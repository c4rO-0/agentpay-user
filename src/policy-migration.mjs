// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { unixSecondsToMilliseconds } from "@agentpay/types";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertPrivateFile,
  atomicWritePrivate,
} from "../../wallet/dist/src/files.js";
// Public user-facing projection. Chain verification and local switching belong to Wallet.
export function migrationSummary(plan) {
  return {
    migrationId: plan.migrationId,
    chainId: plan.source.chainId,
    safe: plan.source.safe,
    delegate: plan.source.delegate,
    token: plan.source.token,
    registry: plan.source.registry,
    oldPolicyId: plan.source.policyId,
    newPolicyId: plan.destination.policyId,
    oldModule: plan.source.module,
    newModule: plan.destination.module,
    oldFactory: plan.source.factory,
    newFactory: plan.destination.factory,
    originalBudgetAtomic: plan.sourceTerms.totalBudget,
    alreadySpentAtomic: plan.sourceTerms.spent,
    replacementBudgetAtomic: plan.totalBudget,
    oldPerPaymentAtomic: plan.source.maxAmount,
    newPerPaymentAtomic: plan.destination.maxAmount,
    validAfter: plan.validAfter,
    validUntil: plan.destination.validUntil,
    expiresAt: new Date(
      unixSecondsToMilliseconds(plan.destination.validUntil),
    ).toISOString(),
    expiresAtMs: unixSecondsToMilliseconds(plan.destination.validUntil),
    note: "Migration pauses Wallet signing. Revoke the old Policy before creating the replacement. No budget increase or expiry extension.",
  };
}

export function migratedPublicPolicy(plan) {
  const p = plan.destination;
  return {
    chainId: p.chainId,
    rpcUrl: p.registryRpcUrl,
    safe: p.safe,
    module: p.module,
    factory: p.factory,
    registry: p.registry,
    token: p.token,
    policyId: p.policyId,
    maxPerPayment: p.maxAmount,
    totalBudget: plan.totalBudget,
    validAfter: plan.validAfter,
    validUntil: p.validUntil,
  };
}

export async function syncMigratedPublicPolicy(dataDir, plan) {
  const path = join(dataDir, "public-policy.json");
  await assertPrivateFile(path);
  const current = JSON.parse(await readFile(path, "utf8"));
  const matches = (p) =>
    [
      "chainId",
      "safe",
      "module",
      "factory",
      "registry",
      "token",
      "policyId",
      "validUntil",
    ].every(
      (key) =>
        String(current[key]).toLowerCase() === String(p[key]).toLowerCase(),
    );
  if (!matches(plan.source) && !matches(plan.destination))
    throw new Error("PUBLIC_POLICY_CONFIG_CONFLICT");
  const replacement = { ...current, ...migratedPublicPolicy(plan) };
  // The Wallet journal already preserves the old binding and on-chain budget.
  // If this write fails, rerunning complete verifies the chain and retries only this projection.
  await atomicWritePrivate(path, JSON.stringify(replacement, null, 2));
  return path;
}
