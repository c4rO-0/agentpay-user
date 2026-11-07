// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInvocationStore } from "../src/invocation-store.mjs";
import { createRuntimeRecovery } from "../src/runtime-recovery.mjs";
const order = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/agentpay-participant-order-v2/records.json",
      import.meta.resolve("@c4roa0/agentpay-protocol"),
    ),
  ),
).buyerOrder;
const b32 = (n) => "0x" + n.toString(16).padStart(64, "0");
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "runtime-recovery-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "invocations.json"),
    store = createInvocationStore(path, "legacy");
  let entry = await store.begin({
    invocationKey: "legacy-recovery-request",
    requestHash: order.requestHash,
  });
  entry = await store.update(entry.invocationId, entry.requestHash, {
    orderId: order.orderId,
    paymentSubmitted: true,
    paymentPayload: {
      accepted: { network: "eip155:" + order.chainId },
      payload: {
        commitment: {
          orderId: order.orderId,
          vault: order.vaultAddress,
          safe: order.buyerAddress,
          token: order.assetAddress,
          amount: order.prepaidAmountAtomic,
        },
      },
    },
  });
  let locked = false,
    calls = 0,
    current = { ...order, vaultState: "Released", orderStatus: "Released" },
    result = null,
    clock = Date.now();
  const deps = {
    store,
    statePath: path,
    settlementUrl: "https://example.invalid/settlement",
    results: { read: async () => result },
    readWallet: async () => ({ locked, bound: true }),
    readOrder: async () => {
      calls++;
      return { ok: true, result: { order: current } };
    },
    now: () => clock,
  };
  return {
    path,
    store,
    entry,
    deps,
    recovery: createRuntimeRecovery(deps),
    lock: (v) => (locked = v),
    setOrder: (v) => (current = v),
    setResult: (v) => (result = v),
    get calls() {
      return calls;
    },
    advance: () => (clock += 4000000),
  };
}
test("legacy terminal history is retained, observed separately from missing output and not rechecked in a tight loop", async (t) => {
  const f = await fixture(t),
    before = await readFile(f.path);
  await f.recovery.refresh();
  const s = f.recovery.status();
  assert.equal(s.inventory, "complete");
  assert.equal(s.orders.settled, 1);
  assert.equal(s.orders.missingResult, 1);
  assert.equal(s.orders.legacy, 1);
  assert.deepEqual(await readFile(f.path), before);
  await f.recovery.refresh();
  assert.equal(f.calls, 1);
  const restarted = createRuntimeRecovery(f.deps);
  await restarted.refresh();
  assert.equal(f.calls, 1);
  assert.equal(restarted.status().orders.settled, 1);
  await assert.rejects(
    f.store.begin({
      invocationKey: "legacy-recovery-request",
      requestHash: f.entry.requestHash,
      binding: "new",
      routingVersion: "agentpay.runtime-call.v1",
    }),
    { code: "INVOCATION_SERVICE_BINDING_MISMATCH" },
  );
});
test("locked Wallet waits without Order reads, then continues after unlock", async (t) => {
  const f = await fixture(t);
  f.lock(true);
  await f.recovery.refresh();
  assert.equal(f.recovery.status().wallet, "locked");
  assert.equal(f.calls, 0);
  f.lock(false);
  await f.recovery.refresh();
  assert.equal(f.recovery.status().orders.settled, 1);
});
test("corrupt and missing history pause new calls without overwriting files", async (t) => {
  const f = await fixture(t);
  await f.recovery.refresh();
  await writeFile(f.path, "bad JSON");
  await f.recovery.refresh();
  assert.equal(f.recovery.status().inventory, "blocked");
  await assert.rejects(f.recovery.assertLocalHistory());
  assert.equal(await readFile(f.path, "utf8"), "bad JSON");
  await rm(f.path);
  await f.recovery.refresh();
  assert.equal(f.recovery.status().inventory, "blocked");
});
test("identity conflicts do not establish finality; temporary remote failure is retried", async (t) => {
  const f = await fixture(t);
  f.setOrder({ ...order, orderId: b32(99), vaultState: "Released" });
  await f.recovery.refresh();
  assert.equal(f.recovery.status().orders.review, 1);
  assert.equal(f.recovery.status().orders.settled, 0);
  f.setOrder({ ...order, vaultState: "Refunded", orderStatus: "Refunded" });
  f.advance();
  await f.recovery.refresh();
  assert.equal(f.recovery.status().orders.settled, 1);
});
test("late observation cannot overwrite a foreground invocation update", async (t) => {
  const f = await fixture(t);
  const recovery = createRuntimeRecovery({
    ...f.deps,
    readOrder: async () => {
      await f.store.update(f.entry.invocationId, f.entry.requestHash, {
        paymentSubmitted: false,
      });
      return {
        ok: true,
        result: { order: { ...order, vaultState: "Released" } },
      };
    },
  });
  await recovery.refresh();
  assert.equal(recovery.status().orders.settled, 0);
  assert.equal(
    (await f.store.inventory())[f.entry.invocationId].paymentSubmitted,
    false,
  );
});
test("unavailable service and missing Order ID remain unresolved without leaking diagnostics", async (t) => {
  const f = await fixture(t);
  const unavailable = createRuntimeRecovery({
    ...f.deps,
    readOrder: async () => {
      throw Error("private diagnostic must not escape");
    },
  });
  await unavailable.refresh();
  assert.equal(unavailable.status().orders.review, 1);
  assert.ok(
    !JSON.stringify(unavailable.status()).includes("private diagnostic"),
  );
  await f.store.update(f.entry.invocationId, f.entry.requestHash, {
    orderId: null,
  });
  const missing = createRuntimeRecovery(f.deps);
  await missing.refresh();
  assert.equal(missing.status().orders.review, 1);
});

test("pending, refunded, cancelled and invalid output retain separate financial and result states", async (t) => {
  const f = await fixture(t);
  f.setOrder({ ...order, vaultState: "Funded", orderStatus: "Funded" });
  await f.recovery.refresh();
  assert.equal(f.recovery.status().orders.settled, 0);
  assert.equal(f.recovery.status().orders.waiting, 1);
  for (const vaultState of ["Refunded", "Cancelled"]) {
    const item = await fixture(t);
    item.setOrder({ ...order, vaultState, orderStatus: "Refunded" });
    await item.recovery.refresh();
    assert.equal(item.recovery.status().orders.settled, 1);
  }
  f.advance();
  f.setOrder({ ...order, vaultState: "Released", orderStatus: "Released" });
  const broken = createRuntimeRecovery({
    ...f.deps,
    results: {
      read: async () => {
        throw Error("corrupt output");
      },
    },
  });
  await broken.refresh();
  assert.equal(broken.status().orders.settled, 1);
  assert.equal(broken.status().orders.missingResult, 0);
  assert.equal(broken.status().orders.review, 1);
});
test("conflicting closure and released state cannot establish terminal observation", async (t) => {
  const f = await fixture(t);
  const recovery = createRuntimeRecovery({
    ...f.deps,
    readOrder: async () => ({
      ok: true,
      result: {
        order: { ...order, vaultState: "Released" },
        closure: { state: "refunded" },
      },
    }),
  });
  await recovery.refresh();
  assert.equal(recovery.status().orders.settled, 0);
  assert.equal(recovery.status().orders.review, 1);
});

test("storage write failure blocks paid calls and retry persists the same observation", async (t) => {
  const f = await fixture(t);
  const { mkdir } = await import("node:fs/promises");
  const path = f.path + ".recovery.json";
  await f.recovery.refresh();
  await rm(path);
  await mkdir(path, { mode: 0o700 });
  f.advance();
  await f.recovery.refresh();
  assert.equal(f.recovery.status().storageError, true);
  await assert.rejects(f.recovery.assertLocalHistory());
  await rm(path, { recursive: true });
  await f.recovery.refresh();
  assert.equal(f.recovery.status().storageError, false);
  assert.equal(
    JSON.parse(await readFile(path)).observations[f.entry.invocationId]
      .vaultState,
    "Released",
  );
});
test("a conflicting terminal observation preserves the prior evidence instead of silently reversing it", async (t) => {
  const f = await fixture(t);
  await f.recovery.refresh();
  f.advance();
  f.setOrder({ ...order, vaultState: "Funded", orderStatus: "Funded" });
  await f.recovery.refresh();
  assert.equal(f.recovery.status().orders.review, 1);
  const saved = JSON.parse(await readFile(f.path + ".recovery.json"))
    .observations[f.entry.invocationId];
  assert.equal(saved.previousTerminalState, "Released");
  assert.equal(saved.errorCode, "ORDER_STATE_CONFLICT");
});

test("concurrent status wakeups share one scan; shutdown does not persist an unfinished scan", async (t) => {
  const f = await fixture(t);
  let release, entered;
  const start = new Promise((r) => (entered = r)),
    wait = new Promise((r) => (release = r));
  let reads = 0;
  const recovery = createRuntimeRecovery({
    ...f.deps,
    readOrder: async () => {
      reads++;
      entered();
      await wait;
      return {
        ok: true,
        result: { order: { ...order, vaultState: "Released" } },
      };
    },
  });
  const first = recovery.refresh();
  await start;
  const second = recovery.refresh();
  assert.equal(first, second);
  const stopped = recovery.stop();
  release();
  await Promise.all([first, second, stopped]);
  assert.equal(reads, 1);
  await assert.rejects(readFile(f.path + ".recovery.json"), { code: "ENOENT" });
});

test("terminal evidence survives a failed read and still rejects regression after restart", async (t) => {
  const f = await fixture(t);
  await f.recovery.refresh();
  f.advance();
  const failed = createRuntimeRecovery({
    ...f.deps,
    readOrder: async () => {
      throw Error("offline");
    },
  });
  await failed.refresh();
  let saved = JSON.parse(await readFile(f.path + ".recovery.json"))
    .observations[f.entry.invocationId];
  assert.equal(saved.previousTerminalState, "Released");
  f.advance();
  f.setOrder({ ...order, vaultState: "Funded", orderStatus: "Funded" });
  const restarted = createRuntimeRecovery(f.deps);
  await restarted.refresh();
  saved = JSON.parse(await readFile(f.path + ".recovery.json")).observations[
    f.entry.invocationId
  ];
  assert.equal(saved.errorCode, "ORDER_STATE_CONFLICT");
  assert.throws(() => restarted.assertInvocation(f.entry), {
    code: "RUNTIME_RECOVERY_REQUIRED",
  });
  assert.doesNotThrow(() =>
    restarted.assertInvocation({ ...f.entry, invocationId: b32(999) }),
  );
});
test("refunded and cancelled Orders do not claim an expected result is missing", async (t) => {
  for (const vaultState of ["Refunded", "Cancelled"]) {
    const f = await fixture(t);
    f.setOrder({ ...order, vaultState, orderStatus: "Refunded" });
    await f.recovery.refresh();
    assert.equal(f.recovery.status().orders.settled, 1);
    assert.equal(f.recovery.status().orders.missingResult, 0);
    assert.equal(f.recovery.status().issues.length, 0);
  }
});
test("foreground inventory and first background load can overlap without losing observations", async (t) => {
  const f = await fixture(t);
  await f.recovery.refresh();
  const recovery = createRuntimeRecovery(f.deps);
  await Promise.all([
    recovery.refresh(),
    recovery.assertLocalHistory(),
    recovery.assertLocalHistory(),
  ]);
  assert.equal(recovery.status().orders.settled, 1);
  assert.equal(f.calls, 1);
});

test("expired unpaid business closure stops waiting without inventing chain cancellation", async (t) => {
  const f = await fixture(t);
  let response = {
    preparationState: "expired",
    order: {
      ...order,
      vaultState: "Created",
      orderStatus: "Created",
      serviceState: "closed",
    },
    closure: {
      version: "agentpay.order-closure.v1",
      state: "cancelled",
      reason: "payment_timeout",
      requestedAtMs: 1000,
      completedAtMs: 1000,
      transactionHash: null,
      errorCode: null,
    },
  };
  const recovery = createRuntimeRecovery({
    ...f.deps,
    readOrder: async () => ({ ok: true, result: response }),
  });
  await recovery.refresh();
  assert.equal(recovery.status().orders.expired, 1);
  assert.equal(recovery.status().orders.waiting, 0);
  assert.equal(recovery.status().orders.settled, 0);
  assert.equal(recovery.status().orders.review, 0);
  // Expiry is not irreversible chain evidence: a later discovered payment/refund
  // must remain visible and must never be mistaken for conflicting payout evidence.
  response = {
    order: { ...order, vaultState: "Refunded", orderStatus: "Refunded" },
  };
  f.advance();
  await recovery.refresh();
  assert.equal(recovery.status().orders.settled, 1);
  assert.equal(recovery.status().orders.review, 0);
});
test("historical Policy selector comes from the saved payment, not current Policy", async (t) => {
  const f = await fixture(t),
    scope = {
      network: "eip155:" + order.chainId,
      module: "0x" + "1".repeat(40),
      safe: order.buyerAddress,
      policyId: b32(9),
    };
  const payload = {
    ...f.entry.paymentPayload,
    payload: {
      commitment: {
        ...f.entry.paymentPayload.payload.commitment,
        policyId: b32(8),
      },
    },
  };
  await f.store.update(f.entry.invocationId, f.entry.requestHash, {
    paymentPayload: payload,
  });
  let selected;
  const recovery = createRuntimeRecovery({
    ...f.deps,
    readWallet: async () => ({
      locked: false,
      bound: true,
      recoveryScope: scope,
    }),
    readOrder: async (id, s) => {
      selected = s;
      return {
        ok: true,
        result: { order: { ...order, vaultState: "Released" } },
      };
    },
  });
  await recovery.refresh();
  assert.equal(selected.policyId, b32(8));
  assert.equal(recovery.status().orders.settled, 1);
});
test("missing Order lookup distinguishes not-found without creating or paying", async (t) => {
  const f = await fixture(t);
  await f.store.update(f.entry.invocationId, f.entry.requestHash, {
    orderId: null,
    paymentPayload: null,
    paymentSubmitted: false,
  });
  let calls = 0;
  const recovery = createRuntimeRecovery({
    ...f.deps,
    readRequest: async (request) => {
      calls++;
      assert.equal(request, f.entry.orderRequestId);
      return { ok: true, result: { found: false, orderRequestId: request } };
    },
  });
  await recovery.refresh();
  assert.equal(calls, 1);
  assert.equal(recovery.status().issues[0].code, "ORIGINAL_POLICY_UNKNOWN");
  assert.equal((await f.store.inventory())[f.entry.invocationId].orderId, null);
});
test("read-only lookup attaches original Order only after identity checks and preserves concurrent progress", async (t) => {
  const f = await fixture(t);
  await f.store.update(f.entry.invocationId, f.entry.requestHash, {
    orderId: null,
  });
  const scope = {
    network: "eip155:" + order.chainId,
    module: "0x" + "1".repeat(40),
    safe: order.buyerAddress,
    policyId: b32(8),
  };
  const recovery = createRuntimeRecovery({
    ...f.deps,
    readWallet: async () => ({
      locked: false,
      bound: true,
      recoveryScope: scope,
    }),
    readRequest: async (request) => ({
      ok: true,
      result: {
        found: true,
        orderRequestId: request,
        order: { ...order, vaultState: "Released" },
      },
    }),
  });
  await recovery.refresh();
  assert.equal(
    (await f.store.inventory())[f.entry.invocationId].orderId,
    order.orderId,
  );
  const current = (await f.store.inventory())[f.entry.invocationId];
  assert.equal(
    await f.store.attachRecoveredOrder(current, b32(99), scope),
    false,
  );
});
test("lookup cannot attach a foreign request or overwrite concurrent history", async (t) => {
  const f = await fixture(t);
  await f.store.update(f.entry.invocationId, f.entry.requestHash, {
    orderId: null,
  });
  const recovery = createRuntimeRecovery({
    ...f.deps,
    readRequest: async (request) => ({
      ok: true,
      result: {
        found: true,
        orderRequestId: request,
        order: { ...order, requestHash: b32(97) },
      },
    }),
  });
  await recovery.refresh();
  assert.equal((await f.store.inventory())[f.entry.invocationId].orderId, null);
  assert.equal(recovery.status().issues[0].code, "ORDER_IDENTITY_MISMATCH");
  const expected = (await f.store.inventory())[f.entry.invocationId];
  await f.store.update(expected.invocationId, expected.requestHash, {
    acceptedTerms: { baseAmountAtomic: "1" },
  });
  assert.equal(
    await f.store.attachRecoveredOrder(expected, order.orderId, null),
    false,
  );
});
test("request lookup failures remain retryable and cannot mean no Order", async (t) => {
  const f = await fixture(t);
  await f.store.update(f.entry.invocationId, f.entry.requestHash, {
    orderId: null,
  });
  const recovery = createRuntimeRecovery({
    ...f.deps,
    readRequest: async () => {
      throw Error("network down");
    },
  });
  await recovery.refresh();
  assert.equal(recovery.status().issues[0].code, "ORDER_CHECK_UNAVAILABLE");
  assert.equal((await f.store.inventory())[f.entry.invocationId].orderId, null);
});
test("archiving hides matching warnings, preserves terminal counts, and new evidence restores attention", async (t) => {
  const f = await fixture(t);
  await f.recovery.refresh();
  const { localOrderReviews } = await import("../src/order-review.mjs");
  const entry = (await f.store.inventory())[f.entry.invocationId],
    observation = JSON.parse(await readFile(f.path + ".recovery.json"))
      .observations[entry.invocationId];
  await localOrderReviews(f.path).change(entry, observation, {
    archive: true,
    note: "Reviewed independently.",
  });
  await f.recovery.refresh();
  assert.equal(f.recovery.status().orders.archived, 1);
  assert.equal(f.recovery.status().orders.settled, 1);
  assert.equal(f.recovery.status().issues.length, 0);
  f.setOrder({ ...order, vaultState: "Refunded" });
  f.advance();
  await f.recovery.refresh();
  assert.equal(f.recovery.status().orders.archived, 0);
  assert.equal(f.recovery.status().issues[0].code, "ORDER_STATE_CONFLICT");
});

test("background restart verifies a pending result with scoped reads; mismatch, missing evidence and revoked Policy never promote it", async (t) => {
  const { hashServiceProfile, hashServiceOutput } = await import(
    "@c4roa0/agentpay-protocol"
  );
  const { invocationResults } = await import("../src/invocation-result.mjs");
  for (const mode of [
    "matching",
    "missing",
    "mismatch",
    "revoked",
    "disk-error",
  ]) {
    const dir = await mkdtemp(join(tmpdir(), "pending-recovery-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "invocations.json"),
      store = createInvocationStore(path),
      results = invocationResults(path);
    const profile = {
      version: "agentpay.service-profile.v1",
      providerId: "provider:test",
      serviceId: "example",
      mcpEndpoint: "https://example.invalid/services/example/mcp/invoke",
      paymentEndpoint:
        "https://example.invalid/services/example/agentpay/invoke",
      seller: "0x" + "3".repeat(40),
      network: "eip155:" + order.chainId,
      asset: order.assetAddress.toLowerCase(),
    };
    const reference = {
      version: "agentpay.service-reference.v1",
      adapter: "agentpay.json.v1",
      skillId: order.skillId,
      profileHash: hashServiceProfile(profile),
      profile,
    };
    let entry = await store.begin({
      invocationKey: "pending-recovery-" + mode,
      requestHash: order.requestHash,
      binding: JSON.stringify({
        version: "agentpay.runtime-service.v1",
        reference,
        requestedMaxUsageUnits: "1",
      }),
      routingVersion: "agentpay.runtime-call.v1",
    });
    entry = await store.update(entry.invocationId, entry.requestHash, {
      orderId: order.orderId,
    });
    const pending = {
      version: "agentpay.service-result.v1",
      orderId: entry.orderId,
      requestHash: entry.requestHash,
      output: { value: "private" },
      outputHash: hashServiceOutput({ value: "private" }),
      usageUnits: "1",
    };
    await results.savePending(entry, pending);
    let reads = 0;
    const recovery = createRuntimeRecovery({
      store,
      results:
        mode === "disk-error"
          ? {
              ...results,
              save: async () => {
                throw Error("disk full");
              },
            }
          : results,
      statePath: path,
      settlementUrl: "https://example.invalid",
      readWallet: async () => ({ locked: false, bound: true }),
      readOrder: async () => {
        reads++;
        if (mode === "revoked")
          throw Object.assign(Error(), { code: "RECOVERY_POLICY_UNAVAILABLE" });
        return {
          ok: true,
          result: {
            order: {
              ...order,
              providerId: profile.providerId,
              profileHash: reference.profileHash,
              vaultState: "Released",
              orderStatus: "Released",
            },
            ...(mode === "missing"
              ? {}
              : {
                  deliveryEvidence: {
                    outputHash:
                      mode === "mismatch" ? b32(99) : pending.outputHash,
                    usageUnits: "1",
                  },
                }),
          },
        };
      },
    });
    await recovery.refresh();
    assert.equal(reads, 1);
    assert.equal(Boolean(await results.read(entry)), mode === "matching");
    const saved = JSON.parse(await readFile(path + ".recovery.json", "utf8"))
      .observations[entry.invocationId];
    assert.equal(
      saved.resultState,
      mode === "matching" ? "verified" : "pending",
    );
    if (mode === "missing") assert.equal(recovery.status().orders.waiting, 1);
    if (mode === "mismatch")
      assert.equal(saved.errorCode, "RECOVERY_RESULT_INVALID");
    if (mode === "revoked")
      assert.equal(saved.errorCode, "RECOVERY_POLICY_UNAVAILABLE");
    if (mode === "disk-error")
      assert.equal(saved.errorCode, "RESULT_STORAGE_UNAVAILABLE");
  }
});
