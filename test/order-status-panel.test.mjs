// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { showOrderStatus } from "../src/order-status-panel.mjs";
import { recordFingerprint } from "../src/order-review.mjs";
const entry = {
  invocationId: "request",
  orderRequestId: "lookup",
  orderId: "order",
  createdAtMs: 1,
};
const observation = {
  fingerprint: recordFingerprint(entry),
  financialState: "pending",
  checkedAtMs: 1000,
};
test("successful query displays only Settlement state, not the older local state", async () => {
  const lines = [];
  const code = await showOrderStatus({
    entry,
    observation,
    selector: "order",
    write: (s) => lines.push(s),
    now: () => 2000,
    read: async () => ({
      order: {
        orderId: "order",
        orderStatus: "Delivered",
        vaultState: "Funded",
        updatedAtMs: 1500,
      },
    }),
  });
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /Settlement · Retrieved:/);
  assert.match(lines.join("\n"), /Delivered/);
  assert.doesNotMatch(lines.join("\n"), /In progress|Last local record/);
});
test("failure labels fallback time and preserves original request", async () => {
  const lines = [];
  assert.equal(
    await showOrderStatus({
      entry,
      observation,
      selector: "order",
      write: (s) => lines.push(s),
      read: async () => {
        throw Error("network");
      },
    }),
    1,
  );
  assert.match(lines.join("\n"), /Last local record · not refreshed/);
  assert.match(lines.join("\n"), /In progress/);
  assert.match(lines.join("\n"), /Last checked:/);
});
test("not found is not declared unpaid; mismatched local observations are not displayed", async () => {
  const lines = [];
  await showOrderStatus({
    entry,
    observation,
    selector: "order",
    write: (s) => lines.push(s),
    read: async () => ({ found: false }),
  });
  assert.match(lines.join("\n"), /does not prove non-payment/);
  assert.doesNotMatch(lines.join("\n"), /In progress/);
  lines.length = 0;
  await showOrderStatus({
    entry,
    observation: { ...observation, fingerprint: "other" },
    selector: "order",
    write: (s) => lines.push(s),
    read: async () => {
      throw Object.assign(Error(), { code: "WALLET_LOCKED" });
    },
  });
  assert.match(lines.join("\n"), /wallet unlock/);
  assert.match(lines.join("\n"), /Not checked/);
  assert.match(lines.join("\n"), /Last checked: Not available/);
});

test('chain transport failure points to RPC and tunnel without exposing exception payloads',async()=>{
 const lines=[];
 await showOrderStatus({entry,observation,selector:'order',write:s=>lines.push(s),read:async()=>{
  throw Object.assign(Error('private URL must not appear'),{code:'CHAIN_RPC_UNAVAILABLE'});
 }});
 assert.match(lines.join('\n'),/Cannot connect to the chain RPC/);
 assert.match(lines.join('\n'),/SSH port forwarding/);
 assert.doesNotMatch(lines.join('\n'),/private URL/);
});
