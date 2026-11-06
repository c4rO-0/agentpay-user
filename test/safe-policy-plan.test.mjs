// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { getBytes, Interface, Wallet } from "ethers";
import {
  buildSafePolicyPlan,
  safeEthSignSignature,
} from "../src/safe-policy-plan.mjs";

const config = {
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8547",
  safe: "0x1111111111111111111111111111111111111111",
  module: "0x2222222222222222222222222222222222222222",
  token: "0x3333333333333333333333333333333333333333",
  factory: "0x4444444444444444444444444444444444444444",
  registry: "0x5555555555555555555555555555555555555555",
  policyId: `0x${"a".repeat(64)}`,
  maxPerPayment: "1000000",
  totalBudget: "5000000",
  validAfter: 1,
  validUntil: Math.floor(Date.now() / 1000) + 86400,
};
const delegate = "0x6666666666666666666666666666666666666666";
test("existing-Safe plan exposes exactly the two bounded owner actions", () => {
  const plan = buildSafePolicyPlan(config, delegate);
  assert.equal(plan.calls.length, 2);
  assert.equal(plan.calls[0].to, config.safe);
  assert.equal(plan.calls[1].to, config.module);
  const enable = new Interface(["function enableModule(address module)"]);
  const policy = new Interface([
    "function createPolicy(bytes32,address,address,address,address,uint256,uint256,uint64,uint64)",
  ]);
  assert.equal(
    enable.parseTransaction({ data: plan.calls[0].data }).args[0],
    config.module,
  );
  const args = policy.parseTransaction({ data: plan.calls[1].data }).args;
  assert.equal(args[0], config.policyId);
  assert.equal(args[1], delegate);
  assert.equal(args[5], 1000000n);
  assert.equal(args[6], 5000000n);
  assert.equal(plan.walletPolicy.maxAmount, "1000000");
  assert.equal(plan.walletPolicy.delegate, delegate);
  assert.equal("ownerPrivateKey" in plan, false);
});
test("plan rejects unsafe RPC and invalid limits before any owner action", () => {
  assert.throws(
    () =>
      buildSafePolicyPlan(
        { ...config, rpcUrl: "http://example.com" },
        delegate,
      ),
    /RPC_URL_UNSAFE/,
  );
  assert.throws(
    () => buildSafePolicyPlan({ ...config, totalBudget: "999999" }, delegate),
    /BUDGET_BELOW/,
  );
  assert.throws(
    () => buildSafePolicyPlan({ ...config, validUntil: 1 }, delegate),
    /VALIDITY_INVALID/,
  );
  assert.throws(
    () =>
      buildSafePolicyPlan(
        { ...config, policyId: `0x${"0".repeat(64)}` },
        delegate,
      ),
    /POLICY_ID_INVALID/,
  );
});
test("Anvil owner eth_sign is encoded as Safe EIP-191 signature only after recovery", async () => {
  const owner = Wallet.createRandom();
  const hash = `0x${"a".repeat(64)}`;
  const signed = await owner.signMessage(getBytes(hash));
  const safeSigned = safeEthSignSignature(hash, signed, owner.address);
  assert.ok(["1f", "20"].includes(safeSigned.slice(-2)));
  assert.throws(
    () => safeEthSignSignature(hash, signed, Wallet.createRandom().address),
    /SIGNATURE_MISMATCH/,
  );
});
