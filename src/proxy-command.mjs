// SPDX-License-Identifier: MPL-2.0
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {askTerminal} from './terminal-input.mjs';
import {readProxy, proxyAddress, proxyEnvironment} from './service-proxy.mjs';
import {atomicWritePrivate} from './private-journal-files.mjs';
import {readPrivateJson} from './deployment-status.mjs';
import {installedUserDir, resolveUserDataDir} from './local-data-directory.mjs';
import {withInstallationOperation} from './installation-operation.mjs';
import {installedServiceSelection, maintenanceServiceScope} from './service-selection.mjs';
import {listenerPresent, serviceSettings} from './local-services.mjs';
import {waitForServiceReadiness} from './service-readiness.mjs';

const execute = promisify(execFile);
const systemctl = (...args) => execute('systemctl',['--user',...args],{timeout:30000});
const roles = ['wallet','runtime'];
const unit = role => 'agentpay-local-'+role+'.service';
const revision = config => config?.enabled ? config.revision : 'off';

async function runningServices(dataDir,ctl,{recover = false} = {}) {
  if (process.platform !== 'linux' || !await installedServiceSelection() ||
      !(await maintenanceServiceScope({userDir:installedUserDir,dataDir})).active) return [];
  return Promise.all(roles.map(async role => {
    const {stdout} = await ctl('show',unit(role),'--property=ActiveState,InvocationID');
    const state = /^ActiveState=(.*)$/m.exec(stdout)?.[1];
    if (!['active','inactive','failed'].includes(state) && !(recover && ['activating','deactivating','reloading'].includes(state)))
      throw Error('Services are changing state. Check agentpay status, then retry.');
    const invocation = /^InvocationID=([a-f0-9]{32})$/m.exec(stdout)?.[1];
    const receipt = await readPrivateJson(join(dataDir,'runtime','proxy-'+role+'.json'));
    return {role,state,invocation,revision:invocation && receipt?.invocation === invocation ? receipt.revision : undefined};
  }));
}

async function unmanagedListener(dataDir) {
  if (await listenerPresent(join(dataDir,'wallet/wallet.sock'))) return true;
  const raw = await readPrivateJson(join(dataDir,'runtime/local-services.json'));
  if (!raw) return false;
  // The fixed port may legitimately belong to another selected installation.
  const owner = process.platform === 'linux' && await installedServiceSelection();
  if (owner && !(await maintenanceServiceScope({userDir:installedUserDir,dataDir})).active) return false;
  const {runtimeUrl} = serviceSettings(raw);
  return listenerPresent({host:'127.0.0.1',port:Number(new URL(runtimeUrl).port)});
}

async function edit(saved, ask) {
  const answer = (await ask('HTTP or HTTPS proxy address'+(saved ? ' (Enter to keep '+saved.address+')' : ' (example http://127.0.0.1:7890)'))).trim();
  const address = proxyAddress(answer || saved?.address);
  const same = address === saved?.address;
  const previous = same ? saved.username : '';
  const name = (await ask('Username (Enter for '+(previous ? 'saved user, or type - to remove authentication' : 'no authentication')+')')).trim();
  const username = name === '-' ? '' : name || previous;
  if (/[:\x00-\x1f\x7f]/.test(username)) throw Object.assign(Error('Invalid proxy username.'),{code:'PROXY_USERNAME_INVALID'});
  const keep = same && username === previous;
  const password = username ? await ask('Proxy password'+(keep ? ' (Enter to keep)' : ''),{hidden:true}) || (keep ? saved.password : '') : '';
  if (same && username === saved.username && password === saved.password) return saved;
  return {version:1,enabled:saved?.enabled ?? false,address,username,password,revision:randomUUID()};
}

async function verify(config,dataDir,write) {
  write('Checking Settlement and chain RPC through the selected connection…');
  const env = {...proxyEnvironment(config)};
  try {
    const {stdout} = await execute(process.execPath,[join(installedUserDir,'scripts/probe-service-proxy.mjs'),dataDir],{env,timeout:30000});
    write(stdout.trim());
  } catch (error) {
    write(error.stdout?.trim() || 'Proxy check timed out or could not start. Check the address and retry.');
    return false;
  }
  return true;
}

export async function proxyCommand(args,{ask=askTerminal,write=console.log,ctl=systemctl}={}) {
  const [action='status'] = args;
  if (args.length>1 || !['status','configure','on','off','clear'].includes(action)) {
    write('Use agentpay proxy [status|configure|on|off|clear].'); return 1;
  }
  const dataDir = await resolveUserDataDir();
  const path = join(dataDir,'runtime/proxy.json');
  const read = () => readProxy(dataDir,{allowInvalid:action === 'clear'});
  const saved = await read();
  const inspect = () => runningServices(dataDir,ctl,{recover:Boolean(saved?.invalid)});
  const services = await inspect();
  const active = services.filter(s => s.state === 'active');
  if (action === 'status') {
    write(saved ? 'Proxy '+(saved.enabled?'on':'off')+' · '+saved.address+' · authentication '+(saved.username?'configured':'unused') : 'Proxy off · no saved address');
    for (const service of services) write(service.role+' · '+(service.state !== 'active' ? service.state :
      service.revision === revision(saved) ? 'using saved mode' : 'running mode unverified'));
    if (!services.length) write('No managed service pair selected for this installation.');
    return 0;
  }
  let next = saved;
  if (action === 'configure' || (action === 'on' && !saved)) next = await edit(saved,ask);
  if (action === 'on') next = {...next,enabled:true};
  if (action === 'off' && saved) next = {...saved,enabled:false};
  if (action === 'clear') next = null;
  const changed = JSON.stringify(next) !== JSON.stringify(saved);
  const recovering = Boolean(saved?.invalid);
  // Clear damaged settings even while systemd is cycling through crash restarts.
  // Stop the selected pair first and leave startup to the operator.
  const stopUnhealthy = recovering && services.length > 0;
  const restart = active.some(s => s.revision !== revision(next) &&
    (next?.enabled || saved?.enabled || saved?.invalid || s.revision !== undefined || action !== 'configure'));
  if (restart && !recovering && active.length !== roles.length) {
    write('Only one managed service is running. Stop the pair with agentpay service stop, then retry.'); return 1;
  }
  if (next?.enabled && (changed || restart) && !await verify(next,dataDir,write)) {
    write(saved?.enabled ? 'The previous proxy setting is still selected.' : 'Proxy was not enabled. This installation is still in direct mode.');
    return 1;
  }
  if (restart || (action === 'clear' && saved)) {
    if (stopUnhealthy) write('The damaged settings will be removed and the affected service pair stopped. Run agentpay service start afterwards.');
    else if (restart) write('Applying the proxy setting restarts Wallet and Runtime. Unlock Wallet afterwards.');
    if (action === 'clear') write('Clearing selects direct connections and removes the saved proxy address and credentials.');
    for (;;) {
      const answer = await ask("Type 'confirm' to continue, or 'q' to cancel");
      if (answer === 'confirm') break;
      if (answer === 'q') { write('Cancelled.'); return 0; }
      write("Enter 'confirm' or 'q'.");
    }
  }
  // Prompts and network checks run unlocked. Commit only against the same
  // installation, saved configuration and service invocations the user saw.
  return withInstallationOperation(async () => {
    if (await resolveUserDataDir() !== dataDir || JSON.stringify(await read()) !== JSON.stringify(saved) ||
        JSON.stringify((await inspect()).map(s => recovering ? s.role : s)) !==
        JSON.stringify(services.map(s => recovering ? s.role : s))) {
      write('Installation or service settings changed. Run the proxy command again to review the current settings.');return 1;
    }
    if (!stopUnhealthy && !active.length && (changed || restart) && await unmanagedListener(dataDir)) {
      write('A service outside the managed service pair is running. Stop this installation’s services before changing its proxy.');return 1;
    }
    if (restart || stopUnhealthy) {
      // An old direct process must stop before an enabled policy becomes visible.
      try { await ctl('stop',...roles.map(unit)); }
      catch { write('Could not stop the previous service pair. Settings were kept. Check agentpay status before retrying.');return 1; }
    }
    if (changed && next) {
      await mkdir(dataDir,{mode:0o700,recursive:true});
      await atomicWritePrivate(path,JSON.stringify(next)+'\n');
    } else if (changed) {
      await unlink(path);
    }
    if (restart && !stopUnhealthy && active.length === roles.length) {
      try {
        await ctl('start',...roles.map(unit));
        await waitForServiceReadiness(dataDir);
        const applied = await runningServices(dataDir,ctl);
        if (applied.length !== 2 || applied.some(s => s.state !== 'active' || s.revision !== revision(next))) throw Error();
      } catch {
        write('The new setting was saved. Service startup could not be verified. Check agentpay status and service logs, then run agentpay service start.');return 1;
      }
    }
    write(action === 'clear' ? 'Saved proxy removed.' : 'Proxy '+(next?.enabled?'on':'off')+(active.length ? '.' : ' · applies on next service start.'));
    return 0;
  });
}
