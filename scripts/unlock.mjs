#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { controlWallet } from "../src/wallet-control.mjs";
try {
  process.exitCode = await controlWallet("unlock");
} catch {
  console.error(
    "Could not start Wallet unlock. Check your local installation.",
  );
  process.exitCode = 1;
}
