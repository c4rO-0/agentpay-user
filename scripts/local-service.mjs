#!/usr/bin/env node
import { walletCliPath } from "../src/wallet-package.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readServiceSettings,
  runtimeEnvironment,
  listenerPresent,
} from "../src/local-services.mjs";
const [role, directory, ...extra] = process.argv.slice(2);
try {
  if (!["wallet", "runtime"].includes(role) || !directory || extra.length)
    throw Error("Invalid service arguments.");
  const dataDir = resolve(directory),
    settings = await readServiceSettings(dataDir);
  const address =
    role === "wallet"
      ? join(dataDir, "wallet", "wallet.sock")
      : { host: "127.0.0.1", port: Number(new URL(settings.runtimeUrl).port) };
  if (await listenerPresent(address))
    throw Error(
      "A process already uses this Wallet socket or Runtime port. Stop it explicitly before starting managed services.",
    );
  const userDir = fileURLToPath(new URL("..", import.meta.url));
  const entry =
    role === "wallet"
      ? walletCliPath()
      : join(userDir, "src/index.mjs");
  const env = Object.fromEntries(
    ["HOME", "PATH", "LANG", "LC_ALL", "TZ", "TMPDIR"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  if (role === "runtime")
    Object.assign(env, runtimeEnvironment(dataDir, settings));
  const child = spawn(
    process.execPath,
    [entry, ...(role === "wallet" ? ["serve", join(dataDir, "wallet")] : [])],
    { env, stdio: "inherit", shell: false },
  );
  const stop = () => child.kill("SIGTERM");
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  child.once("error", () => {
    console.error("Local service could not start.");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
