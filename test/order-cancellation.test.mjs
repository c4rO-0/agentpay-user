// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  cancelOrder,
  cancellationStatus,
  cancellationSettlementUrl,
  cancellationOrderForRequest,
} from "../src/order-cancellation.mjs";
import { createInvocationStore } from "../src/invocation-store.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertOrderCanContinue } from "../src/order-closure.mjs";
const orderId = "0x" + "a".repeat(64),
  policyId = "0x" + "b".repeat(64);
const fixture = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/agentpay-participant-order-v2/records.json",
      import.meta.resolve("@agentpay/types"),
    ),
    "utf8",
  ),
).buyerOrder;
const initial = {
  version: "agentpay.order-closure.v1",
  state: "requested",
  reason: "user_cancel",
  requestedAtMs: 1792677004000,
  completedAtMs: null,
  transactionHash: null,
  errorCode: null,
};
test("request lookup reads only the original per-service ledger and never creates an Order", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "cancel-request-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const path = join(dataDir, "runtime/invocations.json"),
    requestId = "original-test-request";
  const store = createInvocationStore(path),
    entry = await store.begin({
      invocationKey: requestId,
      requestHash: policyId,
      binding: "service-fixture",
      routingVersion: "agentpay.runtime-call.v1",
    });
  await assert.rejects(cancellationOrderForRequest({ dataDir, requestId }), {
    code: "ORDER_NOT_CREATED",
  });
  await store.update(entry.invocationId, policyId, { orderId });
  const before = await readFile(path, "utf8");
  assert.equal(
    await cancellationOrderForRequest({ dataDir, requestId }),
    orderId,
  );
  await assert.rejects(
    cancellationOrderForRequest({ dataDir, requestId: "not-found-request" }),
    { code: "INVOCATION_NOT_FOUND" },
  );
  await assert.rejects(
    cancellationOrderForRequest({ dataDir, requestId: "short" }),
    { code: "INVALID_REQUEST_ID" },
  );
  assert.equal(await readFile(path, "utf8"), before);
});
test("separate User processes recover the same persisted intent after a lost response", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "cancel-process-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const runner = join(dataDir, "runner.mjs"),
    calls = join(dataDir, "calls.jsonl");
  await writeFile(
    runner,
    `import {appendFile} from 'node:fs/promises';
 import {cancelOrder} from ${JSON.stringify(new URL("../src/order-cancellation.mjs", import.meta.url).href)};
 const orderId=${JSON.stringify(orderId)},policyId=${JSON.stringify(policyId)},closure=${JSON.stringify(initial)};
 await cancelOrder({dataDir:${JSON.stringify(dataDir)},settlementUrl:'http://127.0.0.1:6572',orderId},{walletCall:async(method,p)=>{
 if(method==='status')return {bound:true,policyId};
 if(method==='cancelSettlementOrder'){await appendFile(${JSON.stringify(calls)},JSON.stringify(p)+'\\n');if(process.argv[2]==='lose')throw Error('lost response');return {ok:true,result:{orderId,closure,duplicate:true}};}
 if(method==='readSettlementOrder')return {ok:true,result:{order:${JSON.stringify({ ...fixture, orderId })},closure}};
 throw Error('unexpected payment method');}});`,
  );
  const run = promisify(execFile);
  await assert.rejects(run(process.execPath, [runner, "lose"]));
  await run(process.execPath, [runner, "retry"]);
  const records = (await readFile(calls, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], records[1]);
  assert.equal(records[0].orderId, orderId);
});
test("response loss and concurrent clients retain one cancellation identity; status never requests cancellation", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "user-order-cancel-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const input = { dataDir, settlementUrl: "http://127.0.0.1:6572", orderId };
  let lose = true,
    closure = null,
    activePolicy = policyId;
  const cancellations = [];
  const walletCall = async (method, p) => {
    if (method === "status") return { bound: true, policyId: activePolicy };
    if (method === "cancelSettlementOrder") {
      cancellations.push(p);
      closure = { ...initial };
      if (lose) {
        lose = false;
        throw Object.assign(Error("response lost"), {
          code: "SETTLEMENT_TIMEOUT",
        });
      }
      return { ok: true, result: { orderId, closure, duplicate: true } };
    }
    if (method === "readSettlementOrder")
      return {
        ok: true,
        result: {
          order: {
            ...fixture,
            orderId,
            vaultState: closure?.state === "refunded" ? "Refunded" : "Funded",
          },
          closure,
        },
      };
    throw Error("Unexpected signing/payment/service call: " + method);
  };
  await assert.rejects(cancelOrder(input, { walletCall }), {
    code: "SETTLEMENT_TIMEOUT",
  });
  const before = cancellations.length;
  assert.equal(
    (await cancellationStatus(input, { walletCall })).closure.state,
    "requested",
  );
  assert.equal(cancellations.length, before);
  const replies = await Promise.all([
    cancelOrder(input, { walletCall }),
    cancelOrder(input, { walletCall }),
  ]);
  assert(replies.every((x) => x.closure.state === "requested"));
  assert.equal(new Set(cancellations.map((p) => p.cancellationId)).size, 1);
  const path = join(
    dataDir,
    "runtime/order-cancellations",
    createHash("sha256").update(orderId).digest("hex") + ".json",
  );
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  closure = {
    ...initial,
    state: "refunded",
    completedAtMs: initial.requestedAtMs + 1000,
    transactionHash: "0x" + "c".repeat(64),
  };
  assert.equal(
    (await cancellationStatus(input, { walletCall })).closure.state,
    "refunded",
  );
  activePolicy = "0x" + "d".repeat(64);
  await assert.rejects(cancelOrder(input, { walletCall }), {
    code: "CANCELLATION_STATE_CONFLICT",
  });
  assert.equal(cancellations.length, 3);
});
test("accepted cancellation does not become confirmed locally; unsafe endpoints/input are rejected", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "user-order-cancel-denied-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let calls = 0;
  const walletCall = async (method) => {
    if (method === "status") return { bound: true, policyId };
    calls++;
    throw Object.assign(Error("accepted"), { code: "ORDER_ALREADY_ACCEPTED" });
  };
  await assert.rejects(
    cancelOrder(
      { dataDir, settlementUrl: "http://127.0.0.1:6572", orderId },
      { walletCall },
    ),
    { code: "ORDER_ALREADY_ACCEPTED" },
  );
  assert.equal(calls, 1);
  for (const url of [
    "http://remote.test",
    "https://user:secret@example.test",
    "https://example.test/?key=secret",
    "file:///tmp/a",
  ])
    assert.throws(() => cancellationSettlementUrl(url));
  await assert.rejects(
    cancelOrder(
      { dataDir, settlementUrl: "http://127.0.0.1", orderId: "short" },
      { walletCall },
    ),
    { code: "INVALID_ORDER_ID" },
  );
  assert.equal(calls, 1);
});
test("closing/refunded/cancelled Orders fence continuation while accepted/released recovery remains available", () => {
  for (const [state, code] of [
    ["requested", "ORDER_CLOSING"],
    ["cancelling", "ORDER_CLOSING"],
    ["refunding", "ORDER_CLOSING"],
    ["cancelled", "ORDER_CANCELLED"],
    ["refunded", "ORDER_REFUNDED"],
  ])
    assert.throws(() => assertOrderCanContinue({ closure: { state } }), {
      code,
    });
  assert.throws(
    () =>
      assertOrderCanContinue({
        order: { vaultState: "Cancelled", orderStatus: "Refunded" },
      }),
    { code: "ORDER_CANCELLED" },
  );
  assert.doesNotThrow(() =>
    assertOrderCanContinue({
      order: { orderStatus: "Accepted", vaultState: "Funded" },
    }),
  );
  assert.doesNotThrow(() =>
    assertOrderCanContinue({ order: { vaultState: "Released" } }),
  );
});
