import { CHAIN_CHECK_TIMEOUT_MS, formatSetupFailure } from "./setup-diagnostics.mjs";
import { walletCliPath } from "./wallet-package.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { approveOwnerOperations } from "./owner-approval-server.mjs";
import { validatePublicDeployment } from "./prepare-onboarding.mjs";
import { ownerSignerKind, checkTestSigner } from "./owner-signer.mjs";
import {
  OFFICIAL_TEST_PACKAGE,
  verifyOfficialTestSelection,
} from "./official-test-package.mjs";
import { restoreExistingPolicy } from "./restore-wallet.mjs";
import { finishLocalSetup } from "./setup-autostart.mjs";
import { saveServiceSettings } from "./local-services.mjs";
import { saveRuntimeConnection } from "./runtime-client.mjs";
import { spawn } from "node:child_process";
import {
  lstat,
  open,
  readFile,
  writeFile,
  link,
  unlink,
  rename,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, formatUnits, JsonRpcProvider, Contract } from "ethers";
import { Phase0Wallet } from "@c4roa0/agentpay-wallet/local";
import { buildSafePolicyPlan, inspectSafePolicy } from "./safe-policy-plan.mjs";
import { executeAnvilOwnerCall } from "./safe-owner-anvil.mjs";
import { checkLocalInstallation } from "./install-preflight.mjs";
import { inspectLocalUserSetup } from "./user-setup-guide.mjs";
import {
  runPolicyTerminalGuide,
  showAuthorizationSummary,
} from "./policy-terminal-guide.mjs";
import { loadActiveSkill } from "./active-skill.mjs";
import {
  sameWalletPolicy,
  validateGuideTestCheckpoint,
  guideNextAction,
} from "./anvil-onboarding-state.mjs";

const line = "------------------------------------------------------------";
const userDir = fileURLToPath(new URL("..", import.meta.url));
const walletCli = walletCliPath();
const runtimeEntry = fileURLToPath(new URL("./index.mjs", import.meta.url));
const ownEnv = Object.fromEntries(
  ["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "TZ"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
const localUrl = (value) => {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw Error("ANVIL_LOOPBACK_URL_REQUIRED");
  return url.toString();
};
export function validateConfig(config) {
  if (!config || !["private-anvil", "production"].includes(config.mode))
    throw Error("DEPLOYMENT_CONFIG_REQUIRED");
  const allowed = new Set([
    "mode",
    "chainId",
    "source",
    "rpcUrl",
    "module",
    "token",
    "factory",
    "registry",
    "tokenDecimals",
    "tokenSymbol",
    "safe",
    "ownerAddress",
    "ownerSigner",
    "settlementUrl",
    "runtimeUrl",
    "marketBundleMetadataUrl",
    "bundleSha256",
    "maxUsageUnits",
  ]);
  if (Object.keys(config).some((key) => !allowed.has(key)))
    throw Error("UNEXPECTED_CONFIG_FIELD");
  const { safe, ownerAddress, ownerSigner, runtimeUrl, ...publicConfig } =
    config;
  validatePublicDeployment({
    ...publicConfig,
    tokenSymbol: publicConfig.tokenSymbol || "tokens",
  });
  checkTestSigner(ownerSignerKind(ownerSigner), config);
  if (new URL(config.marketBundleMetadataUrl).search)
    throw Error("MARKET_METADATA_URL_QUERY_NOT_ALLOWED");
  if (
    !new URL(localUrl(config.runtimeUrl)).port ||
    new URL(config.runtimeUrl).hostname !== "127.0.0.1"
  )
    throw Error("RUNTIME_LOOPBACK_PORT_REQUIRED");
  ownerSignerKind(config.ownerSigner);
  getAddress(config.ownerAddress);
  if (config.safe) getAddress(config.safe);
  if (!/^[a-f0-9]{64}$/.test(config.bundleSha256 || ""))
    throw Error("BUNDLE_SHA256_REQUIRED");
  if (
    !Number.isInteger(config.tokenDecimals) ||
    config.tokenDecimals < 0 ||
    config.tokenDecimals > 36
  )
    throw Error("TOKEN_DECIMALS_INVALID");
  if (config.maxUsageUnits !== 1)
    throw Error("RANDOM_TEST_REQUIRES_ONE_USAGE_UNIT");
  for (const key of ["module", "token", "factory", "registry"])
    getAddress(config[key]);
  if (typeof config.source !== "string" || !config.source)
    throw Error("DEPLOYMENT_SOURCE_REQUIRED");
  return config;
}
async function privateJson(path) {
  const info = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return null;
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077
  )
    throw Error("PRIVATE_DRAFT_FILE_UNSAFE");
  return JSON.parse(await readFile(path, "utf8"));
}
async function runNode(script, args, { env = ownEnv, stdio = "inherit" } = {}) {
  const child = spawn(process.execPath, [script, ...args], { env, stdio });
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (code !== 0)
    throw Object.assign(Error(`STEP_FAILED: ${script.split("/").at(-1)} (${code})`),{code:"STEP_FAILED"});
}
export function childFailureSummary(stderr) {
  const message = String(stderr).match(/^(?:[A-Za-z]*Error): (.+)$/m)?.[1];
  return message
    ? message.slice(0, 400)
    : "The subprocess failed without a readable error message.";
}
async function captureNode(script, args) {
  const child = spawn(process.execPath, [script, ...args], {
    env: ownEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    error = "";
  for (const [stream, append] of [
    [child.stdout, (part) => (output += part)],
    [child.stderr, (part) => (error += part)],
  ])
    stream.on("data", (part) => append(String(part)));
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (code !== 0)
    throw Object.assign(Error(
      `STEP_FAILED: ${script.split("/").at(-1)} (${code}): ${childFailureSummary(error)}`,
    ), {code:"STEP_FAILED"});
  return JSON.parse(output);
}
async function withRpc(config, work) {
  const rpc = new JsonRpcProvider(config.rpcUrl, undefined, {
    batchMaxCount: 1,
  });
  let timer;
  try {
    return await Promise.race([
      work(rpc),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(Error("CHAIN_CHECK_TIMEOUT"), {code:"CHAIN_CHECK_TIMEOUT"})), CHAIN_CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    rpc.destroy();
  }
}
async function chainState(config, plan) {
  return withRpc(config, (rpc) => inspectSafePolicy(rpc, plan));
}

async function persistPid(path, pid) {
  const info = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (
    info &&
    (!info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077)
  )
    throw Error("LOCAL_PID_FILE_UNSAFE");
  await writeFile(path, `${pid}\n`, { flag: info ? "w" : "wx", mode: 0o600 });
}
async function startLocal(script, args, env, probe, pidPath) {
  const logPath = pidPath.replace(/\.pid$/, ".log");
  const previous = await lstat(logPath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (
    previous &&
    (!previous.isFile() ||
      previous.isSymbolicLink() ||
      previous.uid !== process.getuid() ||
      previous.mode & 0o077)
  )
    throw Error("LOCAL_LOG_FILE_UNSAFE");
  const log = await open(logPath, "a", 0o600);
  let child, started;
  try {
    child = spawn(process.execPath, [script, ...args], {
      env,
      stdio: ["ignore", log.fd, log.fd],
      detached: true,
    });
    started = childReady(child, probe);
    started.catch(() => {});
  } finally {
    await log.close();
  }
  try {
    await started;
    await persistPid(pidPath, child.pid);
    child.unref();
    return child.pid;
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
}
async function childReady(child, probe) {
  await new Promise((resolveSpawn, reject) => {
    child.once("spawn", resolveSpawn);
    child.once("error", reject);
  });
  for (let i = 0; i < 30; i++) {
    if (child.exitCode !== null) throw Error("LOCAL_PROCESS_EXITED");
    if (await probe().catch(() => false)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw Error("LOCAL_PROCESS_START_TIMEOUT");
}
async function walletStatus(dataDir) {
  return captureNode(walletCli, ["status", join(dataDir, "wallet")]);
}
async function runtimeHealth(url, skill) {
  const response = await fetch(new URL("/health", url), {
    redirect: "error",
    signal: AbortSignal.timeout(1500),
  });
  const body = await response.json();
  if (
    body?.ok !== true ||
    !response.ok ||
    body?.result?.role !== "user-runtime"
  )
    throw Error("USER_RUNTIME_HEALTH_INVALID");
  if (!body.result.capabilities?.includes("agentpay.runtime-call.v1"))
    throw Error("USER_RUNTIME_UPGRADE_REQUIRED");
  return body.result;
}
async function promptChoice(ask, prompt, choices) {
  while (true) {
    const value = (await ask(`${prompt ? prompt + "\n" : ""}> `))
      .trim()
      .toLowerCase();
    if (choices.includes(value)) return value;
  }
}
export async function saveNewDraft(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Publish only complete bytes; an existing draft is never overwritten.
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
export async function saveAuthorizationInputs(path, value) {
  const temporary = `${path}.${randomUUID()}.next`;
  try {
    await privateJson(path);
    await saveNewDraft(temporary, value);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
async function bindViaWallet(dataDir, policy) {
  const temporary = join(
    dataDir,
    "runtime",
    `wallet-bind-${randomUUID()}.json`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(policy)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await captureNode(walletCli, ["bind", join(dataDir, "wallet"), temporary]);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
export async function runAnvilOnboarding({
  dataDir,
  config,
  ask,
  write,
  operations = {},
}) {
  // Dependencies allow focused orchestration tests; the CLI uses these real defaults.
  const ops = {
    approveOwnerOperations,
    checkLocalInstallation,
    inspectLocalUserSetup,
    privateJson,
    loadActiveSkill,
    openWallet: (path) => Phase0Wallet.open(path),
    walletStatus,
    runtimeHealth,
    chainState,
    clearDraft: async (path) => {
      await privateJson(path);
      await unlink(path);
    },
    restoreExistingPolicy,
    runNode,
    captureNode,
    startLocal,
    executeAnvilOwnerCall,
    saveServiceSettings,
    finishLocalSetup,
    saveNewDraft,
    saveAuthorizationInputs,
    bindViaWallet,
    saveRuntimeConnection,
    networkFacts: async (config) =>
      withRpc(config, async (rpc) => {
        const chainId = await rpc.send("eth_chainId", []);
        if (BigInt(chainId) !== BigInt(config.chainId))
          throw Error("CHAIN_ID_MISMATCH");
        const token = new Contract(
          config.token,
          [
            "function decimals() view returns(uint8)",
            "function symbol() view returns(string)",
          ],
          rpc,
        );
        return {
          decimals: Number(await token.decimals()),
          symbol: await token.symbol(),
        };
      }),
    ...operations,
  };
  validateConfig(config);
  dataDir = resolve(dataDir);
  const draftPath = join(dataDir, "runtime", "authorization-draft.json");
  const walletDir = join(dataDir, "wallet");
  const step = (title, message) =>
    write(`\n${line}\n${title}\n${line}${message ? "\n" + message : ""}`);
  const script = (name) =>
    fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
  const initial = await ops.checkLocalInstallation({ userDir, dataDir });
  if (!initial.ok) {
    for (const item of initial.checks.filter(
      (item) => item.status === "failed",
    ))
      write(`${item.message}. ${item.fix || ""}`);
    return { completed: false, stage: "preflight" };
  }
  let tokenFacts;
  try {
    tokenFacts = await ops.networkFacts(config);
  } catch (error) {
    const codes = [
      error.code,
      error.cause?.code,
      error.error?.code,
      error.message,
    ];
    if (
      !codes.some((code) =>
        [
          "ECONNREFUSED",
          "ETIMEDOUT",
          "EHOSTUNREACH",
          "ENETUNREACH",
          "ANVIL_RPC_TIMEOUT",
          "CHAIN_CHECK_TIMEOUT",
        ].includes(code),
      )
    ) {
      step("Setup paused · Network and token check", formatSetupFailure(error, {preflight:true}));
      return {completed:false,stage:"network_check_failed"};
    }
    const rpc = new URL(config.rpcUrl);
    step(
      "Setup paused · Network unavailable",
      `Cannot reach the configured RPC at ${rpc.origin}.\nCheck your network and RPC settings, then run the same Install command again.\nYour saved settings are kept.`,
    );
    return { completed: false, stage: "network_unavailable" };
  }
  if (
    tokenFacts.decimals !== config.tokenDecimals ||
    (config.tokenSymbol && tokenFacts.symbol !== config.tokenSymbol)
  )
    {
      step("Setup paused · Currency mismatch", "The token decimals or symbol differ from the saved deployment. Check platform settings with agentpay health. Your saved settings are kept; no transaction was submitted by this check.");
      return {completed:false,stage:"token_metadata_mismatch"};
    }
  step(
    "AgentPay · Wallet setup",
    `Connected to network eip155:${config.chainId}.`,
  );
  let checkedFor = null,
    advancing = false;
  while (true) {
    const preflight = await ops.checkLocalInstallation({ userDir, dataDir });
    if (!preflight.ok) {
      for (const item of preflight.checks.filter(
        (item) => item.status === "failed",
      ))
        write(`${item.message}. ${item.fix}`);
      return { completed: false, stage: "preflight" };
    }
    const local = await ops.inspectLocalUserSetup(dataDir);
    const saved = await ops.privateJson(draftPath);
    if (
      saved &&
      (saved.version !== 1 ||
        saved.delegate?.toLowerCase() !== local.delegate?.toLowerCase() ||
        saved.chainId !== config.chainId ||
        saved.ownerAddress?.toLowerCase() !==
          config.ownerAddress.toLowerCase() ||
        ["module", "token", "factory", "registry"].some(
          (key) =>
            String(saved[key]).toLowerCase() !== config[key].toLowerCase(),
        ) ||
        new URL(saved.rpcUrl).href !== new URL(config.rpcUrl).href)
    ) {
      step(
        "Setup paused",
        "The saved draft belongs to different deployment or Wallet data. Restore its matching configuration; preserve the draft and keys.",
      );
      return { completed: false, stage: "draft_conflict" };
    }
    let plan = null;
    if (saved)
      try {
        plan = buildSafePolicyPlan(saved, local.delegate);
      } catch (error) {
        step(
          "Setup paused",
          `Saved authorization draft cannot be used: ${error.message}. Preserve it and review renewal or the matching configuration.`,
        );
        return { completed: false, stage: "draft_invalid" };
      }
    let chain = null,
      chainProblem = null;
    if (plan)
      try {
        chain = await ops.chainState(config, plan);
      } catch (error) {
        chainProblem = formatSetupFailure(error, {preflight:true});
      }
    const wallet = local.delegate ? await ops.openWallet(walletDir) : null;
    const bound = Boolean(
      wallet?.policy &&
        plan &&
        sameWalletPolicy(wallet.policy, plan.walletPolicy),
    );
    if (wallet?.policy && !bound) {
      step(
        "Setup paused",
        "Wallet already has a Policy that does not match a saved guide draft. Preserve the key and binding. Restore the original matching draft, or use the documented Policy migration path; initialization will not replace it.",
      );
      return { completed: false, stage: "policy_conflict" };
    }
    if (saved?.restoring && (!chain?.moduleEnabled || !chain?.policyMatches)) {
      step(
        "Restore paused",
        "The original Policy could not be verified. Check its network, expiry and revocation status. No new authorization will be created.",
      );
      return { completed: false, stage: "restore_unavailable" };
    }
    const selectedPath = join(dataDir, "runtime", "active-skill.json");
    const installed = await ops.loadActiveSkill(selectedPath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const liveWallet = await ops.walletStatus(dataDir).catch(() => null);
    const liveRuntime = await ops
      .runtimeHealth(config.runtimeUrl, installed)
      .catch((error) => {
        if (error.message === "USER_RUNTIME_SKILL_MISMATCH") throw error;
        return null;
      });
    const ready =
      bound && liveWallet && !liveWallet.locked && liveRuntime && installed;
    const checkpoint = await ops.privateJson(
      join(dataDir, "runtime", "model-ack-smoke.json"),
    );
    verifyOfficialTestSelection(installed, checkpoint, config.bundleSha256);
    let completed = null;
    if (checkpoint) {
      try {
        completed = validateGuideTestCheckpoint(
          checkpoint,
          await ops.privateJson(join(dataDir, "runtime", "invocations.json")),
          installed,
        );
      } catch (error) {
        step(
          "Test recovery paused",
          `${error.message}. Preserve the test checkpoint and invocation history; restore their matching Skill before retrying. No replacement purchase was started.`,
        );
        return { completed: false, stage: "test_conflict" };
      }
    }
    const readinessIdentity = JSON.stringify({
      policy: plan?.policyId,
      bundle: installed?.bundle,
      unlocked: Boolean(liveWallet && !liveWallet.locked),
      runtime: Boolean(liveRuntime),
    });
    const next = guideNextAction({
      initialized: local.stage === "initialized",
      plan,
      chain,
      bound,
      installed,
      liveWallet,
      liveRuntime,
      checked: checkedFor === readinessIdentity,
      test: completed,
    });
    if (!advancing)
      step(
        "Your progress",
        `  Wallet: ${local.stage === "initialized" ? "Initialized" : "Not initialized"}\n  Chain Policy: ${chain?.policyMatches ? "Verified" : chain?.moduleEnabled ? "Module enabled; Policy pending" : plan ? "Draft saved; authorization pending" : "Not configured"}\n  Local binding: ${bound ? "Verified" : "Pending"}\n  Official Skill: ${installed ? "Installed" : "Pending"}\n  Wallet / Runtime: ${liveWallet && !liveWallet.locked ? "Wallet unlocked" : "Not ready"} / ${liveRuntime ? "Running" : "Not running"}`,
      );
    if (chainProblem)
      write(
        chainProblem,
      );
    const stage = ["initialize"].includes(next)
      ? "1/4 Create local Wallet"
      : ["limits", "approve", "bind"].includes(next)
        ? "2/4 Set spending permission"
        : ["install", "start", "check"].includes(next)
          ? "3/4 Prepare the official test Skill"
          : completed?.confirmed
            ? "4/4 Verify the completed test"
            : completed?.hasOrder
              ? "4/4 Continue the existing test"
              : "4/4 Run the paid test";
    if (!advancing) {
      step(
        "> Continue setup",
        `${stage}\n  * 'continue'  Resume the next incomplete step\n    'details'   Inspect current state\n    'q'         Quit`,
      );
      const choice = await promptChoice(ask, "", ["continue", "details", "q"]);
      if (choice === "q") return { completed: false, stage: "quit", next };
      if (choice === "details") {
        write(
          JSON.stringify(
            {
              config,
              delegate: local.delegate,
              policy: saved,
              chain,
              installed,
              liveWallet,
              liveRuntime,
            },
            null,
            2,
          ),
        );
        continue;
      }
    }
    const action = next;
    advancing = true;
    try {
      if (action === "initialize") {
        if (local.stage === "initialized") {
          write("Existing Wallet preserved.");
          continue;
        }
        step(
          "1/4 Create local Wallet",
          "Wallet will ask for an unlock secret twice, with hidden input.",
        );
        await ops.runNode(script("setup-local.mjs"), ["install", dataDir]);
        continue;
      }
      if (action === "limits") {
        if (!local.delegate) {
          write("Initialize Wallet first.");
          continue;
        }
        if (saved) {
          write(
            "An authorization draft already exists. It is preserved for recovery.",
          );
          continue;
        }
        const inputPath = join(dataDir, "runtime", "authorization-fields.json");
        const inputs = await ops.privateJson(inputPath);
        if (
          !inputs &&
          (await ops.privateJson(
            join(dataDir, "runtime", "authorization-inputs.json"),
          ))
        ) {
          write(
            "An older unfinished questionnaire was found. Its file is preserved. Re-enter Safe and limits once to use resumable fields.",
          );
        }
        const result = await runPolicyTerminalGuide({
          deployment: config,
          delegate: local.delegate,
          collectOnly: true,
          checkpoint: inputs,
          restoreExisting: (target) =>
            ops.restoreExistingPolicy({
              dataDir,
              target,
              ask,
              write,
              expectedDeployment: config,
              previewOnly: true,
            }),
          saveInputs: (value) => ops.saveAuthorizationInputs(inputPath, value),
          ask,
          write,
          inspect: async (plan) => ops.chainState(config, plan),
        });
        if (result.cancelled || result.needsSafe || result.chainError) {
          advancing = false;
          continue;
        }
        const p = result.policyConfig;
        const state = await ops.chainState(
          config,
          buildSafePolicyPlan(p, local.delegate),
        );
        if (
          !result.restored &&
          (!state.owners
            .map((value) => value.toLowerCase())
            .includes(config.ownerAddress.toLowerCase()) ||
            state.threshold !== 1)
        )
          throw Error("ANVIL_SAFE_OWNER_OR_THRESHOLD_MISMATCH");
        await ops.saveNewDraft(draftPath, {
          ...p,
          version: 1,
          delegate: local.delegate,
          ownerAddress: config.ownerAddress,
          ...(result.restored ? { restoring: true } : {}),
        });
        write("Draft saved. Review your spending permission next.");
        continue;
      }
      if (!plan) {
        write("Choose authorization limits first.");
        continue;
      }
      if (action === "approve") {
        if (saved?.restoring)
          throw Error("RESTORE_CANNOT_CREATE_AUTHORIZATION");
        if (chainProblem) throw Error("CHAIN_STATE_UNAVAILABLE");
        if (chain?.policyExists && !chain.policyMatches)
          throw Error("EXISTING_CHAIN_POLICY_CONFLICT");
        const work = [
          ...(!chain?.moduleEnabled ? [plan.calls[0]] : []),
          ...(!chain?.policyMatches ? [plan.calls[1]] : []),
        ];
        if (!work.length) {
          write("Chain Policy already verified.");
          continue;
        }
        step("2/4 Review spending permission", "");
        showAuthorizationSummary(plan, {
          write,
          currency: config.tokenSymbol || "tokens",
          decimals: config.tokenDecimals,
        });
        write(
          "\nConfirm the spending authorization operations.\nWallet will verify the authorization before using it.\n",
        );
        let consent;
        do {
          consent = await promptChoice(
            ask,
            "Type 'confirm' to authorize, 'back' to change the draft, 'details' for transaction data, or 'q' to return",
            ["confirm", "back", "details", "q"],
          );
          if (consent === "details")
            write(
              JSON.stringify({ policyId: plan.policyId, calls: work }, null, 2),
            );
        } while (consent === "details");
        if (consent === "back") {
          const latest = await ops.chainState(config, plan);
          if (latest.policyExists) {
            write(
              "This Policy already exists on-chain. Its limits cannot be edited.",
            );
            advancing = false;
            continue;
          }
          const inputPath = join(
            dataDir,
            "runtime",
            "authorization-fields.json",
          );
          const inputs = await ops.privateJson(inputPath);
          if (inputs) {
            const { days, ...previous } = inputs.fields;
            await ops.saveAuthorizationInputs(inputPath, {
              ...inputs,
              fields: previous,
            });
          }
          await ops.clearDraft(draftPath);
          advancing = true;
          continue;
        }
        if (consent === "q") {
          advancing = false;
          continue;
        }
        const signer = ownerSignerKind(
          process.env.AGENTPAY_OWNER_SIGNER ?? config.ownerSigner,
        );
        checkTestSigner(signer, config);
        await ops.saveAuthorizationInputs(
          join(dataDir, "runtime", "owner-signer.json"),
          { version: 1, kind: signer },
        );
        if (signer === "external") {
          const done = await ops.approveOwnerOperations({
            source: {
              chainId: config.chainId,
              safe: plan.safe,
              module: config.module,
            },
            calls: work,
            dataDir,
            ask,
            write,
            check: async () => {
              const state = await ops.chainState(config, plan);
              return state.moduleEnabled && state.policyMatches;
            },
          });
          if (!done) return { completed: false, stage: "owner_approval" };
          continue;
        }
        for (const call of work) {
          await ops.executeAnvilOwnerCall(
            {
              source: {
                chainId: config.chainId,
                registryRpcUrl: config.rpcUrl,
                safe: plan.safe,
              },
            },
            config.ownerAddress,
            call,
          );
        }
        const verified = await ops.chainState(config, plan);
        if (!verified.moduleEnabled || !verified.policyMatches)
          throw Error("CHAIN_POLICY_NOT_VERIFIED");
        write("Spending permission verified on-chain.");
        continue;
      }
      if (action === "bind") {
        if (!chain?.moduleEnabled || !chain.policyMatches) {
          advancing = false;
          write("Chain Policy must be verified before Wallet binding.");
          continue;
        }
        if (bound) {
          write("Local Wallet already matches this Policy.");
          continue;
        }
        if (!liveWallet)
          await ops.startLocal(
            walletCli,
            ["serve", walletDir],
            ownEnv,
            () => ops.walletStatus(dataDir),
            join(dataDir, "runtime", "wallet-guide.pid"),
          );
        if (saved?.restoring)
          await ops.restoreExistingPolicy({
            dataDir,
            target: {
              chainId: saved.chainId,
              rpcUrl: saved.rpcUrl,
              module: saved.module,
              safe: saved.safe,
              policyId: saved.policyId,
            },
            ask,
            write,
            expectedDeployment: config,
          });
        else await ops.bindViaWallet(dataDir, plan.walletPolicy);
        write("Wallet bound to the verified chain Policy.");
        continue;
      }
      if (!bound) {
        write("Complete chain authorization and local binding first.");
        continue;
      }
      if (action === "install" && config.chainId !== 31337) {
        write(
          "Wallet authorization is ready. The official connectivity package for this network is not configured yet. Your binding is kept.",
        );
        return { completed: false, stage: "official_test_unavailable" };
      }
      if (action === "install") {
        if (installed) {
          write("Official Skill already installed.");
          continue;
        }
        step(
          "3/4 Prepare the official test Skill",
          "Preparing the official test Skill automatically. Source and package checks must pass; payment requires your confirmation later.",
        );
        await ops.runNode(script("install-skill-bundle.mjs"), [
          "--prepare-official-test",
          dataDir,
          config.marketBundleMetadataUrl,
          OFFICIAL_TEST_PACKAGE.sha256,
          "--market",
        ]);
        continue;
      }
      if (action === "start") {
        await ops.saveServiceSettings({
          dataDir,
          runtimeUrl: config.runtimeUrl,
          settlementUrl: config.settlementUrl,
        });
        step(
          "Start and unlock Wallet / Runtime",
          "Wallet asks for your unlock secret with hidden input.",
        );
        if (!liveWallet) {
          await ops.startLocal(
            walletCli,
            ["serve", walletDir],
            ownEnv,
            () => ops.walletStatus(dataDir),
            join(dataDir, "runtime", "wallet-guide.pid"),
          );
        }
        if (!(await ops.walletStatus(dataDir)).locked)
          write("Wallet is already unlocked.");
        else await ops.runNode(walletCli, ["unlock", walletDir]);
        if (!liveRuntime) {
          const env = {
            ...ownEnv,
            AGENTPAY_USER_HOST: "127.0.0.1",
            AGENTPAY_USER_PORT: String(new URL(config.runtimeUrl).port),
            AGENTPAY_WALLET_SOCKET: join(walletDir, "wallet.sock"),
            AGENTPAY_WALLET_AGENT_TOKEN_FILE: join(walletDir, "agent.token"),
            AGENTPAY_USER_CALLER_TOKEN_FILE: join(
              dataDir,
              "runtime",
              "caller.token",
            ),
            AGENTPAY_USER_STATE_FILE: join(
              dataDir,
              "runtime",
              "invocations.json",
            ),
            AGENTPAY_SETTLEMENT_URL: config.settlementUrl,
          };
          await ops.startLocal(
            runtimeEntry,
            [],
            env,
            () => ops.runtimeHealth(config.runtimeUrl, installed),
            join(dataDir, "runtime", "user-runtime-guide.pid"),
          );
        }
        await ops.saveRuntimeConnection({
          dataDir,
          runtimeUrl: config.runtimeUrl,
        });
        write("Wallet and Runtime are ready.");
        continue;
      }
      if (action === "check" || action === "test") {
        if (!ready) {
          advancing = false;
          write(
            "Start Wallet and Runtime, then unlock Wallet. Runtime has no separate password.",
          );
          continue;
        }
        await ops.saveRuntimeConnection({
          dataDir,
          runtimeUrl: config.runtimeUrl,
        });
        if (action === "test" && completed) {
          step(
            "Continue the same test",
            completed.confirmed
              ? "Rechecking the recorded result without another purchase."
              : "Resuming the saved request; keep its original identifier.",
          );
        }
        if (action === "test" && completed?.confirmed) {
          await ops.captureNode(script("random-model-ack-smoke.mjs"), [
            "confirm",
            dataDir,
            config.settlementUrl,
            config.runtimeUrl,
          ]);
          await ops.finishLocalSetup({ dataDir, config, ask, write });
          step(
            "Setup complete",
            "Recorded connectivity test verified. You can now browse Market and choose other Skills. Wallet and Runtime remain running. This guide has finished; you can close this terminal.",
          );
          return { completed: true, stage: "tested" };
        }
        const result =
          completed?.hasOrder && action === "test"
            ? null
            : await ops.captureNode(script("check-purchase-readiness.mjs"), [
                dataDir,
                draftPath,
                config.settlementUrl,
                config.runtimeUrl,
                String(config.maxUsageUnits),
              ]);
        if (result && !result.readyToPurchase) {
          checkedFor = null;
          advancing = false;
          write(`Purchase not ready: ${(result.blockers || []).join(", ")}`);
          continue;
        }
        const max = result
          ? formatUnits(
              BigInt(result.facts.estimatedPrepaidMaximumAtomic),
              config.tokenDecimals,
            )
          : null;
        if (action === "check") {
          checkedFor = readinessIdentity;
          write("Connection checks passed.");
          continue;
        }
        if (!completed?.hasOrder) {
          step(
            "4/4 Run the paid test",
            `Current test quote: up to ${max} ${config.tokenSymbol || "tokens"}.\n\nUse the official random-number Skill to test your setup.\nThe price may change before purchase, within your spending limits.\n\nAfter a successful test, Wallet confirms receipt automatically, allowing payment to the Provider.\n`,
          );
          if (
            (await promptChoice(
              ask,
              "Type 'confirm' to run the paid test, or 'q' to return",
              ["confirm", "q"],
            )) === "q"
          ) {
            advancing = false;
            continue;
          }
        }
        await ops.captureNode(script("random-model-ack-smoke.mjs"), [
          "invoke",
          dataDir,
          config.settlementUrl,
          config.runtimeUrl,
        ]);
        write("Test result verified. Confirming receipt…");
        await ops.captureNode(script("random-model-ack-smoke.mjs"), [
          "confirm",
          dataDir,
          config.settlementUrl,
          config.runtimeUrl,
        ]);
        await ops.finishLocalSetup({ dataDir, config, ask, write });
        step(
          "Setup complete",
          "Connectivity check passed. You can now browse Market and choose other Skills. Wallet and Runtime remain running. This guide has finished; you can close this terminal.",
        );
        return { completed: true, stage: "tested" };
      }
    } catch (error) {
      advancing = false;
      write(
        `${stage} stopped.\n${formatSetupFailure(error)}`,
      );
    }
  }
}
