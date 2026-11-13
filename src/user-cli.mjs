import {reportCommandFailure} from "./command-diagnostics.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { installedUserDir } from "./local-data-directory.mjs";
const execute = promisify(execFile);
const groups = {
  wallet: [
    ["info", "Wallet identity and local file locations"],
    ["unlock", "Unlock Wallet for payments"],
    ["lock", "Lock Wallet; keep services running"],
    ["restore", "Restore an existing key and Policy"],
  ],
  policy: [
    ["info", "View current spending permission"],
    ["renew", "Renew or replace spending limits and expiry"],
    ["revoke", "Revoke spending permission on-chain"],
  ],
  service: [
    ["start", "Start Wallet and Runtime"],
    ["stop", "Stop Wallet and Runtime"],
    ["restart", "Restart both; Wallet starts locked"],
    ["autostart on|off", "Change startup at login"],
    ["logs wallet|runtime", "Read recent service logs"],
  ],
  market: [
    ["connect [--market URL]", "Sign in and connect this Wallet to Market"],
  ],
  orders: [
    ["list", "List saved Orders and warnings"],
    ["details ID", "Read saved Order details"],
    ["status ID", "Check an Order online"],
    ["retrieve ID", "Retrieve its original result"],
    ["case ID", "Find support for an Order"],
    ["archive ID", "Hide a reviewed local warning"],
    ["unarchive ID", "Show its warning again"],
    ["files ID [remove KEY]", "View or remove cached attachments"],
  ],
  cache: [
    ["info", "View cache usage"],
    ["list [PAGE] [input|output]", "List cached files"],
    ["details ID", "Inspect one cached file"],
    ["export ID PATH", "Export a verified copy"],
    ["clean", "Review and confirm cleanup"],
    ["settings [KEY VALUE]", "View or change cache limits"],
  ],
  payment: [["test", "Test the full payment path with the official Skill"]],
};
function panel(title, rows, example = "") {
  return (
    "\nAgentPay · " +
    title +
    "\n\n" +
    rows
      .map(([name, description]) => "  " + name.padEnd(32) + "  " + description)
      .join("\n") +
    (example ? "\n\nExample:\n  " + example : "") +
    "\n"
  );
}
export const helpText =
  panel(
    "User and Wallet",
    [
      ["status", "Check services, permission and Order warnings"],
      ["health", "Read-only diagnostics to share with support"],
      ["install --market URL", "Install and continue setup"],
      ["setup", "Continue setup"],
      ["update [-f]", "Check npm and update User, Wallet and the official test Skill"],
      ["repair [-f]", "Refresh installed services; -f skips confirmation"],
      ["uninstall [--delete-data]", "Remove services; optionally erase private data"],
      ...Object.keys(groups).map((name) => [
        name + " help",
        name === "service"
          ? "Background processes and login startup"
          : name === "policy"
            ? "Spending permission"
            : name === "orders"
              ? "Order history and support"
              : name === "wallet"
                ? "Local Wallet"
                : name === "market"
                  ? "Website connection"
                  : name === "payment"
                    ? "Payment path checks"
                    : "Local file cache",
      ]),
      ["help", "Show this overview"],
    ],
    "agentpay policy help",
  ) +
  `
Update your installation
  npm installation: agentpay update
  Source checkout: update User, run npm ci, then agentpay repair.
  Keep your private data. Do not uninstall to upgrade.
`;

function topicHelp(group, sub) {
  if (group === "service" && sub === "autostart")
    return (
      panel(
        "Login startup",
        [
          ["agentpay service autostart on", "Enable startup at future logins"],
          ["agentpay service autostart off", "Disable startup at future logins"],
        ],
        "agentpay service autostart off",
      ) + "Current processes are unchanged. Wallet starts locked.\n"
    );
  const notes = {
    wallet: "Locking Wallet does not revoke on-chain spending permission.",
    policy:
      "Renewal and revocation require owner approval. Existing Orders are retained.",
    service:
      "Services run in the background as systemd user services. Closing your terminal does not stop them.",
    orders:
      "Use an Order/request ID or unique short ID. Queries need an unlocked Wallet; retrieving a result does not purchase again.",
    cache:
      "Add --offline when Runtime is stopped. Unfinished inputs are protected.",
    market: "Connecting grants website Order access, not spending permission.",
    payment:
      "Each new test requires price confirmation. An interrupted test continues its original Order.",
  };
  return (
    panel(
      group[0].toUpperCase() + group.slice(1),
      groups[group].map(([name, text]) => [
        "agentpay " + group + " " + name,
        text,
      ]),
      "agentpay " +
        group +
        " " +
        (group === "orders" ? "details ORDER_ID" : groups[group][0][0]),
    ) +
    "\n" +
    notes[group] +
    "\n"
  );
}
function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(installedUserDir,"scripts/command-entry.mjs"), ...args], {
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
async function dispatchUserCli(
  args,
  {
    run = runNode,
    status = async (write) => {
      const { showStatusPanel } = await import("./status-panel.mjs");
      return showStatusPanel(write);
    },
    logs = async (role) => {
      try {
        const { stdout } = await execute(
          "journalctl",
          [
            "--user",
            "-u",
            `agentpay-local-${role}.service`,
            "-n",
            "40",
            "--no-pager",
          ],
          { timeout: 10000, maxBuffer: 262144 },
        );
        console.log(
          `Recent ${role === "wallet" ? "Wallet" : "Runtime"} service logs`,
        );
        process.stdout.write(
          !stdout.trim() || stdout.trim() === "-- No entries --"
            ? "No recent entries for this user service.\n"
            : stdout,
        );
        return 0;
      } catch (error) {
        await reportCommandFailure(error,{operation:"Read service journal"});
        console.error(
          "Could not read the user service journal. Run agentpay status to check services; verify access to your systemd user journal.",
        );
        return 1;
      }
    },
    uninstall = async (options) => {
      const { uninstallLocal } = await import("./uninstall-local.mjs");
      return uninstallLocal(options);
    },
    connect = async (args, options) => {
      const { connectMarket } = await import("./connect-market.mjs");
      return connectMarket(args, options);
    },
    write = console.log,
  } = {},
) {
  const [command, ...rest] = args;
  const script = (name) => join(installedUserDir, "scripts", name + ".mjs");
  const isHelp = (value) => ["help", "--help", "-h"].includes(value);
  if (!command || isHelp(command)) {
    if (rest.length && groups[rest[0]]) write(topicHelp(rest[0], rest[1]));
    else write(helpText);
    return 0;
  }
  if (
    groups[command] &&
    (!rest.length || (rest.length === 1 && isHelp(rest[0])))
  ) {
    write(topicHelp(command));
    return 0;
  }
  const [action, ...values] = rest;
  if (groups[command] && values.length === 1 && isHelp(values[0])) {
    write(topicHelp(command, action));
    return 0;
  }
  if (
    ["update", "repair", "install", "setup", "status", "health", "uninstall"].includes(command) &&
    rest.length === 1 &&
    isHelp(action)
  ) {
    write(helpText);
    return 0;
  }
  if (command === "orders" && action === "files" && !values.length) {
    write(
      panel("Order files", [
        ["agentpay orders files ORDER_ID", "List cached attachments"],
        [
          "agentpay orders files ORDER_ID remove FILE_KEY",
          "Confirm removal of one copy",
        ],
      ]),
    );
    return 0;
  }
  if (
    command === "service" &&
    action === "autostart" &&
    (!values.length || (values.length === 1 && isHelp(values[0])))
  ) {
    write(topicHelp(command, action));
    return 0;
  }
  if (command === "health" && !rest.length) {
    const { runHealth } = await import("./health.mjs");
    return runHealth({write});
  }
  if (command === "install" && rest.length === 2 && action === "--market")
    return run([script("install-user"), ...rest]);
  if (
    command === "repair" &&
    (!rest.length || (rest.length === 1 && action === "-f"))
  )
    return run([script("repair"), ...rest]);
  if (command === "update" && (!rest.length || (rest.length === 1 && action === "-f")))
    return run([script("update"), ...rest]);
  if (command === "setup" && !rest.length)
    return run([script("user-setup"), "--guided"]);
  if (command === "payment" && action === "test" && !values.length)
    return run([script("official-paid-test")]);
  if (command === "status" && !rest.length) return status(write);
  if (command === "uninstall" && (!rest.length || (rest.length === 1 && action === "--delete-data"))) return uninstall({ removeData: action === "--delete-data" });
  if (command === "wallet") {
    if (["unlock", "lock"].includes(action) && !values.length)
      return run([script(action)]);
    if (action === "restore" && !values.length) {
      const { runWalletRestore } = await import("./restore-wallet.mjs");
      return runWalletRestore({ write });
    }
    if (action === "info" && !values.length) {
      const { showLocalInfo } = await import("./local-info.mjs");
      return showLocalInfo({ write });
    }
  }
  if (command === "policy" && !values.length) {
    if (["renew", "revoke"].includes(action)) return run([script(action)]);
    if (action === "info") {
      const { showPolicyInfo } = await import("./policy-info.mjs");
      return showPolicyInfo({ write });
    }
  }
  if (command === "service") {
    if (["start", "restart"].includes(action) && !values.length) {
      return run([script("autostart"), action]);
    }
    if (action === "stop" && !values.length)
      return run([script("autostart"), "stop"]);
    if (
      action === "autostart" &&
      values.length === 1 &&
      ["on", "off"].includes(values[0])
    )
      return run([
        script("autostart"),
        values[0] === "on" ? "enable" : "disable",
      ]);
    if (
      action === "logs" &&
      values.length === 1 &&
      ["wallet", "runtime"].includes(values[0])
    )
      return logs(values[0]);
  }
  if (
    command === "market" &&
    action === "connect" &&
    (!values.length || (values.length === 2 && values[0] === "--market"))
  )
    return connect(values, { write });
  if (command === "orders") {
    if (action === "files") {
      const { runFileCache } = await import("./file-cache-cli.mjs");
      return runFileCache(values, { write });
    }
    if (
      (action === "list" && !values.length) ||
      ([
        "details",
        "status",
        "retrieve",
        "case",
        "archive",
        "unarchive",
      ].includes(action) &&
        values.length === 1)
    ) {
      const { runOrderSupport } = await import("./order-support.mjs");
      return runOrderSupport(action === "list" ? [] : [values[0], action], {
        write,
      });
    }
  }
  if (command === "cache") {
    const { runCacheManagement } = await import("./cache-management-cli.mjs");
    return runCacheManagement(
      [...(action === "info" ? ["summary"] : [action]), ...values],
      { write },
    );
  }
  write(
    "Unknown command or arguments. " +
      (groups[command] ? "Use agentpay " + command + " help." : "Use agentpay help."),
  );
  return 2;
}

// One fallback boundary for every public command, including dynamically imported
// local administration commands. Handled failures retain their tailored guidance.
export async function runUserCli(args, options={}) {
  try { return await dispatchUserCli(args, options); }
  catch(error) {
    const command = [...Object.keys(groups), 'install','setup','repair','update','status','health','uninstall'].includes(args[0]) ? args[0] : 'command';
    await reportCommandFailure(error,{operation:command,write:options.write||console.error});
    return 1;
  }
}
