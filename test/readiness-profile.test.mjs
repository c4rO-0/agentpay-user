// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { settlementProfileBlocker } from "../src/readiness-profile.mjs";

const address = (digit) => `0x${digit.repeat(40)}`;
const plan = {
  chainId: 31337,
  token: address("1"),
  factory: address("2"),
  registry: address("3"),
};
const profile = {
  chainId: 31337,
  network: "eip155:31337",
  assetAddress: address("1"),
  factoryAddress: address("2"),
  registryAddress: address("3"),
};

test("current Settlement profile permits a matching Policy", () => {
  assert.equal(settlementProfileBlocker(plan, profile), null);
});

test("old Factory Policy is blocked before purchase", () => {
  assert.equal(
    settlementProfileBlocker({ ...plan, factory: address("4") }, profile),
    "POLICY_PROFILE_MISMATCH",
  );
});

test("Registry, chain and asset drift block readiness", () => {
  for (const change of [
    { registryAddress: address("4") },
    { chainId: 8453 },
    { assetAddress: address("4") },
    { network: "eip155:8453" },
  ]) {
    assert.equal(
      settlementProfileBlocker(plan, { ...profile, ...change }),
      "POLICY_PROFILE_MISMATCH",
    );
  }
});

test("older or malformed Settlement response fails closed", () => {
  assert.equal(
    settlementProfileBlocker(plan, undefined),
    "SETTLEMENT_PROFILE_UNAVAILABLE",
  );
  assert.equal(
    settlementProfileBlocker(plan, { ...profile, factoryAddress: "bad" }),
    "SETTLEMENT_PROFILE_UNAVAILABLE",
  );
});
