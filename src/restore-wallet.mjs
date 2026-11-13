import {reportCommandFailure} from "./command-diagnostics.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { getAddress, formatUnits } from "ethers";
import {
  resolveUserDataDir,
  installedUserDir,
} from "./local-data-directory.mjs";
import { inspectLocalUserSetup } from "./user-setup-guide.mjs";
import { ensureLocalServices } from "./prepare-local-services.mjs";
import { localWalletAdmin } from "./local-wallet-ipc.mjs";
import { controlWallet } from "./wallet-control.mjs";
import { displaySeconds } from "./local-time.mjs";
export const restoreMessages = {
  METHOD_NOT_ALLOWED:
    "This Wallet build does not support restoration. Install compatible User and Wallet versions, then retry agentpay wallet restore.",
  RESTORE_CONTRACT_MISSING:
    "A required contract is missing. Check the network, Safe and Module addresses.",
  RESTORE_CHAIN_UNAVAILABLE:
    "The chain could not be read. Check your RPC connection and retry agentpay wallet restore.",
  RESTORE_TARGET_INVALID:
    "Check the network, Module, Safe and original Policy ID.",
  POLICY_KEY_MISMATCH:
    "This Policy belongs to a different Session Key. Use its original key.",
  POLICY_ALREADY_BOUND:
    "This Wallet already uses another Policy. Its binding was kept.",
  RESTORE_POLICY_NOT_FOUND:
    "No Policy was found for this Safe and ID. Check the network, Module and Policy ID.",
  RESTORE_POLICY_REVOKED:
    "This Policy was revoked and cannot be restored for spending.",
  RESTORE_POLICY_EXPIRED:
    "This Policy has expired. Restoring a key does not renew spending permission.",
  RESTORE_POLICY_NOT_ACTIVE:
    "This Policy is not active yet. Try again after its start time.",
  RESTORE_MODULE_DISABLED:
    "The Safe has disabled this Module. Restore does not enable it.",
  MIGRATION_CHAIN_MISMATCH:
    "The RPC returned a different network. Check its address.",
  LOCKED: "Wallet is locked. Unlock it before restoring the authorization.",
  CANCELLED: "Restoration paused. Existing Wallet data was kept.",
};
async function askTerminal(message) {
  if (!process.stdin.isTTY)
    throw Error("Run agentpay wallet restore in an interactive terminal.");
  const r = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await r.question(message + "\n> ");
  } finally {
    r.close();
  }
}
async function run(script, args, dataDir) {
  const code = await new Promise((done, reject) => {
    const c = spawn(
      process.execPath,
      [join(installedUserDir, "scripts", script), ...args],
      {
        stdio: "inherit",
        env: { ...process.env, AGENTPAY_USER_DATA_DIR: dataDir },
      },
    );
    c.once("error", reject);
    c.once("exit", done);
  });
  if (code !== 0)
    throw Error(
      "Local preparation did not finish. Retry agentpay wallet restore.",
    );
}
export async function restoreExistingPolicy({
  dataDir,
  target,
  ask = askTerminal,
  write = console.log,
  expectedDeployment = null,
  previewOnly = false,
  ops = {},
}) {
  const services = {
    ensure: ensureLocalServices,
    wallet: localWalletAdmin,
    unlock: controlWallet,
    run,
    ...ops,
  };
  let status;
  try {
    status = await services.wallet(dataDir, "status");
  } catch (e) {
    if (e.code !== "WALLET_NOT_RUNNING") throw e;
  }
  if (!status) {
    await services.ensure({ dataDir, ask, write });
    await services.run("autostart.mjs", ["prepare"], dataDir);
    await services.run("autostart.mjs", ["start"], dataDir);
    for (let i = 0; i < 30; i++) {
      try {
        status = await services.wallet(dataDir, "status");
        break;
      } catch (e) {
        if (e.code !== "WALLET_NOT_RUNNING") throw e;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  if (!status)
    throw Error("Wallet did not start. Run agentpay status before retrying.");
  if (
    status.locked &&
    (await services.unlock("unlock", { args: [dataDir], write })) !== 0
  )
    throw Object.assign(Error(), { code: "CANCELLED" });
  const preview = await services.wallet(dataDir, "previewPolicyRestore", {
    target,
  });
  if (
    expectedDeployment &&
    ["factory", "registry", "token", "module"].some(
      (k) =>
        preview.policy[k].toLowerCase() !== expectedDeployment[k].toLowerCase(),
    )
  )
    throw Error(
      "This Policy uses another deployment. Use agentpay wallet restore separately; the current setup test cannot use it.",
    );
  if (previewOnly) return preview;
  write(
    "\n------------------------------------------------------------\n> Restore spending permission\n------------------------------------------------------------",
  );
  write(
    `Safe: ${preview.policy.safe}\nPolicy ID: ${preview.policy.policyId}\nNetwork: eip155:${preview.policy.chainId}`,
  );
  const amount = (value) =>
    expectedDeployment
      ? `${formatUnits(value, expectedDeployment.tokenDecimals)} ${expectedDeployment.tokenSymbol || "tokens"}`
      : `${value} atomic units (token ${preview.policy.token})`;
  if (expectedDeployment)
    write(
      `Remaining budget: ${amount(preview.remainingBudget)}\nPer-purchase limit: ${amount(preview.policy.maxAmount)}`,
    );
  write(`Expires: ${displaySeconds(preview.policy.validUntil)}`);
  if (preview.remainingBudget === "0")
    write(
      "No budget remains. Restoring this identity does not enable new purchases.",
    );
  write("Use this existing permission. Its limits and expiry will not change.");
  while (true) {
    const value = (
      await ask(
        "Type 'confirm' to restore, 'details' for existing limits, or 'q' to return.",
      )
    ).trim();
    if (value === "q") throw Object.assign(Error(), { code: "CANCELLED" });
    if (value === "details") {
      write(
        `Remaining budget: ${amount(preview.remainingBudget)}\nPer-purchase limit: ${amount(preview.policy.maxAmount)}`,
      );
      continue;
    }
    if (value === "confirm") break;
  }
  const result = await services.wallet(dataDir, "restorePolicy", { target });
  write(
    "Original Policy restored locally. No new authorization or payment was made.",
  );
  return result;
}
export async function runWalletRestore({
  ask = askTerminal,
  write = console.log,
  resolveDirectory = resolveUserDataDir,
  ops = {},
} = {}) {
  try {
    const dataDir = await resolveDirectory();
    let local = await inspectLocalUserSetup(dataDir);
    if (local.stage !== "initialized") {
      write(
        "First restore your original Session Key. Wallet will ask for secrets privately.",
      );
      await (ops.run || run)(
        "setup-local.mjs",
        ["install", dataDir, "--restore"],
        dataDir,
      );
      local = await inspectLocalUserSetup(dataDir);
      if (local.stage !== "initialized") return 0;
    }
    const field = async (prompt, validate) => {
      while (true) {
        const value = (await ask(prompt + " ('q' to return)")).trim();
        if (value === "q") throw Object.assign(Error(), { code: "CANCELLED" });
        try {
          return validate(value);
        } catch {
          write("Check this value and try again.");
        }
      }
    };
    write(
      "Find your original Policy ID in Market → Wallets, or your saved agentpay wallet info.",
    );
    const chainId = await field("Network chain ID (for example 31337)", (v) => {
      const n = Number(v);
      if (!/^[1-9][0-9]*$/.test(v) || !Number.isSafeInteger(n)) throw Error();
      return n;
    });
    const rpcUrl = await field("RPC address for this network", (v) => {
      const u = new URL(v);
      if (
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        !(
          u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
        )
      )
        throw Error();
      return u.href;
    });
    const module = await field(
        "AgentPay Module address from your saved settings",
        getAddress,
      ),
      safe = await field("Original Safe account address", getAddress),
      policyId = await field("Original Policy ID", (v) => {
        if (!/^0x[0-9a-f]{64}$/i.test(v) || /^0x0+$/.test(v)) throw Error();
        return v.toLowerCase();
      });
    await restoreExistingPolicy({
      dataDir,
      target: { chainId, rpcUrl, module, safe, policyId },
      ask,
      write,
      ops,
    });
    write(
      "Restore finished. Use agentpay status to check services and retained Orders.",
    );
    return 0;
  } catch (e) {
    if(e.code!=="CANCELLED") await reportCommandFailure(e,{operation:"Restore Wallet",write});
    write(
      restoreMessages[e.code] ||
        e.message ||
        "Restoration could not complete. Check the network and retry agentpay wallet restore; existing data was kept.",
    );
    return e.code === "CANCELLED" ? 0 : 1;
  }
}
