import { installationDirectory, legacyInstallationDirectory } from "./installation-paths.mjs";
import { walletPackage } from "./wallet-package.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { lstat, realpath, readFile, rm, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, parse, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { autostartFiles, isManagedUnit } from "./autostart-files.mjs";
import {
  resolveUserDataDir,
  installedUserDir,
} from "./local-data-directory.mjs";
import { readServiceSettings, listenerPresent } from "./local-services.mjs";
const execute = promisify(execFile);
const inside = (parent, path) => {
  const r = relative(parent, path);
  return r === "" || (!r.startsWith("..") && !parse(r).root);
};
async function target(path, { directory = false, privateMode = false } = {}) {
  try {
    const info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      info.mode & (privateMode ? 0o077 : 0o022) ||
      (directory ? !info.isDirectory() : !info.isFile()) ||
      (await realpath(path)) !== path
    )
      throw Error(`Cannot safely remove this path: ${path}`);
    return { path, directory, dev: info.dev, ino: info.ino, privateMode };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function uninstallPlan({
  dataDir,
  userDir = installedUserDir,
  home = homedir(),
  node = process.execPath,
  removeData = false,
}) {
  dataDir = resolve(dataDir);
  userDir = resolve(userDir);
  home = resolve(home);
  let walletDir;
  try { walletDir = walletPackage(userDir).directory; } catch { walletDir = userDir; }
  for (const protectedPath of [parse(dataDir).root, home, userDir, walletDir])
    if (inside(dataDir, protectedPath))
      throw Error(
        "Refusing to remove a home, repository or ancestor directory.",
      );
  const targets = [];
  const data = await target(dataDir, { directory: true, privateMode: true });
  if (data && removeData) targets.push(data);
  let settings;
  if (data)
    try {
      settings = await readServiceSettings(dataDir);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const pid = await lstat(
        join(dataDir, "runtime/user-runtime-guide.pid"),
      ).catch((x) => {
        if (x.code === "ENOENT") return null;
        throw x;
      });
      if (pid)
        throw Error(
          "Runtime startup settings are missing but a guide process record exists. Inspect it before uninstalling.",
        );
    }
  const installDir = installationDirectory();
  for (const reserved of [join(home, ".config"), installDir])
    if (inside(dataDir, reserved) || inside(reserved, dataDir))
      throw Error(
        "Data directory overlaps installation or service configuration. No files were removed.",
      );
  const lock = await lstat(join(installDir, "install.lock")).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (lock)
    throw Error(
      "An installer lock exists. Finish or inspect that installation before uninstalling.",
    );
  const install = await target(installDir, {
    directory: true,
    privateMode: true,
  });
  if (install && removeData) {
    const state = await target(join(installDir, "state.json"), {
      privateMode: true,
    });
    if (state) {
      const saved = JSON.parse(await readFile(state.path, "utf8"));
      if (
        saved.version !== 1 ||
        typeof saved.dataDir !== "string" ||
        !isAbsolute(saved.dataDir) ||
        resolve(saved.dataDir) !== dataDir
      )
        throw Error(
          "Installation record points to another data directory; no files were removed.",
        );
      targets.push({ ...install, checkpoint: true });

    }
  }
  // Retire only the old source checkpoint that names this exact data directory.
  // Otherwise a later setup could rediscover and reimport purged configuration.
  if (removeData) {
    const legacyDir = legacyInstallationDirectory(userDir);
    if (legacyDir !== installDir) {
      const legacy = await target(legacyDir, { directory: true, privateMode: true });
      const record = legacy && await target(join(legacyDir, "state.json"), { privateMode: true });
      if (record) {
        const saved = JSON.parse(await readFile(record.path, "utf8"));
        if (saved.version === 1 && typeof saved.dataDir === "string" && isAbsolute(saved.dataDir) && resolve(saved.dataDir) === dataDir) {
          if (await lstat(join(legacyDir, "install.lock")).catch(e => { if (e.code !== "ENOENT") throw e; return null; }))
            throw Error("An old installer lock exists. Finish that installation before uninstalling.");
          for (const name of ["user-deployment.json", "anvil-onboarding.json"]) {
            const file = await target(join(dirname(userDir), name), { privateMode: true });
            if (file) targets.push(file);
          }
          targets.push({ ...legacy, checkpoint: true });
        }
      }
    }
  }
  const unitDir = join(home, ".config/systemd/user"),
    generated = autostartFiles({ node, userDir, dataDir }),
    units = [];
  for (const [name, body] of Object.entries(generated)) {
    const file = await target(join(unitDir, name));
    if (!file) continue;
    for (const path of [
      join(home, ".config"),
      join(home, ".config/systemd"),
      unitDir,
    ]) {
      const info = await lstat(path);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid() ||
        info.mode & 0o022
      )
        throw Error("Service configuration directory ownership is unsafe.");
    }
    if (!isManagedUnit(await readFile(file.path, "utf8"), name, dataDir))
      throw Error(
        `Service file is not this installation's managed file: ${name}`,
      );
    units.push({ ...file, name });
  }
  return { dataDir, targets, units, settings, removeData };
}
async function unchanged(item) {
  const fresh = await target(item.path, item);
  if (!fresh || fresh.dev !== item.dev || fresh.ino !== item.ino)
    throw Error("An uninstall target changed. No further files were removed.");
}
export async function removeInstallation(
  plan,
  {
    manage = async (args) =>
      execute("systemctl", ["--user", ...args], {
        timeout: 45000,
        maxBuffer: 16384,
      }),
    probe = listenerPresent,
  } = {},
) {
  // Validate all targets before stopping, and again immediately before deletion.
  for (const item of [...plan.targets, ...plan.units]) await unchanged(item);
  if (plan.units.length) {
    await manage(["stop", ...plan.units.map((u) => u.name)]);
    for (const unit of plan.units) {
      const { stdout } = await manage([
        "show",
        unit.name,
        "--property=MainPID,ActiveState",
      ]);
      const state = Object.fromEntries(
        stdout
          .trim()
          .split("\n")
          .map((s) => s.split("=")),
      );
      if (
        state.MainPID !== "0" ||
        !["inactive", "failed"].includes(state.ActiveState)
      )
        throw Error("A local service has not stopped; data was preserved.");
    }
  }
  if (await probe(join(plan.dataDir, "wallet/wallet.sock")))
    throw Error(
      "A Wallet outside these managed services is still running. Stop it explicitly; data was preserved.",
    );
  if (
    plan.settings &&
    (await probe({
      host: "127.0.0.1",
      port: Number(new URL(plan.settings.runtimeUrl).port),
    }))
  )
    throw Error(
      "A Runtime or other process still occupies this port. Stop/review it explicitly; data was preserved.",
    );
  if (plan.units.length) {
    await manage(["disable", ...plan.units.map((u) => u.name)]);
    for (const unit of plan.units) {
      await unchanged(unit);
      await unlink(unit.path);
    }
    await manage(["daemon-reload"]);
  }
  // Remove the installation checkpoint last so interrupted cleanup can find its scope.
  const ordered = [...plan.targets].sort(
    (a, b) =>
      Number(Boolean(a.checkpoint)) -
      Number(Boolean(b.checkpoint)),
  );
  for (const item of ordered) {
    await unchanged(item);
    await rm(item.path, { recursive: item.directory, force: false });
  }
}
export async function uninstallLocal({
  ask,
  write = console.log,
  plan = uninstallPlan,
  remove = removeInstallation,
  dataDir,
  terminal = Boolean(process.stdin.isTTY),
  removeData = false,
} = {}) {
  if (!terminal)
    throw Error(
      "Run agentpay uninstall in an interactive terminal. No files were removed.",
    );
  const selected = await plan({
    dataDir: dataDir || (await resolveUserDataDir()),
    removeData,
  });
  write("Uninstall AgentPay from this computer");
  write(
    removeData ? "This permanently deletes the local Session Key, credentials, installed Skills and transaction recovery history. Reinstalling cannot restore them." : "This removes background services. Your keys, Policies, Orders, configuration and cache will be kept.",
  );
  write(
    "It does not revoke Safe permissions or cancel on-chain Orders. Resolve pending Orders and revoke the Safe permission first if you intend to retire it.",
  );
  write("Services will stop. Removal is limited to:");
  for (const item of [...selected.units, ...selected.targets])
    write(`  ${item.path}`);
  const confirmation = removeData ? "DELETE LOCAL AGENTPAY DATA" : "REMOVE AGENTPAY SERVICES";
  let input;
  if (ask)
    input = await ask(
      `Type ${confirmation} to continue, or anything else to cancel: `,
    );
  else {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      input = await terminal.question(
        `Type ${confirmation} to continue, or anything else to cancel: `,
      );
    } finally {
      terminal.close();
    }
  }
  if (input !== confirmation) {
    write("Uninstall cancelled. Nothing was stopped or deleted.");
    return 0;
  }
  try {
    await remove(selected);
  } catch (error) {
    write(
      "Uninstall did not finish. Some services or files may already have changed. Review the error before retrying; keep the installed User package.",
    );
    throw error;
  }
  write(
    `Selected services and data removal complete. On-chain permissions remain unchanged.
To remove a global program installation: npm uninstall --global @c4roa0/agentpay-user
For a source checkout, you may now delete the User program folder.`,
  );
  return 0;
}
