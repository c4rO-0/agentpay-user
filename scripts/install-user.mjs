#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { fileURLToPath } from "node:url";
import { resolveUserDataDir } from "../src/local-data-directory.mjs";
import { installAndSetup } from "../src/install-and-setup.mjs";
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--market")
    throw Error("Usage: agentpay install --market MARKET_URL");
  if (!process.stdin.isTTY)
    throw Error(
      "Run Install in an interactive terminal so setup can continue.",
    );
  process.exitCode = await installAndSetup({
    userDir: fileURLToPath(new URL("..", import.meta.url)),
    market: args[1],
    dataDir: await resolveUserDataDir(),
  });
} catch (error) {
  if (!error.messageDisplayed) console.error(error.message);
  process.exitCode = 1;
}
