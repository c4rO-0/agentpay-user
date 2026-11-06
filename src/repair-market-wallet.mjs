// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { installedUserDir } from "./local-data-directory.mjs";
import { checkServiceDirectory } from "./local-services.mjs";
import { ensureLocalServices } from "./prepare-local-services.mjs";
import { runInstall } from "./install-user.mjs";
import { localWalletAdmin } from "./local-wallet-ipc.mjs";
import { controlWallet } from "./wallet-control.mjs";

async function service(action, { userDir, dataDir, logPath }) {
  const log = await open(logPath, "a", 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(userDir, "scripts/autostart.mjs"), action],
        {
          shell: false,
          env: { ...process.env, AGENTPAY_USER_DATA_DIR: dataDir },
          stdio: ["ignore", log.fd, log.fd],
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(Error("Service preparation failed.")),
      );
    });
  } finally {
    await log.close();
  }
}
export async function repairMarketWallet({
  dataDir,
  write = console.log,
  userDir = installedUserDir,
  prepare = runInstall,
  manage = service,
  wallet = localWalletAdmin,
  unlock = controlWallet,
  inspectSource = readFile,
  checkDirectory = checkServiceDirectory,
  ensureSettings = ensureLocalServices,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let logPath,
    servicesPaused = false;
  try {
    // Rebuild the code the participant already downloaded. This does not change
    // Git checkouts, deployment/Policy settings or original purchase records.
    const source = await inspectSource(
      join(dirname(userDir), "wallet/src/ipc.ts"),
      "utf8",
    );
    if (!source.includes("marketConnectionScope"))
      throw Error("CURRENT_SOURCE_REQUIRED");
    await checkDirectory(dataDir);
    await ensureSettings({ dataDir, userDir, write });
    logPath = join(
      dataDir,
      "runtime",
      `wallet-prepare-${Date.now()}-${randomUUID()}.log`,
    );
    const context = { userDir, dataDir, logPath };
    write("1/3 Prepare Wallet. Your background services will pause briefly.");
    await manage("prepare", context);
    await manage("stop", context);
    servicesPaused = true;
    write(
      "2/3 Check dependencies and build Wallet. This may take a few minutes.",
    );
    await prepare({
      userDir,
      dataDir,
      prepareOnly: true,
      forceWalletBuild: true,
      write: () => {},
    });
    write("3/3 Start Wallet and Runtime.");
    await manage("start", context);
    servicesPaused = false;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await wallet(dataDir, "status");
        ready = true;
        break;
      } catch (e) {
        if (e.code !== "WALLET_NOT_RUNNING") throw e;
        await pause(500);
      }
    }
    if (!ready) throw Error("START_TIMEOUT");
    await wallet(dataDir, "marketConnectionScope");
    const state = await wallet(dataDir, "status");
    if (
      state.locked &&
      (await unlock("unlock", {
        args: [dataDir],
        write: (m) => {
          if (!m.startsWith("Wallet unlocked.")) write(m);
        },
      })) !== 0
    )
      return false;
    if ((await wallet(dataDir, "status")).locked)
      throw Error("UNLOCK_REQUIRED");
    write("Wallet is ready. Continuing your Market connection.");
    return true;
  } catch (e) {
    if (e.message === "CURRENT_SOURCE_REQUIRED")
      write(
        "Download the latest User and Wallet code, then run ./run market connect again.",
      );
    else {
      if (!logPath)
        write(
          "Startup settings were not completed. Run ./run service start in your terminal, then retry this connection.",
        );
      if (e.preparationMessage) write(e.preparationMessage);
      if (servicesPaused)
        write(
          "Wallet and Runtime remain stopped until preparation succeeds. Your keys and Order records are kept.",
        );
      write(
        "Wallet preparation stopped. Run ./run market connect again after checking the log.",
      );
      if (e.logPath || logPath) write("Log: " + (e.logPath || logPath));
    }
    return false;
  }
}
