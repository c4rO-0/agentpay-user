// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isUnpaidExpiry,
  assertOrderCanContinue,
} from "../src/order-closure.mjs";
const result = {
  preparationState: "expired",
  closure: {
    state: "cancelled",
    reason: "payment_timeout",
    transactionHash: null,
  },
  order: { vaultState: "Created", serviceState: "closed" },
};
test("business expiry cannot resume a payment or service call", () => {
  assert.equal(isUnpaidExpiry(result), true);
  assert.throws(() => assertOrderCanContinue(result), {
    code: "ORDER_EXPIRED",
  });
  for (const patch of [
    { preparationState: "payment_required" },
    { order: { vaultState: "Funded", serviceState: "closed" } },
    {
      closure: {
        state: "cancelled",
        reason: "user_cancel",
        transactionHash: null,
      },
    },
  ])
    assert.equal(isUnpaidExpiry({ ...result, ...patch }), false);
});
