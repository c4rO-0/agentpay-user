import {runServiceCommand} from "./service-command.mjs";
import {reportCommandFailure} from "./command-diagnostics.mjs";
import {withInstallationOperation} from './installation-operation.mjs';
import {maintenanceServiceScope} from './service-selection.mjs';
import { requireRunningSoftware } from "./software-versions.mjs";
import { walletPackage } from "./wallet-package.mjs";
// Apply installed packages. Preserve identity/history and startup preferences;
// preparation failure must not enable a mismatched Wallet/Runtime pair.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { ensureRuntimeConnection } from "./runtime-connection-settings.mjs";
import { prepareOfficialTestUpdate } from "./official-test-update.mjs";
import { readFile, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  installedUserDir,
  resolveUserDataDir,
} from "./local-data-directory.mjs";
import {
  checkServiceDirectory,
  readServiceSettings,
} from "./local-services.mjs";
import { createInterface } from "node:readline/promises";
import { createHash } from "node:crypto";
import { runInstall, fingerprint } from "./install-user.mjs";
import { localWalletAdmin } from "./local-wallet-ipc.mjs";
import { readRuntimeStatus } from "./runtime-status.mjs";

async function json(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
    throw Error("Update metadata must be a regular file.");
  return JSON.parse(await readFile(path, "utf8"));
}
// The v1 metadata field typesDependency now pins the public npm Protocol package.
// Keep exact pair checks until the separate compatibility-range design is implemented.
export async function checkUpdatePair(userDir) {
  const { directory: walletDir } = walletPackage(userDir);
  const [pair, user, wallet] = await Promise.all([
    json(join(userDir, "update-pair.json")),
    json(join(userDir, "package.json")),
    json(join(walletDir, "package.json")),
  ]);
  if (
    pair.format !== "agentpay.local-update-pair.v1" ||
    !/^\d+\.\d+\.\d+$/.test(pair.userVersion) ||
    !/^\d+\.\d+\.\d+$/.test(pair.walletVersion) ||
    typeof pair.typesDependency !== "string" ||
    !pair.typesDependency ||
    user.name !== "@c4roa0/agentpay-user" ||
    wallet.name !== "@c4roa0/agentpay-wallet" ||
    user.version !== pair.userVersion ||
    wallet.version !== pair.walletVersion ||
    user.dependencies?.["@c4roa0/agentpay-protocol"] !== pair.typesDependency ||
    wallet.dependencies?.["@c4roa0/agentpay-protocol"] !== pair.typesDependency
  ) {
    throw Error(
      "User and Wallet do not match the downloaded update. Reinstall the reviewed User package version, then retry agentpay repair.",
    );
  }
  return pair;
}
export async function updateSnapshot(userDir) {
  const { directory: walletDir } = walletPackage(userDir);
  const inputs = createHash("sha256")
    .update(
      JSON.stringify([
        userDir,
        process.execPath,
        process.versions.node,
        await fingerprint(userDir, [
          "package.json",
          "update-pair.json",
          "src",
          "scripts",
        ]),
        await fingerprint(walletDir, [
          "package.json",
          "lib",
          "bin",
        ]),
      ]),
    )
    .digest("hex");
  let outputs = null;
  try {
    outputs = await fingerprint(walletDir, ["lib", "bin"]);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return { inputs, outputs };
}
async function askUpdate(prompt) {
  if (!process.stdin.isTTY)
    throw Error(
      "Run agentpay repair in a terminal to confirm, or use agentpay repair -f to skip confirmation.",
    );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await terminal.question(prompt + "\n> ");
  } finally {
    terminal.close();
  }
}
const manage = runServiceCommand;
export async function applyLocalUpdate(options = {}) {
  try { return await withInstallationOperation(() => repairUnderLock(options)); }
  catch(error) { await reportCommandFailure(error,{operation:"Repair",write:options.write || console.log}); return 1; }
}
async function repairUnderLock({
  userDir = installedUserDir,
  dataDir,
  write = console.log,
  platform = process.platform,
  force = false,
  ask = askUpdate,
  snapshot = updateSnapshot,
  officialTest = prepareOfficialTestUpdate,
  resolveDirectory = resolveUserDataDir,
  pairCheck = checkUpdatePair,
  checkDirectory = checkServiceDirectory,
  settings = readServiceSettings,
  connection = ensureRuntimeConnection,
  prepare = runInstall,
  service = manage,
  serviceScope = maintenanceServiceScope,
  wallet = localWalletAdmin,
  runtime = readRuntimeStatus,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let phase = "preflight",
    logPath,
    selected,
    activeServices = true;
  try {
    write(
      "\n------------------------------------------------------------\n> Repair User and Wallet\n------------------------------------------------------------",
    );
    write(
      "Checks the installed User and Wallet packages, refreshes service paths and checks the official test Skill.",
    );
    if (platform !== "linux")
      throw Error(
        "This repair command currently supports Linux user services. macOS startup support is not ready.",
      );
    dataDir ??= await resolveDirectory({ userDir });
    const pair = await pairCheck(userDir);
    await checkDirectory(dataDir);
    await settings(dataDir);
    const scope = await serviceScope({userDir,dataDir});
    activeServices = scope.active;
    write(
      `1/3 Check local files · User ${pair.userVersion} / Wallet ${pair.walletVersion}`,
    );
    const result = await prepare({
      userDir,
      dataDir,
      prepareOnly: true,

      write: () => {},
      beforePrepare: async (context) => {
        logPath = context.logPath;
        // Recheck after taking the shared installer lock, before stopping anything.
        await pairCheck(userDir);
        selected = await snapshot(userDir);
        const applied = context.state.localUpdate;
        if (
          context.initial.ok &&
          applied?.status === "complete" &&
          applied.inputs === selected.inputs &&
          applied.outputs === selected.outputs
        ) {
          if (!scope.active) {
            await connection({dataDir,write,refreshClientModule:true});
            phase = "unchanged";
            write("This installation is up to date and remains inactive. Running services were not changed.");
            return false;
          }
          let runningMatches = false;
          try {
            requireRunningSoftware(await wallet(dataDir, "status"), await runtime(dataDir), { ...pair, protocolVersion: pair.typesDependency });
            runningMatches = true;
          } catch { /* Keep repair available for old, stopped or unreported processes. */ }
          if (runningMatches && scope.active) {
            await connection({ dataDir, write });
            phase = "unchanged";
            write("Local installation and running versions are up to date. Background services were not changed.");
            return false;
          }
          write("Running versions need verification. Repair will restart the paired services.");
        }
        write(
          applied?.status === "pending"
            ? "A previous repair did not finish. Retry preparation."
            : "Installed program changes need to be applied.",
        );
        write(
          scope.active ? "Wallet and Runtime will pause, verify installed files and restart. Wallet will need unlocking afterwards."
            : "This inactive installation will be repaired. The running Wallet and Runtime will not change.",
        );
        if (!force) {
          while (true) {
            const answer = (
              await ask("Type 'confirm' to repair, or 'q' to cancel")
            )
              .trim()
              .toLowerCase();
            if (answer === "q") {
              phase = "cancelled";
              write("Repair cancelled. Background services were not changed.");
              return false;
            }
            if (answer === "confirm") break;
            write("Enter 'confirm' or 'q'.");
          }
        }
        const confirmed = await snapshot(userDir);
        if (JSON.stringify(confirmed) !== JSON.stringify(selected))
          throw Error(
            "Local files changed during confirmation. Run agentpay repair again.",
          );
        await connection({ dataDir, write, refreshClientModule: true, checkOnly: true });
        context.state.localUpdate = {
          status: "pending",
          inputs: selected.inputs,
        };
        await context.saveState();
        if (!scope.active) {
          phase = "building";
          write("2/3 Check this installation's packages. Active services are unchanged.");
          return;
        }
        await service("prepare-repair", { userDir, dataDir, logPath });
        phase = "stopping";
        write(
          "2/3 Pause background services and check installed packages. This may take a few minutes.",
        );
        await service("stop", { userDir, dataDir, logPath });
        phase = "building";
      },
      afterPrepare: async (context) => {
        logPath = context.logPath;
        const built = await snapshot(userDir);
        if (built.inputs !== selected.inputs)
          throw Error("Installed files changed during repair.");
        await connection({ dataDir, write, refreshClientModule: true });
        if (!scope.active) {
          context.state.localUpdate = {status:"complete", ...built};
          await context.saveState();
          phase = "ready";
          write("3/3 Inactive installation checked. It has not been started.");
          return;
        }
        phase = "starting";
        write("3/3 Start Wallet and Runtime.");
        await service("start", { userDir, dataDir, logPath });
        let ready = false, readinessError;
        const deadline = Date.now() + 15000;
        for (
          let attempt = 0;
          attempt < 20 && Date.now() < deadline;
          attempt++
        ) {
          try {
            const [w, r] = await Promise.all([
              wallet(dataDir, "status"),
              runtime(dataDir),
            ]);
            if (typeof w.locked === "boolean" && r.role === "user-runtime") {
              requireRunningSoftware(w, r, { ...pair, protocolVersion: pair.typesDependency });
              ready = true;
              break;
            }
          } catch (error) {
            readinessError=error;
            if (error.code === "RUNNING_VERSION_UNVERIFIED") throw error;
            /* Startup can take a moment; final failure is reported below. */
          }
          await pause(500);
        }
        if (!ready) throw Object.assign(Error("Service readiness could not be confirmed."),{code:"SERVICE_READINESS_FAILED",cause:readinessError});
        context.state.localUpdate = { status: "complete", ...built };
        await context.saveState();
        phase = "ready";
      },
    });
    if (result?.skipped && phase === "cancelled") return 0;
    if (result?.skipped && phase === "unchanged") {
      await officialTest({ userDir, dataDir, write });
      return 0;
    }
    if (!result?.completed || phase !== "ready")
      throw Error("Repair did not finish.");
    write(
      scope.active ? "\nRepair complete. Wallet and Runtime are running in the background."
        : "\nRepair complete. This installation remains inactive; existing services were kept.",
    );
    write(
      "Keys, spending permission and Order records were kept. Login startup preference is unchanged.",
    );
    await officialTest({ userDir, dataDir, write });
    write(scope.active ? "Next: agentpay wallet unlock\nThen: agentpay status" : "To switch to this installation: agentpay service start");
    return 0;
  } catch (error) {
    const effect=phase==='preflight'
      ? 'Repair stopped before pausing services.'
      : phase==='building'
        ? (activeServices ? 'Wallet and Runtime remain stopped; local data was kept.' : 'The active installation was not changed; local data was kept.')
        : 'Service startup is not confirmed. The current operation may have changed service state; Wallet keys, permission and Order records were kept.';
    await reportCommandFailure(error,{operation:`Repair · ${phase}`,write,effect,services:phase==='starting'||phase==='stopping',logPath:error.logPath||logPath});
    write("After resolving the problem, run agentpay repair again.");
    return 1;
  }
}
