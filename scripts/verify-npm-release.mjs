// Check public registry data only. Never retries publication after an uncertain result.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const [archive, version] = process.argv.slice(2);
if (!archive || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  throw new Error('Usage: node scripts/verify-npm-release.mjs ARCHIVE VERSION');
}
const integrity = 'sha512-' + createHash('sha512')
  .update(await readFile(archive)).digest('base64');
const url = `https://registry.npmjs.org/@c4roa0%2fagentpay-user/${version}`;
for (let attempt = 1; attempt <= 10; attempt++) {
  let metadata;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (response.ok) metadata = await response.json();
    else console.log(`Registry check ${attempt}/10: HTTP ${response.status}`);
  } catch {
    console.log(`Registry check ${attempt}/10: request unavailable`);
  }
  if (metadata) {
    if (metadata.name !== '@c4roa0/agentpay-user' || metadata.version !== version ||
        metadata.dist?.integrity !== integrity) {
      throw new Error('Public package identity or integrity differs from the built archive.');
    }
    console.log(`Verified public package @c4roa0/agentpay-user@${version}.`);
    process.exit(0);
  }
  if (attempt < 10) await delay(Math.min(5000 * 2 ** (attempt - 1), 60000));
}
throw new Error('Publication may already be accepted. Registry verification is pending; do not republish.');
