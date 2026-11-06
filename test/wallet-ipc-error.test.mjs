// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { walletIpcError } from "../src/wallet-ipc-error.mjs";

test("Wallet IPC error preserves stable code, original Settlement code and message", () => {
  const error = walletIpcError({
    error: {
      code: "SETTLEMENT_REQUEST_REJECTED",
      settlementCode: "future.settlement-rule",
      message: "future rule",
    },
  });
  assert.equal(error.code, "SETTLEMENT_REQUEST_REJECTED");
  assert.equal(error.settlementCode, "future.settlement-rule");
  assert.equal(error.message, "future rule");
});
test("invalid Settlement provenance is not forwarded", () => {
  const error = walletIpcError({
    error: {
      code: "SETTLEMENT_REQUEST_REJECTED",
      settlementCode: "bad\ncode",
      message: "rejected",
    },
  });
  assert.equal(error.code, "SETTLEMENT_REQUEST_REJECTED");
  assert.equal("settlementCode" in error, false);
});
