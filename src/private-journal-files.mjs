// SPDX-License-Identifier: MPL-2.0
// User-owned migration journal storage; this module never reads Wallet keys.
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function assertPrivateFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077))
    throw Object.assign(Error('User journal must be a private file owned by you.'), {code:'UNSAFE_FILE'});
}
export async function atomicWritePrivate(path, content) {
  const parent = dirname(path);
  await mkdir(parent, {recursive:true, mode:0o700});
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077))
    throw Error('User journal directory must be private and owned by you.');
  const temporary = join(parent, '.tmp-' + randomUUID());
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
}
