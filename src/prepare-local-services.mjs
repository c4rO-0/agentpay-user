// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { ensureRuntimeConnection } from "./runtime-connection-settings.mjs";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { installedUserDir } from "./local-data-directory.mjs";
import {
  checkServiceDirectory,
  readServiceSettings,
  saveServiceSettings,
  serviceSettings,
} from "./local-services.mjs";

async function privateJson(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await file.stat();
    if (
      !st.isFile() ||
      st.uid !== process.getuid() ||
      st.mode & 0o077 ||
      st.size > 65536
    )
      throw Error(
        "Saved User settings must be private, regular files owned by you.",
      );
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}
async function optionalJson(path) {
  try {
    return await privateJson(path);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function askServiceSetting(prompt) {
  if (!process.stdin.isTTY)
    throw Error(
      "Startup settings are incomplete. Run ./run service start in your terminal to finish configuration.",
    );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await terminal.question(`${prompt}\n> `);
  } finally {
    terminal.close();
  }
}
// Only participant-owned settings are consulted. No platform environment file,
// default endpoint or business-specific Skill is a source of startup authority.
export async function ensureLocalServices({
  dataDir,
  userDir = installedUserDir,
  ask = askServiceSetting,
  write = console.log,
} = {}) {
  let saved;
  try {
    saved = await readServiceSettings(dataDir);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (saved) {
    await ensureRuntimeConnection({ dataDir, write });
    return saved;
  }
  await checkServiceDirectory(dataDir);
  const key = await optionalJson(
    join(dataDir, "wallet", "session.keystore.json"),
  );
  if (!key) throw Error("Wallet is not initialized. Run ./run setup first.");
  const connection = await optionalJson(
    join(dataDir, "runtime", "connection.json"),
  );
  if (
    connection &&
    (connection.version !== "agentpay.runtime-connection.v1" ||
      connection.callerTokenFile !== join(dataDir, "runtime", "caller.token"))
  )
    throw Error(
      "The saved Runtime connection does not match this User directory. Review it before starting.",
    );
  const setup = await optionalJson(
    join(dirname(userDir), "anvil-onboarding.json"),
  );
  const policy = await optionalJson(join(dataDir, "wallet", "policy.json"));
  if (
    setup &&
    policy &&
    (["safe", "module"].some(
      (k) => String(setup[k]).toLowerCase() !== String(policy[k]).toLowerCase(),
    ) ||
      Number(setup.chainId) !== Number(policy.chainId))
  )
    throw Error(
      "Saved setup belongs to a different authorization. Your current Wallet was kept; review its startup addresses first.",
    );
  let runtimeUrl = connection?.runtimeUrl || setup?.runtimeUrl;
  if (
    connection &&
    setup &&
    new URL(connection.runtimeUrl).origin !== new URL(setup.runtimeUrl).origin
  )
    throw Error(
      "Saved Runtime addresses disagree. Review your local settings before starting.",
    );
  let settlementUrl = setup?.settlementUrl;
  write(
    "Preparing background services for your existing Wallet. Your key and spending permission stay unchanged.",
  );
  const request = async (label) => {
    const value = (await ask(label + " (type 'q' to cancel)")).trim();
    if (value === "q" || !value)
      throw Error(
        "Startup preparation cancelled. Your Wallet data is unchanged.",
      );
    return value;
  };
  if (!runtimeUrl)
    runtimeUrl = await request(
      "Local Runtime address, including its port (for example http://127.0.0.1:6490)",
    );
  if (!settlementUrl)
    settlementUrl = await request(
      "Settlement address supplied by your AgentPay platform",
    );
  const settings = serviceSettings({ version: 1, runtimeUrl, settlementUrl });
  await saveServiceSettings({ dataDir, ...settings });
  await ensureRuntimeConnection({ dataDir, write });
  write("Startup settings saved. Login startup preference was not changed.");
  return settings;
}
