#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { saveRuntimeConnection } from "../src/runtime-client.mjs";
if (process.argv.length !== 4)
  throw Error(
    "Usage: node scripts/configure-runtime-client.mjs <User data directory> <loopback Runtime URL>",
  );
await saveRuntimeConnection({
  dataDir: process.argv[2],
  runtimeUrl: process.argv[3],
});
console.log(
  "Local Runtime client connection saved. No authorization or purchase was made.",
);
