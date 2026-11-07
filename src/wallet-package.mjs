// SPDX-License-Identifier: MPL-2.0
// Resolve public Wallet entries from this User installation, never a sibling checkout.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const userPackageDirectory = fileURLToPath(new URL('..', import.meta.url));
export function walletPackage(userDir = userPackageDirectory) {
  const require = createRequire(join(userDir, 'package.json'));
  const manifestPath = require.resolve('@c4roa0/agentpay-wallet/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const user = JSON.parse(readFileSync(join(userDir, 'package.json'), 'utf8'));
  if (manifest.name !== '@c4roa0/agentpay-wallet' ||
      !/^\d+\.\d+\.\d+$/.test(user.dependencies?.[manifest.name] || '') ||
      manifest.version !== user.dependencies[manifest.name] ||
      manifest.dependencies?.['@c4roa0/agentpay-protocol'] !== user.dependencies?.['@c4roa0/agentpay-protocol']) {
    throw Error('Installed Wallet does not match this User version. Reinstall the reviewed User version, then run agentpay repair. Your private data is unchanged.');
  }
  return { directory: dirname(manifestPath), manifest, cli: require.resolve('@c4roa0/agentpay-wallet/cli') };
}
export function walletCliPath(userDir) { return walletPackage(userDir).cli; }
