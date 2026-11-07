import { walletPackage } from "./wallet-package.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { NODE_REQUIREMENT, supportedNodeVersion } from "./node-version.mjs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { createRequire } from "node:module";

const inside = (parent, child) => {
  const path = relative(parent, child);
  return (
    !path ||
    (!path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      path !== ".." &&
      !isAbsolute(path))
  );
};
export async function checkLocalInstallation({
  userDir,
  dataDir,
  nodeVersion = process.versions.node,
  uid = process.getuid(),
}) {
  userDir = resolve(userDir);
  let walletDir = null;
  const checks = [];
  const add = (code, status, message, fix = null) =>
    checks.push({ code, status, message, fix });
  add(
    "NODE_VERSION",
    supportedNodeVersion(nodeVersion) ? "passed" : "failed",
    `Node ${nodeVersion}; requires ${NODE_REQUIREMENT}`,
    `Install ${NODE_REQUIREMENT}`,
  );
  async function repository(path, name, label) {
    try {
      const manifest = JSON.parse(
        await readFile(join(path, "package.json"), "utf8"),
      );
      if (manifest.name !== name) throw new Error("wrong package");
      add(`${label}_REPOSITORY`, "passed", `${label} repository found`);
      return manifest;
    } catch {
      add(
        `${label}_REPOSITORY`,
        "failed",
        `${label} repository missing or invalid`,
        "Reinstall this User version and its pinned npm dependencies",
      );
      return null;
    }
  }
  const user = await repository(userDir, "@c4roa0/agentpay-user", "USER");
  try {
    const wallet = walletPackage(userDir);
    walletDir = wallet.directory;
    for (const entry of [wallet.cli, join(walletDir, 'lib/client.js'), join(walletDir, 'lib/local.js')]) {
      if (!(await lstat(entry)).isFile()) throw Error('Missing compiled Wallet entry');
    }
    add('WALLET_PACKAGE', 'passed', `Wallet ${wallet.manifest.version} matches the installed User`);
  } catch (error) {
    add('WALLET_PACKAGE', 'failed', 'Compatible Wallet package is missing or incomplete', 'Reinstall the reviewed User version, then run agentpay repair. Source checkout: npm ci.');
  }
  if (user) {
    const require = createRequire(join(userDir, 'package.json'));
    for (const dependency of Object.keys(user.dependencies || {})) {
      try {
        try { require.resolve(dependency); }
        catch (error) {
          if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
          let found = false;
          for (const base of require.resolve.paths(dependency) || []) {
            try {
              const dir = join(base, dependency);
              const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
              const entry = pkg.exports?.['.']?.import;
              if (pkg.name !== dependency || typeof entry !== 'string' || !entry.startsWith('./') || entry.includes('..')) continue;
              if (!(await lstat(join(dir, entry))).isFile()) continue;
              found = true; break;
            } catch {}
          }
          if (!found) throw error;
        }
        add(`USER_DEPENDENCY_${dependency}`, 'passed', `${dependency} resolves without loading code`);
      } catch (error) {
        add(`USER_DEPENDENCY_${dependency}`, 'failed', `${dependency} is not installed or resolvable (${error.code || 'INVALID_PACKAGE_ENTRY'})`, 'Reinstall this User version. Source checkout: npm ci.');
      }
    }
  }
  dataDir = resolve(dataDir);
  let privatePath = dataDir;
  try {
    // Resolve existing ancestors, including symlinks, even for a new directory.
    let existing = dataDir;
    const missing = [];
    while (true) {
      try {
        privatePath = resolve(await realpath(existing), ...missing.reverse());
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (existing === dirname(existing)) throw error;
        missing.push(existing.slice(dirname(existing).length + 1));
        existing = dirname(existing);
      }
    }
    const roots = await Promise.all(
      [userDir, walletDir].filter(Boolean).map((path) =>
        realpath(path).catch(() => resolve(path)),
      ),
    );
    if (roots.some((root) => inside(root, privatePath))) {
      add(
        "PRIVATE_PATH",
        "failed",
        "Private data must be outside user and wallet repositories",
        "Choose an owner-held private directory outside both repositories",
      );
    } else {
      const targets = [
        dataDir,
        join(dataDir, "wallet"),
        join(dataDir, "runtime"),
      ];
      for (const target of targets) {
        try {
          const info = await lstat(target);
          const valid =
            info.isDirectory() &&
            !info.isSymbolicLink() &&
            info.uid === uid &&
            !(info.mode & 0o077);
          add(
            `PRIVATE_DIRECTORY_${relative(dataDir, target) || "root"}`,
            valid ? "passed" : "failed",
            valid
              ? "Private directory permissions checked"
              : "Private directory must be owner-held, non-symlink and 0700-or-stricter",
            "Inspect ownership/type; choose or secure your own private directory before installation",
          );
        } catch (error) {
          add(
            `PRIVATE_DIRECTORY_${relative(dataDir, target) || "root"}`,
            error.code === "ENOENT" ? "pending" : "failed",
            error.code === "ENOENT"
              ? "Not created yet; setup install will create this directory"
              : "Private directory could not be inspected",
          );
        }
      }
    }
  } catch {
    add(
      "PRIVATE_PATH",
      "failed",
      "Private path could not be resolved",
      "Check path access and symbolic links",
    );
  }
  // Advisory inventory only; do not migrate or discard existing requests during setup.
  if (!checks.some((check) => check.status === "failed")) {
    try {
      const { createInvocationStore } = await import("./invocation-store.mjs");
      const entries = Object.values(
        await createInvocationStore(
          join(dataDir, "runtime/invocations.json"),
        ).inventory(),
      );
      const legacy = entries.filter(
        (entry) => entry.routingVersion !== "agentpay.runtime-call.v1",
      ).length;
      add(
        "INVOCATION_HISTORY",
        legacy ? "warning" : "passed",
        legacy
          ? `${legacy} older request(s) are preserved. Runtime can start; check agentpay status after unlocking Wallet.`
          : "Local invocation history can be inspected without migration",
      );
    } catch {
      add(
        "INVOCATION_HISTORY",
        "failed",
        "Local invocation history needs review; existing data was preserved",
        "Start Runtime for its status view; do not delete history or repeat purchases",
      );
    }
  }
  return {
    ok: !checks.some((check) => check.status === "failed"),
    checks,
    userDir,
    walletDir,
    dataDir,
    readyToPurchase: false,
    scope: "read_only_installation_preflight",
    networkChecked: false,
    message:
      "This checks local prerequisites only; Wallet package compatibility is checked; keys, Policy and running-process readiness are not verified",
  };
}
