import {runServiceCommand} from "./service-command.mjs";
import {reportCommandFailure} from "./command-diagnostics.mjs";
import { ensureRuntimeConnection } from "./runtime-connection-settings.mjs";
import { walletPackage } from "./wallet-package.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { installedUserDir } from "./local-data-directory.mjs";
import { checkServiceDirectory } from "./local-services.mjs";
import { ensureLocalServices } from "./prepare-local-services.mjs";
import { runInstall } from "./install-user.mjs";
import { localWalletAdmin } from "./local-wallet-ipc.mjs";
import { controlWallet } from "./wallet-control.mjs";

const service = runServiceCommand;
export async function repairMarketWallet({
  dataDir,
  write = console.log,
  userDir = installedUserDir,
  prepare = runInstall,
  connection = ensureRuntimeConnection,
  manage = service,
  wallet = localWalletAdmin,
  unlock = controlWallet,
  inspectPackage = walletPackage,
  checkDirectory = checkServiceDirectory,
  ensureSettings = ensureLocalServices,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let logPath,
    servicesPaused = false;
  try {
    await inspectPackage(userDir);
    await checkDirectory(dataDir);
    await ensureSettings({ dataDir, userDir, write, connectionOptions: { refreshClientModule: true, checkOnly: true } });
    logPath = join(
      dataDir,
      "runtime",
      `wallet-prepare-${Date.now()}-${randomUUID()}.log`,
    );
    const context = { userDir, dataDir, logPath };
    write("1/3 Prepare Wallet. Your background services will pause briefly.");
    await prepare({
      userDir,
      dataDir,
      prepareOnly: true,
      write: () => {},
      // The installer lock covers service changes as well as dependency checks.
      // A competing repair must fail before pausing a running Wallet.
      beforePrepare: async () => {
        await connection({ dataDir, write, refreshClientModule: true, checkOnly: true });
        await manage("prepare-repair", context);
        await manage("stop", context);
        servicesPaused = true;
        write("2/3 Verify installed User and Wallet packages.");
      },
      afterPrepare: async () => {
        await connection({ dataDir, write, refreshClientModule: true });
        write("3/3 Start Wallet and Runtime.");
        await manage("start", context);
        servicesPaused = false;
      },
    });
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
    await reportCommandFailure(e,{operation:"Prepare Wallet for Market",write,services:true,logPath:e.logPath||logPath});
    if (e.message === "CURRENT_SOURCE_REQUIRED")
      write(
        "Install the reviewed User package, then run agentpay market connect again.",
      );
    else {
      if (!logPath)
        write(
          "Startup settings were not completed. Run agentpay service start in your terminal, then retry this connection.",
        );
      if (e.preparationMessage) write(e.preparationMessage);
      if (servicesPaused)
        write(
          "Wallet and Runtime remain stopped until preparation succeeds. Your keys and Order records are kept.",
        );
      write(
        "Wallet preparation stopped. Run agentpay market connect again after checking the log.",
      );
      if (e.logPath || logPath) write("Log: " + (e.logPath || logPath));
    }
    return false;
  }
}
