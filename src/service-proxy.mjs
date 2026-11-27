// SPDX-License-Identifier: MPL-2.0
import {join} from 'node:path';
import {lstat, open} from 'node:fs/promises';
import {constants} from 'node:fs';

export function proxyAddress(input) {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || /[\s\\@?#]/.test(input)) throw Error();
    return url.origin;
  } catch { throw Object.assign(Error('Use an HTTP or HTTPS proxy address. Enter credentials separately.'), {code:'PROXY_ADDRESS_INVALID'}); }
}

const invalidConfig = () => Object.assign(Error('Invalid private proxy settings. Use agentpay proxy clear to recover.'), {code:'PROXY_CONFIG_INVALID'});

export async function readProxy(dataDir, {allowInvalid = false} = {}) {
  for (const directory of [dataDir, join(dataDir,'runtime')]) {
    const info = await lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!info) return null;
    if (!info.isDirectory() || info.uid !== process.getuid() || info.mode & 0o077)
      throw Error('Proxy settings require a private installation directory owned by you.');
  }
  const handle = await open(join(dataDir,'runtime/proxy.json'),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  if (!handle) return null;
  try {
    const stat = await handle.stat({bigint:true});
    if (!stat.isFile() || stat.uid !== BigInt(process.getuid()) || stat.nlink !== 1n || (stat.mode & 0o077n))
      throw Error('Proxy settings must be a private regular file owned by you.');
    const raw = stat.size <= 65536n ? await handle.readFile('utf8') : '';
    try {
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || typeof saved.enabled !== 'boolean' || proxyAddress(saved.address) !== saved.address ||
          typeof saved.username !== 'string' || typeof saved.password !== 'string' ||
          /[:\x00-\x1f\x7f]/.test(saved.username) || (!saved.username && saved.password) ||
          !/^[a-f0-9-]{36}$/.test(saved.revision)) throw invalidConfig();
      return saved;
    } catch {
      // Clear can recover malformed content, but only after checking the same
      // private file again under lock. Never quote parser errors or file bytes.
      if (allowInvalid) return {invalid:[stat.dev,stat.ino,stat.ctimeNs].join('-')};
      throw invalidConfig();
    }
  } finally { await handle.close(); }
}

export function proxyEnvironment(config) {
  if (!config?.enabled) return {};
  const [major,minor] = process.versions.node.split('.').map(Number);
  if (!(major >= 25 || major === 24 && minor >= 5 || major === 22 && minor >= 21))
    throw Error('Proxy mode needs Node 22.21+, 24.5+ or later with built-in fetch and HTTP proxy support.');
  const url = new URL(config.address);
  url.username = encodeURIComponent(config.username);
  url.password = encodeURIComponent(config.password);
  const bypass = 'localhost,127.0.0.1,::1,[::1]';
  return {
    AGENTPAY_PROXY_REQUIRED:'1', NODE_USE_ENV_PROXY:'1',
    HTTP_PROXY:url.href, HTTPS_PROXY:url.href, NO_PROXY:bypass,
    http_proxy:url.href, https_proxy:url.href, no_proxy:bypass,
  };
}
