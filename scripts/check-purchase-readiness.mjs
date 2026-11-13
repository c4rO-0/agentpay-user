#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { sameWalletPolicy } from "../src/anvil-onboarding-state.mjs";
import { ReadOnlyRpc } from "../src/read-only-rpc.mjs";
import { CHAIN_CHECK_TIMEOUT_MS, failureGuidance } from "../src/setup-diagnostics.mjs";
import { parseServiceReference } from "../src/service-reference.mjs";
import { serviceUrl } from "../src/service-url.mjs";
// Read-only business readiness: no Order preparation, signature, nonce or funds.
import { readFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Contract } from "ethers";
import { Phase0Wallet } from "@c4roa0/agentpay-wallet/local";
import { callWallet } from "@c4roa0/agentpay-wallet";
import {
  buildSafePolicyPlan,
  inspectSafePolicy,
} from "../src/safe-policy-plan.mjs";
import { installedSkillPath } from "../src/active-skill.mjs";
import { loadInstalledServiceReference } from "../src/skill-package.mjs";
import { settlementProfileBlocker } from "../src/readiness-profile.mjs";

const [dataArg, configArg, settlementArg, runtimeArg, unitsArg] =
  process.argv.slice(2);
if (
  !dataArg ||
  !configArg ||
  !settlementArg ||
  !runtimeArg ||
  !/^[1-9][0-9]*$/.test(unitsArg || "") ||
  process.argv.length !== 7
)
  throw new Error(
    "usage: check-purchase-readiness.mjs <private-user-data-dir> <public-policy-config.json> <settlement-url> <user-runtime-url> <requested-max-usage-units>",
  );
const dataDir = resolve(dataArg);
const config = JSON.parse(await readFile(resolve(configArg), "utf8"));
const settlement = localOrHttps(settlementArg);
const runtime = localOrHttps(runtimeArg);
const blockers = [];
const diagnostics = [];
const facts = {};
const check = async (code, work) => {
  try {
    return await work();
  } catch (error) {
    blockers.push(code);
    diagnostics.push({check: code, code: failureGuidance(error).code});
    return null;
  }
};
const walletDir = join(dataDir, "wallet");
const wallet = await check("WALLET_NOT_INSTALLED", () =>
  Phase0Wallet.open(walletDir),
);
const delegate = wallet
  ? await check("WALLET_ADDRESS_UNAVAILABLE", () => wallet.address())
  : null;
// This command checks a specific purchase, not global Runtime health.
const referenceArg = process.env.AGENTPAY_CHECK_SERVICE_REFERENCE_FILE;
const skill = await check("SERVICE_REFERENCE_REQUIRED", async () =>
  referenceArg
    ? readFile(referenceArg, "utf8")
        .then(JSON.parse)
        .then(parseServiceReference)
        .then((reference) => ({
          ...reference,
          reference,
          providerId: reference.profile.providerId,
          endpointUrl: reference.profile.paymentEndpoint,
        }))
    : loadInstalledServiceReference(await installedSkillPath(dataDir)),
);
await check("USER_CALLER_CREDENTIAL_MISSING", async () => {
  const path = join(dataDir, "runtime", "caller.token");
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077 ||
    !/^[0-9a-f]{64}$/.test((await readFile(path, "utf8")).trim())
  )
    throw new Error("caller credential invalid");
  return true;
});
if (skill)
  facts.skill = {
    providerId: skill.providerId,
    skillId: skill.skillId,
    profileHash: skill.profileHash,
  };
let plan = null;
let chain = null;
if (wallet && delegate) {
  plan = await check("POLICY_CONFIG_INVALID", () =>
    buildSafePolicyPlan(config, delegate),
  );
  if (!wallet.policy) blockers.push("WALLET_POLICY_UNBOUND");
  else if (
    plan &&
    !sameWalletPolicy(wallet.policy, plan.walletPolicy)
  )
    blockers.push("WALLET_POLICY_MISMATCH");
}
if (plan) {
  chain = new ReadOnlyRpc(plan.rpcUrl);
  try {
    const state = await check("CHAIN_POLICY_UNAVAILABLE", () =>
      boundedRead(chain, () => inspectSafePolicy(chain, plan)),
    );
    if (state) {
      if (!state.moduleEnabled) blockers.push("MODULE_NOT_ENABLED");
      if (!state.policyMatches) blockers.push("CHAIN_POLICY_MISMATCH");
      if (plan.validAfter > Math.floor(Date.now() / 1000))
        blockers.push("POLICY_NOT_YET_ACTIVE");
      facts.policy = {
        safe: plan.safe,
        delegate: plan.delegate,
        maxPerPaymentAtomic: plan.maxPerPayment.toString(),
        totalBudgetAtomic: plan.totalBudget.toString(),
        spentAtomic: state.policySpent,
        validUntil: plan.validUntil,
        moduleEnabled: state.moduleEnabled,
      };
    }
  } finally {
    chain.destroy();
    chain = null;
  }
}
if (wallet) {
  const status = await check("WALLET_PROCESS_UNAVAILABLE", async () => {
    const tokenPath = join(walletDir, "agent.token");
    const info = await lstat(tokenPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077
    )
      throw new Error("capability file unsafe");
    const token = (await readFile(tokenPath, "utf8")).trim();
    return callWallet(join(walletDir, "wallet.sock"), token, "status");
  });
  if (status?.locked) blockers.push("WALLET_LOCKED");
  if (status?.policyMigrationPending) blockers.push("POLICY_MIGRATION_PENDING");
  if (status && !status.bound) blockers.push("WALLET_POLICY_UNBOUND_LIVE");
  if (status?.bound && plan && status.policyId !== plan.policyId)
    blockers.push("WALLET_LIVE_POLICY_MISMATCH");
}
const runtimeState = await check("USER_RUNTIME_UNAVAILABLE", async () => {
  const response = await fetch(new URL("/health", runtime), {
    redirect: "error",
    signal: AbortSignal.timeout(2000),
  });
  const body = await response.json();
  if (!response.ok || body?.result?.role !== "user-runtime")
    throw new Error("runtime health invalid");
  return body.result;
});
if (
  runtimeState &&
  !runtimeState.capabilities?.includes("agentpay.runtime-call.v1")
)
  blockers.push("USER_RUNTIME_UPGRADE_REQUIRED");
let quote = null;
if (skill) {
  const commercial = await check(
    "SETTLEMENT_READINESS_UNAVAILABLE",
    async () => {
      const url = serviceUrl(settlement, "/agentpay/purchase-readiness");
      url.searchParams.set("skillId", skill.skillId);
      url.searchParams.set("profileHash", skill.profileHash);
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(3500),
      });
      const body = await response.json();
      if (!response.ok || body?.ok !== true)
        throw new Error("commercial readiness unavailable");
      return body.result;
    },
  );
  if (commercial) {
    if (plan) {
      const profileBlocker = settlementProfileBlocker(
        plan,
        commercial.settlementProfile,
      );
      if (profileBlocker) blockers.push(profileBlocker);
    }
    facts.finalizationPolicy = commercial.finalizationPolicy || null;
    facts.orderDeadlinePolicy = commercial.orderDeadlinePolicy || null;
    if (!commercial.finalizationPolicy)
      blockers.push("FINALIZATION_POLICY_UNAVAILABLE");
    blockers.push(...commercial.blockers);
    quote = commercial.quote;
    if (quote && quote.providerId !== skill.providerId)
      blockers.push("PROVIDER_ID_MISMATCH");
  }
}
if (plan && quote && facts.policy) {
  const provider = new ReadOnlyRpc(plan.rpcUrl);
  try {
    const qualified = await check("REGISTRY_UNAVAILABLE", async () => {
      const registry = new Contract(
        plan.registry,
        ["function isQualified(bytes32,bytes32,address) view returns(bool)"],
        provider,
      );
      return boundedRead(provider, () => registry.isQualified(
        skill.skillId,
        skill.profileHash,
        quote.seller,
      ));
    });
    if (qualified === false) blockers.push("SKILL_NOT_QUALIFIED");
    if (quote.asset.toLowerCase() !== plan.token.toLowerCase())
      blockers.push("POLICY_ASSET_MISMATCH");
    const units = BigInt(unitsArg);
    if (units > BigInt(quote.maxUsageUnits))
      blockers.push("USAGE_EXCEEDS_QUOTE");
    const maximum =
      BigInt(quote.baseAmountAtomic) + BigInt(quote.unitPriceAtomic) * units;
    const remaining =
      facts.policy?.spentAtomic == null
        ? 0n
        : plan.totalBudget - BigInt(facts.policy.spentAtomic);
    if (maximum > plan.maxPerPayment)
      blockers.push("PER_PAYMENT_LIMIT_EXCEEDED");
    if (maximum > remaining) blockers.push("POLICY_BUDGET_EXCEEDED");
    const balance = await check("SAFE_BALANCE_UNAVAILABLE", async () => {
      const token = new Contract(
        plan.token,
        ["function balanceOf(address) view returns(uint256)"],
        provider,
      );
      return boundedRead(provider, () => token.balanceOf(plan.safe));
    });
    if (balance != null && balance < maximum)
      blockers.push("SAFE_TOKEN_BALANCE_LOW");
    facts.estimatedPrepaidMaximumAtomic = maximum.toString();
    facts.safeTokenBalanceAtomic = balance?.toString() ?? null;
    facts.quoteId = quote.quoteId;
  } finally {
    provider.destroy();
  }
}
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      readyToPurchase: blockers.length === 0,
      blockers: [...new Set(blockers)],
      diagnostics,
      facts,
      note: "Snapshot only; Order creation rechecks all limits and current Quote",
    },
    null,
    2,
  )}\n`,
);

function localOrHttps(input) {
  const url = new URL(input);
  if (
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error("HTTPS_OR_LOOPBACK_REQUIRED");
  return url;
}

// Aggregate inspection has one deadline; cancellation closes the HTTP work too.
async function boundedRead(provider, work) {
  let timer;
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => {
        provider.destroy();
        reject(Object.assign(Error(), {code: 'CHAIN_CHECK_TIMEOUT'}));
      }, CHAIN_CHECK_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}
