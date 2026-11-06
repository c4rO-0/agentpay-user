#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { revokePolicy } from "../src/renew-policy.mjs";
if (process.argv.length !== 2) {
  console.error("Usage: ./run policy revoke");
  process.exitCode = 2;
} else process.exitCode = await revokePolicy();
