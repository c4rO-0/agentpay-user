#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// Keep child exceptions out of the terminal: they may contain credentials or
// private request data. Only the shared, reviewed diagnostic category crosses
// the subprocess boundary. The parent supplies a program-owned helper path.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { failureGuidance } from '../src/setup-diagnostics.mjs';
const [script, ...args] = process.argv.slice(2);
try {
  process.argv = [process.execPath, resolve(script), ...args];
  await import(pathToFileURL(process.argv[1]).href);
} catch (error) {
  process.stderr.write(JSON.stringify({agentpaySetupFailure: failureGuidance(error).code}) + '\n');
  process.exitCode = 1;
}
