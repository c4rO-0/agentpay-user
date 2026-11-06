// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { initializeCallerCredential } from "../src/caller-auth.mjs";

const path = String(process.argv[2] || "").trim();
if (!path) throw new Error("caller credential path is required");
await initializeCallerCredential(path);
process.stdout.write(
  `${JSON.stringify({ ok: true, callerCredential: "ready" })}\n`,
);
