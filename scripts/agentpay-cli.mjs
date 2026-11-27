#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {reportCommandFailure} from "../src/command-diagnostics.mjs";
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveUserDataDir} from '../src/local-data-directory.mjs';
import {readProxy, proxyEnvironment} from '../src/service-proxy.mjs';
try {
  const args = process.argv.slice(2);
  // Proxy administration must remain accessible even with a malformed file.
  // Native HTTP and fetch configure their agents at process start.
  const localOnly = !args.length || ['help','--help','-h','proxy'].includes(args[0]);
  const saved = localOnly ? null : await readProxy(await resolveUserDataDir());
  if (saved?.enabled || args[0] === 'proxy') {
    const env = {...process.env};
    if (saved?.enabled) {
      const routing = proxyEnvironment(saved);
      Object.assign(env,routing,{npm_config_proxy:routing.HTTP_PROXY,
        npm_config_https_proxy:routing.HTTPS_PROXY,npm_config_noproxy:routing.NO_PROXY});
    } else {
      // This worker performs local administration. Only its isolated preflight
      // child may contact external endpoints, with the explicitly chosen proxy.
      for (const key of Object.keys(env)) {
        if (['http_proxy','https_proxy','all_proxy','no_proxy','node_use_env_proxy','agentpay_proxy_required'].includes(key.toLowerCase()))
          delete env[key];
      }
    }
    const entry = fileURLToPath(new URL('./cli-main.mjs',import.meta.url));
    process.exitCode = await new Promise((resolve,reject) => {
      const child = spawn(process.execPath,[entry,...args],{env,stdio:'inherit'});
      child.once('error',reject);
      child.once('exit',code => resolve(code ?? 1));
    });
  } else {
    await import('./cli-main.mjs');
  }
} catch (error) {
  await reportCommandFailure(error,{operation:'Command'});

  process.exitCode = 1;
}
