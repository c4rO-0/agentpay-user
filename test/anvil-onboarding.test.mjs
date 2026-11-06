// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../src/anvil-onboarding.mjs";
import { runPolicyTerminalGuide } from "../src/policy-terminal-guide.mjs";
import { buildSafePolicyPlan } from "../src/safe-policy-plan.mjs";
const at = (n) => `0x${String(n).repeat(40)}`;
const config = {
  mode: "private-anvil",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8547",
  settlementUrl: "http://127.0.0.1:6472",
  runtimeUrl: "http://127.0.0.1:6490",
  marketBundleMetadataUrl:
    "http://127.0.0.1:6473/skills/bundles/example/metadata",
  ownerAddress: at(6),
  bundleSha256: "a".repeat(64),
  tokenDecimals: 6,
  maxUsageUnits: 1,
  module: at(1),
  token: at(2),
  factory: at(3),
  registry: at(4),
  source: "operator-reviewed Anvil deployment",
};
test("Anvil onboarding accepts explicit private config and rejects public or wrong-chain targets", () => {
  assert.equal(validateConfig(config), config);
  for (const changed of [
    { chainId: 0 },
    { ownerSigner: "anvil", chainId: 8453 },
    { settlementUrl: "http://example.com" },
    { runtimeUrl: "http://0.0.0.0:6490" },
    { runtimeUrl: "http://localhost:6490" },
    { ownerPrivateKey: "must not be accepted" },
    { marketBundleMetadataUrl: "http://127.0.0.1:6473/x?token=secret" },
    { maxUsageUnits: 2 },
    { bundleSha256: "wrong" },
  ]) {
    assert.throws(() => validateConfig({ ...config, ...changed }));
  }
});
test("confirmed terminal draft returns an exact plan for persistence and chain verification", async () => {
  const answers = [at(6), "10", "1", "7", "confirm"];
  const result = await runPolicyTerminalGuide({
    deployment: config,
    delegate: at(5),
    ask: async () => answers.shift(),
    write: () => {},
    inspect: async () => ({ moduleEnabled: false, policyMatches: false }),
  });
  assert.equal(result.mode, "read_only");
  assert.equal(result.chainError, null);
  const plan = buildSafePolicyPlan(result.policyConfig, at(5));
  assert.equal(plan.safe, at(6));
  assert.equal(plan.totalBudget, 10000000n);
  assert.equal(plan.maxPerPayment, 1000000n);
  assert.equal(plan.calls.length, 2);
});
