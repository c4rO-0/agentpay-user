// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { inspectDeploymentStatus } from "./deployment-status.mjs";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  installedUserDir,
  resolveUserDataDir,
} from "./local-data-directory.mjs";
import { readRuntimeStatus } from "./runtime-status.mjs";
const execute = promisify(execFile);
async function service(role) {
  let stdout;
  try {
    ({ stdout } = await execute(
      "systemctl",
      [
        "--user",
        "show",
        `agentpay-local-${role}.service`,
        "--property=LoadState,ActiveState,SubState,UnitFileState",
      ],
      { timeout: 4000, maxBuffer: 4096 },
    ));
  } catch (error) {
    if (
      typeof error.stdout === "string" &&
      /^LoadState=not-found$/m.test(error.stdout)
    )
      stdout = error.stdout;
    else throw error;
  }
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
}
export async function readAuthorizationStatus(dataDir) {
  let file;
  try {
    file = await open(
      join(dataDir, "wallet/policy.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      info.size > 16384
    )
      throw Error("Unsafe Policy file");
    const p = JSON.parse(await file.readFile("utf8"));
    if (
      !Number.isSafeInteger(p.validUntil) ||
      p.validUntil <= 0 ||
      !/^0x[0-9a-f]{64}$/i.test(p.policyId)
    )
      throw Error("Invalid Policy");
    let revoked = false,
      marker;
    try {
      marker = await open(
        join(dataDir, "wallet/policy-revocation.json"),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const st = await marker.stat();
      if (
        !st.isFile() ||
        st.uid !== process.getuid() ||
        st.mode & 0o077 ||
        st.size > 16384
      )
        throw Error("Unsafe revocation record");
      const record = JSON.parse(await marker.readFile("utf8"));
      revoked = record.revoked === true && record.policyId === p.policyId;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    } finally {
      await marker?.close();
    }
    return { policyId: p.policyId, validUntil: p.validUntil, revoked };
  } finally {
    await file?.close();
  }
}
// Local proof receipt only; this does not claim the server is online or that
// the connection has not subsequently been disconnected on the website.
export async function readMarketStatus(dataDir) {
  async function saved(path) {
    let h;
    try {
      h = await open(
        join(dataDir, path),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const st = await h.stat();
      if (
        !st.isFile() ||
        st.uid !== process.getuid() ||
        st.mode & 0o077 ||
        st.size > 16384
      )
        throw Error("Unsafe connection settings");
      return JSON.parse(await h.readFile("utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    } finally {
      await h?.close();
    }
  }
  const receipt = await saved("market-connection.json");
  if (!receipt) return { state: "none" };
  const policy = await saved("wallet/policy.json"),
    c = receipt.connection;
  if (!receipt.marketOrigin || !c || !policy) return { state: "unknown" };
  const expected = {
    network: "eip155:" + policy.chainId,
    module: policy.module,
    safe: policy.safe,
    delegate: policy.delegate,
    policyId: policy.policyId,
  };
  if (Object.values(expected).some((v) => typeof v !== "string" || !v))
    return { state: "unknown" };
  return {
    state: Object.entries(expected).every(
      ([k, v]) =>
        typeof c[k] === "string" && c[k].toLowerCase() === v.toLowerCase(),
    )
      ? "saved"
      : "pending",
  };
}
export async function collectLocalStatus() {
  let dataDir;
  try {
    dataDir = await resolveUserDataDir();
  } catch {
    return { configurationError: true };
  }
  const results = await Promise.allSettled([
    execute(
      process.execPath,
      [
        join(installedUserDir, "../wallet/dist/src/cli.js"),
        "status",
        join(dataDir, "wallet"),
      ],
      { timeout: 3000, maxBuffer: 16384 },
    ).then(({ stdout }) => {
      const value = JSON.parse(stdout);
      if (typeof value.locked !== "boolean" || typeof value.bound !== "boolean")
        throw Error();
      return value;
    }),
    service("wallet"),
    service("runtime"),
    readRuntimeStatus(dataDir),
    readAuthorizationStatus(dataDir),
    readMarketStatus(dataDir),
    inspectDeploymentStatus(dataDir),
  ]);
  const value = (i) =>
    results[i].status === "fulfilled" ? results[i].value : null;
  return {
    deployment: value(6) || { state: "unknown" },
    market: value(5) || { state: "unknown" },
    authorization: value(4),
    wallet: value(0),
    walletService: value(1),
    runtimeService: value(2),
    runtime: value(3),
    runtimeUnsupported:
      results[3].status === "rejected" &&
      results[3].reason?.code === "STATUS_UNSUPPORTED",
  };
}
export function loginStartupLabel(service) {
  if (!service) return "Could not check";
  if (service.LoadState === "not-found") return "Not configured for this user";
  if (service.LoadState && !["loaded", "masked"].includes(service.LoadState))
    return "Could not check";
  const labels = {
    enabled: "Enabled",
    disabled: "Disabled",
    "enabled-runtime": "Enabled until reboot",
    masked: "Blocked",
    "masked-runtime": "Blocked until reboot",
    static: "No independent startup setting",
    indirect: "Controlled by another unit",
    alias: "Controlled by another unit",
    generated: "Generated by the system",
    transient: "Temporary service",
    linked: "Not enabled for login",
    "linked-runtime": "Not enabled for login",
  };
  return Object.hasOwn(labels, service.UnitFileState)
    ? labels[service.UnitFileState]
    : "Could not check";
}
const plainText = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
function wrapLine(line, width) {
  if (plainText(line).length <= width) return line;
  // Wrapped explanatory text remains plain; ANSI padding must not change layout.
  line = plainText(line);
  const indent = line.match(/^ */)[0],
    words = line.trim().split(/ +/),
    lines = [];
  let current = indent;
  for (const word of words) {
    const candidate = current.trim() ? current + " " + word : indent + word;
    if (plainText(candidate).length > width && current.trim()) {
      lines.push(current);
      current = indent + word;
    } else current = candidate;
  }
  if (current.trim()) lines.push(current);
  return lines.join("\n");
}
export function renderStatusPanel(
  model,
  {
    color = false,
    columns = 80,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = {},
) {
  const width = Math.max(
    40,
    Math.min(72, Number.isFinite(columns) ? Math.floor(columns) : 80),
  );
  const paint = (s, n) => (color ? `\x1b[${n}m${s}\x1b[0m` : s);
  const badge = (level, width = 0) =>
    paint(
      (level === "ok" ? "[OK]" : level === "wait" ? "[WAIT]" : "[!]").padEnd(
        width,
      ),
      level === "ok" ? 32 : level === "wait" ? 33 : 31,
    );
  const {
    wallet: w,
    runtime: r,
    walletService: ws,
    runtimeService: rs,
  } = model;
  const authorization = model.authorization;
  const authorizationMatches =
    authorization &&
    w?.bound !== false &&
    (!w?.policyId ||
      w.policyId.toLowerCase() === authorization.policyId?.toLowerCase());
  const expired =
    authorizationMatches &&
    Number.isSafeInteger(authorization.validUntil) &&
    authorization.validUntil <= nowSeconds;
  const revoked = authorizationMatches && authorization.revoked;
  const issues = Array.isArray(r?.issues) ? r.issues : [];
  const onlyRetryable =
    r?.orders.review > 0 &&
    issues.length === r.orders.review &&
    issues.every((issue) => issue.code === "ORDER_CHECK_UNAVAILABLE");
  const stopped = (s) =>
    s && ["failed", "inactive", "deactivating"].includes(s.ActiveState);
  let title = "Local checks passed",
    level = "ok",
    detail = "Wallet and service checks still apply before payment.",
    next = null;
  if (model.configurationError) {
    title = "Local settings need attention";
    level = "error";
    detail =
      "Your saved installation could not be read. Keep your existing Wallet data.";
    next = "./run service logs runtime";
  } else if (model.deployment?.state === "changed") {
    title = "Spending permission needs updating";
    level = "error";
    detail =
      "AgentPay deployment changed. New purchases need updated permission; existing Orders remain accessible.";
    next = "./run policy renew";
  } else if (revoked) {
    title = "Spending permission revoked";
    level = "error";
    detail =
      "New payments are stopped. Existing Orders and support remain available.";
    next = "./run policy renew";
  } else if (expired) {
    title = "Spending permission expired";
    level = "error";
    detail =
      "New payments are blocked. Your existing Orders and records are kept.";
    next = "./run policy renew";
  } else if (!r) {
    title = stopped(rs)
      ? "Runtime is not running"
      : "Runtime status unavailable";
    level = "error";
    detail = model.runtimeUnsupported
      ? "This Runtime version does not provide startup checks."
      : stopped(rs)
        ? "Start the background services, then check again."
        : "Check the Runtime log for the cause.";
    next = model.runtimeUnsupported
      ? "Update User, then run ./run service restart."
      : stopped(rs)
        ? "./run service start"
        : "./run service logs runtime";
  } else if (r.inventory === "blocked" || r.storageError) {
    title = "History needs attention";
    level = "error";
    detail =
      "New payments are paused. Keep your history; do not repeat purchases.";
    next = "./run service logs runtime";
  } else if (!w) {
    title = stopped(ws) ? "Wallet is not running" : "Wallet status unavailable";
    level = "error";
    detail =
      "Runtime is running. Order checks will continue when Wallet is available.";
    next = stopped(ws) ? "./run service start" : "./run service logs wallet";
  } else if (w.policyRenewalPending) {
    title = "Spending permission renewal incomplete";
    level = "wait";
    detail = "Finish the saved renewal before making new payments.";
    next = "./run policy renew";
  } else if (w.policyMigrationPending) {
    title = "Authorization update needed";
    level = "wait";
    detail = "New payments are paused until the update is complete.";
    next = "./run policy renew";
  } else if (w.locked) {
    title = "Waiting for unlock";
    level = "wait";
    detail =
      "Your services are running. Unlock Wallet to continue Order checks.";
    next = "./run wallet unlock";
  } else if (!w.bound) {
    title = "Spending permission needed";
    level = "wait";
    detail = "Choose your Safe and spending limits in setup.";
    next = "./run setup";
  } else if (r.inventory !== "complete" || r.wallet !== "available") {
    title = "Checks in progress";
    level = "wait";
    detail =
      "Wallet is available. Runtime will refresh its checks automatically.";
    next =
      "Leave the services running. Wait about 15 seconds, then run ./run status. Large histories may take longer.";
  } else if (model.deployment?.state === "downloaded") {
    title = "Platform deployment not checked online";
    level = "wait";
    detail =
      "Only downloaded settings were compared. Connect Market to check current deployment.";
    next = "./run market connect";
  } else if (model.deployment?.state === "unknown") {
    title = "Payment availability could not be confirmed";
    level = "wait";
    detail =
      "Platform deployment check is unavailable. Check your network and retry.";
    next = "./run status";
  } else if (onlyRetryable) {
    title = "Order checks temporarily unavailable";
    level = "wait";
    detail = "Runtime retries automatically. See the Order list for details.";
    next = "./run orders list";
  } else if (r.orders.review > 0) {
    title = "Some Orders need review";
    level = "wait";
    detail = "Open your local Order list to review the warnings.";
    next = "./run orders list";
  } else if (r.orders.missingResult > 0) {
    title = "Payment complete; local result unavailable";
    level = "wait";
    detail = "See the Order list for recovery options. Do not pay again.";
    next = "./run orders list";
  } else if (r.orders.archived > 0 && r.orders.waiting === 0) {
    title = "Local review complete";
    detail =
      "Archived records are retained; archiving does not confirm their financial state.";
    next = "./run orders list";
  } else if (r.orders.expired > 0 && r.orders.waiting === 0) {
    title = "Unpaid Orders expired";
    level = "ok";
    detail =
      "These Orders ended without payment. No service result is expected.";
    next =
      "No action is needed for expired Orders. They will not be paid again automatically.";
  } else if (r.orders.waiting > 0) {
    title = "Orders still in progress";
    level = "wait";
    detail =
      "Runtime checks their status automatically; it does not run the service for you.";
    next =
      "Keep services running. Check progress in the original Agent conversation. If continuing a supported request, keep its original identifier; never create a replacement purchase.";
  }
  const marketPending = ["pending", "unknown"].includes(model.market?.state);
  if (marketPending && level === "ok") {
    title =
      model.market.state === "pending"
        ? "Market connection needs updating"
        : "Market connection could not be checked";
    level = "wait";
    detail =
      "Website access to this Policy is not confirmed. Local payments are unaffected.";
    next = "./run market connect";
  }
  const divider = "-".repeat(Math.min(60, width));
  const lines = [
    "",
    divider,
    `> AgentPay status`,
    divider,
    `${badge(level)} ${paint(title, 1)}`,
    `  ${detail}`,
    "",
  ];
  if (!model.configurationError) {
    lines.push("> Services");
    const row = (label, text, state) =>
      lines.push(`  ${badge(state, 6)}  ${label.padEnd(8)}  ${text}`);
    row(
      "Wallet",
      w
        ? w.locked
          ? "Running · locked"
          : "Running · unlocked"
        : stopped(ws)
          ? "Stopped"
          : "Not checked",
      w ? (w.locked ? "wait" : "ok") : "error",
    );
    row(
      "Runtime",
      r ? "Running" : stopped(rs) ? "Stopped" : "Not checked",
      r ? "ok" : "error",
    );
    if (r)
      row(
        "History",
        r.storageError
          ? "Checks not saved"
          : r.inventory === "complete"
            ? "Local check complete"
            : r.inventory === "blocked"
              ? "Needs review"
              : "Checking",
        r.storageError || r.inventory === "blocked"
          ? "error"
          : r.inventory === "complete"
            ? "ok"
            : "wait",
      );
    lines.push("", "> Policy");
    const policyState =
      model.deployment?.state === "changed"
        ? ["error", "Update required · deployment changed"]
        : w?.policyRenewalPending
          ? ["wait", "Renewal incomplete"]
          : w?.policyMigrationPending
            ? ["wait", "Migration incomplete"]
            : w?.bound === false
              ? ["wait", "Not configured"]
              : revoked
                ? ["error", "Revoked (last verified)"]
                : expired
                  ? ["error", "Expired"]
                  : authorizationMatches
                    ? ["ok", "Within saved validity period"]
                    : ["wait", "Could not confirm"];
    lines.push(`  ${badge(policyState[0])} ${policyState[1]}`);
    if (authorizationMatches)
      lines.push(
        `  Valid until: ${new Date(authorization.validUntil * 1000).toLocaleString()}`,
      );
    if (model.deployment?.state === "unknown")
      lines.push(`  ${badge("wait")} Platform compatibility not confirmed`);
    if (model.deployment?.state === "downloaded")
      lines.push(
        "  Deployment matches downloaded settings; live compatibility not confirmed.",
      );
    if (policyState[1] === "Could not confirm")
      lines.push("  Details: ./run policy info");
    const startup = loginStartupLabel;
    lines.push("", "> Login startup");
    const startupBadge = (s) =>
      startup(s) === "Enabled"
        ? "ok"
        : ["Could not check", "Blocked", "Blocked until reboot"].includes(
              startup(s),
            )
          ? "error"
          : "wait";
    if (startup(ws) === startup(rs)) {
      const shared = startup(ws);
      lines.push(
        `  ${badge(startupBadge(ws))} ${shared === "Not configured for this user" ? "Neither service configured" : shared === "Could not check" ? "Could not check either service" : shared + " for both services"}`,
      );
    } else {
      row("Wallet", startup(ws), startupBadge(ws));
      row("Runtime", startup(rs), startupBadge(rs));
    }
    if (model.market) {
      lines.push("", "> Market");
      const state = model.market.state;
      lines.push(
        state === "saved"
          ? `  ${badge("ok")} Current Policy connection saved locally`
          : state === "none"
            ? "  Not connected from this installation"
            : state === "pending"
              ? `  ${badge("wait")} Current Policy not connected`
              : `  ${badge("wait")} Could not check saved connection`,
      );
      if (marketPending) lines.push("  Continue: ./run market connect");
    }
  }
  if (r && r.inventory !== "complete")
    lines.push(
      "",
      "> Orders",
      "  Counts unavailable until history is checked.",
    );
  if (r && r.inventory === "complete") {
    const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : "?");
    lines.push(
      "",
      "> Orders",
      r.orders.total === 0
        ? "  No saved Orders."
        : `  ${count(r.orders.total)} saved · ${count(r.orders.settled)} settled${r.orders.expired ? " · " + count(r.orders.expired) + " expired unpaid" : ""} · ${count(r.orders.waiting)} waiting`,
    );
    if (r.orders.archived > 0)
      lines.push(
        `  ${count(r.orders.archived)} archived locally · ./run orders list`,
      );
    if (r.orders.review > 0)
      lines.push(
        `  ${badge("wait")} ${paint(`${count(r.orders.review)} need review`, "1;33")}`,
      );
    if (r.orders.missingResult > 0)
      lines.push(
        `  ${badge("wait")} ${paint(`${count(r.orders.missingResult)} local ${r.orders.missingResult === 1 ? "result needs" : "results need"} recovery`, "1;33")}`,
      );
    if (r.orders.legacy)
      lines.push(
        `  ${count(r.orders.legacy)} older ${r.orders.legacy === 1 ? "request" : "requests"} preserved.`,
      );
  }
  if (next)
    lines.push(
      "",
      "> Next",
      `  ${next.startsWith("./") ? paint(next, 36) : next}`,
    );
  else if (level === "ok") lines.push("", "  Status check complete.");
  lines.push("");
  return {
    text: lines
      .filter(
        (line, index) => line !== "" || index === 0 || lines[index - 1] !== "",
      )
      .map((line) => wrapLine(line, width))
      .join("\n"),
    code: level === "ok" ? 0 : 1,
  };
}
export async function showStatusPanel(
  write = console.log,
  {
    collect = collectLocalStatus,
    color = Boolean(process.stdout.isTTY) &&
      process.env.TERM !== "dumb" &&
      !Object.hasOwn(process.env, "NO_COLOR"),
  } = {},
) {
  const panel = renderStatusPanel(await collect(), {
    color,
    columns: process.stdout.columns || 80,
  });
  write(panel.text);
  return panel.code;
}
