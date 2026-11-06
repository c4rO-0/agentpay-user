// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  migrationSummary,
  migratedPublicPolicy,
  syncMigratedPublicPolicy,
} from "../src/policy-migration.mjs";
import { executeAnvilOwnerCall } from "../src/safe-owner-anvil.mjs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

test("migration presentation exposes the replacement budget and exact factory/expiry change", () => {
  const source = {
    chainId: 31337,
    safe: "safe",
    delegate: "delegate",
    token: "token",
    registry: "registry",
    module: "module",
    factory: "old",
    policyId: "old-policy",
    maxAmount: "5000000",
    validUntil: 2_000_000_000,
  };
  const plan = {
    source,
    destination: {
      ...source,
      factory: "new",
      policyId: "new-policy",
      registryRpcUrl: "http://127.0.0.1:8547",
    },
    migrationId: "migration",
    sourceTerms: { totalBudget: "20000000", spent: "700000" },
    totalBudget: "19300000",
    validAfter: 1,
  };
  const summary = migrationSummary(plan);
  assert.equal(summary.replacementBudgetAtomic, "19300000");
  assert.equal(summary.oldFactory, "old");
  assert.equal(summary.newFactory, "new");
  assert.equal(migratedPublicPolicy(plan).totalBudget, "19300000");
  assert.equal(migratedPublicPolicy(plan).validUntil, source.validUntil);
});
test("test owner adapter refuses live networks and remote RPC before requesting any signature", async () => {
  for (const source of [
    { chainId: 8453, registryRpcUrl: "http://127.0.0.1:8547" },
    { chainId: 31337, registryRpcUrl: "https://example.com" },
  ]) {
    await assert.rejects(
      executeAnvilOwnerCall({ source }, "unused", {}),
      /ANVIL_OWNER_SIGNING_TEST_ONLY/,
    );
  }
});
test("owner RPC failure hides raw calldata and signatures from terminal errors", async () => {
  const owner = `0x${"11".repeat(20)}`;
  const sensitive = "DO_NOT_LOG_RAW_SIGNED_SAFE_CALLDATA";
  const rpc = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const call = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: call.id,
        ...(call.method === "eth_chainId"
          ? { result: "0x7a69" }
          : call.method === "eth_accounts"
            ? { result: [owner] }
            : { error: { code: -32000, message: sensitive } }),
      }),
    );
  });
  await new Promise((resolve) => rpc.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      executeAnvilOwnerCall(
        {
          source: {
            chainId: 31337,
            registryRpcUrl: `http://127.0.0.1:${rpc.address().port}`,
            safe: `0x${"22".repeat(20)}`,
          },
        },
        owner,
        {},
      ),
      (error) => {
        assert.equal(
          error.message,
          "SAFE_OWNER_CALL_UNCONFIRMED_RECHECK_CHAIN",
        );
        assert.doesNotMatch(error.stack, new RegExp(sensitive));
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => rpc.close(resolve));
  }
});
test("public Policy metadata sync retries after Wallet completion and rejects unrelated local configuration", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "agentpay-migration-metadata-"));
  try {
    const source = {
      chainId: 31337,
      safe: "safe",
      module: "module",
      factory: "old",
      registry: "registry",
      token: "token",
      policyId: "old-policy",
      validUntil: 2_000_000_000,
      maxAmount: "5000000",
      registryRpcUrl: "http://127.0.0.1:8547",
    };
    const plan = {
      source,
      destination: { ...source, factory: "new", policyId: "new-policy" },
      totalBudget: "19300000",
      validAfter: 1,
    };
    const file = join(dataDir, "public-policy.json");
    await writeFile(
      file,
      JSON.stringify({
        ...source,
        ownerAddress: "test-owner",
        totalBudget: "20000000",
      }),
      { mode: 0o600 },
    );
    await syncMigratedPublicPolicy(dataDir, plan);
    await syncMigratedPublicPolicy(dataDir, plan);
    const actual = JSON.parse(await readFile(file, "utf8"));
    assert.equal(actual.totalBudget, "19300000");
    assert.equal(actual.factory, "new");
    assert.equal(actual.ownerAddress, "test-owner");
    await writeFile(file, JSON.stringify({ ...actual, safe: "another-safe" }));
    await assert.rejects(
      syncMigratedPublicPolicy(dataDir, plan),
      /PUBLIC_POLICY_CONFIG_CONFLICT/,
    );
    assert.equal(JSON.parse(await readFile(file, "utf8")).safe, "another-safe");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
