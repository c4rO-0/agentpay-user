// SPDX-License-Identifier: MPL-2.0
// A descriptor lock prevents different product entry points from running two
// Runtimes for the same OS user, even when their ports and data folders differ.
import { constants } from 'node:fs';
import { open, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureInstallationDirectory } from './installation-paths.mjs';
export async function acquireRuntimeOwner() {
  const directory=await ensureInstallationDirectory();
  await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);
  if(!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid() || info.mode & 0o077)
    throw Error('Runtime ownership directory must be private and owned by you.');
  const handle=await open(join(directory,'runtime-owner.lock'),constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  try {
    const info=await handle.stat();
    if(!info.isFile() || info.nlink!==1 || info.uid!==process.getuid() || info.mode & 0o077) throw Error('Unsafe Runtime ownership lock.');
    const {tryLock}=await import('fs-native-extensions');
    if(!tryLock(handle.fd)) throw Error('Another AgentPay Runtime is running. Switch installations through agentpay service start; do not start a second Runtime.');
    return handle;
  } catch(e) { await handle.close(); throw e; }
}
