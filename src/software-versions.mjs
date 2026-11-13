// SPDX-License-Identifier: MPL-2.0
import { installedProtocol } from './protocol-package.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Capture once: installed files may be replaced while this process still runs.
// This local compatibility report is not attestation or payment authority.
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const runtimeSoftware = Object.freeze({
  name: '@c4roa0/agentpay-user',
  version: manifest.version,
  interfaceVersion: 1,
  protocolVersion: installedProtocol(fileURLToPath(new URL('../package.json', import.meta.url))),
});

export function assessRunningSoftware(wallet, runtime, expected = {
  userVersion: manifest.version,
  walletVersion: manifest.dependencies['@c4roa0/agentpay-wallet'],
  protocolVersion: manifest.dependencies['@c4roa0/agentpay-protocol'],
}) {
  const components = [
    ['Wallet', wallet?.software, '@c4roa0/agentpay-wallet', expected.walletVersion],
    ['Runtime', runtime?.software, '@c4roa0/agentpay-user', expected.userVersion],
  ];
  return components.map(([label, reported, name, version]) => {
    if (!reported) return { label, state: 'unreported', expected: version };
    const matches = reported.name === name && reported.version === version &&
      reported.interfaceVersion === 1 && reported.protocolVersion === expected.protocolVersion;
    return {
      label, state: matches ? 'matched' : 'mismatch', expected: version,
      running: typeof reported.version === 'string' && /^\d+\.\d+\.\d+$/.test(reported.version)
        ? reported.version : 'unknown',
    };
  });
}

export function requireRunningSoftware(wallet, runtime, expected) {
  const checks = assessRunningSoftware(wallet, runtime, expected);
  const bad = checks.find(check => check.state !== 'matched');
  if (bad) {
    const reason = bad.state === 'unreported' ? 'does not report its running version' :
      `does not match the installed package/interface (${bad.expected})`;
    throw Object.assign(Error(`${bad.label} ${reason}. Update the paired packages and run agentpay repair.`), {
      code: 'RUNNING_VERSION_UNVERIFIED', component: bad.label, running: bad.running, expected: bad.expected,
    });
  }
  return checks;
}
