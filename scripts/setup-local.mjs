#!/usr/bin/env node
import { walletCliPath } from "../src/wallet-package.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { createInterface } from "node:readline/promises";
import { rememberUserDataDir } from "../src/local-data-directory.mjs";
// Minimal user-side setup for the private test. No Safe or policy action.
import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeCallerCredential } from "../src/caller-auth.mjs";

const command = process.argv[2];
const dataDir = process.argv[3] ? resolve(process.argv[3]) : null;
if (
  !dataDir ||
  !["install", "check"].includes(command) ||
  !(
    process.argv.length === 4 ||
    (command === "install" &&
      process.argv.length === 5 &&
      process.argv[4] === "--restore")
  )
) {
  throw new Error(
    "usage: node user/scripts/setup-local.mjs <install|check> <private-data-dir>",
  );
}
const walletDir = join(dataDir, "wallet");
const runtimeDir = join(dataDir, "runtime");
const credentialPath = join(runtimeDir, "caller.token");
const keystore = join(walletDir, "session.keystore.json");
const walletCli = walletCliPath();
const userRuntime = fileURLToPath(new URL("../src/index.mjs", import.meta.url));
for (const file of [walletCli, userRuntime]) await stat(file);

async function privateDirectory(path) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    (info.mode & 0o077) !== 0
  )
    throw new Error(
      `private directory ownership or permissions invalid: ${path}`,
    );
}
async function runWallet(...args) {
  const child = spawn(process.execPath, [walletCli, ...args], {
    stdio: "inherit",
  });
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolveExit(value));
  });
  if (code !== 0)
    throw new Error(`Wallet ${args[0]} failed with exit status ${code}`);
}

if (command === "install") {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(
      "interactive terminal required for Wallet unlock-secret setup",
    );
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await privateDirectory(dataDir);
  await mkdir(walletDir, { recursive: true, mode: 0o700 });
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await privateDirectory(walletDir);
  await privateDirectory(runtimeDir);
  let exists = false;
  try {
    const info = await lstat(keystore);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Wallet keystore type invalid");
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!exists) {
    const ask = async (message) => {
      const terminal = createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      try {
        return (await terminal.question(message + "\n> ")).trim();
      } finally {
        terminal.close();
      }
    };
    let choice =
      process.argv[4] === "--restore"
        ? "restore"
        : await ask(
            "Press Enter to create a new Wallet, type 'restore' to use your original key, or 'q' to return.",
          );
    while (!["", "restore", "q"].includes(choice))
      choice = await ask(
        "Enter 'restore', 'q', or press Enter for a new Wallet.",
      );
    if (choice === "q") process.exit(0);
    if (choice === "restore") {
      const source = await ask(
        "Enter the path to your encrypted Session Key backup, or type 'key' to enter the original key privately ('q' to return).",
      );
      if (source === "q") process.exit(0);
      if (!source) throw Error("A backup file path is required.");
      await runWallet(
        "import-key",
        walletDir,
        source === "key" ? "--private-key" : resolve(source),
      );
      process.stdout.write(
        "Original Session Key restored. Spending permission is not bound yet.\n",
      );
    } else {
      process.stdout.write(
        "\nSet your Wallet unlock secret\n  Enter it twice; input is hidden.\n\n",
      );
      await runWallet("init", walletDir);
    }
    process.stdout.write(
      `\nKeep your Wallet recoverable\n  Back up this encrypted file and keep its password:\n  ${keystore}\n  Never upload the backup to Market or share it with support.\n\n`,
    );
  }
  try {
    const info = await lstat(credentialPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o077) !== 0
    )
      throw new Error("existing caller credential type or permissions invalid");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  process.stdout.write(
    "\nPrepare local runtime access\n  The next step creates or reuses a local access credential.\n  It is saved automatically; you do not need to copy it.\n\n",
  );
  await runWallet("prepare-access", walletDir);
  await initializeCallerCredential(credentialPath);
}

await privateDirectory(dataDir);
await privateDirectory(walletDir);
await privateDirectory(runtimeDir);
const credentialInfo = await lstat(credentialPath);
if (
  !credentialInfo.isFile() ||
  credentialInfo.isSymbolicLink() ||
  credentialInfo.uid !== process.getuid() ||
  (credentialInfo.mode & 0o077) !== 0
) {
  throw new Error("User Runtime caller credential permissions invalid");
}
const token = (await readFile(credentialPath, "utf8")).trim();
if (!/^[0-9a-f]{64}$/.test(token))
  throw new Error("User Runtime caller credential invalid");
const keystoreInfo = await lstat(join(walletDir, "session.keystore.json"));
if (
  !keystoreInfo.isFile() ||
  keystoreInfo.isSymbolicLink() ||
  keystoreInfo.uid !== process.getuid() ||
  (keystoreInfo.mode & 0o077) !== 0
) {
  throw new Error("Wallet keystore permissions invalid");
}
const addressFile = JSON.parse(await readFile(keystore, "utf8"));
const delegate = `0x${String(addressFile.address || "")}`;
if (!/^0x[0-9a-fA-F]{40}$/.test(delegate))
  throw new Error("Wallet keystore address invalid");
let policyBoundLocalFile = false;
try {
  policyBoundLocalFile = (await lstat(join(walletDir, "policy.json"))).isFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (command === "install") await rememberUserDataDir({ dataDir });
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      installed: true,
      dataDir,
      wallet: { delegate, lockState: "not_checked", policyBoundLocalFile },
      userRuntime: { callerCredential: "ready", running: "not_checked" },
      readyToPurchase: false,
      next: "confirm the existing-Safe spending policy",
    },
    null,
    2,
  )}\n`,
);
