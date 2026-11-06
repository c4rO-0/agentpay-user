// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
export function serviceSettings(input) {
  if (
    !input ||
    Object.keys(input).some(
      (k) =>
        !["version", "runtimeUrl", "settlementUrl", "startupChoice"].includes(
          k,
        ),
    ) ||
    input.version !== 1
  )
    throw Error("Invalid local service settings.");
  if (
    input.startupChoice !== undefined &&
    !["enabled", "disabled"].includes(input.startupChoice)
  )
    throw Error("Invalid startup preference.");
  const runtime = new URL(input.runtimeUrl),
    settlement = new URL(input.settlementUrl);
  if (
    runtime.protocol !== "http:" ||
    runtime.hostname !== "127.0.0.1" ||
    !runtime.port ||
    runtime.pathname !== "/" ||
    runtime.search ||
    runtime.hash ||
    runtime.username ||
    runtime.password
  )
    throw Error("Runtime needs a loopback HTTP origin with an explicit port.");
  if (
    settlement.username ||
    settlement.password ||
    settlement.search ||
    settlement.hash ||
    !(
      settlement.protocol === "https:" ||
      (settlement.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(settlement.hostname))
    )
  )
    throw Error("Settlement needs HTTPS or a local rehearsal URL.");
  return {
    version: 1,
    runtimeUrl: runtime.origin,
    settlementUrl: settlement.href.replace(/\/+$/, ""),
    ...(input.startupChoice ? { startupChoice: input.startupChoice } : {}),
  };
}
function owned(info) {
  return (
    info.uid === process.getuid() &&
    (info.mode & 0o077) === 0 &&
    !info.isSymbolicLink()
  );
}
export async function checkServiceDirectory(dataDir) {
  for (const dir of [
    dataDir,
    join(dataDir, "wallet"),
    join(dataDir, "runtime"),
  ]) {
    const info = await lstat(dir);
    if (!info.isDirectory() || !owned(info))
      throw Error(
        "Local service directories must be private and owned by you.",
      );
  }
}
export async function saveServiceSettings({
  dataDir,
  runtimeUrl,
  settlementUrl,
  startupChoice,
}) {
  await checkServiceDirectory(dataDir);
  let previous;
  try {
    previous = await readServiceSettings(dataDir);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const choice = startupChoice ?? previous?.startupChoice;
  const settings = serviceSettings({
    version: 1,
    runtimeUrl,
    settlementUrl,
    ...(choice ? { startupChoice: choice } : {}),
  });
  const temp = join(dataDir, "runtime", `services-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(JSON.stringify(settings) + "\n");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, join(dataDir, "runtime", "local-services.json"));
  } finally {
    await handle?.close();
    await unlink(temp).catch(() => {});
  }
}
export async function readServiceSettings(dataDir) {
  await checkServiceDirectory(dataDir);
  const file = await open(
    join(dataDir, "runtime", "local-services.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || !owned(info) || info.size > 4096)
      throw Error("Invalid local service settings file.");
    return serviceSettings(JSON.parse(await file.readFile("utf8")));
  } finally {
    await file.close();
  }
}
export function runtimeEnvironment(dataDir, settings) {
  return {
    AGENTPAY_USER_HOST: "127.0.0.1",
    AGENTPAY_USER_PORT: new URL(settings.runtimeUrl).port,
    AGENTPAY_WALLET_SOCKET: join(dataDir, "wallet", "wallet.sock"),
    AGENTPAY_WALLET_AGENT_TOKEN_FILE: join(dataDir, "wallet", "agent.token"),
    AGENTPAY_USER_CALLER_TOKEN_FILE: join(dataDir, "runtime", "caller.token"),
    AGENTPAY_USER_STATE_FILE: join(dataDir, "runtime", "invocations.json"),
    AGENTPAY_SETTLEMENT_URL: settings.settlementUrl,
  };
}
export function listenerPresent(address) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(address);
    socket.setTimeout(2000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (e) => {
      socket.destroy();
      if (["ENOENT", "ECONNREFUSED"].includes(e.code)) resolve(false);
      else reject(Error("Could not safely check the existing listener."));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(Error("Existing listener check timed out."));
    });
  });
}
