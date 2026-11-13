#!/usr/bin/env node
import { CHAIN_CHECK_TIMEOUT_MS } from "../src/setup-diagnostics.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  confirmDemoUnlockSecret,
  readHiddenTerminal,
} from "../src/demo-unlock-secret.mjs";
import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { checkLocalInstallation } from "../src/install-preflight.mjs";
import {
  inspectLocalUserSetup,
  runUserSetupGuide,
} from "../src/user-setup-guide.mjs";
try {
  const args = process.argv.slice(2),
    demo = args[0] === "--demo";
  if (args[0] === "--guided") {
    if (args.length > 2 || (args[1] && !isAbsolute(args[1])))
      throw Error("Usage: user-setup.mjs --guided [ABSOLUTE_PRIVATE_DATA_DIR]");
    if (!process.stdin.isTTY)
      throw Error("Run the setup guide in an interactive terminal.");
    const { resolveUserDataDir } = await import(
      "../src/local-data-directory.mjs"
    );
    const { runGuidedEntry } = await import("../src/guided-setup.mjs");
    const dataDir = await resolveUserDataDir({argument:args[1]});
    const { activateSetup } = await import('../src/setup-service-selection.mjs');
    const activation = await activateSetup({dataDir});
    if (activation) process.exit(activation);
    process.exit(
      await runGuidedEntry({
        userDir: fileURLToPath(new URL("..", import.meta.url)),
        dataDir: await resolveUserDataDir({ argument: args[1] }),
      }),
    );
  }

  if (["--config", "--anvil"].includes(args[0])) {
    if (args.length !== 3 || !isAbsolute(args[1]) || !isAbsolute(args[2]))
      throw Error(
        "Usage: user-setup.mjs --config ABSOLUTE_PRIVATE_DATA_DIR ABSOLUTE_CONFIG_JSON",
      );
    if (!process.stdin.isTTY)
      throw Error("Run the setup guide in an interactive terminal.");
    const preflight = await checkLocalInstallation({
      userDir: fileURLToPath(new URL("..", import.meta.url)),
      dataDir: args[1],
    });
    if (!preflight.ok) {
      for (const item of preflight.checks.filter(
        (item) => item.status === "failed",
      ))
        console.error(`${item.message}. ${item.fix || ""}`);
      process.exitCode = 1;
    } else {
      const { runAnvilOnboarding } = await import(
        "../src/anvil-onboarding.mjs"
      );
      const ask = async (prompt) => {
        const terminal = createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        try {
          return await terminal.question(prompt);
        } finally {
          terminal.close();
        }
      };
      const config = JSON.parse(await readFile(args[2], "utf8"));
      if (
        args[0] === "--anvil" &&
        (config.mode !== "private-anvil" || config.chainId !== 31337)
      )
        throw Error("PRIVATE_ANVIL_CONFIG_REQUIRED");
      const result = await runAnvilOnboarding({
        dataDir: args[1],
        config,
        ask,
        write: (value) => process.stdout.write(`${value}\n`),
      });
      process.exit(
        result?.completed === false && result.stage !== "quit" ? 1 : 0,
      );
    }
    if (!preflight.ok) process.exit(1);
  }
  if (
    demo
      ? args.length !== 1
      : !args[0] || !isAbsolute(args[0]) || args.length > 2
  )
    throw Error(
      "Usage: user-setup.mjs --demo | ABSOLUTE_PRIVATE_DATA_DIR [PUBLIC_DEPLOYMENT_JSON]",
    );
  if (!process.stdin.isTTY)
    throw Error("Run the setup guide in an interactive terminal.");
  const ask = async (prompt) => {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return await terminal.question(prompt);
    } finally {
      terminal.close();
    }
  };
  const write = (text) => process.stdout.write(`${text}\n`);
  let demoInitialized = false;
  await runUserSetupGuide({
    demo,
    ask,
    write,
    check: () =>
      demo
        ? { ok: true }
        : checkLocalInstallation({
            userDir: fileURLToPath(new URL("..", import.meta.url)),
            dataDir: args[0],
          }),
    state: () =>
      demo
        ? {
            stage: demoInitialized ? "initialized" : "not_initialized",
            delegate: demoInitialized ? `0x${"5".repeat(40)}` : null,
            policyStatus: "not_configured",
            runtimeStatus: "not_checked",
          }
        : inspectLocalUserSetup(args[0]),
    initialize: async () => {
      if (demo) {
        write(
          "\n------------------------------------------------------------\nSet your Wallet unlock secret\n------------------------------------------------------------",
        );
        await confirmDemoUnlockSecret({
          readHidden: readHiddenTerminal,
          write,
        });
        write(
          "\n------------------------------------------------------------\nPrepare local runtime access\n------------------------------------------------------------\n  Real setup saves a local access credential automatically.\n  Demo: skipped; no credential or file is created.",
        );
        demoInitialized = true;
        return;
      }
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./setup-local.mjs", import.meta.url)),
          "install",
          args[0],
        ],
        { stdio: "inherit" },
      );
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      if (code !== 0)
        throw Error(
          "Initialization did not finish. Existing state was preserved; inspect and resume.",
        );
    },
    preview: async (delegate, options = {}) => {
      if (!demo && !args[1]) {
        write(
          "Provide a trusted public deployment JSON as the second argument to preview authorization. No Policy was changed.",
        );
        return;
      }
      const { runPolicyTerminalGuide } = await import(
        "../src/policy-terminal-guide.mjs"
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
        : JSON.parse(await readFile(args[1], "utf8"));
      return await runPolicyTerminalGuide({
        deployment,
        delegate,
        demo,
        ask,
        write,
        ...options,
        inspect: async (plan) => {
          const { JsonRpcProvider } = await import("ethers");
          const { inspectSafePolicy } = await import(
            "../src/safe-policy-plan.mjs"
          );
          const rpc = new JsonRpcProvider(plan.rpcUrl);
          let timer;
          try {
            return await Promise.race([
              inspectSafePolicy(rpc, plan),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(Object.assign(Error("CHAIN_CHECK_TIMEOUT"), {code:"CHAIN_CHECK_TIMEOUT"})), CHAIN_CHECK_TIMEOUT_MS);
              }),
            ]);
          } finally {
            clearTimeout(timer);
            rpc.destroy();
          }
        },
      });
    },
  });
} catch (error) {
  console.error(error.message);
  console.error('For a read-only diagnostic report, run agentpay health. Keep your saved data.');
  process.exitCode = 1;
}
