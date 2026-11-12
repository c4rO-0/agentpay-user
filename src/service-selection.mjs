import {importHistoricalRequests} from './default-request-owner.mjs';
// SPDX-License-Identifier: MPL-2.0
// One managed service pair per OS user. A switch never changes Wallet identity.
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { autostartFiles, units } from './autostart-files.mjs';
import { installationDirectory } from './installation-paths.mjs';
import { withInstallationOperation } from './installation-operation.mjs';
import { readServiceSettings, listenerPresent } from './local-services.mjs';
import { atomicWritePrivate } from './private-journal-files.mjs';
import { ensureRuntimeConnection } from './runtime-connection-settings.mjs';
import { waitForServiceReadiness } from './service-readiness.mjs';

export async function installedServiceSelection(unitDir = join(homedir(), '.config/systemd/user'), recovery, {allowPartial = false} = {}) {
  let identity;
  let count = 0;
  for (const name of units) {
    const path = join(unitDir,name);
    let info;
    try { info = await lstat(path); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o022)
      throw Error('Existing service files need ownership review before switching.');
    const body = await readFile(path,'utf8');
    const line = body.split('\n').find(s => s.startsWith('ExecStart='));
    const args = [...(line || '').matchAll(/"(?:\\.|[^"\\])*"/g)].map(([s]) => JSON.parse(s).replaceAll('%%','%').replaceAll('$$','$'));
    const suffix = name.includes('reminder') ? '/scripts/login-notify.mjs' : '/scripts/local-service.mjs';
    if (!args[1]?.endsWith(suffix) || !args[2]) throw Error('Unrecognized startup file. No service was changed.');
    const found = {node:args[0], userDir:args[1].slice(0,-suffix.length), dataDir:args[2]};
    const recoverable = recovery && [recovery.previous,recovery.target].filter(Boolean).some(value=>autostartFiles(value)[name]===body);
    if ((recovery && !recoverable) || autostartFiles(found)[name] !== body || (!recoverable && identity && JSON.stringify(found) !== JSON.stringify(identity)))
      throw Error('Startup files belong to conflicting configurations. No service was changed.');
    identity = found; count++;
  }
  if (!recovery && !allowPartial && count && count !== units.length) throw Error('Startup files are incomplete. Repair the original installation before switching.');
  return recovery ? (recovery.previous || recovery.target) : identity;
}

// Full, exact target units distinguish a failed service command from interrupted
// file replacement. Never infer completion from only one surviving unit.
async function targetUnitsPrepared(unitDir, target) {
  try {
    const found = await installedServiceSelection(unitDir);
    return Boolean(found && ['node','userDir','dataDir'].every(key => found[key] === target?.[key]));
  } catch { return false; }
}

// A cancelled first setup can own generated units before it has a Wallet or
// runtime address. Only that demonstrably unconfigured state may omit settings;
// missing settings in an established installation still require review.
async function previousServiceSettings(dataDir) {
  try { return await readServiceSettings(dataDir); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    for (const directory of [dataDir, join(dataDir,'wallet'), join(dataDir,'runtime')]) {
      const info = await lstat(directory).catch(e => { if(e.code==='ENOENT' && directory!==dataDir)return null;throw e; });
      if (info && (!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid() || info.mode & 0o077))
        throw Error('Previous installation directories need ownership review before switching.');
    }
    for (const name of ['wallet/session.keystore.json','wallet/policy.json','runtime/local-services.json','runtime/connection.json']) {
      const exists = await lstat(join(dataDir,name)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
      if (exists) throw Error('Previous installation has saved Wallet or Runtime settings, but its service configuration is incomplete. Keep its files and repair it before switching.');
    }
    return null;
  }
}

// The caller holds this lock through unit replacement and start/stop. No prompts
// can grant approval to a different target while the current transition writes.
export async function withServiceSelection({target, action, ask, write = console.log, ctl, unitDir, operation, verifyReady = waitForServiceReadiness}) {
  return withServiceLifecycleLock(async () => {
    const canonical = path => realpath(path).catch(error=>{if(error.code==='ENOENT')return resolve(path);throw error;});
    target = {...target,userDir:await canonical(target.userDir),dataDir:await canonical(target.dataDir)};
    const state = installationDirectory();
    const journalPath = join(state,'active-services.json');
    let recovery, savedSelection;
    try {
      const st=await lstat(journalPath);
      if (!st.isFile() || st.isSymbolicLink() || st.uid!==process.getuid() || st.mode & 0o077 || st.size>32768) throw Error('Unsafe service transition record.');
      const saved=JSON.parse(await readFile(journalPath,'utf8'));
      savedSelection=saved;
      if (saved.version!==1) throw Error('Invalid service transition record.');
      if (['stopping','preparing'].includes(saved.phase)) {
        if (!saved.target || await canonical(saved.target.dataDir)!==target.dataDir || await canonical(saved.target.userDir)!==target.userDir) throw Error('A switch was interrupted. Retry from the originally selected installation before choosing another one.');
        recovery=saved;
      }
    } catch(e) { if(e.code!=='ENOENT')throw e; }
    if (recovery && await targetUnitsPrepared(unitDir,recovery.target)) {
      // Also recover journals written before the explicit units-prepared checkpoint.
      await atomicWritePrivate(journalPath,JSON.stringify({version:1,phase:'stopped',target:recovery.target,startupChoice:recovery.startupChoice})+'\n');
      savedSelection={...recovery,phase:'stopped'};
      recovery=undefined;
    }
    const previous = await installedServiceSelection(unitDir,recovery);
    if (action === 'status') return operation({previous,switched:false});
    if (recovery && !['start','restart','activate-setup'].includes(action))
      throw Error('A service switch is unfinished. Retry agentpay service start before changing startup preferences.');
    let startupChoice=recovery?.startupChoice || (savedSelection?.target?.dataDir===target.dataDir ? savedSelection.startupChoice : undefined);
    const different = previous && (previous.dataDir !== target.dataDir || previous.userDir !== target.userDir);
    if (different) {
      if (!['start','restart','activate-setup'].includes(action))
        throw Error('Another installation owns the background services. Run service start from this installation to switch explicitly.');
      write('\nSwitch AgentPay installation');
      write('Current data: ' + previous.dataDir);
      write('Selected data: ' + target.dataDir);
      write('Wallet and Runtime will stop. Keys, permissions and Order records stay in their own folders.');
      if (!ask || String(await ask("Type 'confirm' to switch, or 'q' to cancel")).trim().toLowerCase() !== 'confirm') {
        write('Switch cancelled. Existing services were kept.');
        return {cancelled:true};
      }
      if (!startupChoice) {
        const states=await Promise.all(units.slice(0,2).map(async name=>String((await ctl('show',name,'--property=UnitFileState','--value')).stdout || '').trim()));
        if (states.every(s=>s==='enabled')) startupChoice='enabled';
        else if (states.every(s=>s==='disabled')) startupChoice='disabled';
      }
      await atomicWritePrivate(join(state,'active-services.json'),JSON.stringify({version:1,phase:'stopping',previous,target,startupChoice})+'\n');
      await ctl('stop',...units);
      // is-active returning nonzero alone is not evidence of a successful stop:
      // inspect explicit ActiveState values, including failed/inactive only.
      for (const name of units) {
        const result = await ctl('show',name,'--property=ActiveState','--value');
        if (!['inactive','failed'].includes(String(result.stdout || '').trim()))
          throw Error('Previous services have not stopped. The selected installation was not started.');
      }
    }
    if (different) {
      const settings = await previousServiceSettings(previous.dataDir);
      if (await listenerPresent(join(previous.dataDir,'wallet/wallet.sock')) ||
          (settings && await listenerPresent({host:'127.0.0.1',port:Number(new URL(settings.runtimeUrl).port)})))
        throw Error('An original Wallet or Runtime listener is still running. Stop it before switching; no new service was started.');
    }
    if (different) {
      for (const dataDir of new Set([previous.dataDir,target.dataDir])) {
        const history = await importHistoricalRequests(dataDir);
        if (history?.unclassified)
          write('Some older requests need review. Their original files are kept; automatic replacement purchases are blocked.');
      }
    }
    const journal = join(state,'active-services.json');
    const starts = ['start','restart'].includes(action);
    const preservesRunning = !different && !recovery && !['stop','remove'].includes(action) &&
      savedSelection?.phase === 'selected' && savedSelection.target?.dataDir === target.dataDir &&
      savedSelection.target?.userDir === target.userDir;
    // Preference-only operations must not revive a stopped default connection.
    if (starts || different || recovery || ['stop','remove'].includes(action))
      await atomicWritePrivate(journal,JSON.stringify({version:1,phase:'preparing',previous,target,startupChoice})+'\n');
    // Reusing data across program installations moves only the client locator.
    // Consent and stopped-listener checks above must precede this write. On retry
    // the locator may already point here; unrelated paths still require review.
    if (different && previous.dataDir === target.dataDir) {
      await ensureRuntimeConnection({
        dataDir:target.dataDir, write, refreshClientModule:true,
        previousClientModule:join(previous.userDir,'src/runtime-client.mjs'),
      });
    }
    // Exact old unit bodies may be replaced only inside this confirmed transition.
    const unitsPrepared = async () => {
      if (!await targetUnitsPrepared(unitDir,target))
        throw Error('Service files are incomplete. Retry agentpay service start from this installation.');
      // "stopped" closes the default route; it is not a claim about process state.
      // Persist before invoking systemctl so a crash/timeout still permits repair.
      await atomicWritePrivate(journal,JSON.stringify({version:1,phase:'stopped',target,startupChoice})+'\n');
    };
    const result = await operation({previous, switched:Boolean(different), unitsPrepared});
    if (starts) {
      write('Checking Wallet and Runtime readiness…');
      try { await verifyReady(target.dataDir); }
      catch (error) {
        // Unit installation completed. Keep the default closed, but allow repair
        // or a later start instead of stranding it in a unit-write transition.
        await atomicWritePrivate(journal,JSON.stringify({version:1,phase:'stopped',target,startupChoice})+'\n');
        throw error;
      }
    }
    if(action==='enable')startupChoice='enabled';
    if(action==='disable' || action==='remove')startupChoice='disabled';
    const phase = starts || preservesRunning ? 'selected' : 'stopped';
    await atomicWritePrivate(journal,JSON.stringify({version:1,phase,target,startupChoice})+'\n');
    return result;
  });
}

// Uninstall shares the service transition lock. Keep confirmation outside this
// section, then re-read the selected scope before making destructive changes.
export async function withServiceLifecycleLock(operation) {
  return withInstallationOperation(operation);
}

// Called while holding the installation-operation lock. Maintenance of an inactive
// program tree must never claim the fixed service pair or rewrite active data.
export async function maintenanceServiceScope({userDir,dataDir,unitDir}) {
  const canonical = async path => realpath(path).catch(error=>{if(error.code==='ENOENT')return resolve(path);throw error;});
  userDir = await canonical(userDir); dataDir = await canonical(dataDir);
  let saved;
  try {
    const path=join(installationDirectory(),'active-services.json');
    const {assertPrivateFile}=await import('./private-journal-files.mjs');
    await assertPrivateFile(path); saved=JSON.parse(await readFile(path,'utf8'));
    if(saved.version!==1)throw Error('Unrecognized service selection. Keep it for review.');
    if(['stopping','preparing'].includes(saved.phase) && !await targetUnitsPrepared(unitDir,saved.target))
      throw Error('A service switch is unfinished. Retry service start from its selected installation before maintenance.');
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  const owner=await installedServiceSelection(unitDir) || saved?.target;
  if(!owner)return {active:true}; // Existing single-install setup/repair behavior.
  if(await canonical(owner.userDir)===userDir && await canonical(owner.dataDir)===dataDir)return {active:true};
  if(await canonical(owner.userDir)===userDir || await canonical(owner.dataDir)===dataDir)
    throw Error('Another service selection shares these program or data files. Switch explicitly before repairing or updating this installation.');
  return {active:false};
}
