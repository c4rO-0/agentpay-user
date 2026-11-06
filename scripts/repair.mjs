#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { applyLocalUpdate } from "../src/local-update.mjs";
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "-f")) {
  console.error("Usage: ./run repair [-f]");
  process.exitCode = 2;
} else process.exitCode = await applyLocalUpdate({ force: args[0] === "-f" });
