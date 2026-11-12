// SPDX-License-Identifier: MPL-2.0
// Program upgrades never own or replace private state. XDG_STATE_HOME is standard
// per-user state storage; explicit data-directory settings still select key/history data.
import { homedir } from 'node:os';
import { isAbsolute, join, dirname } from 'node:path';
import { lstat, mkdir, copyFile, constants, link, unlink, realpath } from 'node:fs/promises';
import {openSync,closeSync,fstatSync,readFileSync,lstatSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {atomicWritePrivate} from './private-journal-files.mjs';
export function stateLocationFile() {
  return join(homedir(),'.local/state/agentpay/state-location.json');
}
export function installationDirectory() {
  // A fixed, non-secret locator makes login services and Skills independent of
  // shell-only XDG settings. XDG chooses the initial location, not a second instance.
  let handle;
  try {
    const path=stateLocationFile(),parent=lstatSync(dirname(path));
    if(!parent.isDirectory() || parent.isSymbolicLink() || parent.uid!==process.getuid() || parent.mode & 0o022)
      throw Error('AgentPay state locator directory needs ownership review.');
    handle=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const st=fstatSync(handle);
    if(!st.isFile() || st.uid!==process.getuid() || st.mode & 0o077 || st.size>16384)
      throw Error('AgentPay state locator must be private and owned by you.');
    const saved=JSON.parse(readFileSync(handle,'utf8'));
    if(saved.version!==1 || typeof saved.directory!=='string' || !isAbsolute(saved.directory) || /[\x00-\x1f\x7f]/.test(saved.directory))
      throw Error('Invalid AgentPay state locator. Preserve it for review.');
    return saved.directory;
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  finally {if(handle!==undefined)closeSync(handle);}
  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local/state');
  if (!isAbsolute(base)) throw Error('XDG_STATE_HOME must be an absolute path.');
  return join(base, 'agentpay/user');
}
export async function ensureInstallationDirectory() {
  const requested=installationDirectory();
  await mkdir(requested,{recursive:true,mode:0o700});
  const info=await lstat(requested);
  if(!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid() || info.mode & 0o077)
    throw Error('Installation state directory must be private and owned by you.');
  const directory=await realpath(requested),path=stateLocationFile();
  try {
    await lstat(path);
    if(installationDirectory()!==directory)
      throw Error('Another command selected the AgentPay state directory. Retry using its saved location.');
    return directory;
  } catch(error) { if(error.code!=='ENOENT')throw error; }
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const parent=await lstat(dirname(path));
  if(!parent.isDirectory() || parent.isSymbolicLink() || parent.uid!==process.getuid() || parent.mode & 0o022)
    throw Error('AgentPay state locator directory needs ownership review.');
  const temporary=path+'.'+randomUUID();
  try {
    await atomicWritePrivate(temporary,JSON.stringify({version:1,directory})+'\n');
    try {await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  if(installationDirectory()!==directory)
    throw Error('Another command selected the AgentPay state directory. Retry using its saved location.');
  return directory;
}
export function legacyInstallationDirectory(userDir) { return join(dirname(userDir), '.agentpay-install'); }
export async function deploymentFilePath(dataDir, userDir, name) {
  if (!['anvil-onboarding.json', 'user-deployment.json'].includes(name)) throw Error('Invalid setup filename.');
  const current = join(dataDir, name);
  try { await lstat(current); return current; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // Read-only fallback for an existing source installation. Never search unrelated machines.
  return join(dirname(userDir), name);
}
export async function importSetupFiles(dataDir, userDir) {
  for (const name of ['anvil-onboarding.json', 'user-deployment.json']) {
    const source = await deploymentFilePath(dataDir, userDir, name);
    if (source === join(dataDir, name)) continue;
    let info;
    try { info = await lstat(source); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 16384)
      throw Error('Old setup configuration needs ownership/permission review before migration.');
    await mkdir(dataDir, {recursive:true, mode:0o700});
    await copyFile(source, join(dataDir,name), constants.COPYFILE_EXCL).catch(e => { if(e.code !== 'EEXIST') throw e; });
  }
}
