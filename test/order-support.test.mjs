// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashPrivateRequest,
  hashServiceOutput,
  hashServiceProfile,
} from "@c4roa0/agentpay-protocol";
import { runOrderSupport } from "../src/order-support.mjs";
import { createInvocationStore } from "../src/invocation-store.mjs";
import { invocationResults } from "../src/invocation-result.mjs";
import { saveServiceSettings } from "../src/local-services.mjs";

const b32 = (n) => "0x" + n.toString(16).padStart(64, "0");
const orderFixture = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/agentpay-participant-order-v2/records.json",
      import.meta.resolve("@c4roa0/agentpay-protocol"),
    ),
    "utf8",
  ),
).buyerOrder;

test("Order support restores two business results using only read/retrieval operations", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "order-support-"));
  await Promise.all(
    ["wallet", "runtime"].map((p) => mkdir(join(dir, p), { mode: 0o700 })),
  );
  await writeFile(join(dir, "wallet/agent.token"), "local-fixture-token", {
    mode: 0o600,
  });
  const records = new Map(),
    calls = [],
    httpCalls = [];
  let invalidHash = false;
  const provider = httpServer((req, res) => {
    httpCalls.push(req.method);
    assert.match(req.headers.authorization, /^AgentPayResult /);
    const permission = JSON.parse(
      Buffer.from(req.headers.authorization.slice(15), "base64url"),
    );
    const entry = records.get(permission.orderId);
    assert.ok(entry);
    res.end(
      JSON.stringify({
        ok: true,
        result: {
          version: "agentpay.service-result.v1",
          orderId: entry.orderId,
          requestHash: entry.requestHash,
          output: entry.output,
          outputHash: invalidHash ? b32(999) : entry.outputHash,
          usageUnits: "1",
        },
      }),
    );
  });
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${provider.address().port}`;
  const wallet = createServer((socket) => {
    let data = "";
    socket.on("data", (part) => {
      data += part;
      if (!data.includes("\n")) return;
      const req = JSON.parse(data),
        entry = records.get(req.params.orderId);
      calls.push(req.method);
      assert.equal(req.token, "local-fixture-token");
      let result;
      if (req.method === "requestSettlementResult")
        result = {
          orderId: entry.orderId,
          requestHash: entry.requestHash,
          endpoint: entry.endpoint,
        };
      else if (req.method === "readSettlementOrder")
        result = {
          order: {
            ...orderFixture,
            orderId: entry.orderId,
            requestHash: entry.requestHash,
          },
          deliveryEvidence: { outputHash: entry.outputHash, usageUnits: "1" },
        };
      else assert.fail("Unexpected Wallet mutation: " + req.method);
      setTimeout(
        () =>
          socket.end(
            JSON.stringify({ ok: true, result: { ok: true, result } }),
          ),
        5,
      );
    });
  });
  await new Promise((r) => wallet.listen(join(dir, "wallet/wallet.sock"), r));
  t.after(async () => {
    await Promise.all([
      new Promise((r) => wallet.close(r)),
      new Promise((r) => {
        provider.closeAllConnections();
        provider.close(r);
      }),
    ]);
    await rm(dir, { recursive: true, force: true });
  });
  await saveServiceSettings({
    dataDir: dir,
    runtimeUrl: "http://127.0.0.1:6490",
    settlementUrl: "http://127.0.0.1:6572",
  });
  const state = join(dir, "runtime/invocations.json"),
    store = createInvocationStore(state);
  for (const [i, output] of [
    { tracking: "ABC", carrier: "example" },
    { resourceHours: 2, artifact: "complete" },
  ].entries()) {
    const profile = {
      version: "agentpay.service-profile.v1",
      providerId: "provider:fixture",
      serviceId: "fixture-" + i,
      mcpEndpoint: `${origin}/services/fixture-${i}/mcp/invoke`,
      paymentEndpoint: `${origin}/services/fixture-${i}/agentpay/invoke`,
      seller: "0x" + "3".repeat(40),
      network: "eip155:31337",
      asset: "0x" + "4".repeat(40),
    };
    const reference = {
      version: "agentpay.service-reference.v1",
      adapter: "agentpay.json.v1",
      skillId: b32(i + 1),
      profileHash: hashServiceProfile(profile),
      profile,
    };
    const requestHash = hashPrivateRequest({ business: i }),
      orderId = b32(i + 10),
      binding = JSON.stringify({
        version: "agentpay.runtime-service.v1",
        reference,
        requestedMaxUsageUnits: "1",
      });
    const entry = await store.begin({
      invocationKey: "retrieve-case-" + i,
      requestHash,
      binding,
      routingVersion: "agentpay.runtime-call.v1",
    });
    await store.update(entry.invocationId, requestHash, {
      orderId,
      paymentSubmitted: true,
    });
    records.set(orderId, {
      orderId,
      requestHash,
      output,
      outputHash: hashServiceOutput(output),
      endpoint: profile.paymentEndpoint,
    });
    const before = await readFile(state, "utf8"),
      messages = [];
    assert.equal(
      await runOrderSupport([orderId, "retrieve"], {
        dataDir: dir,
        write: (s) => messages.push(s),
      }),
      0,
      messages.join("\n"),
    );
    assert.deepEqual(
      (await invocationResults(state).read(entry)).output,
      output,
    );
    assert.equal(
      await readFile(state, "utf8"),
      before,
      "retrieval cannot rewrite request/payment history",
    );
    assert.equal(
      await runOrderSupport([orderId, "case"], {
        dataDir: dir,
        write: (s) => messages.push(s),
      }),
      0,
    );
    assert.match(messages.at(-1), /\.\/run market connect/);
    assert.ok(!calls.includes("createSettlementCaseAccess"));
  }
  invalidHash = true;
  const messages = [];
  assert.equal(
    await runOrderSupport([b32(10), "retrieve"], {
      dataDir: dir,
      write: (s) => messages.push(s),
    }),
    1,
  );
  assert.match(
    messages.join("\n"),
    /does not match original delivery evidence/,
  );
  assert.deepEqual(
    new Set(calls),
    new Set(["requestSettlementResult", "readSettlementOrder"]),
  );
  assert.equal(
    httpCalls.length,
    3,
    "only explicit original-result retrieval reaches Provider",
  );
});
