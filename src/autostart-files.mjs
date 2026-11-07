// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { isAbsolute, join } from "node:path";
function checked(value) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw Error("Autostart paths must be absolute without control characters.");
  return value;
}
const unitArg = (value) =>
  '"' +
  checked(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", () => "$$") +
  '"';
export const runtimeUnits = [
  "agentpay-local-wallet.service",
  "agentpay-local-runtime.service",
];
export const reminderUnit = "agentpay-wallet-reminder.service";
export const units = [...runtimeUnits, reminderUnit];
export function autostartFiles({ node, userDir, dataDir }) {
  const entries = {};
  for (const role of ["wallet", "runtime"])
    entries[`agentpay-local-${role}.service`] =
      `# Managed by AgentPay User\n[Unit]\nDescription=AgentPay local ${role}\n${role === "runtime" ? "Wants=agentpay-local-wallet.service\nAfter=agentpay-local-wallet.service\n" : ""}StartLimitIntervalSec=60\nStartLimitBurst=3\n\n[Service]\nType=simple\nExecStart=${[node, join(userDir, "scripts/local-service.mjs")].map(unitArg).join(" ")} ${role} ${unitArg(dataDir)}\nRestart=on-failure\nRestartSec=10\nUMask=0077\nKillMode=control-group\nTimeoutStopSec=30\n\n[Install]\nWantedBy=default.target\n`;
  entries[reminderUnit] =
    `# Managed by AgentPay User\n[Unit]\nDescription=AgentPay Wallet login reminder\nPartOf=graphical-session.target\nAfter=graphical-session-pre.target agentpay-local-wallet.service\n\n[Service]\nType=oneshot\nExecStart=${[node, join(userDir, "scripts/login-notify.mjs"), dataDir].map(unitArg).join(" ")}\nRemainAfterExit=yes\nTimeoutStartSec=90\nUMask=0077\n\n[Install]\nWantedBy=graphical-session.target\n`;
  return entries;
}

// Accept only an exact previously generated unit for this same private directory.
// This lets repair relocate program/Node paths without accepting custom unit bodies.
export function isManagedUnit(body, name, dataDir) {
  try {
    const line = body.split('\n').find(line => line.startsWith('ExecStart='));
    const quoted = [...line.matchAll(/"(?:\\.|[^"\\])*"/g)].map(([text]) => JSON.parse(text).replaceAll('%%','%').replaceAll('$$','$'));
    const [node, script] = quoted;
    const suffix = name === reminderUnit ? '/scripts/login-notify.mjs' : '/scripts/local-service.mjs';
    if (!script.endsWith(suffix)) return false;
    const userDir = script.slice(0, -suffix.length);
    return autostartFiles({node, userDir, dataDir})[name] === body;
  } catch { return false; }
}
