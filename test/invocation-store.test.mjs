// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInvocationStore } from "../src/invocation-store.mjs";

test("invocation checkpoint survives restart without private request or output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentpay-user-invocation-"));
  const path = join(directory, "invocations.json");
  try {
    const first = createInvocationStore(path);
    const started = await first.begin({
      invocationKey: "caller-run-0001",
      requestHash: b32("1"),
    });
    const paymentPayload = {
      x402Version: 2,
      payload: { signature: "0xsigned" },
    };
    await first.update(started.invocationId, started.requestHash, {
      orderId: b32("2"),
      paymentPayload,
      paymentSubmitted: true,
    });

    const restarted = createInvocationStore(path);
    const recovered = await restarted.begin({
      invocationKey: "caller-run-0001",
      requestHash: b32("1"),
    });
    assert.equal(recovered.orderRequestId, started.orderRequestId);
    assert.equal(recovered.commitmentNonce, started.commitmentNonce);
    assert.equal(recovered.orderId, b32("2"));
    assert.deepEqual(recovered.paymentPayload, paymentPayload);
    assert.equal(recovered.paymentSubmitted, true);
    await assert.rejects(
      restarted.begin({
        invocationKey: "caller-run-0001",
        requestHash: b32("3"),
      }),
      (error) => error?.code === "INVOCATION_CONFLICT",
    );

    const persisted = await readFile(path, "utf8");
    assert(
      !persisted.includes("caller-run-0001"),
      "raw caller idempotency key must not be stored",
    );
    assert(!persisted.includes("private request"));
    assert(!persisted.includes("private output"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsupported or damaged invocation state fails closed without replacing a purchase intent", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "agentpay-user-state-invalid-"),
  );
  const path = join(directory, "invocations.json");
  const key = "caller-run-0002";
  const requestHash = b32("1");
  try {
    const store = createInvocationStore(path);
    const started = await store.begin({ invocationKey: key, requestHash });
    const original = JSON.parse(await readFile(path, "utf8"));
    for (const damaged of [
      { ...original, version: "agentpay.user-invocations.v2" },
      { ...original, invocations: null },
      {
        ...original,
        invocations: {
          [started.invocationId]: {
            ...original.invocations[started.invocationId],
            orderRequestId: null,
          },
        },
      },
      [],
      "{invalid-json",
    ]) {
      const bytes =
        typeof damaged === "string" ? damaged : JSON.stringify(damaged);
      await writeFile(path, bytes);
      const restarted = createInvocationStore(path);
      await assert.rejects(
        restarted.begin({ invocationKey: key, requestHash }),
        (error) => error?.code === "INVOCATION_STATE_INVALID",
      );
      assert.equal(await readFile(path, "utf8"), bytes);
    }
    await writeFile(path, JSON.stringify(original));
    const recovered = await createInvocationStore(path).begin({
      invocationKey: key,
      requestHash,
    });
    assert.equal(recovered.orderRequestId, started.orderRequestId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function b32(digit) {
  return `0x${digit.repeat(64)}`;
}

test("strict legacy timestamps migrate on write while purchase identity and signed payload survive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-time-history-")),
    path = join(dir, "state.json");
  try {
    const store = createInvocationStore(path),
      entry = await store.begin({
        invocationKey: "legacy-time-0001",
        requestHash: b32("1"),
      });
    let document = JSON.parse(await readFile(path, "utf8"));
    assert.equal(document.timeEncoding, "unix-ms");
    assert.equal(
      typeof document.invocations[entry.invocationId].createdAtMs,
      "number",
    );
    assert.equal(
      "createdAt" in document.invocations[entry.invocationId],
      false,
    );
    const old = { ...document };
    delete old.timeEncoding;
    old.invocations[entry.invocationId] = {
      ...old.invocations[entry.invocationId],
      createdAt: "2026-10-07T08:00:00.123+08:00",
      updatedAt: "2026-10-07T00:00:00.123Z",
      paymentPayload: { signedAt: "opaque-private-signed-field" },
    };
    delete old.invocations[entry.invocationId].createdAtMs;
    delete old.invocations[entry.invocationId].updatedAtMs;
    await writeFile(path, JSON.stringify(old));
    const resumed = await createInvocationStore(path).begin({
      invocationKey: "legacy-time-0001",
      requestHash: b32("1"),
    });
    assert.equal(resumed.orderRequestId, entry.orderRequestId);
    assert.equal(resumed.commitmentNonce, entry.commitmentNonce);
    await createInvocationStore(path).update(
      entry.invocationId,
      entry.requestHash,
      { paymentSubmitted: true },
    );
    document = JSON.parse(await readFile(path, "utf8"));
    assert.equal(
      document.invocations[entry.invocationId].createdAtMs,
      1791331200123,
    );
    assert.deepEqual(document.invocations[entry.invocationId].paymentPayload, {
      signedAt: "opaque-private-signed-field",
    });
    for (const change of [
      { createdAtMs: -1 },
      { createdAtMs: null },
      { createdAt: "2026-10-07 00:00:00" },
      { createdAt: "2026-10-08T00:00:00Z" },
    ]) {
      const bad = structuredClone(document);
      Object.assign(bad.invocations[entry.invocationId], change);
      const bytes = JSON.stringify(bad);
      await writeFile(path, bytes);
      await assert.rejects(
        () =>
          createInvocationStore(path).begin({
            invocationKey: "legacy-time-0001",
            requestHash: b32("1"),
          }),
        { code: "INVOCATION_STATE_INVALID" },
      );
      assert.equal(await readFile(path, "utf8"), bytes);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("original-only continuation atomically rejects missing or replaced history without reading Wallet", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "original-only-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state"),
    store = createInvocationStore(path);
  const args = {
    invocationKey: "original-request-key-001",
    requestHash: b32("1"),
  };
  await assert.rejects(store.lookup(args), {
    code: "ORIGINAL_REQUEST_NOT_FOUND",
  });
  const original = await store.begin(args);
  assert.equal(
    (await store.lookup(args)).orderRequestId,
    original.orderRequestId,
  );
  await rm(path);
  let walletReads = 0;
  await assert.rejects(
    store.begin({
      ...args,
      originalOrderRequestId: original.orderRequestId,
      readRecoveryScope: async () => {
        walletReads++;
      },
    }),
    { code: "ORIGINAL_REQUEST_NOT_FOUND" },
  );
  assert.equal(walletReads, 0);
  assert.deepEqual(await store.inventory(), {});
  const replacement = await store.begin(args);
  assert.notEqual(replacement.orderRequestId, original.orderRequestId);
  await assert.rejects(
    store.begin({ ...args, originalOrderRequestId: original.orderRequestId }),
    { code: "ORIGINAL_REQUEST_NOT_FOUND" },
  );
});
