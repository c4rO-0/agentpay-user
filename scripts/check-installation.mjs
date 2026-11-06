#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { fileURLToPath } from "node:url";
import { checkLocalInstallation } from "../src/install-preflight.mjs";
try {
  if (process.argv.length !== 3)
    throw new Error(
      "Usage: node scripts/check-installation.mjs ABSOLUTE_PRIVATE_DATA_DIR",
    );
  const { isAbsolute } = await import("node:path");
  if (!isAbsolute(process.argv[2]))
    throw new Error("Private data directory must be an absolute path");
  const result = await checkLocalInstallation({
    userDir: fileURLToPath(new URL("..", import.meta.url)),
    dataDir: process.argv[2],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { message: error.message } })}\n`,
  );
  process.exitCode = 1;
}
