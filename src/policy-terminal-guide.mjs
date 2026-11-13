import { formatSetupFailure } from "./setup-diagnostics.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { displaySeconds } from "./local-time.mjs";
import { randomBytes } from "node:crypto";
import { parseUnits, getAddress, formatUnits } from "ethers";
import { buildSafePolicyPlan } from "./safe-policy-plan.mjs";
import { authorizationFields } from "./authorization-question-checkpoint.mjs";

export function authorizationContext(deployment, delegate) {
  return JSON.stringify(
    Object.fromEntries(
      [
        "chainId",
        "rpcUrl",
        "module",
        "token",
        "factory",
        "registry",
        "tokenDecimals",
        "tokenSymbol",
        "ownerAddress",
      ]
        .map((key) => [key, deployment[key] ?? null])
        .concat([["delegate", delegate]]),
    ),
  );
}
export function showAuthorizationSummary(plan, { write, currency, decimals }) {
  write(
    `Safe: ${plan.safe}\nNetwork: eip155:${plan.chainId}\nTotal budget: ${formatUnits(plan.totalBudget, decimals)} ${currency}\nPer-purchase limit: ${formatUnits(plan.maxPerPayment, decimals)} ${currency}\nExpires: ${displaySeconds(plan.validUntil)}`,
  );
  write(
    "\nYour Agent can make purchases within these limits without asking you each time.\nIt could spend the full budget.",
  );
}
export async function runPolicyTerminalGuide(options) {
  let checkpoint = options.checkpoint;
  let current = {
    ...options,
    saveInputs: async (value) => {
      await options.saveInputs?.(value);
      checkpoint = value;
    },
  };
  for (;;) {
    try {
      return await runGuideOnce(current);
    } catch (error) {
      if (error.code === "AUTHORIZATION_BACK_REVIEW") {
        const { days, ...previous } = checkpoint.fields;
        const edited = { ...checkpoint, fields: previous };
        await current.saveInputs(edited);
        current = { ...current, checkpoint: edited };
        continue;
      }
      if (error.code !== "AUTHORIZATION_BACK") throw error;
      current = { ...current, checkpoint: error.checkpoint };
      checkpoint = error.checkpoint;
    }
  }
}
async function runGuideOnce({
  deployment,
  delegate,
  demo = false,
  collectOnly = false,
  defaults = {},
  boundSafe = null,
  migration = false,
  checkpoint = null,
  saveInputs = async () => {},
  restoreExisting = null,
  ask,
  write,
  inspect,
}) {
  if (
    !Number.isInteger(deployment.tokenDecimals) ||
    deployment.tokenDecimals < 0 ||
    deployment.tokenDecimals > 18 ||
    typeof deployment.source !== "string" ||
    !deployment.source.trim()
  )
    throw Error("Public deployment data requires tokenDecimals and source");
  const rpc = new URL(deployment.rpcUrl);
  if (rpc.username || rpc.password)
    throw Error("RPC URL must not contain credentials");
  const publicDeployment = Object.fromEntries(
    ["chainId", "rpcUrl", "module", "token", "factory", "registry"].map(
      (key) => [key, deployment[key]],
    ),
  );
  const currency = demo
    ? "demo USDC"
    : deployment.tokenSymbol || "payment tokens";
  const suggested = boundSafe
    ? getAddress(boundSafe)
    : demo
      ? "0x6666666666666666666666666666666666666666"
      : deployment.mode === "private-anvil" && deployment.chainId === 31337
        ? deployment.safe
        : null;
  const details = {
    ...publicDeployment,
    ...(suggested ? { safe: getAddress(suggested) } : {}),
    delegate,
    tokenDecimals: deployment.tokenDecimals,
    tokenSymbol: currency,
  };
  const previousChoice = checkpoint?.fields?.policyChoice;
  const editableCheckpoint =
    previousChoice && previousChoice !== "new"
      ? {
          ...checkpoint,
          fields: Object.fromEntries(
            Object.entries(checkpoint.fields).filter(
              ([key]) => key !== "policyChoice",
            ),
          ),
        }
      : checkpoint;
  const field = authorizationFields({
    context: authorizationContext(deployment, delegate),
    checkpoint: editableCheckpoint,
    ask,
    save: saveInputs,
    write,
    details,
  });
  write(
    "\n------------------------------------------------------------\n2/4 Set spending permission\n------------------------------------------------------------",
  );
  if (demo) write("Demo only: no real authorization or payment.");
  if (boundSafe) write(`Using your connected Safe: ${getAddress(boundSafe)}`);
  else if (demo && suggested) write(`Demo Safe: ${getAddress(suggested)}`);
  else if (!suggested)
    write(
      `Use your Safe account address on chain ${deployment.chainId}. Find it at https://app.safe.global/.`,
    );
  const safe = await field(
    "safe",
    suggested
      ? "Safe address (Enter to use the address above; type 'create' if you need a Safe)"
      : "Enter your Safe account address, or type 'create' for guidance",
    (value) => {
      if (value.toLowerCase() === "create")
        throw Error(
          `This guide cannot create a Safe. ${deployment.chainId === 31337 ? "Ask the operator for the private Anvil (31337) test Safe; the official app does not offer this network." : `Open https://app.safe.global/ on chain ${deployment.chainId}.`} Use the Safe account address, not its owner address.`,
        );
      try {
        return getAddress(value || suggested);
      } catch {
        throw Error("Enter a full Safe account address starting with 0x.");
      }
    },
    !demo && suggested ? getAddress(suggested) : undefined,
  );
  if (restoreExisting && !demo) {
    write(
      previousChoice && previousChoice !== "new"
        ? `Original Policy: ${previousChoice}. Press Enter to retry it, or enter a corrected Policy ID.`
        : "Press Enter to create new spending permission, or enter your original Policy ID to restore it.",
    );
    const choice = await field(
      "policyChoice",
      "New permission or original Policy ID",
      (v) => {
        v = v || previousChoice || "new";
        if (v === "new") return "new";
        if (!/^0x[0-9a-f]{64}$/i.test(v) || /^0x0+$/.test(v))
          throw Error(
            "Enter a full Policy ID, or press Enter for new permission.",
          );
        return v.toLowerCase();
      },
      checkpoint?.fields?.budget && !checkpoint?.fields?.policyChoice
        ? "new"
        : undefined,
    );
    if (choice !== "new") {
      const result = await restoreExisting({
        chainId: deployment.chainId,
        rpcUrl: deployment.rpcUrl,
        module: deployment.module,
        safe,
        policyId: choice,
      });
      return {
        restored: true,
        policyConfig: {
          ...publicDeployment,
          safe,
          policyId: choice,
          totalBudget: result.terms.totalBudget,
          maxPerPayment: result.terms.maxPerPayment,
          validAfter: result.terms.validAfter,
          validUntil: result.terms.validUntil,
        },
      };
    }
  }
  const amount = (value) => {
    if (
      !/^\d+(\.\d+)?$/.test(value) ||
      parseUnits(value, deployment.tokenDecimals) <= 0n
    )
      throw Error(`Enter an amount greater than zero in ${currency}.`);
    return value;
  };
  write(
    migration
      ? "Your remaining allowance is the default budget for the updated permission."
      : "Set the total amount your Agent may spend without asking you to approve each payment.",
  );
  if (demo || deployment.mode === "private-anvil")
    write(`${currency} is the test currency for this rehearsal.`);
  write(`Currency: ${currency}`);
  const budget = await field(
    "budget",
    defaults.budget
      ? `Total budget · Enter to keep ${defaults.budget} ${currency}`
      : "Enter total budget",
    (v) => amount(v || defaults.budget || ""),
  );
  write(
    "\n------------------------------------------------------------\nPer-purchase limit\n------------------------------------------------------------",
  );
  write("Set the most your Agent may spend on one purchase.");
  write(`Currency: ${currency} · Maximum: ${budget}`);
  const previousLimit =
    defaults.perPayment &&
    parseUnits(defaults.perPayment, deployment.tokenDecimals) <=
      parseUnits(budget, deployment.tokenDecimals)
      ? defaults.perPayment
      : null;
  const perPayment = await field(
    "perPayment",
    previousLimit
      ? `Per-purchase limit · Enter to keep ${previousLimit} ${currency}`
      : "Enter per-purchase limit",
    (value) => {
      value = value || previousLimit || "";
      amount(value);
      if (
        parseUnits(value, deployment.tokenDecimals) >
        parseUnits(budget, deployment.tokenDecimals)
      )
        throw Error(
          `Enter an amount no greater than your total budget of ${budget} ${currency}.`,
        );
      return value;
    },
  );
  write(
    "\n------------------------------------------------------------\nAuthorization expiry\n------------------------------------------------------------",
  );
  write(
    migration && defaults.validUntil
      ? `Keep the original expiry: ${displaySeconds(defaults.validUntil)}. Enter a different number of days to change it.`
      : "Allow your Agent to make purchases for this many days, starting now.",
  );
  write(
    "When this period ends, new purchases stop until you authorize them again.",
  );
  if (defaults.daysRounded)
    write(
      "The previous duration is rounded up to whole days for this default.",
    );
  const days = await field(
    "days",
    migration && defaults.validUntil
      ? `Enter to keep the original expiry, or enter new validity in days`
      : defaults.days
        ? `Validity in days · Enter to keep ${defaults.days}`
        : "Enter validity in days",
    (value) => {
      value = value || defaults.days || "";
      const end = Math.floor(Date.now() / 1000) + Number(value) * 86400;
      if (
        !/^[1-9][0-9]*$/.test(value) ||
        !Number.isSafeInteger(end) ||
        end * 1000 > 253402300799999
      )
        throw Error("Enter a positive whole number of days.");
      return value;
    },
  );
  const startsAt = Math.floor(Date.now() / 1000);
  const policyConfig = {
    ...publicDeployment,
    safe,
    policyId: `0x${randomBytes(32).toString("hex")}`,
    totalBudget: parseUnits(budget, deployment.tokenDecimals).toString(),
    maxPerPayment: parseUnits(perPayment, deployment.tokenDecimals).toString(),
    validAfter: startsAt,
    validUntil:
      migration && defaults.validUntil && days === defaults.days
        ? defaults.validUntil
        : startsAt + Number(days) * 86400,
  };
  const plan = buildSafePolicyPlan(policyConfig, delegate);
  let chainState = null,
    chainError = null;
  if (!demo)
    write(
      "Checking the network, Safe and contracts… This may take a moment. No transaction is being submitted.",
    );
  if (!demo)
    try {
      chainState = await inspect(plan);
    } catch (error) {
      chainError = formatSetupFailure(error, {preflight:true});
    }
  if (chainError) {
    write(chainError);
    return { chainError, readyToSign: false, readyToPurchase: false };
  }
  if (!collectOnly) {
    showAuthorizationSummary(plan, {
      write,
      currency,
      decimals: deployment.tokenDecimals,
    });
    while (true) {
      const value = (
        await ask(
          "Type 'confirm' to finish this preview, 'back' to change the draft, 'details' for transaction data, or 'q' to return\n> ",
        )
      )
        .trim()
        .toLowerCase();
      if (value === "back")
        throw Object.assign(Error("Change draft"), {
          code: "AUTHORIZATION_BACK_REVIEW",
        });
      if (value === "q")
        throw Object.assign(
          Error("Preview cancelled; no authorization was submitted."),
          { code: "CANCELLED" },
        );
      if (value === "details") {
        write(
          JSON.stringify(
            { policyId: plan.policyId, calls: plan.calls },
            null,
            2,
          ),
        );
        continue;
      }
      if (value === "confirm") break;
    }
    write("Authorization preview complete. No permission was granted.");
  }
  return {
    mode: demo ? "demo" : "read_only",
    readyToSign: false,
    readyToPurchase: false,
    chainState,
    chainError,
    policyConfig,
    calls: plan.calls,
    draft: {
      safe,
      module: plan.module,
      chainId: plan.chainId,
      budget,
      perPayment,
      currency,
      expiry: displaySeconds(plan.validUntil),
      delegate: plan.delegate,
      calls: plan.calls,
    },
  };
}
