import {reportCommandFailure} from "./command-diagnostics.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  loadCurrentDeployment,
  deploymentChanges,
  syncSetupDeployment,
} from "./deployment-status.mjs";
import { approveOwnerOperations } from "./owner-approval-server.mjs";
import { selectedOwnerSigner, checkTestSigner } from "./owner-signer.mjs";
import { connectMarket } from "./connect-market.mjs";
import { revokeOnChain } from "./policy-operations.mjs";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { resolveUserDataDir } from "./local-data-directory.mjs";
import { localWalletAdmin } from "./local-wallet-ipc.mjs";
import { controlWallet } from "./wallet-control.mjs";
import {
  runPolicyTerminalGuide,
  showAuthorizationSummary,
} from "./policy-terminal-guide.mjs";
import { buildSafePolicyPlan, inspectSafePolicy } from "./safe-policy-plan.mjs";
import { executeAnvilOwnerCall } from "./safe-owner-anvil.mjs";
import { JsonRpcProvider, Contract, Interface, formatUnits } from "ethers";
async function read(path) {
  let h;
  try {
    h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = await h.stat();
    if (
      !st.isFile() ||
      st.uid !== process.getuid() ||
      st.mode & 0o077 ||
      st.size > 65536
    )
      throw Error("Unsafe saved authorization");
    return JSON.parse(await h.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await h?.close();
  }
}
async function save(path, value) {
  const tmp = path + "." + randomUUID() + ".tmp";
  let h;
  try {
    h = await open(tmp, "wx", 0o600);
    await h.writeFile(JSON.stringify(value) + "\n");
    await h.sync();
    await h.close();
    h = null;
    await rename(tmp, path);
  } finally {
    await h?.close();
    await unlink(tmp).catch(() => {});
  }
}
async function askTerminal(prompt) {
  if (!process.stdin.isTTY)
    throw Error("Run agentpay policy renew in your terminal.");
  const t = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await t.question(
      prompt.trimEnd().endsWith(">") ? prompt : prompt + "\n> ",
    );
  } finally {
    t.close();
  }
}
export async function renewPolicy({
  write = console.log,
  ask = askTerminal,
  dataDir,
  ownerSigner,
  readDeployment = loadCurrentDeployment,
  syncDeployment = syncSetupDeployment,
  approve = approveOwnerOperations,
  connect = connectMarket,
  call = localWalletAdmin,
  unlock = controlWallet,
  readState = read,
  saveState = save,
  guide = runPolicyTerminalGuide,
  inspect = inspectSafePolicy,
  submit = executeAnvilOwnerCall,
  revoke = revokeOnChain,
  rpcFactory = (url) =>
    new JsonRpcProvider(url, undefined, { batchMaxCount: 1 }),
  readPreviousTerms = async (rpc, policy) =>
    new Contract(
      policy.module,
      [
        "function policies(address,bytes32) view returns(address delegate,address token,address factory,address registry,uint256 maxPerPayment,uint256 totalBudget,uint256 spent,uint64 validAfter,uint64 validUntil,bool revoked)",
      ],
      rpc,
    ).policies(policy.safe, policy.policyId),
  tokenInfo = async (rpc, token) => {
    const c = new Contract(
      token,
      [
        "function decimals() view returns(uint8)",
        "function symbol() view returns(string)",
      ],
      rpc,
    );
    return { decimals: Number(await c.decimals()), symbol: await c.symbol() };
  },
} = {}) {
  let rpc;
  // Keep connection errors outside renewal failure handling: the on-chain renewal
  // and local binding have already succeeded. Use connect's own hidden password prompt.
  async function continueMarket() {
    try {
      const previous = await readState(join(dataDir, "market-connection.json"));
      if (!previous?.marketOrigin) return;
      write(
        "Continuing your Market connection with the new spending permission.",
      );
      await connect(["--market", previous.marketOrigin], { dataDir, write });
      write(
        "If Market connection is unfinished, retry with agentpay market connect. Your renewal is complete.",
      );
    } catch {
      write(
        "Spending permission is renewed. Market connection could not finish. Retry: agentpay market connect",
      );
    }
  }
  try {
    dataDir ??= await resolveUserDataDir();
    const path = join(dataDir, "runtime/policy-renewal-guide.json");
    let record = await readState(path);
    const current = await readState(join(dataDir, "wallet/policy.json"));
    if (!current) throw Error("No existing permission. Run agentpay setup first.");
    if (
      record?.sourcePolicyId !== current.policyId &&
      record?.config?.policyId !== current.policyId
    )
      record = null;
    const downloaded = await readDeployment({ dataDir, fresh: true });
    const changes = downloaded
      ? deploymentChanges(current, downloaded.config)
      : [];
    if (changes.some((k) => !["factory", "module"].includes(k)))
      throw Error(
        "Network, token or Registry changed. This requires a separate migration review; your original authorization is kept.",
      );
    const updating = changes.length > 0;
    const destination = updating ? downloaded.config : current;
    const status = await call(dataDir, "status");
    if (
      status.locked &&
      (await unlock("unlock", { args: [dataDir], write })) !== 0
    )
      return 1;
    if (
      record?.config?.policyId === current.policyId &&
      !status.policyRenewalPending
    ) {
      if (downloaded)
        await syncDeployment({
          dataDir,
          config: downloaded.config,
          authorization: record.config,
        });
      if (!record.localCompleted) {
        record = { ...record, localCompleted: true };
        await saveState(path, record);
        write("Renewal already completed and local settings verified.");
        await continueMarket();
        write("Next: agentpay status");
        return 0;
      }
      await saveState(
        path + "." + current.policyId + ".completed.json",
        record,
      );
      record = null;
    }
    if (record?.config?.policyId === current.policyId) {
      await call(dataDir, "renewPolicy", {
        expectedPolicyId: record.sourcePolicyId,
        target: {
          chainId: current.chainId,
          rpcUrl: current.registryRpcUrl,
          module: current.module,
          safe: current.safe,
          policyId: current.policyId,
        },
      });
      if (downloaded)
        await syncDeployment({
          dataDir,
          config: downloaded.config,
          authorization: record.config,
        });
      write("Renewal already completed.");
      await continueMarket();
      write("Next: agentpay status");
      return 0;
    }
    const { address } = await call(dataDir, "getAddress");
    if (address.toLowerCase() !== current.delegate.toLowerCase())
      throw Error("Wallet execution address differs from saved authorization.");
    rpc = rpcFactory(current.registryRpcUrl);
    if (Number((await rpc.getNetwork()).chainId) !== current.chainId)
      throw Error("Wrong chain");
    const signer = await selectedOwnerSigner({
      dataDir,
      choice: ownerSigner,
      readState,
    });
    checkTestSigner(signer, current);
    write(
      signer === "anvil"
        ? "Owner approval: private Anvil test signer."
        : "Owner approval: your external Safe wallet. No test account will sign.",
    );
    const token = await tokenInfo(rpc, current.token);
    const previous = await readPreviousTerms(rpc, current);
    if (
      ["delegate", "token", "factory", "registry"].some(
        (k) => String(previous[k]).toLowerCase() !== current[k].toLowerCase(),
      )
    )
      throw Error("Previous on-chain permission does not match this Wallet.");
    const chainNow = updating
      ? Number((await rpc.getBlock("latest")).timestamp)
      : null;
    const duration = updating
      ? Number(previous.validUntil) - chainNow
      : Number(previous.validUntil) - Number(previous.validAfter);
    const remaining =
      BigInt(previous.totalBudget) - BigInt(previous.spent ?? 0);
    const budget =
      updating && remaining > 0n ? remaining : BigInt(previous.totalBudget);
    const perPayment =
      updating && BigInt(previous.maxPerPayment) > budget
        ? budget
        : BigInt(previous.maxPerPayment);
    const defaults = {
      budget: formatUnits(budget, token.decimals),
      perPayment: formatUnits(perPayment, token.decimals),
      ...(updating && duration > 0
        ? { days: String(Math.max(1, Math.floor(duration / 86400))) }
        : Number.isSafeInteger(duration) && duration > 0
          ? {
              days: String(Math.ceil(duration / 86400)),
              ...(duration % 86400 ? { daysRounded: true } : {}),
            }
          : {}),
    };
    if (updating && duration > 0)
      defaults.validUntil = Number(previous.validUntil);
    if (updating && remaining <= 0n) delete defaults.budget;
    const deployment = {
      mode: signer === "anvil" ? "private-anvil" : "production",
      chainId: current.chainId,
      rpcUrl: current.registryRpcUrl,
      module: destination.module,
      token: current.token,
      factory: destination.factory,
      registry: current.registry,
      safe: current.safe,
      tokenDecimals: token.decimals,
      tokenSymbol: token.symbol,
      source: "Existing local Wallet deployment",
    };
    write(
      "\n------------------------------------------------------------\n> Renew spending permission\n------------------------------------------------------------",
    );
    if (updating) {
      write(
        "AgentPay contracts have changed. Update spending permission before making new purchases.",
      );
      write(
        "Remaining allowance is used as the default budget; review any budget or expiry change before approval.",
      );
      for (;;) {
        const answer = (
          await ask(
            "Enter 'confirm' to review updated permission, 'details' for contract addresses, or 'q' to return",
          )
        ).trim();
        if (answer === "details") {
          for (const key of changes)
            write(`${key}: ${current[key]} → ${destination[key]}`);
          continue;
        }
        if (answer !== "confirm") return 0;
        break;
      }
    }
    write(
      "Choose a new budget and expiry. Your Safe and Wallet key stay the same; previous Orders are kept.",
    );
    for (;;) {
      if (!record) {
        const inputsPath = join(
          dataDir,
          "runtime",
          "renewal-fields-" +
            current.policyId +
            (updating
              ? "-" +
                destination.module.toLowerCase() +
                "-" +
                destination.factory.toLowerCase()
              : "") +
            ".json",
        );
        const result = await guide({
          deployment,
          delegate: address,
          collectOnly: true,
          boundSafe: current.safe,
          migration: updating,
          defaults,
          checkpoint: await readState(inputsPath),
          saveInputs: (v) => saveState(inputsPath, v),
          ask,
          write,
          inspect: (plan) => inspect(rpc, plan),
        });
        if (!result.policyConfig) return 1;
        if (updating && defaults.days) {
          const fields = await readState(inputsPath);
          if (
            fields?.fields?.days === defaults.days &&
            Number(previous.validUntil) > chainNow
          )
            result.policyConfig = {
              ...result.policyConfig,
              validUntil: Number(previous.validUntil),
            };
        }
        if (
          result.policyConfig.safe.toLowerCase() !== current.safe.toLowerCase()
        )
          throw Error("Renewal must use the existing Safe.");
        record = {
          version: 1,
          sourcePolicyId: current.policyId,
          config: result.policyConfig,
        };
        await saveState(path, record);
      }
      const plan = buildSafePolicyPlan(record.config, address);
      if (
        plan.factory.toLowerCase() !== destination.factory.toLowerCase() ||
        plan.module.toLowerCase() !== destination.module.toLowerCase()
      )
        throw Error(
          "Saved renewal draft uses another deployment. Keep it for review; do not submit a replacement.",
        );
      write(
        "Checking the saved permission on-chain before review… No transaction is being submitted.",
      );
      const state = await inspect(rpc, plan);
      showAuthorizationSummary(plan, {
        write,
        currency: deployment.tokenSymbol,
        decimals: deployment.tokenDecimals,
      });
      write(
        "This revokes your previous permission and creates the new one. Existing Orders remain accessible.",
      );
      const answer = (
        await ask(
          "Type 'confirm' to authorize and bind, 'back' to change the draft, or 'q' to return",
        )
      ).trim();
      if (answer === "back") {
        const latest = await inspect(rpc, plan);
        const expired =
          signer === "external" &&
          record.submitted &&
          BigInt((await rpc.getBlock("latest")).timestamp) >=
            BigInt(plan.validUntil);
        if (
          latest.policyExists ||
          status.policyRenewalPending ||
          (record.submitted && !expired)
        ) {
          write(
            "This authorization may already be on-chain and cannot be edited yet. Continue verification.",
          );
          continue;
        }
        const inputsPath = join(
          dataDir,
          "runtime",
          "renewal-fields-" +
            current.policyId +
            (updating
              ? "-" +
                destination.module.toLowerCase() +
                "-" +
                destination.factory.toLowerCase()
              : "") +
            ".json",
        );
        const fields = await readState(inputsPath);
        if (fields) {
          const { days, ...previous } = fields.fields;
          await saveState(inputsPath, { ...fields, fields: previous });
        }
        await saveState(path, null);
        record = null;
        continue;
      }
      if (answer !== "confirm") {
        write("Renewal paused. Your saved choices are kept.");
        return 0;
      }
      if (!state.moduleEnabled && !updating)
        throw Error(
          "AgentPay Module is disabled. Review its removal before re-enabling it.",
        );
      if (state.policyExists && !state.policyMatches)
        throw Error("Existing new Policy does not match your choices.");
      if (signer === "anvil") {
        record = { ...record, submitted: true };
        await saveState(path, record);
      }
      if (signer === "external") {
        const revokeCall = {
          purpose: "Revoke old permission",
          to: current.module,
          value: "0",
          operation: 0,
          data: new Interface([
            "function revokePolicy(bytes32)",
          ]).encodeFunctionData("revokePolicy", [current.policyId]),
        };
        // Keep the plan stable across restarts; the page skips verified completed steps.
        const calls = [revokeCall, plan.calls[0], plan.calls[1]];
        const verified = await approve({
          source: {
            ...current,
            module: plan.module,
            previousModule: current.module,
          },
          calls,
          dataDir,
          ask,
          write,
          onSubmitted: async (event) => {
            // Old/unknown journal entries and portable exports remain conservative.
            // Creation intent is persisted before the wallet prompt, including approveHash.
            if (!Number.isInteger(event?.callIndex) || event.callIndex === 2) {
              record = { ...record, submitted: true };
              await saveState(path, record);
            }
          },
          check: async () => {
            const old = await readPreviousTerms(rpc, current);
            const next = await inspect(rpc, plan);
            return old.revoked && next.moduleEnabled && next.policyMatches;
          },
        });
        if (!verified) return 0;
        await saveState(join(dataDir, "wallet/policy-revocation.json"), {
          policyId: current.policyId,
          revoked: true,
          checkedAtMs: Date.now(),
        });
      } else {
        if (
          !(await revoke({
            rpc,
            policy: current,
            write,
            submit,
            ownerSigner: signer,
            dataDir,
            ask,
            approve,
          }))
        )
          return 0;
        await saveState(join(dataDir, "wallet/policy-revocation.json"), {
          policyId: current.policyId,
          revoked: true,
          checkedAtMs: Date.now(),
        });
        if (state.threshold !== 1 || state.owners.length !== 1)
          throw Error(
            "Private renewal requires the sole prepared Anvil owner.",
          );
        if (!state.moduleEnabled)
          await submit({ source: current }, state.owners[0], plan.calls[0]);
        if (!state.policyMatches)
          await submit({ source: current }, state.owners[0], plan.calls[1]);
      }
      await call(dataDir, "renewPolicy", {
        expectedPolicyId: record.sourcePolicyId,
        target: {
          chainId: current.chainId,
          rpcUrl: current.registryRpcUrl,
          module: plan.module,
          safe: current.safe,
          policyId: plan.policyId,
        },
      });
      if (downloaded)
        await syncDeployment({
          dataDir,
          config: downloaded.config,
          authorization: record.config,
        });
      record = { ...record, localCompleted: true };
      await saveState(path, record);
      write(
        "Spending permission renewed and verified by Wallet. Original Order records were kept.",
      );
      await continueMarket();
      write("Next: agentpay status");
      return 0;
    }
  } catch (e) {
    if(e.code!=="CANCELLED") await reportCommandFailure(e,{operation:"Renew permission",write,effect:"An authorization transaction may already have been submitted. Resume the saved renewal; do not create a replacement draft."});
    write(
      e.code === "CANCELLED"
        ? "Renewal paused. Your choices are kept."
        : e.code === "METHOD_NOT_ALLOWED"
          ? "Wallet needs the renewal update. Run agentpay repair, then agentpay policy renew."
          : e.message || "Renewal could not finish.",
    );
    write(
      "Retry: agentpay policy renew. Keep your keys and existing Order records.",
    );
    return e.code === "CANCELLED" ? 0 : 1;
  } finally {
    rpc?.destroy();
  }
}

export async function revokePolicy({
  write = console.log,
  ask = askTerminal,
  dataDir,
  ownerSigner,
  readState = read,
  saveState = save,
  rpcFactory = (url) =>
    new JsonRpcProvider(url, undefined, { batchMaxCount: 1 }),
  revoke = revokeOnChain,
} = {}) {
  let rpc;
  try {
    dataDir ??= await resolveUserDataDir();
    const policy = await readState(join(dataDir, "wallet/policy.json"));
    if (!policy) throw Error("No saved spending permission.");
    const signer = await selectedOwnerSigner({
      dataDir,
      choice: ownerSigner,
      readState,
    });
    checkTestSigner(signer, policy);
    write(
      signer === "anvil"
        ? "Owner approval: private Anvil test signer."
        : "Owner approval: your external Safe wallet. No test account will sign.",
    );
    write("\n> Revoke spending permission");
    write(`Safe: ${policy.safe}\nPolicy ID: ${policy.policyId}`);
    write(
      "Stops new payments under this permission. Existing Orders, queries and support remain available.",
    );
    if (
      (await ask("Type 'confirm' to revoke, or 'q' to return")).trim() !==
      "confirm"
    ) {
      write("Revocation cancelled.");
      return 0;
    }
    rpc = rpcFactory(policy.registryRpcUrl);
    if (Number((await rpc.getNetwork()).chainId) !== policy.chainId)
      throw Error("Wrong chain");
    if (
      !(await revoke({ rpc, policy, write, ownerSigner: signer, dataDir, ask }))
    )
      return 0;
    await saveState(join(dataDir, "wallet/policy-revocation.json"), {
      policyId: policy.policyId,
      revoked: true,
      checkedAtMs: Date.now(),
    });
    write(
      "Spending permission revoked on-chain. Existing Orders were kept.\nNext: agentpay status",
    );
    return 0;
  } catch (e) {
    await reportCommandFailure(e,{operation:"Revoke permission",write,effect:"Revocation is not confirmed. Check the saved permission and resume the original operation."});
    write(e.message || "Revocation could not be confirmed.");
    write("Retry: agentpay policy revoke");
    return 1;
  } finally {
    rpc?.destroy();
  }
}
