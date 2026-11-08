// SPDX-License-Identifier: MPL-2.0
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Resolve from each consumer independently: npm may install a nested Protocol copy.
// The public schema export works even when package.json is not publicly exported.
export function installedProtocol(consumerManifest) {
  const require = createRequire(consumerManifest);
  let directory = dirname(require.resolve('@c4roa0/agentpay-protocol/schema'));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (pkg.name !== '@c4roa0/agentpay-protocol' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
        throw Error('Installed Protocol package identity is invalid.');
      }
      return pkg.version;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw Error('Installed Protocol package metadata is missing.');
    directory = parent;
  }
}
