// SPDX-License-Identifier: MPL-2.0
// Choose storage before dependencies or services are changed. Selection itself
// never creates a Wallet, copies a key, or activates another installation.
import { lstat, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readInstallationBinding } from './installation-binding.mjs';
import { resolveUserDataDir } from './local-data-directory.mjs';

export async function selectInstallationData({userDir, ask, write = console.log, env = process.env}) {
  const binding = await readInstallationBinding(userDir);
  if (binding) {
    if (env.AGENTPAY_USER_DATA_DIR && resolve(env.AGENTPAY_USER_DATA_DIR) !== binding.dataDir)
      throw Error('This installation already uses another data folder. Remove the conflicting AGENTPAY_USER_DATA_DIR setting before installing.');
    return {dataDir:binding.dataDir, requiresActivation:true};
  }
  const existing = await resolveUserDataDir({userDir, env});
  const info = await lstat(existing).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (!info) return {dataDir:existing, requiresActivation:true};
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077)
    throw Error('The existing User data folder needs ownership and permission review. No installation was changed.');
  write('\nExisting AgentPay data');
  write(existing);
  write('Use it to keep your Wallet and Orders, or create separate data for this installation.');
  while (true) {
    const choice = String(await ask("Enter 'reuse', 'new', or 'q' to cancel")).trim().toLowerCase();
    if (choice === 'q') return null;
    if (choice === 'reuse') {
      // Activation belongs to the serialized service-switch flow, not storage choice.
      write('Existing Wallet and Order data will be kept. This does not switch running services.');
      return {dataDir:existing, requiresActivation:true, selection:'reuse'};
    }
    if (choice === 'new') {
      const dataDir = join(dirname(existing), 'user-' + randomUUID());
      await mkdir(dataDir, {mode:0o700});
      write('Separate data folder: ' + dataDir);
      return {dataDir, requiresActivation:true, selection:'new'};
    }
    write("Choose 'reuse' to keep the existing data, 'new' for a separate Wallet setup, or 'q'.");
  }
}
