// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Phase0Wallet } from "../../wallet/dist/src/wallet.js";
import {
  initializeCapabilities,
  startWalletServer,
  callWallet,
} from "../../wallet/dist/src/ipc.js";
import { runAnvilOnboarding, saveNewDraft } from "../src/anvil-onboarding.mjs";
import { buildSafePolicyPlan } from "../src/safe-policy-plan.mjs";
import { sameWalletPolicy } from "../src/anvil-onboarding-state.mjs";
const at = (n) => `0x${String(n).repeat(40)}`;
const config = {
  ownerSigner: "anvil",
  mode: "private-anvil",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8547",
  settlementUrl: "http://127.0.0.1:6572",
  runtimeUrl: "http://127.0.0.1:6590",
  marketBundleMetadataUrl: "http://127.0.0.1:6583/skills/bundles/test/metadata",
  ownerAddress: at(6),
  bundleSha256: "a".repeat(64),
  tokenDecimals: 6,
  maxUsageUnits: 1,
  module: at(1),
  token: at(2),
  factory: at(3),
  registry: at(4),
  source: "isolated test",
};
async function data(t) {
  const dir = await mkdtemp(join(tmpdir(), "onboarding-local-"));
  await mkdir(join(dir, "runtime"), { mode: 0o700 });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test("draft persistence publishes complete private JSON and refuses to overwrite recovery state", async (t) => {
  const dir = await data(t),
    path = join(dir, "runtime", "authorization-draft.json");
  await saveNewDraft(path, { version: 1, policyId: "first" });
  const before = await readFile(path);
  await assert.rejects(
    saveNewDraft(path, { version: 1, policyId: "replacement" }),
    { code: "EEXIST" },
  );
  assert.deepEqual(await readFile(path), before);
  assert.deepEqual(await readdir(join(dir, "runtime")), [
    "authorization-draft.json",
  ]);
});
test("guide binds through real Wallet admin IPC while it runs locked; reopening sees the same binding", async (t) => {
  const dir = await data(t);
  const walletDir = join(dir, "wallet");
  const wallet = await Phase0Wallet.initialize(
    walletDir,
    "disposable fixture secret",
  );
  await initializeCapabilities(walletDir);
  const delegate = await wallet.address();
  await writeFile(join(dir, "runtime", "caller.token"), "1".repeat(64), {
    mode: 0o600,
  });
  const draft = {
    ...config,
    version: 1,
    delegate,
    safe: at(6),
    policyId: "0x" + "b".repeat(64),
    maxPerPayment: "1000000",
    totalBudget: "10000000",
    validAfter: Math.floor(Date.now() / 1000) - 5,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
  };
  await saveNewDraft(join(dir, "runtime", "authorization-draft.json"), draft);
  const server = await startWalletServer(walletDir);
  t.after(() => server.close());
  const answers = ["continue", "q"],
    output = [];
  // Only chain reads are fixtures. Binding, persistence, CLI subprocess, socket and status are real.
  const r = await runAnvilOnboarding({
    dataDir: dir,
    config,
    ask: async () => {
      assert.ok(answers.length);
      return answers.shift();
    },
    write: (s) => output.push(s),
    operations: {
      runtimeHealth: async () => {
        throw Error("fixture runtime is stopped");
      },
      runNode: async () => {
        throw Error("Stop before unlock/start in this IPC test");
      },
      networkFacts: async () => ({ decimals: 6 }),
      chainState: async () => ({
        moduleEnabled: true,
        policyExists: true,
        policyMatches: true,
      }),
    },
  });
  assert.equal(r.stage, "quit");
  assert.equal(r.next, "start");
  assert.equal(
    sameWalletPolicy(
      (await Phase0Wallet.open(walletDir)).policy,
      buildSafePolicyPlan(draft, delegate).walletPolicy,
    ),
    true,
  );
  const token = (await readFile(join(walletDir, "agent.token"), "utf8")).trim();
  const status = await callWallet(server.socketPath, token, "status", {});
  assert.equal(status.locked, true);
  assert.equal(status.bound, true);
  assert.ok(
    !(await readdir(join(dir, "runtime"))).some((s) =>
      s.startsWith("wallet-bind-"),
    ),
  );
});
