import {reportCommandFailure,childCause} from "./command-diagnostics.mjs";
import { installationDirectory } from "./installation-paths.mjs";
import { assertPrivateFile } from "./private-journal-files.mjs";
import { walletCliPath } from "./wallet-package.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readServiceSettings,
  saveServiceSettings,
  listenerPresent,
} from "./local-services.mjs";
const execute = promisify(execFile);
const userDir = fileURLToPath(new URL("..", import.meta.url));
async function ctl(...args) {
  return execute("systemctl", ["--user", ...args], {
    timeout: 10000,
    maxBuffer: 16384,
  });
}
export async function guideOwnsProcess({
  pidFile,
  expected,
  expectedEnv = {},
  inspect = lstat,
  read = readFile,
}) {
  try {
    const info = await inspect(pidFile);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      info.size > 32
    )
      return false;
    const text = (await read(pidFile, "utf8")).trim();
    if (!/^[1-9][0-9]*$/.test(text) || Number(text) <= 1) return false;
    const proc = await inspect(`/proc/${text}`);
    if (proc.uid !== process.getuid()) return false;
    const args = (await read(`/proc/${text}/cmdline`, "utf8"))
      .split("\0")
      .filter(Boolean);
    if (JSON.stringify(args) !== JSON.stringify(expected)) return false;
    if (Object.keys(expectedEnv).length) {
      const environment = Object.fromEntries(
        (await read(`/proc/${text}/environ`, "utf8"))
          .split("\0")
          .filter(Boolean)
          .map((line) => {
            const i = line.indexOf("=");
            return [line.slice(0, i), line.slice(i + 1)];
          }),
      );
      for (const [key, value] of Object.entries(expectedEnv))
        if (environment[key] !== value) return false;
    }
    // Classification only. Never signal a PID obtained from a stale file.
    const group = await read(`/proc/${text}/cgroup`, "utf8");
    if (group.includes("/system.slice/")) return false;
    return true;
  } catch {
    return false;
  }
}
async function ownership(dataDir, settings) {
  const paths = {
    wallet: join(dataDir, "wallet", "wallet.sock"),
    runtime: {
      host: "127.0.0.1",
      port: Number(new URL(settings.runtimeUrl).port),
    },
  };
  for (const role of ["wallet", "runtime"]) {
    if (!(await listenerPresent(paths[role]))) continue;
    try {
      await ctl("is-active", `agentpay-local-${role}.service`);
      continue;
    } catch {}
    const expected =
      role === "wallet"
        ? [process.execPath, walletCliPath(), "serve", join(dataDir, "wallet")]
        : [process.execPath, join(userDir, "src/index.mjs")];
    if (
      !(await guideOwnsProcess({
        pidFile: join(
          dataDir,
          "runtime",
          role === "wallet" ? "wallet-guide.pid" : "user-runtime-guide.pid",
        ),
        expected,
        expectedEnv:
          role === "runtime"
            ? {
                AGENTPAY_USER_STATE_FILE: join(
                  dataDir,
                  "runtime",
                  "invocations.json",
                ),
              }
            : {},
      }))
    )
      return false;
  }
  return true;
}
export async function finishLocalSetup({
  dataDir,
  config,
  ask,
  write,
  platform = process.platform,
  save = saveServiceSettings,
  readSettings = readServiceSettings,
  available = () => ctl("list-jobs", "--no-legend", "--no-pager"),
  owns = ownership,
  enable = async () =>
    execute(
      process.execPath,
      [join(userDir, "scripts/autostart.mjs"), "enable"],
      {
        env: { ...process.env, AGENTPAY_USER_DATA_DIR: dataDir, AGENTPAY_DIAGNOSTIC_CHANNEL: "1" },
        timeout: 60000,
        maxBuffer: 16384,
      },
    ),
}) {
  if (platform !== "linux") {
    write(
      "Automatic startup is not available on this system yet. Your current setup is kept.",
    );
    return { state: "unsupported" };
  }
  try {
    await save({
      dataDir,
      runtimeUrl: config.runtimeUrl,
      settlementUrl: config.settlementUrl,
    });
    const settings = await readSettings(dataDir);
    const selectionPath=join(installationDirectory(),'active-services.json');
    try {
      await assertPrivateFile(selectionPath);
      const selection=JSON.parse(await readFile(selectionPath,'utf8'));
      if (selection.target?.dataDir===dataDir && ['enabled','disabled'].includes(selection.startupChoice)) {
        settings.startupChoice=selection.startupChoice;
        await save({dataDir,...settings});
      }
    } catch(e) { if(e.code!=='ENOENT')throw e; }
    await available();
    if (!(await owns(dataDir, settings))) {
      write(
        "Existing services are managed outside this installer. Automatic startup was not changed.",
      );
      return { state: "external" };
    }
    if (settings.startupChoice === "disabled") {
      return { state: "declined" };
    }
    if (settings.startupChoice !== "enabled") {
      write(
        "\nStart Wallet and Runtime automatically when you log in? Wallet will stay locked until you unlock it.",
      );
      let answer;
      do {
        answer = String(
          await ask("Type 'yes' to enable, or 'no' to keep manual startup"),
        )
          .trim()
          .toLowerCase();
      } while (!["yes", "no", "q"].includes(answer));
      if (answer !== "yes") {
        if (answer === "no")
          await save({
            dataDir,
            runtimeUrl: config.runtimeUrl,
            settlementUrl: config.settlementUrl,
            startupChoice: "disabled",
          });
        write("Current services are kept. Automatic startup was not enabled.");
        return { state: "declined" };
      }
    }
    await save({
      dataDir,
      runtimeUrl: config.runtimeUrl,
      settlementUrl: config.settlementUrl,
      startupChoice: "enabled",
    });
    await enable();
    write(
      "Automatic startup enabled for your next login. Current services are kept; after a restart, use agentpay wallet unlock.",
    );
    return { state: "enabled" };
  } catch (error) {
    const cause=childCause(error.stderr);
    if(cause && !error.cause)error.cause=cause;
    await reportCommandFailure(error,{
      operation:"Setup · automatic startup",write,
      effect:"Setup is saved. Automatic startup may be incomplete; existing processes and Wallet data were kept.",
    });
    write(
      "Setup is saved, but automatic startup could not be completed. Retry with agentpay service autostart on. Current processes and Wallet data were kept.",
    );
    return { state: "pending" };
  }
}
