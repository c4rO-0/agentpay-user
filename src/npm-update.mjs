import {reportCommandFailure,childCause} from "./command-diagnostics.mjs";
import {atomicWritePrivate, assertPrivateFile} from './private-journal-files.mjs';
import {withInstallationOperation, runInstallationCommand} from './installation-operation.mjs';
import {maintenanceServiceScope} from './service-selection.mjs';
// SPDX-License-Identifier: MPL-2.0
// Update real global or project npm installations. Source checkouts/npm links are never
// overwritten. npm selects User; User's exact dependencies select Wallet/Protocol.
import { access, appendFile, copyFile, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { installedUserDir, resolveUserDataDir, rememberUserDataDir } from './local-data-directory.mjs';
import { installationDirectory } from './installation-paths.mjs';
import { prepareOfficialTestUpdate } from './official-test-update.mjs';
const execute = runInstallationCommand;
const name = '@c4roa0/agentpay-user';
const stable = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
function newer(next, current) {
  const a = next.split('.').map(BigInt), b = current.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function command(file, args, { logPath, timeout = 120000, env = process.env, cwd = process.cwd(), onStdout } = {}) {
  try {
    const result = await execute(file, args, { timeout, cwd, onStdout, maxBuffer: 2 * 1024 * 1024,
      env: { ...env, PATH: dirname(process.execPath) + ':' + (env.PATH || '') } });
    if (logPath) await appendFile(logPath, result.stdout + result.stderr, {mode:0o600});
    return onStdout ? '' : result.stdout.trim();
  } catch (error) {
    if (logPath) await appendFile(logPath, String(error.stdout || '') + String(error.stderr || ''), {mode:0o600});
    throw Object.assign(Error('Update helper failed'),{code:'COMMAND_FAILED',cause:childCause(error.stderr)||error});
  }
}
async function askConfirmation(message) {
  if (!process.stdin.isTTY) throw Error('Run agentpay update in a terminal, or use -f.');
  const terminal = createInterface({ input:process.stdin, output:process.stdout });
  try { return await terminal.question(message + '\n> '); } finally { terminal.close(); }
}
// Resolve the installed package, not the terminal's working directory. A project
// update must name a direct dependency; never promote a transitive package or
// replace a linked source checkout as a side effect of updating User.
async function installationTarget(userDir, npm) {
  const root = await npm(['root', '--global']);
  if (!isAbsolute(root)) throw Error('npm installation paths could not be verified.');
  const globalPath = join(root, name);
  const info = await lstat(globalPath).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
  if (info?.isDirectory() && !info.isSymbolicLink() && await realpath(globalPath) === await realpath(userDir)) {
    const prefix = await npm(['prefix', '--global']);
    if (!isAbsolute(prefix)) throw Error('npm installation paths could not be verified.');
    return {prefix, flags:['--global'], directory:globalPath};
  }
  const scope = dirname(userDir), modules = dirname(scope), prefix = dirname(modules);
  if (basename(userDir) !== 'agentpay-user' || basename(scope) !== '@c4roa0' || basename(modules) !== 'node_modules' ||
      !(await lstat(userDir)).isDirectory() || (await lstat(userDir)).isSymbolicLink())
    throw Error('This is a source checkout or linked installation. Update its files, run npm ci, then agentpay repair.');
  const project = JSON.parse(await readFile(join(prefix,'package.json'),'utf8'));
  const sections = ['dependencies','devDependencies','optionalDependencies'].filter(key => Object.hasOwn(project[key] || {}, name));
  if (sections.length !== 1 || typeof project[sections[0]][name] !== 'string')
    throw Error('User must be a direct npm dependency of this folder. Install it in a dedicated folder before using update.');
  const spec = project[sections[0]][name];
  if (/[:/\\]/.test(spec) || spec.startsWith('.'))
    throw Error('This dependency uses a custom source. Update that source explicitly, then run agentpay repair.');
  const save = {dependencies:'--save-prod',devDependencies:'--save-dev',optionalDependencies:'--save-optional'}[sections[0]];
  return {prefix, directory:userDir, section:sections[0], spec,
    flags:['--global=false','--workspaces=false','--save-exact',save,'--include=dev','--include=optional']};
}

export async function updateFromNpm(options = {}) {
  try { return await withInstallationOperation(() => updateUnderLock(options)); }
  catch(error) { await reportCommandFailure(error,{operation:"Update",write:options.write||console.log}); return 1; }
}
async function updateUnderLock({
  userDir = installedUserDir, dataDir, force = false, write = console.log,
  ask = askConfirmation,
  npm = (args, options) => command('npm', args, options),
  service = (action, options) => command(process.execPath, [join(userDir,'scripts/autostart.mjs'), action], options),
  repair = options => {
    let pending = '';
    return command(process.execPath, [join(userDir,'scripts/repair.mjs'), '-f'], {...options, onStdout(chunk) {
      pending += chunk;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) write(line);
    }}).finally(() => { if (pending) write(pending); });
  },
  officialTest = prepareOfficialTestUpdate,
  serviceScope = maintenanceServiceScope,
} = {}) {
  let logPath, installing = false;
  try {
    userDir = resolve(userDir);
    const current = JSON.parse(await readFile(join(userDir, 'package.json'), 'utf8'));
    if (current.name !== name || !stable(current.version)) throw Error('Unrecognized User installation.');
    write('Checking for a User update…');
    const target = await installationTarget(userDir, npm);
    await access(dirname(target.directory), constants.W_OK);
    const progressPath = join(installationDirectory(), 'update-' + createHash('sha256').update(userDir).digest('hex') + '.json');
    let pending;
    try {
      await assertPrivateFile(progressPath);
      if ((await lstat(progressPath)).size > 16384) throw Error('Invalid update recovery record.');
      pending = JSON.parse(await readFile(progressPath,'utf8'));
      if (pending.version !== 1 || pending.installation !== userDir || !stable(pending.targetVersion) ||
          !stable(pending.walletVersion) || !stable(pending.protocolVersion) || !isAbsolute(pending.dataDir))
        throw Error('Invalid update recovery record. Keep it for review.');
    } catch(error) { if(error.code !== 'ENOENT') throw error; }
    dataDir ??= await resolveUserDataDir({userDir});
    if (pending && pending.dataDir !== dataDir) throw Error('The interrupted update belongs to another data folder. Keep its recovery record for review.');
    const scope = await serviceScope({userDir,dataDir,resumeUpdate:true});
    const resumeSwitch = async options => {
      if (!scope.resumeSwitch) return;
      write('Continuing your previously confirmed installation switch…');
      // Prepare the confirmed target without launching it; repair starts it once.
      const output = await service('activate-setup',options);
      if(output)write(output);
    };
    if (pending && current.version === pending.targetVersion) {
      installing = true;
      if (current.dependencies?.['@c4roa0/agentpay-wallet'] !== pending.walletVersion ||
          current.dependencies?.['@c4roa0/agentpay-protocol'] !== pending.protocolVersion)
        throw Error('The interrupted update has mismatched dependencies. Reinstall the confirmed User version, then retry.');
      write('Continuing the interrupted update. Checking installed packages and service settings.');
      const configured = await lstat(join(dataDir,'runtime/local-services.json')).then(s=>s.isFile(),e=>{if(e.code==='ENOENT')return false;throw e;});
      if (configured) {
        await resumeSwitch({env:{...process.env,AGENTPAY_USER_DATA_DIR:dataDir},cwd:target.prefix,timeout:600000});
        const output = await repair({env:{...process.env,AGENTPAY_USER_DATA_DIR:dataDir},cwd:target.prefix,timeout:600000});
        if(output)write(output);
      } else await officialTest({userDir,dataDir,write});
      await unlink(progressPath);
      write(`User ${current.version} update completed. No paid test was started.`);
      return 0;
    }
    if(pending && newer(current.version,pending.targetVersion))
      throw Error('Installed User is newer than the interrupted update. Keep the recovery record for review; no downgrade was attempted.');
    const metadata = JSON.parse(await npm(['view',name + '@' + (pending?.targetVersion || 'latest'),'--json'], {cwd:target.prefix}));
    if (metadata.name !== name || !stable(metadata.version) ||
        !stable(metadata.dependencies?.['@c4roa0/agentpay-wallet']) ||
        !stable(metadata.dependencies?.['@c4roa0/agentpay-protocol']))
      throw Error('The published User release does not declare reviewed package versions.');
    if (pending && (metadata.version !== pending.targetVersion || metadata.dependencies["@c4roa0/agentpay-wallet"] !== pending.walletVersion || metadata.dependencies["@c4roa0/agentpay-protocol"] !== pending.protocolVersion))
      throw Error("The published package differs from the interrupted update. No program files were changed.");
    if (!newer(metadata.version,current.version)) {
      if (scope.resumeSwitch) {
        if (!force && (await ask("Continue the previously confirmed installation switch? Type 'confirm', or 'q' to cancel")).trim().toLowerCase() !== 'confirm') {
          write('Update cancelled. The saved switch was kept.'); return 0;
        }
        const options={env:{...process.env,AGENTPAY_USER_DATA_DIR:dataDir},cwd:target.prefix,timeout:600000};
        // Even without a new package, keep repair resumable if the process exits
        // after selecting the target units but before the one final service start.
        if (!stable(current.dependencies?.['@c4roa0/agentpay-wallet']) || !stable(current.dependencies?.['@c4roa0/agentpay-protocol']))
          throw Error('Installed package dependencies could not be verified.');
        await atomicWritePrivate(progressPath, JSON.stringify({version:1,installation:userDir,dataDir,
          targetVersion:current.version,walletVersion:current.dependencies['@c4roa0/agentpay-wallet'],
          protocolVersion:current.dependencies['@c4roa0/agentpay-protocol']}) + '\n');
        installing = true;
        await resumeSwitch(options);
        const output=await repair(options); if(output)write(output);
        await unlink(progressPath);
        return 0;
      }
      write(`User ${current.version} is current. Checking the official test Skill.`);
      await officialTest({userDir,dataDir,write});
      return 0;
    }
    // Read the installed dependency, not the version requested by User's manifest.
    // Missing/broken packages must not prevent npm from repairing the installation.
    let walletVersion;
    try {
      const file = createRequire(join(userDir,'package.json')).resolve('@c4roa0/agentpay-wallet/package.json');
      const wallet = JSON.parse(await readFile(file,'utf8'));
      if(wallet.name === '@c4roa0/agentpay-wallet' && stable(wallet.version)) walletVersion = wallet.version;
    } catch {}
    const targetWallet = metadata.dependencies['@c4roa0/agentpay-wallet'];
    write('Installed packages → update target');
    write(`User    ${current.version} → ${metadata.version}`);
    write(`Wallet  ${walletVersion === targetWallet ? `${walletVersion} (unchanged)` : `${walletVersion || 'not confirmed'} → ${targetWallet}`}`);
    write(`Installation folder: ${target.prefix}`);
    if (scope.resumeSwitch) write('After updating, AgentPay will finish your previously confirmed installation switch.');
    write(scope.active ? 'Background services will pause. Keys, permissions, Orders and cache are kept.' : scope.resumeSwitch ? 'Services are stopped. Keys, permissions, Orders and cache are kept.' : 'This installation is inactive. The running Wallet and Runtime will not change.');
    if (!force && (await ask("Type 'confirm' to update, or 'q' to cancel")).trim().toLowerCase() !== 'confirm') {
      write('Update cancelled. Nothing was changed.'); return 0;
    }
    // Persist a custom directory before replacing this package; no key/Policy changes.
    await rememberUserDataDir({userDir,dataDir});
    const stateDir = installationDirectory();
    await mkdir(stateDir,{recursive:true,mode:0o700});
    logPath = join(stateDir, `update-${Date.now()}-${randomUUID()}.log`);
    const rechecked = JSON.parse(await readFile(join(userDir,'package.json'),'utf8'));
    if (rechecked.version !== current.version || rechecked.name !== name)
      throw Error('Program files changed while reviewing the update. Run agentpay update again.');
    if (target.section) {
      const project = JSON.parse(await readFile(join(target.prefix,'package.json'),'utf8'));
      if (project[target.section]?.[name] !== target.spec)
        throw Error('The project dependency changed while reviewing the update. Run agentpay update again.');
    }
    const env = {...process.env,AGENTPAY_USER_DATA_DIR:dataDir};
    const options = {logPath,env,cwd:target.prefix,timeout:600000};
    const spec = name + '@' + metadata.version;
    const args = ['install',...target.flags,'--prefix',target.prefix,'--engine-strict','--ignore-scripts','--no-audit','--no-fund',spec];
    write('1/3 Check the update requirements.');
    // npm dry-run may rewrite its hidden installed-tree lockfile. Preflight in
    // a disposable prefix, never the live installation. Carry project npm settings
    // privately so registry/auth selection remains consistent with the real install.
    const preflight = await mkdtemp(join(stateDir,'update-check-'));
    try {
      await copyFile(join(target.prefix,'.npmrc'),join(preflight,'.npmrc')).then(
        () => chmod(join(preflight,'.npmrc'),0o600),
        error => { if(error.code !== 'ENOENT') throw error; });
      await npm(['install','--global=false','--prefix',preflight,'--engine-strict',
        '--ignore-scripts','--no-audit','--no-fund',spec,'--dry-run'],
        {...options,cwd:preflight});
    } finally { await rm(preflight,{recursive:true,force:true}); }
    let configured = false;
    try { configured = (await lstat(join(dataDir,'runtime/local-services.json'))).isFile(); }
    catch(e) { if(e.code !== 'ENOENT') throw e; }
    // Record the confirmed version before stopping or replacing anything. A retry
    // must finish repair even when npm already installed the target version.
    await atomicWritePrivate(progressPath, JSON.stringify({version:1,installation:userDir,dataDir,
      targetVersion:metadata.version,walletVersion:metadata.dependencies['@c4roa0/agentpay-wallet'],
      protocolVersion:metadata.dependencies['@c4roa0/agentpay-protocol']}) + '\n');
    // All imports used by this updater are loaded before npm replaces its files.
    if (configured && scope.active) await service('stop',options);
    installing = true;
    write('2/3 Install User and its matching Wallet. This may take a few minutes.');
    await npm(args,options);
    const installed = JSON.parse(await readFile(join(userDir,'package.json'),'utf8'));
    if(installed.name !== name || installed.version !== metadata.version ||
       installed.dependencies?.['@c4roa0/agentpay-wallet'] !== metadata.dependencies['@c4roa0/agentpay-wallet'] ||
       installed.dependencies?.['@c4roa0/agentpay-protocol'] !== metadata.dependencies['@c4roa0/agentpay-protocol'])
      throw Error('The installed version does not match the confirmed update.');
    if (configured) {
      await resumeSwitch(options);
      write(scope.active || scope.resumeSwitch ? '3/3 Restore services and verify the official test Skill.' : '3/3 Verify the inactive installation and official test Skill.');
      // A fresh Node process loads the NEW repair/client/official digest, not old imports.
      const output = await repair(options);
      if(output) write(output);
    } else {
      write('3/3 Program files are ready. Local setup has not been configured.');
      write('Next: agentpay install --market YOUR_MARKET_URL');
    }
    await unlink(progressPath);
    write(`User ${metadata.version} installed. No paid test was started.`);
    return 0;
  } catch(error) {
    await reportCommandFailure(error,{operation:"Update",write,logPath});
    write(installing
      ? 'Update did not finish. Your private data was kept. Reinstall the intended User version with npm if needed, then run agentpay repair.'
      : 'Update stopped before replacing program files. ' + (error.code === 'EEXIST' ? 'Another installation is running.' : error.message));
    if(logPath) write('Log: ' + logPath);
    return 1;
  }
}
