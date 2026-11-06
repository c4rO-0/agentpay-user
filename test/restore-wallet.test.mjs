// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { restoreExistingPolicy } from "../src/restore-wallet.mjs";
import { runPolicyTerminalGuide } from "../src/policy-terminal-guide.mjs";
const at = (n) => "0x" + String(n).repeat(40),
  policyId = "0x" + "a".repeat(64);
const target = {
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8547",
  module: at(1),
  safe: at(6),
  policyId,
};
const deployment = {
  ...target,
  token: at(2),
  factory: at(3),
  registry: at(4),
  tokenDecimals: 6,
  tokenSymbol: "rUSDC",
  source: "test",
};
const preview = {
  policy: {
    ...deployment,
    delegate: at(5),
    maxAmount: "1000000",
    validUntil: 2000000000,
  },
  terms: {
    totalBudget: "10000000",
    spent: "3000000",
    maxPerPayment: "1000000",
    validAfter: 1,
    validUntil: 2000000000,
  },
  remainingBudget: "7000000",
};
test("restore unlocks locally, previews, requires confirmation and freshly verifies at bind", async () => {
  const calls = [],
    output = [];
  const ops = {
    wallet: async (_d, m) => {
      calls.push(m);
      return m === "status" ? { locked: true } : preview;
    },
    unlock: async () => {
      calls.push("unlock");
      return 0;
    },
  };
  await restoreExistingPolicy({
    dataDir: "/private",
    target,
    expectedDeployment: deployment,
    ops,
    ask: async () => "confirm",
    write: (v) => output.push(v),
  });
  assert.deepEqual(calls, [
    "status",
    "unlock",
    "previewPolicyRestore",
    "restorePolicy",
  ]);
  assert.ok(output.some((v) => v.includes("7.0 rUSDC")));
  calls.length = 0;
  await assert.rejects(
    restoreExistingPolicy({
      dataDir: "/private",
      target,
      ops,
      ask: async () => "q",
      write: () => {},
    }),
    (e) => e.code === "CANCELLED",
  );
  assert.ok(!calls.includes("restorePolicy"));
});
test("preview never binds; deployment mismatch and fresh chain rejection preserve original permission", async () => {
  const calls = [];
  const ops = {
    wallet: async (_d, m) => {
      calls.push(m);
      return m === "status" ? { locked: false } : preview;
    },
  };
  await restoreExistingPolicy({
    dataDir: "/private",
    target,
    previewOnly: true,
    ops,
    write: () => {},
    ask: () => {
      throw Error("no approval at preview");
    },
  });
  assert.deepEqual(calls, ["status", "previewPolicyRestore"]);
  await assert.rejects(
    restoreExistingPolicy({
      dataDir: "/private",
      target,
      expectedDeployment: { ...deployment, factory: at(9) },
      ops,
      write: () => {},
    }),
    /another deployment/,
  );
  assert.ok(!calls.includes("restorePolicy"));
  ops.wallet = async (_d, m) => {
    if (m === "restorePolicy")
      throw Object.assign(Error("expired"), { code: "RESTORE_POLICY_EXPIRED" });
    return m === "status" ? { locked: false } : preview;
  };
  await assert.rejects(
    restoreExistingPolicy({
      dataDir: "/private",
      target,
      ops,
      ask: async () => "confirm",
      write: () => {},
    }),
    (e) => e.code === "RESTORE_POLICY_EXPIRED",
  );
});
test("old Policy choice precedes budget and survives a failed read without generating a new Policy", async () => {
  let checkpoint = null,
    reads = 0;
  const answers = [at(6), policyId];
  const options = {
    deployment,
    delegate: at(5),
    write: () => {},
    saveInputs: async (v) => {
      checkpoint = v;
    },
    ask: async () => {
      assert.ok(answers.length);
      return answers.shift();
    },
    restoreExisting: async () => {
      reads++;
      throw Error("network offline");
    },
  };
  await assert.rejects(runPolicyTerminalGuide(options), /network offline/);
  assert.equal(checkpoint.fields.policyChoice, policyId);
  assert.equal(checkpoint.fields.budget, undefined);
  answers.push("");
  const result = await runPolicyTerminalGuide({
    ...options,
    checkpoint,
    restoreExisting: async (t) => {
      assert.deepEqual(t, target);
      return preview;
    },
  });
  assert.equal(result.restored, true);
  assert.equal(result.policyConfig.policyId, policyId);
  assert.equal(reads, 1);
});
