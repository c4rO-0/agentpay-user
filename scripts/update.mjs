#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
import { updateFromNpm } from '../src/npm-update.mjs';
const args=process.argv.slice(2);
if(args.length > 1 || (args.length === 1 && args[0] !== '-f')) {
  console.error('Usage: agentpay update [-f]'); process.exitCode=2;
} else process.exitCode=await updateFromNpm({force:args[0] === '-f'});
