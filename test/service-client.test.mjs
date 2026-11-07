// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashServiceProfile } from "@c4roa0/agentpay-protocol";
import { selectInvocation, resumeInvocation } from "../src/runtime-client.mjs";
test("generic retry cannot silently change usage cap or transport; force keeps old intent", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "service-client-binding-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const profile = {
    version: "agentpay.service-profile.v1",
    providerId: "provider:example",
    serviceId: "echo",
    mcpEndpoint: "https://example.test/services/echo/mcp/invoke",
    paymentEndpoint: "https://example.test/services/echo/agentpay/invoke",
    seller: "0x" + "1".repeat(40),
    network: "eip155:31337",
    asset: "0x" + "2".repeat(40),
  };
  const ref = {
      version: "agentpay.service-reference.v1",
      skillId: "0x" + "3".repeat(64),
      profileHash: hashServiceProfile(profile),
      profile,
      adapter: "agentpay.json.v1",
    },
    connection = { dataDir: dir, runtimeUrl: "http://127.0.0.1:6490" };
  const input = { request: { max: 20, min: 10 }, requestedMaxUsageUnits: "1" };
  const original = await selectInvocation(connection, ref, input);
  assert.equal(
    (
      await selectInvocation(connection, ref, {
        request: { min: 10, max: 20 },
        requestedMaxUsageUnits: "1",
      })
    ).requestId,
    original.requestId,
  );
  await assert.rejects(
    selectInvocation(connection, ref, {
      ...input,
      requestedMaxUsageUnits: "2",
    }),
    { code: "REQUEST_CONFLICT" },
  );
  await assert.rejects(
    selectInvocation(
      connection,
      { ...ref, adapter: "agentpay.random.v1" },
      input,
    ),
    { code: "SKILL_SERVICE_INVALID" },
  );
  const forced = await selectInvocation(
    connection,
    ref,
    { ...input, requestedMaxUsageUnits: "2" },
    { force: true },
  );
  assert.notEqual(forced.requestId, original.requestId);
  assert.deepEqual(
    (await resumeInvocation(connection, ref, original.requestId)).input,
    input,
  );
  const large = {
    request: { text: "x".repeat(30000) },
    requestedMaxUsageUnits: "1",
  };
  const largeCall = await selectInvocation(connection, ref, large);
  assert.equal(
    (await selectInvocation(connection, ref, large)).requestId,
    largeCall.requestId,
  );
});
