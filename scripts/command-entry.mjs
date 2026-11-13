#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// Public CLI child boundary. Keep terminal stdin/TTY intact for hidden prompts;
// report unexpected failures without exposing raw Node exception stacks.
import {pathToFileURL} from 'node:url';
import {resolve,basename} from 'node:path';
import {reportCommandFailure} from '../src/command-diagnostics.mjs';
const [script,...args]=process.argv.slice(2);
try {
  process.argv=[process.execPath,resolve(script),...args];
  await import(pathToFileURL(process.argv[1]).href);
} catch(error) {
  await reportCommandFailure(error,{operation:basename(script||'command','.mjs')});
  process.exitCode=1;
}
