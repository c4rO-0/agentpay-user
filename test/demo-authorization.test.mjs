// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { runSetupDemo } from "../src/setup-demo.mjs";
import { runPolicyTerminalGuide } from "../src/policy-terminal-guide.mjs";
const at = (n) => `0x${String(n).repeat(40)}`;
const deployment = {
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  module: at(1),
  token: at(2),
  factory: at(3),
  registry: at(4),
  tokenDecimals: 6,
  source: "fictional demo",
};
test("complete demo collects limits once and confirms official receipt automatically after paid-test consent", async () => {
  const answers = ["continue", "", "1", "0.7", "1", "confirm", "confirm"];
  const prompts = [],
    output = [];
  let initialized = false;
  const ask = async (p) => {
    prompts.push(p);
    assert.ok(answers.length);
    return answers.shift();
  };
  const result = await runSetupDemo({
    ask,
    write: (s) => output.push(s),
    check: async () => ({ ok: true }),
    state: async () => ({
      stage: initialized ? "initialized" : "not_initialized",
      delegate: at(5),
    }),
    initialize: async () => {
      initialized = true;
    },
    preview: (delegate, options) =>
      runPolicyTerminalGuide({
        deployment,
        delegate,
        demo: true,
        ask,
        write: (s) => output.push(s),
        ...options,
      }),
  });
  assert.equal(result.completed, true);
  assert.equal(answers.length, 0);
  assert.equal(
    prompts.filter((p) => p.includes("simulate the paid test")).length,
    1,
  );
  assert.equal(prompts.filter((p) => p.includes("Confirm receipt")).length, 0);
  assert.equal(
    prompts.filter((p) => p.includes("owner authorization")).length,
    1,
  );
  assert.ok(output.at(-1).includes("close this terminal"));
});
