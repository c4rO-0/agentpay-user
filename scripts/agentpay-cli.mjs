#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { runUserCli } from "../src/user-cli.mjs";
try {
  process.exitCode = await runUserCli(process.argv.slice(2));
} catch (error) {
  console.error(error.message || "Local operation failed. Run ./run help.");
  process.exitCode = 1;
}
