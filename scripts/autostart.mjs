#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { withServiceSelection } from "../src/service-selection.mjs";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import {runInstallationCommand,withInstallationOperation} from "../src/installation-operation.mjs";
import { lstat, mkdir, readFile, writeFile, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  resolveUserDataDir,
  installedUserDir,
} from "../src/local-data-directory.mjs";
import {
  autostartFiles,
  isManagedUnit,
  units,
  runtimeUnits,
} from "../src/autostart-files.mjs";
import {
  readServiceSettings,
  saveServiceSettings,
} from "../src/local-services.mjs";
import { ensureLocalServices } from "../src/prepare-local-services.mjs";
const ctl = async (...args) => {
  const result = await runInstallationCommand("systemctl", ["--user", ...args], {timeout:30000});
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
};
try {
  const [action, ...args] = process.argv.slice(2);
  if (
    ![
      "activate-setup",
      "prepare",
      "prepare-repair",
      "enable",
      "disable",
      "remove",
      "start",
      "restart",
      "stop",
      "status",
      "configure",
    ].includes(action) ||
    args.length !== (action === "configure" ? 2 : 0)
  )
    throw Error(
      "Usage: node scripts/autostart.mjs <prepare|enable|disable|remove|start|restart|stop|status> or configure RUNTIME_URL SETTLEMENT_URL",
    );
  if (process.platform !== "linux")
    throw Error(
      "Automatic startup currently supports Linux with systemd user services. macOS support is pending.",
    );
  const dataDir = await resolveUserDataDir();
  if (action === "configure") {
    await withInstallationOperation(() => saveServiceSettings({
      dataDir,
      runtimeUrl: args[0],
      settlementUrl: args[1],
    }));
    console.log("Local startup settings saved. No service was started.");
  } else {
    const selectionResult = await withServiceSelection({
      target:{node:process.execPath,userDir:installedUserDir,dataDir}, action,
      ctl:(...args) => runInstallationCommand('systemctl',['--user',...args],{timeout:30000}),
      ask:process.stdin.isTTY ? async message => {
        const terminal = createInterface({input:process.stdin,output:process.stdout});
        try { return await terminal.question(message + '\n> '); } finally { terminal.close(); }
      } : undefined,
      operation:async ({previous,switched,unitsPrepared}) => {
    const files = autostartFiles({
      node: process.execPath,
      userDir: installedUserDir,
      dataDir,
    });
    const config = join(homedir(), ".config"),
      unitDir = join(config, "systemd/user");
    for (const directory of [config, join(config, "systemd"), unitDir]) {
      if (["enable", "prepare", "prepare-repair", "start", "restart", "activate-setup"].includes(action))
        await mkdir(directory, { mode: 0o700 }).catch((e) => {
          if (e.code !== "EEXIST") throw e;
        });
      const info = await lstat(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid() ||
        info.mode & 0o022
      )
        throw Error(
          `User configuration directory is not safely owned: ${directory}`,
        );
    }
    const paths = Object.entries(files).map(([name, body]) => ({
      name,
      path: join(unitDir, name),
      body,
    }));
    for (const { path, body, name } of paths) {
      try {
        const info = await lstat(path);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.uid !== process.getuid() ||
          info.mode & 0o022 ||
          !(isManagedUnit(await readFile(path, "utf8"), name, dataDir) || (switched && previous && autostartFiles(previous)[name] === await readFile(path,"utf8")))
        )
          throw Error(
            "An existing startup file belongs to another configuration. Preserve it and review before switching.",
          );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    if (action === "status") {
      await ctl("status", "--no-pager", ...runtimeUnits);
      console.log(
        "The login reminder runs once per graphical session; it can be inactive outside a desktop login.",
      );
    } else if (["start", "restart", "stop"].includes(action)) {
      if (action !== 'stop') {
      await ensureLocalServices({dataDir});
      for (const {path,body} of paths) {
        const temporary = path + '.' + randomUUID();
        try { await writeFile(temporary,body,{flag:'wx',mode:0o600}); await rename(temporary,path); }
        finally { await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;}); }
      }
      }
      await unitsPrepared();
      if (action !== 'stop') await ctl('daemon-reload');
      await ctl(action, ...(action !== "stop" ? runtimeUnits : units));
      if (action === 'stop') console.log(
        'Stop requested through systemd. Login startup and saved Wallet data are unchanged.\nNext: agentpay status',
      );
    } else if (["enable", "prepare", "prepare-repair", "activate-setup"].includes(action)) {
      if (action !== "activate-setup") await ensureLocalServices({ dataDir, connectionOptions: action === "prepare-repair" ? { refreshClientModule: true, checkOnly: true } : {} });
      // No --now: avoid replacing a Wallet currently owned by terminal setup/system services.
      for (const { path, body } of paths)
        try {
          await writeFile(path, body, { flag: "wx", mode: 0o600 });
        } catch (e) {
          if (e.code !== "EEXIST") throw e;
          const temporary = path + '.' + randomUUID();
          try {
            await writeFile(temporary, body, {flag:'wx',mode:0o600});
            await rename(temporary,path);
          } finally { await unlink(temporary).catch(e => { if(e.code !== 'ENOENT') throw e; }); }
        }
      await ctl("daemon-reload");
      if (action === "enable") {
        await ctl("enable", ...units);
        await saveServiceSettings({
          dataDir,
          ...(await readServiceSettings(dataDir)),
          startupChoice: "enabled",
        });
        console.log(
          "Login startup enabled for Wallet and Runtime. Current processes were not changed.\nTo start now: agentpay service start",
        );
      } else
        console.log(
          "Local service files prepared. Automatic startup was not changed.",
        );
    } else if (action === "disable") {
      await readServiceSettings(dataDir);
      await ctl("disable", ...units);
      await saveServiceSettings({
        dataDir,
        ...(await readServiceSettings(dataDir)),
        startupChoice: "disabled",
      });
      console.log(
        "Login startup disabled for Wallet and Runtime. Current processes were not stopped.\nTo stop now: agentpay service stop",
      );
    } else {
      await saveServiceSettings({
        dataDir,
        ...(await readServiceSettings(dataDir)),
        startupChoice: "disabled",
      });
      await ctl("disable", "--now", ...units);
      for (const { path } of paths)
        await unlink(path).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
      await ctl("daemon-reload");
      console.log(
        "Automatic startup and its reminder removed. Wallet data, Policy and request history are kept.",
      );
    }
      }});
    if (selectionResult?.cancelled) process.exitCode = 2;
    else if (['start','restart'].includes(action)) console.log(
      'Wallet and Runtime are ready. Default Skill access is available.\nNext: agentpay status',
    );
  }
} catch (error) {
  console.error(
    error.status === undefined
      ? error.message
      : "The systemd command failed; some service changes may already have applied. Wallet keys and request history were kept. Run agentpay status before retrying.",
  );
  if (process.argv[2] === 'stop') console.error('Retry: agentpay service stop');
  else if (['start','restart'].includes(process.argv[2]))
    console.error('Check: agentpay status\nRetry: agentpay service start');
  process.exitCode = 1;
}
