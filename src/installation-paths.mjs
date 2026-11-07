// SPDX-License-Identifier: MPL-2.0
// Program upgrades never own or replace private state. XDG_STATE_HOME is standard
// per-user state storage; explicit data-directory settings still select key/history data.
import { homedir } from 'node:os';
import { isAbsolute, join, dirname } from 'node:path';
import { lstat, mkdir, copyFile, constants } from 'node:fs/promises';
export function installationDirectory() {
  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local/state');
  if (!isAbsolute(base)) throw Error('XDG_STATE_HOME must be an absolute path.');
  return join(base, 'agentpay/user');
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
