// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSettlementResult } from "../src/settlement-response.mjs";
const fixtures = JSON.parse(
  readFileSync(
    new URL(
      "../node_modules/@c4roa0/agentpay-protocol/fixtures/agentpay-native-service-v1/records.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const v2 = JSON.parse(
  readFileSync(
    new URL(
      "../node_modules/@c4roa0/agentpay-protocol/fixtures/agentpay-participant-order-v2/records.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("Runtime validates closure fields and refuses payment instructions during closure", () => {
  const closure = {
    version: "agentpay.order-closure.v1",
    state: "requested",
    reason: "user_cancel",
    requestedAtMs: 1792677004000,
    completedAtMs: null,
    transactionHash: null,
    errorCode: null,
  };
  assert.deepEqual(
    readSettlementResult({
      ok: true,
      result: { order: v2.buyerOrder, closure },
    }).closure,
    closure,
  );
  for (const result of [
    { closure: { ...closure, requestedAtMs: "1792677004000" } },
    { closure: { ...closure, rawTransaction: "private" } },
    { closure, paymentRequired: {} },
    {
      waiting: { version: "agentpay.order-waiting.v1", paymentDueAtMs: "bad" },
    },
  ])
    assert.throws(() => readSettlementResult({ ok: true, result }), {
      code: "SETTLEMENT_RESPONSE_INVALID",
    });
});
test("Runtime adapts old Wallet and retains integer Order from updated Wallet without touching purchase identities", () => {
  for (const order of [fixtures.buyerOrder, v2.buyerOrder]) {
    const paymentRequired = {
      extra: { orderId: order.orderId, termsHash: "original-signed-hash" },
    };
    const result = readSettlementResult({
      ok: true,
      result: { order, paymentRequired },
    });
    assert.deepEqual(result.order, v2.buyerOrder);
    assert.equal(result.paymentRequired, paymentRequired);
  }
  assert.deepEqual(
    readSettlementResult({ ok: true, result: { authorization: "opaque" } }),
    { authorization: "opaque" },
  );
});
test("Runtime rejects ambiguous/invalid time and unexpected participant role", () => {
  for (const value of [
    { ok: false, result: {} },
    { ok: true, result: [] },
    { ok: true, result: { order: null } },
    { ok: true, result: { order: fixtures.providerOrder } },
    {
      ok: true,
      result: {
        order: { ...fixtures.buyerOrder, createdAt: "2026-10-07 01:00:00" },
      },
    },
    {
      ok: true,
      result: { order: { ...v2.buyerOrder, createdAtMs: "1791020911000" } },
    },
  ]) {
    assert.throws(
      () => readSettlementResult(value),
      (e) => e.code === "SETTLEMENT_RESPONSE_INVALID",
    );
  }
});
test("Runtime validates finalization even when the response has no nested Order", () => {
  const { legacy, v2 } = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/agentpay-finalization-disclosure-v2/records.json",
        import.meta.resolve("@c4roa0/agentpay-protocol"),
      ),
      "utf8",
    ),
  );
  for (const finalization of [legacy, v2])
    assert.deepEqual(
      readSettlementResult({
        ok: true,
        result: { authorization: "opaque", finalization },
      }),
      { authorization: "opaque", finalization: v2 },
    );
  assert.equal(
    readSettlementResult({ ok: true, result: { finalization: null } })
      .finalization,
    null,
  );
  assert.throws(
    () =>
      readSettlementResult({
        ok: true,
        result: {
          finalization: {
            ...legacy,
            releaseScheduledAt: "2026-09-27T09:10:50",
          },
        },
      }),
    { code: "SETTLEMENT_RESPONSE_INVALID" },
  );
});
test("Runtime preserves deadline instants and distinguishes old policy snapshots", () => {
  const { legacy, v2 } = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/agentpay-order-deadlines-v2/records.json",
        import.meta.resolve("@c4roa0/agentpay-protocol"),
      ),
      "utf8",
    ),
  );
  for (const deadlines of [legacy, v2])
    assert.deepEqual(
      readSettlementResult({ ok: true, result: { deadlines } }).deadlines,
      v2,
    );
  const old = readSettlementResult({
    ok: true,
    result: {
      deadlines: {
        ...legacy,
        deliveryDueAt: null,
        chainMarginMs: null,
        deadlinePolicyVersion: null,
      },
    },
  });
  assert.equal(old.deadlines.deliveryDueAtMs, null);
  assert.equal(old.deadlines.deadlinePolicyVersion, null);
  for (const deadlines of [
    { ...legacy, refundAvailableAt: "2026-09-27T09:22:00" },
    { ...v2, providerResponseDueAtMs: "1790000000000" },
  ])
    assert.throws(
      () => readSettlementResult({ ok: true, result: { deadlines } }),
      { code: "SETTLEMENT_RESPONSE_INVALID" },
    );
});
test("Runtime adapts service authorization times while preserving one-time token", () => {
  const { legacy, v2 } = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/agentpay-service-authorization-v2/records.json",
        import.meta.resolve("@c4roa0/agentpay-protocol"),
      ),
      "utf8",
    ),
  );
  for (const result of [legacy, v2])
    assert.deepEqual(
      readSettlementResult({
        ok: true,
        result: { ...result, authorization: "opaque-fixture" },
      }),
      { ...v2, authorization: "opaque-fixture" },
    );
  const missing = { ...legacy };
  delete missing.expiresAt;
  for (const result of [
    missing,
    { ...legacy, expiresAt: "2026-09-27T09:05:00" },
    { ...v2, responseDueAtMs: "1790000000000" },
  ])
    assert.throws(() => readSettlementResult({ ok: true, result }), {
      code: "SETTLEMENT_RESPONSE_INVALID",
    });
});
test("Runtime confirmation results keep the actual stored release time even after late confirmation", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/agentpay-delivery-result-v2/records.json",
        import.meta.resolve("@c4roa0/agentpay-protocol"),
      ),
      "utf8",
    ),
  );
  for (const result of [fixture.confirmationLegacy, fixture.confirmationV2])
    assert.deepEqual(
      readSettlementResult({ ok: true, result }),
      fixture.confirmationV2,
    );
  for (const result of [
    { ...fixture.confirmationLegacy, confirmedAt: "2026-09-27T09:02:00" },
    { ...fixture.confirmationV2, releaseDueAtMs: "1790000000000" },
  ])
    assert.throws(() => readSettlementResult({ ok: true, result }), {
      code: "SETTLEMENT_RESPONSE_INVALID",
    });
});
