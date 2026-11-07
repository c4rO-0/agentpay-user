import { importSetupFiles } from "./installation-paths.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  loadCurrentDeployment,
  deploymentChanges,
  readPrivateJson,
} from "./deployment-status.mjs";
import { readAuthorizationStatus } from "./status-panel.mjs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { checkLocalInstallation } from "./install-preflight.mjs";
import {
  prepareOnboarding,
  validatePublicDeployment,
} from "./prepare-onboarding.mjs";

export async function ensureGuidedConfig({
  parent,
  ask,
  write,
  validateConfig,
}) {
  const configPath = join(parent, "anvil-onboarding.json");
  let existing;
  try {
    const info = await lstat(configPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      info.size > 16384
    )
      throw Error(
        "Inspect the saved local configuration: use an owner-held regular file with mode 0600.",
      );
    existing = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing) {
    validateConfig(existing);
    // Preserve older authorizations/test identities even after a successful install
    // downloads newer platform settings. Never silently migrate the participant.
    let publicConfig;
    try {
      publicConfig = validatePublicDeployment(
        JSON.parse(
          await readFile(join(parent, "user-deployment.json"), "utf8"),
        ),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (publicConfig) {
      const keys = [
        "chainId",
        "module",
        "token",
        "factory",
        "registry",
        "rpcUrl",
        "settlementUrl",
        "marketBundleMetadataUrl",
        "tokenDecimals",
        "maxUsageUnits",
      ];
      const normalized = (key, value) =>
        key.endsWith("Url")
          ? new URL(value).href
          : ["module", "token", "factory", "registry"].includes(key)
            ? String(value).toLowerCase()
            : value;
      const changed = keys.filter(
        (key) =>
          normalized(key, existing[key]) !== normalized(key, publicConfig[key]),
      );
      if (changed.length)
        throw Error(
          "Saved setup uses different deployment or test-source settings.\n" +
            changed
              .map(
                (key) =>
                  `  ${key}\n    Saved: ${existing[key]}\n    Downloaded: ${publicConfig[key]}`,
              )
              .join("\n") +
            "\nCompared files: " +
            configPath +
            " and " +
            join(parent, "user-deployment.json") +
            "\nYour keys, Policy and Orders were kept. Do not delete the saved files. Deployment address changes need review before migration; URL-only changes need a connectivity check.",
        );
    }
    // Package SHA from Market is informational. Official installation is pinned in User;
    // keep the saved SHA for original-test recovery instead of rewriting history.
    write("Saved local settings found. Continuing your setup.");
    return configPath;
  }
  await prepareOnboarding({
    inputPath: join(parent, "user-deployment.json"),
    outputPath: configPath,
    ask,
    write,
    continueAutomatically: true,
  });
  return configPath;
}
export async function runGuidedEntry({
  userDir,
  dataDir,
  write = console.log,
}) {
  userDir = resolve(userDir);
  const checked = await checkLocalInstallation({ userDir, dataDir });
  if (!checked.ok) {
    const failed = checked.checks.filter((c) => c.status === "failed");
    throw Error(
      "Setup prerequisites need attention.\n" +
        failed
          .map(
            (c) =>
              `${c.message}\n  ${c.fix || "Run agentpay install --market YOUR_MARKET_URL."}`,
          )
          .join("\n") +
        "\nThen retry agentpay setup.",
    );
  }
  for (const check of checked.checks.filter((c) => c.status === "warning"))
    write(check.message);
  const policy = await readPrivateJson(join(dataDir, "wallet/policy.json"));
  if (policy) {
    const latest = await loadCurrentDeployment({
      dataDir,
      userDir,
      fresh: true,
    });
    if (latest && deploymentChanges(policy, latest.config).length) {
      write(
        "AgentPay deployment has changed. Continuing to update your spending permission.",
      );
      const { renewPolicy } = await import("./renew-policy.mjs");
      return renewPolicy({ dataDir, write });
    }
  }
  const authorization = await readAuthorizationStatus(dataDir).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (
    authorization &&
    authorization.validUntil <= Math.floor(Date.now() / 1000)
  ) {
    write("Spending permission expired. Continuing to renewal.");
    const { renewPolicy } = await import("./renew-policy.mjs");
    return renewPolicy({ dataDir, write });
  }
  const { validateConfig } = await import("./anvil-onboarding.mjs");
  const ask = async (prompt) => {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await terminal.question(`${prompt}\n> `);
    } finally {
      terminal.close();
    }
  };
  await importSetupFiles(dataDir, userDir);
  const configPath = await ensureGuidedConfig({
    parent: dataDir,
    ask,
    write,
    validateConfig,
  });
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(userDir, "scripts/user-setup.mjs"),
        "--config",
        dataDir,
        configPath,
      ],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
