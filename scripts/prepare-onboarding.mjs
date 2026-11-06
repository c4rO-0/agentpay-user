#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { createInterface } from "node:readline/promises";
import { isAbsolute } from "node:path";
import { prepareOnboarding } from "../src/prepare-onboarding.mjs";
let terminal;
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !args.every(isAbsolute))
    throw Error(
      "Usage: node scripts/prepare-onboarding.mjs ABSOLUTE_PUBLIC_DEPLOYMENT_JSON ABSOLUTE_LOCAL_CONFIG_JSON",
    );
  if (!process.stdin.isTTY)
    throw Error("Run this command in an interactive terminal.");
  terminal = createInterface({ input: process.stdin, output: process.stdout });
  await prepareOnboarding({
    inputPath: args[0],
    outputPath: args[1],
    ask: (prompt) => terminal.question(`${prompt}\n> `),
    write: (line) => console.log(line),
  });
} catch (error) {
  console.error(
    error.code === "EEXIST"
      ? "The local configuration already exists. Reuse it with user-setup.mjs; use a different filename for a deliberate new configuration."
      : error.message,
  );
  process.exitCode = 1;
} finally {
  terminal?.close();
}
