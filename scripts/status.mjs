#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {reportCommandFailure} from "../src/command-diagnostics.mjs";
import { controlWallet } from "../src/wallet-control.mjs";
try {
  process.exitCode = await controlWallet("status");
} catch (error) {
  await reportCommandFailure(error,{operation:'Wallet status'});
  console.error(
    "Could not check Wallet status. Check your local installation.",
  );
  process.exitCode = 1;
}
