#!/usr/bin/env node
import { walletCliPath } from "../src/wallet-package.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUserDataDir } from "../src/local-data-directory.mjs";
import { remindLockedWallet } from "../src/login-reminder.mjs";
const execute = promisify(execFile);
try {
  if (process.argv.length > 3) throw Error();
  const dataDir = await resolveUserDataDir({ argument: process.argv[2] });
  const cli = walletCliPath();
  await remindLockedWallet({
    status: async () => {
      const { stdout } = await execute(
        process.execPath,
        [cli, "status", join(dataDir, "wallet")],
        { timeout: 3000, maxBuffer: 16384 },
      );
      return JSON.parse(stdout);
    },
    notify: () =>
      execute(
        "notify-send",
        [
          "--app-name=AgentPay",
          "AgentPay Wallet is locked",
          "To resume payments, open the User folder in a terminal and run: agentpay wallet unlock",
        ],
        { timeout: 5000, maxBuffer: 4096 },
      ),
  });
} catch {
  /* Notifications are best effort; no secret, prompt or background unlock. */
}
