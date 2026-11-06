#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { callWallet, readCapability } from "../../wallet/dist/src/ipc.js";
import {
  migrationSummary,
  migratedPublicPolicy,
  syncMigratedPublicPolicy,
} from "../src/policy-migration.mjs";
import { executeAnvilOwnerCall } from "../src/safe-owner-anvil.mjs";

const [command, directory, argument, ...extra] = process.argv.slice(2);
const withArgument = [
  "preview",
  "prepare",
  "complete",
  "cancel",
  "authorize-test",
];
if (
  !directory ||
  extra.length ||
  ![...withArgument, "status", "export", "refresh"].includes(command) ||
  (withArgument.includes(command) ? !argument : argument !== undefined)
) {
  throw new Error(
    "usage: migrate-safe-policy.mjs <preview|prepare|status|export|authorize-test|complete|cancel|refresh> <private-user-data-dir> [target.json|migration-id|test-owner-address]",
  );
}
const walletDir = join(resolve(directory), "wallet");
const capability = await readCapability(walletDir, "admin");
const call = (method, params = {}) =>
  callWallet(join(walletDir, "wallet.sock"), capability, method, params);
const print = (value) =>
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
if (["preview", "prepare"].includes(command)) {
  const target = JSON.parse(await readFile(resolve(argument), "utf8"));
  const status = await call("policyMigrationStatus");
  if (status.state === "pending") {
    if (
      target.expectedPolicyId !== status.plan.source.policyId ||
      target.policyId.toLowerCase() !== status.plan.destination.policyId ||
      target.factory.toLowerCase() !==
        status.plan.destination.factory.toLowerCase() ||
      target.module.toLowerCase() !==
        status.plan.destination.module.toLowerCase()
    )
      throw new Error("MIGRATION_CONFLICT");
    print({ ...status, summary: migrationSummary(status.plan), resumed: true });
  } else {
    const plan = await call("previewPolicyMigration", { target });
    print({ summary: migrationSummary(plan) });
    if (command === "prepare") {
      await confirm(
        `MIGRATE ${plan.migrationId}`,
        "Pause Wallet signing and save this migration",
      );
      print(
        await call("preparePolicyMigration", {
          target,
          migrationId: plan.migrationId,
        }),
      );
    }
  }
} else if (command === "refresh") {
  const preview = await call("previewPolicyMigrationRefresh");
  print({
    previousMigrationId: preview.previousMigrationId,
    summary: migrationSummary(preview.plan),
  });
  await confirm(
    `MIGRATE ${preview.plan.migrationId}`,
    "Save the recalculated remaining budget for the same destination",
  );
  print(
    await call("refreshPolicyMigration", {
      previousMigrationId: preview.previousMigrationId,
      migrationId: preview.plan.migrationId,
    }),
  );
} else if (command === "authorize-test") {
  let status = await call("policyMigrationStatus");
  if (status.state !== "pending") throw new Error("MIGRATION_NOT_PENDING");
  print({ summary: migrationSummary(status.plan), chain: status.chain });
  if (status.chain.expired) throw new Error("MIGRATION_POLICY_EXPIRED");
  const migrationId = status.plan.migrationId;
  await confirm(
    `AUTHORIZE ${migrationId}`,
    "Submit the displayed Safe owner transactions on private Anvil",
  );
  while (status.chain.calls.length) {
    print(
      await executeAnvilOwnerCall(status.plan, argument, status.chain.calls[0]),
    );
    // Never submit the next call until independent Wallet chain inspection succeeds.
    status = await call("policyMigrationStatus");
    if (
      status.state !== "pending" ||
      status.plan.migrationId !== migrationId ||
      status.chain.expired
    )
      throw new Error("MIGRATION_CHANGED");
  }
  print({ ownerTransactionsVerified: true, migrationId, next: "complete" });
} else if (command === "complete") {
  const status = await call("completePolicyMigration", {
    migrationId: argument,
  });
  const publicPolicyPath = await syncMigratedPublicPolicy(
    resolve(directory),
    status.plan,
  );
  print({
    ...status,
    publicPolicyConfig: migratedPublicPolicy(status.plan),
    publicPolicyPath,
    next: "Synchronize runtime deployment metadata, restart callers, check readiness, then unlock Wallet. Admission remains an operator decision.",
  });
} else if (command === "cancel") {
  await confirm(
    `CANCEL ${argument}`,
    "Cancel only if the old Policy is still active and the replacement does not exist",
  );
  print(await call("cancelPolicyMigration", { migrationId: argument }));
} else {
  const status = await call("policyMigrationStatus");
  if (command === "export") {
    if (status.state !== "pending" || status.chain.expired)
      throw new Error("MIGRATION_NOT_PENDING_OR_EXPIRED");
    // Export only the next call: confirm it on chain and export again. This prevents
    // an owner UI from treating creation-before-revocation as a supported ordering.
    const { calls, ...chain } = status.chain;
    print({
      summary: migrationSummary(status.plan),
      chain,
      safe: status.plan.source.safe,
      chainId: status.plan.source.chainId,
      nextSafeCall: calls[0] ?? null,
    });
  } else print(status);
}

async function confirm(expected, action) {
  // Public confirmation prompts may be captured by run_debug's tee; input must
  // still come from the interactive terminal, never a pipe/environment variable.
  if (!process.stdin.isTTY) throw new Error("OWNER_AUTHORIZATION_TTY_REQUIRED");
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    if (
      (await prompt.question(`${action}. Type '${expected}': `)).trim() !==
      expected
    )
      throw new Error("OWNER_AUTHORIZATION_NOT_CONFIRMED");
  } finally {
    prompt.close();
  }
}
