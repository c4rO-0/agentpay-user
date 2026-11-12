// SPDX-License-Identifier: MPL-2.0
// Installation routing is local metadata, never Wallet or payment identity.
import { constants } from 'node:fs';
import { open, realpath, mkdir, link, unlink, lstat } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { installationDirectory } from './installation-paths.mjs';
import { atomicWritePrivate } from './private-journal-files.mjs';

async function location(userDir) {
  const root = await realpath(userDir);
  const directory = join(installationDirectory(), 'bindings');
  const key = createHash('sha256').update(root).digest('hex');
  return {root, directory, path: join(directory, key + '.json')};
}
export async function readInstallationBinding(userDir) {
  let place;
  try { place = await location(userDir); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let handle;
  try {
    const directory = await lstat(place.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || directory.mode & 0o077)
      throw Error('Installation bindings directory must be private and owned by you.');
    handle = await open(place.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || info.mode & 0o077 || info.size > 16384)
      throw Error('Installation binding must be a private file owned by you.');
    const value = JSON.parse(await handle.readFile('utf8'));
    if (value.version !== 1 || value.installation !== place.root || typeof value.dataDir !== 'string' || !isAbsolute(value.dataDir) || value.dataDir.includes('\0'))
      throw Error('Installation binding is invalid. Keep it for review.');
    return value;
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  finally { await handle?.close(); }
}
export async function rememberInstallationBinding(userDir, dataDir) {
  const place = await location(userDir);
  // Missing data is valid before setup. Existing paths use their canonical location.
  const selected = await realpath(resolve(dataDir)).catch(e => {
    if (e.code === 'ENOENT') return resolve(dataDir);
    throw e;
  });
  const saved = await readInstallationBinding(userDir);
  if (saved) {
    if (saved.dataDir !== selected) throw Error('This installation uses another data folder. Explicit adoption is required before changing it.');
    return saved;
  }
  await mkdir(place.directory, {recursive:true, mode:0o700});
  const value = {version:1, installation:place.root, dataDir:selected};
  const temporary = join(place.directory, '.binding-' + randomUUID());
  try {
    await atomicWritePrivate(temporary, JSON.stringify(value) + '\n');
    // Publish without replacing a concurrently established binding.
    try { await link(temporary, place.path); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  const actual = await readInstallationBinding(userDir);
  if (actual.dataDir !== selected) throw Error('Another command selected a different data folder. No binding was replaced.');
  return actual;
}

export async function installationBindingPath(userDir) { return (await location(userDir)).path; }
