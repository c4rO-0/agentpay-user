import {reportCommandFailure} from "./command-diagnostics.mjs";
import { inspectLocalSetup } from "./local-setup-state.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { join } from "node:path";
import { resolveUserDataDir } from "./local-data-directory.mjs";

const address = (value) =>
  typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value)
    ? value
    : "Not recorded";
const policyId = (value) =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value)
    ? value
    : "Not recorded";
const text = (value) =>
  typeof value === "string"
    ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 160)
    : "Not recorded";
function endpoint(value) {
  try {
    const u = new URL(value);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      return "Not shown (inspect local settings)";
    return u.origin + u.pathname;
  } catch {
    return "Not recorded";
  }
}
async function privateJson(dataDir, relative) {
  for (const directory of [
    dataDir,
    ...(relative.includes("/") ? [join(dataDir, relative.split("/")[0])] : []),
  ]) {
    try {
      const st = await lstat(directory);
      if (
        !st.isDirectory() ||
        st.isSymbolicLink() ||
        st.uid !== process.getuid() ||
        st.mode & 0o077
      )
        throw Error("unsafe");
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  let h;
  try {
    h = await open(
      join(dataDir, relative),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const st = await h.stat();
    if (
      !st.isFile() ||
      st.uid !== process.getuid() ||
      st.mode & 0o077 ||
      st.size > 65536
    )
      throw Error("unsafe");
    return JSON.parse(await h.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await h?.close();
  }
}
// Display only selected public fields. Never dump files or query/unlock Wallet.
export async function showLocalInfo({
  resolveDirectory = resolveUserDataDir,
  write = console.log,
} = {}) {
  let dataDir;
  try {
    dataDir = await resolveDirectory();
  } catch (error) {
    await reportCommandFailure(error,{operation:"Read Wallet information",write,effect:"This read-only command did not change local data."});
    write(
      "Could not read your saved User directory. Check the installation record.",
    );
    return 1;
  }
  const setup = await inspectLocalSetup(dataDir);
  if (setup.state === "needed") {
    write([
      "------------------------------------------------------------",
      "> Wallet information",
      "------------------------------------------------------------",
      "[WAIT] Setup not finished",
      setup.hasKey ? "Your local key is saved. Continue setup to finish this installation." : "No Wallet has been created for this installation yet.",
      "", "Data folder", "  " + dataDir,
      "", "Next", "  " + setup.next,
    ].join("\n"));
    return 0;
  }
  let incomplete = setup.state === "attention";
  const read = async (name) => {
    try {
      return await privateJson(dataDir, name);
    } catch {
      incomplete = true;
      write(
        `Could not safely read ${name}. Check its ownership, permissions and format.`,
      );
      return null;
    }
  };
  const key = await read("wallet/session.keystore.json"),
    policy = await read("wallet/policy.json"),
    services = await read("runtime/local-services.json"),
    connection = await read("runtime/connection.json"),
    market = await read("market-connection.json");
  const keyAddress = typeof key?.address === "string" ? key.address : "";
  const delegate = address(
    keyAddress.startsWith("0x") ? keyAddress : `0x${keyAddress}`,
  );
  const divider =
    "------------------------------------------------------------";
  const section = (title) => ["", divider, `> ${title}`, divider];
  const field = (label, value) => [`  ${label}`, `    ${value}`];
  const lines = [
    divider,
    "> Wallet information",
    divider,
    "Saved settings · live status: agentpay status",
    ...(setup.state === "attention" ? [
      "[!] Local Wallet files need attention",
      "Keep this data folder. Check missing files against your backup before continuing.",
      "Do not create a replacement Wallet to recover existing Orders.",
    ] : []),
    ...section("Wallet & authorization"),
    `  Network: ${Number.isSafeInteger(policy?.chainId) && policy.chainId > 0 ? `eip155:${policy.chainId}` : "Not recorded"}`,
    ...field("Safe account", address(policy?.safe)),
    ...field("Policy ID", policyId(policy?.policyId)),
    ...field("Wallet execution address", delegate),
    ...field("AgentPay Module", address(policy?.module)),
  ];
  if (
    policy &&
    delegate !== "Not recorded" &&
    delegate.toLowerCase() !== String(policy.delegate).toLowerCase()
  ) {
    incomplete = true;
    lines.push(
      "  [!] Saved Policy delegate differs from this key. Review before using it.",
    );
  }
  lines.push(
    ...section("Local files"),
    ...field("Data folder", dataDir),
    "  Files inside this folder:",
    "    wallet/session.keystore.json   Encrypted Session Key",
    "    wallet/policy.json             Policy binding",
    "    runtime/local-services.json    Startup settings",
    "    runtime/invocations.json       Order history",
    "    runtime/invocations.json.results/  Verified result records",
    "    runtime/invocations.json.pending-results/  Results awaiting verification",
    "    runtime/invocations.json.files/  Saved file copies · agentpay orders files ORDER_ID",
    ...section("Service connections"),
    ...field(
      "Local Runtime · Skills connect here",
      endpoint(services?.runtimeUrl || connection?.runtimeUrl),
    ),
    ...field(
      "Settlement · Platform order service",
      endpoint(services?.settlementUrl),
    ),
    ...section("Market"),
  );
  if (market)
    lines.push(
      ...field("Saved website", endpoint(market.marketOrigin)),
      `  Wallet nickname: ${text(market.connection?.label)}`,
      ...field("Saved connection ID", text(market.connection?.id)),
      "  Current connection status is shown on the website.",
    );
  else lines.push("  No saved connection. To connect: agentpay market connect");
  lines.push(
    ...section("Backup"),
    "  Keep a private backup of this data folder and your unlock password.",
    "  This includes your key, Order records, private results and download links. Do not share it.",
  );
  if (!key)
    lines.push(
      "",
      "No readable Session Key found. Check your data directory before creating a new Wallet.",
    );
  write(lines.join("\n"));
  return incomplete ? 1 : 0;
}
