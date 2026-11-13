#!/usr/bin/env node
import { ReadOnlyRpc } from "../src/read-only-rpc.mjs";
import { CHAIN_CHECK_TIMEOUT_MS } from "../src/setup-diagnostics.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { inspectSafePolicy } from "../src/safe-policy-plan.mjs";
import { runPolicyTerminalGuide } from "../src/policy-terminal-guide.mjs";
let terminal;
try {
  const args = process.argv.slice(2),
    demo = args[0] === "--demo";
  if (demo ? args.length !== 1 : args.length !== 2)
    throw Error(
      "Usage: guide-policy.mjs --demo | PUBLIC_DEPLOYMENT_JSON WALLET_DELEGATE",
    );
  if (!process.stdin.isTTY)
    throw Error(
      "Run this guide in an interactive terminal; piped authorization input is not accepted.",
    );
  const deployment = demo
    ? {
        chainId: 31337,
        rpcUrl: "http://127.0.0.1:8545",
        module: `0x${"1".repeat(40)}`,
        token: `0x${"2".repeat(40)}`,
        factory: `0x${"3".repeat(40)}`,
        registry: `0x${"4".repeat(40)}`,
        tokenDecimals: 6,
        source: "Demo data, not an actual deployment",
      }
    : JSON.parse(await readFile(args[0], "utf8"));
  terminal = createInterface({ input: process.stdin, output: process.stderr });
  await runPolicyTerminalGuide({
    deployment,
    delegate: demo ? `0x${"5".repeat(40)}` : args[1],
    demo,
    ask: (prompt) => terminal.question(prompt),
    write: (message) => process.stdout.write(`${message}\n`),
    inspect: async (plan) => {
      const rpc = new ReadOnlyRpc(plan.rpcUrl);
      let timeout;
      try {
        return await Promise.race([
          inspectSafePolicy(rpc, plan),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Object.assign(Error("CHAIN_CHECK_TIMEOUT"), {code:"CHAIN_CHECK_TIMEOUT"})), CHAIN_CHECK_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        rpc.destroy();
      }
    },
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = error.code === "CANCELLED" ? 0 : 1;
} finally {
  terminal?.close();
}
