// SPDX-License-Identifier: MPL-2.0
// Update real global or project npm installations. Source checkouts/npm links are never
// overwritten. npm selects User; User's exact dependencies select Wallet/Protocol.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, appendFile, copyFile, chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { installedUserDir, resolveUserDataDir, rememberUserDataDir } from './local-data-directory.mjs';
import { installationDirectory } from './installation-paths.mjs';
import { prepareOfficialTestUpdate } from './official-test-update.mjs';
const execute = promisify(execFile);
const name = '@c4roa0/agentpay-user';
const stable = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
function newer(next, current) {
  const a = next.split('.').map(BigInt), b = current.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function command(file, args, { logPath, timeout = 120000, env = process.env, cwd = process.cwd() } = {}) {
  try {
    const result = await execute(file, args, { timeout, cwd, maxBuffer: 2 * 1024 * 1024,
      env: { ...env, PATH: dirname(process.execPath) + ':' + (env.PATH || '') } });
    if (logPath) await appendFile(logPath, result.stdout + result.stderr, {mode:0o600});
    return result.stdout.trim();
  } catch (error) {
    if (logPath) await appendFile(logPath, String(error.stdout || '') + String(error.stderr || ''), {mode:0o600});
    throw Error(logPath ? 'The command did not complete. Check the update log.' : 'Could not query npm. Check your network and npm configuration, then retry.');
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

export async function updateFromNpm({
  userDir = installedUserDir, dataDir, force = false, write = console.log,
  ask = askConfirmation,
  npm = (args, options) => command('npm', args, options),
  service = (action, options) => command(process.execPath, [join(userDir,'scripts/autostart.mjs'), action], options),
  repair = options => command(process.execPath, [join(userDir,'scripts/repair.mjs'), '-f'], options),
  officialTest = prepareOfficialTestUpdate,
} = {}) {
  let lock, lockPath, logPath, installing = false;
  try {
    userDir = resolve(userDir);
    const current = JSON.parse(await readFile(join(userDir, 'package.json'), 'utf8'));
    if (current.name !== name || !stable(current.version)) throw Error('Unrecognized User installation.');
    write('Checking for a User update…');
    const target = await installationTarget(userDir, npm);
    await access(dirname(target.directory), constants.W_OK);
    const metadata = JSON.parse(await npm(['view',name + '@latest','--json'], {cwd:target.prefix}));
    if (metadata.name !== name || !stable(metadata.version) ||
        !stable(metadata.dependencies?.['@c4roa0/agentpay-wallet']) ||
        !stable(metadata.dependencies?.['@c4roa0/agentpay-protocol']))
      throw Error('The published User release does not declare reviewed package versions.');
    dataDir ??= await resolveUserDataDir({userDir});
    if (!newer(metadata.version,current.version)) {
      write(`User ${current.version} is current. Checking the official test Skill.`);
      await officialTest({userDir,dataDir,write});
      return 0;
    }
    write(`User ${current.version} → ${metadata.version} · Wallet ${metadata.dependencies['@c4roa0/agentpay-wallet']}`);
    write(`Installation folder: ${target.prefix}`);
    write('Background services will pause. Keys, permissions, Orders and cache are kept.');
    if (!force && (await ask("Type 'confirm' to update, or 'q' to cancel")).trim().toLowerCase() !== 'confirm') {
      write('Update cancelled. Nothing was changed.'); return 0;
    }
    // Persist a custom directory before replacing this package; no key/Policy changes.
    await rememberUserDataDir({userDir,dataDir});
    const stateDir = installationDirectory();
    await mkdir(stateDir,{recursive:true,mode:0o700});
    logPath = join(stateDir, `update-${Date.now()}-${randomUUID()}.log`);
    lockPath = join(stateDir,'install.lock');
    lock = await open(lockPath,'wx',0o600);
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
    // All imports used by this updater are loaded before npm replaces its files.
    if (configured) await service('stop',options);
    installing = true;
    write('2/3 Install User and its matching Wallet. This may take a few minutes.');
    await npm(args,options);
    const installed = JSON.parse(await readFile(join(userDir,'package.json'),'utf8'));
    if(installed.name !== name || installed.version !== metadata.version ||
       installed.dependencies?.['@c4roa0/agentpay-wallet'] !== metadata.dependencies['@c4roa0/agentpay-wallet'] ||
       installed.dependencies?.['@c4roa0/agentpay-protocol'] !== metadata.dependencies['@c4roa0/agentpay-protocol'])
      throw Error('The installed version does not match the confirmed update.');
    // Release before the new version's repair acquires the same lock. Another
    // operation may win that lock; repair then refuses safely and can be retried.
    await lock.close(); lock = null; await unlink(lockPath); lockPath = null;
    if (configured) {
      write('3/3 Restore services and verify the official test Skill.');
      // A fresh Node process loads the NEW repair/client/official digest, not old imports.
      const output = await repair(options);
      if(output) write(output);
    } else {
      write('3/3 Program files are ready. Local setup has not been configured.');
      write('Next: agentpay install --market YOUR_MARKET_URL');
    }
    write(`User ${metadata.version} installed. No paid test was started.`);
    return 0;
  } catch(error) {
    write(installing
      ? 'Update did not finish. Your private data was kept. Reinstall the intended User version with npm if needed, then run agentpay repair.'
      : 'Update stopped before replacing program files. ' + (error.code === 'EEXIST' ? 'Another installation is running.' : error.message));
    if(logPath) write('Log: ' + logPath);
    return 1;
  } finally {
    if(lock) { await lock.close(); await unlink(lockPath); }
  }
}
