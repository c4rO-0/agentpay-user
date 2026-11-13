// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  runPolicyTerminalGuide,
  authorizationContext,
} from "../src/policy-terminal-guide.mjs";
const at = (n) => `0x${String(n).repeat(40)}`;
const deployment = {
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  module: at(1),
  token: at(2),
  factory: at(3),
  registry: at(4),
  tokenDecimals: 6,
  source: "test",
};
test("demo validates amounts and shows a single final preview consent", async () => {
  const answers = [
      "invalid",
      "",
      "0",
      "10",
      "20",
      "1",
      "invalid",
      "7",
      "confirm",
    ],
    output = [];
  const result = await runPolicyTerminalGuide({
    deployment,
    delegate: at(5),
    demo: true,
    ask: async () => answers.shift(),
    write: (s) => output.push(s),
    inspect: () => {
      throw Error("no chain");
    },
  });
  assert.equal(result.readyToPurchase, false);
  assert.equal(result.calls.length, 2);
  assert.equal(result.policyConfig.safe, at(6));
  assert.ok(output.some((s) => s.includes("No permission was granted")));
});
test("cancellation and failed chain checks never report authorization", async () => {
  await assert.rejects(
    runPolicyTerminalGuide({
      deployment,
      delegate: at(5),
      ask: async () => "q",
      write: () => {},
    }),
    (e) => e.code === "CANCELLED",
  );
  const answers = [at(6), "10", "1", "7"];
  const result = await runPolicyTerminalGuide({
    deployment,
    delegate: at(5),
    ask: async () => answers.shift(),
    write: () => {},
    inspect: async () => {
      throw Error("private RPC secret");
    },
  });
  assert.match(result.chainError, /could not complete/);
  assert.doesNotMatch(result.chainError, /secret/);
});
test("missing Safe guidance identifies the required network without another yes/no gate", async () => {
  const answers = ["create", "q"],
    output = [];
  await assert.rejects(
    runPolicyTerminalGuide({
      deployment,
      delegate: at(5),
      ask: async () => answers.shift(),
      write: (s) => output.push(s),
    }),
    (e) => e.code === "CANCELLED",
  );
  assert.ok(output.some((s) => s.includes("Anvil (31337)")));
});
test("saved private Safe is reused without an address prompt; collecting limits requests no draft approval", async () => {
  const answers = ["1", "0.7", "1"],
    prompts = [];
  const result = await runPolicyTerminalGuide({
    deployment: { ...deployment, mode: "private-anvil", safe: at(6) },
    delegate: at(5),
    collectOnly: true,
    ask: async (p) => {
      prompts.push(p);
      return answers.shift();
    },
    write: () => {},
    inspect: async () => ({}),
  });
  assert.equal(result.policyConfig.safe, at(6));
  assert.equal(prompts.length, 3);
  assert.ok(prompts.every((p) => !p.includes("'confirm'")));
});

test("conflicting saved authorization Safe is not silently replaced by configuration", async () => {
  const current = { ...deployment, mode: "private-anvil", safe: at(6) };
  await assert.rejects(
    runPolicyTerminalGuide({
      deployment: current,
      delegate: at(5),
      checkpoint: {
        version: 2,
        context: authorizationContext(current, at(5)),
        fields: { safe: at(7) },
      },
      ask: async () => {
        throw Error("must not prompt");
      },
      saveInputs: async () => {
        throw Error("must not overwrite");
      },
      write: () => {},
    }),
    /SAVED_AUTHORIZATION_FIELD_MISMATCH/,
  );
});

test("back from per-payment returns to the saved budget and uses the revised limit", async () => {
  const answers = ["10", "back", "5", "1", "7"];
  let checkpoint;
  const result = await runPolicyTerminalGuide({
    deployment: { ...deployment, mode: "private-anvil", safe: at(6) },
    delegate: at(5),
    collectOnly: true,
    ask: async () => {
      assert.ok(answers.length);
      return answers.shift();
    },
    write: () => {},
    saveInputs: async (v) => {
      checkpoint = v;
    },
    inspect: async () => ({}),
  });
  assert.equal(result.policyConfig.totalBudget, "5000000");
  assert.equal(checkpoint.fields.budget, "5");
  assert.equal(answers.length, 0);
});

test("renewal defaults accept Enter and put navigation on its own line", async () => {
  const answers = ["", "", ""],
    prompts = [],
    output = [];
  const result = await runPolicyTerminalGuide({
    deployment: {
      ...deployment,
      mode: "private-anvil",
      safe: at(6),
      tokenSymbol: "rUSDC",
    },
    delegate: at(5),
    collectOnly: true,
    defaults: { budget: "10.0", perPayment: "1.0", days: "180" },
    ask: async (p) => {
      prompts.push(p);
      assert.ok(answers.length);
      return answers.shift();
    },
    write: (s) => output.push(s),
    inspect: async () => ({}),
  });
  assert.equal(result.policyConfig.totalBudget, "10000000");
  assert.equal(result.policyConfig.maxPerPayment, "1000000");
  assert.equal(
    result.policyConfig.validUntil - result.policyConfig.validAfter,
    180 * 86400,
  );
  assert.ok(prompts.every((p) => p.includes("\n('back'")));
  assert.ok(prompts.every((p) => !p.includes("for example")));
  assert.ok(output.includes("Currency: rUSDC · Maximum: 10.0"));
});
test("lower budget cannot silently reuse an excessive previous per-purchase limit", async () => {
  const answers = ["0.5", "", "0.2", ""],
    prompts = [];
  const result = await runPolicyTerminalGuide({
    deployment: { ...deployment, mode: "private-anvil", safe: at(6) },
    delegate: at(5),
    collectOnly: true,
    defaults: { budget: "10", perPayment: "1", days: "30" },
    ask: async (p) => {
      prompts.push(p);
      assert.ok(answers.length);
      return answers.shift();
    },
    write: () => {},
    inspect: async () => ({}),
  });
  assert.equal(result.policyConfig.maxPerPayment, "200000");
  assert.ok(prompts.slice(1, 3).every((p) => !p.includes("keep 1")));
});

test("external renewal reuses the bound Safe and labels preserved expiry and remaining allowance", async () => {
  const prompts = [],
    output = [],
    answers = ["", "", ""];
  const expiry = Math.floor(Date.now() / 1000) + 164 * 86400 + 123;
  const result = await runPolicyTerminalGuide({
    deployment: { ...deployment, mode: "production", tokenSymbol: "rUSDC" },
    delegate: at(5),
    boundSafe: at(6),
    migration: true,
    collectOnly: true,
    defaults: {
      budget: "9.3",
      perPayment: "1",
      days: "164",
      validUntil: expiry,
    },
    ask: async (p) => {
      prompts.push(p);
      assert.ok(answers.length);
      return answers.shift();
    },
    write: (s) => output.push(s),
    inspect: async () => ({}),
  });
  assert.equal(prompts.length, 3);
  assert.equal(result.policyConfig.safe, at(6));
  assert.equal(result.policyConfig.validUntil, expiry);
  assert.match(output.join("\n"), /remaining allowance/);
  assert.match(output.join("\n"), /Keep the original expiry/);
  assert.doesNotMatch(output.join("\n"), /starting now/);
});

test("chain-check progress appears before waiting for the RPC", async () => {
  const output = [],
    answers = ["10", "1", "180"];
  await runPolicyTerminalGuide({
    deployment,
    delegate: at(5),
    boundSafe: at(6),
    collectOnly: true,
    ask: async () => answers.shift(),
    write: (s) => output.push(s),
    inspect: async () => {
      assert.match(output.at(-1), /Checking the network, Safe and contracts/);
      assert.match(output.at(-1), /No transaction/);
      return {};
    },
  });
});
