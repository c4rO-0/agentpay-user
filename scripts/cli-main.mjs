// SPDX-License-Identifier: MPL-2.0
import {runUserCli} from '../src/user-cli.mjs';
process.exitCode = await runUserCli(process.argv.slice(2));
