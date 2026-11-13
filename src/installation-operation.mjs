// SPDX-License-Identifier: MPL-2.0
// Serialize installation writes and managed-service changes. Descriptor locks are
// inherited by npm/repair children: killing the caller does not unlock a live writer.
import {AsyncLocalStorage} from 'node:async_hooks';
import {constants, fstatSync} from 'node:fs';
import {open, mkdir, lstat, unlink, link} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ensureInstallationDirectory} from './installation-paths.mjs';

const context = new AsyncLocalStorage();
export const installationLockMarker = 'agentpay.install-lock.v2\n';
const marker = installationLockMarker;
const fdVariable = 'AGENTPAY_INSTALLATION_LOCK_FD';
const busy = () => Error('Another AgentPay installation or service change is running. Wait for it to finish, then retry.');
function checkFile(info, allowLinks = false) {
  if (!info.isFile() || (!allowLinks && info.nlink !== 1) || info.uid !== process.getuid() || info.mode & 0o077)
    throw Error('Installation lock must be a private regular file owned by you.');
}

export async function withInstallationOperation(operation) {
  const directory = await ensureInstallationDirectory();
  const existing = context.getStore();
  if (existing?.directory === directory) return operation();
  await mkdir(directory,{recursive:true,mode:0o700});
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077)
    throw Error('Installation state directory must be private and owned by you.');
  let tryLock;
  try { ({tryLock} = await import('fs-native-extensions')); }
  catch { throw Error('Installation tools are missing. Reinstall the User npm package, or run npm ci in your User source folder, then retry.'); }
  const path = join(directory,'service-selection.lock');
  const file = await open(path,constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,0o600);
  let ownsMarker = false;
  try {
    const stat = await file.stat(); checkFile(stat);
    const inherited = process.env[fdVariable];
    if (inherited !== undefined) {
      if (!/^\d+$/.test(inherited) || Number(inherited) < 3) throw Error('Invalid installation lock handoff.');
      const fd = Number(inherited), held = fstatSync(fd); checkFile(held);
      if (held.dev !== stat.dev || held.ino !== stat.ino || !tryLock(fd)) throw Error('Invalid installation lock handoff.');
      // A separately opened descriptor must be excluded, proving the inherited
      // descriptor really protects this file; an environment flag alone is not a bypass.
      if (tryLock(file.fd)) throw Error('Installation lock handoff did not preserve exclusion.');
      return await context.run({directory,fd},operation);
    }
    if (!tryLock(file.fd)) throw busy();
    // Preserve interoperability with older installers. Only our recognizable v2
    // marker can be reclaimed after acquiring the native lock. Unknown/empty old
    // markers need operator review, never PID-age based deletion.
    const legacyPath = join(directory,'install.lock');
    const temporary = join(directory, 'install-marker-' + randomUUID());
    let legacy;
    try {
      legacy = await open(temporary,'wx',0o600);
      await legacy.writeFile(marker); await legacy.sync(); await legacy.close(); legacy=undefined;
      await link(temporary,legacyPath);
    } catch(error) {
      await legacy?.close(); legacy = undefined;
      if (error.code !== 'EEXIST') throw error;
      legacy = await open(legacyPath,constants.O_RDONLY | constants.O_NOFOLLOW);
      // A crash between link publication and temporary-name cleanup can leave
      // two names for this marker. We only read/unlink it; the actual native
      // lock file still requires exactly one link and provides exclusion.
      const saved = await legacy.stat(); checkFile(saved, true);
      if (saved.size !== Buffer.byteLength(marker) || await legacy.readFile('utf8') !== marker)
        throw Error('An older installer lock exists. Keep it for review; automatic recovery cannot confirm whether its writer has stopped.');
    } finally {
      await legacy?.close();
      await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
    ownsMarker = true;
    return await context.run({directory,fd:file.fd},operation);
  } finally {
    // Do not unlock explicitly: inherited children may still hold the same open
    // description. Production command runners wait for child close before returning.
    try {
      if (ownsMarker) await unlink(join(directory,'install.lock')).catch(e=>{if(e.code!=='ENOENT')throw e;});
    } finally { await file.close(); }
  }
}

// Only short-lived administration/writer children inherit the lock. Never pass it
// to the Wallet/Runtime daemons, which would keep maintenance blocked indefinitely.
export function installationChildOptions({env = process.env, stdio = ['ignore','pipe','pipe']} = {}) {
  const held = context.getStore();
  const clean = {...env}; delete clean[fdVariable];
  if (!held) return {env:clean,stdio};
  return {env:{...clean,[fdVariable]:String(stdio.length)},stdio:[...stdio,held.fd]};
}

// Wait for close even on timeout/error: returning on a timer while npm still writes
// would release the caller's lock too early. Writer children retain the descriptor.
export async function runInstallationCommand(file, args, {env = process.env, timeout = 120000, maxBuffer = 2 * 1024 * 1024, cwd, onStdout} = {}) {
  const {spawn} = await import('node:child_process');
  return new Promise((resolve,reject) => {
    const child = spawn(file,args,{cwd,...installationChildOptions({env})});
    let stdout='',stderr='',failure,killTimer;
    const stop = error => {
      failure ||= error;
      child.kill('SIGTERM');
      killTimer ||= setTimeout(()=>child.kill('SIGKILL'),1000);
    };
    const timer = setTimeout(()=>stop(Object.assign(Error('Command timed out.'),{code:'COMMAND_TIMEOUT'})),timeout);
    child.stdout.on('data',chunk=>{if(failure)return;stdout+=chunk;if(onStdout)onStdout(chunk.toString());if(Buffer.byteLength(stdout)>maxBuffer)stop(Object.assign(Error('Command output exceeded its limit.'),{code:'COMMAND_OUTPUT_LIMIT'}));});
    child.stderr.on('data',chunk=>{if(failure)return;stderr+=chunk;if(Buffer.byteLength(stderr)>maxBuffer)stop(Object.assign(Error('Command output exceeded its limit.'),{code:'COMMAND_OUTPUT_LIMIT'}));});
    child.once('error',error=>{failure=error;});
    child.once('close',(code,signal)=>{
      clearTimeout(timer); clearTimeout(killTimer);
      if(failure || code!==0) reject(Object.assign(failure || Error(`Command failed (${signal || code}).`),{stdout,stderr,exitCode:code,...(!failure?{code:'COMMAND_FAILED'}:{})}));
      else resolve({stdout,stderr});
    });
  });
}
