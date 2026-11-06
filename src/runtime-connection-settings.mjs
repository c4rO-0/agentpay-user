// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Reconstruct only the client locator from verified local service settings.
// Keys, caller credentials, authorization and request history are never changed.
import { constants } from "node:fs";
import { open, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readServiceSettings } from "./local-services.mjs";

export async function ensureRuntimeConnection({ dataDir, write = () => {} }) {
  const settings = await readServiceSettings(dataDir);
  const directory = join(dataDir, "runtime"),
    path = join(directory, "connection.json");
  const expected = {
    version: "agentpay.runtime-connection.v1",
    runtimeUrl: new URL(settings.runtimeUrl).href,
    callerTokenFile: join(directory, "caller.token"),
    clientModule: fileURLToPath(
      new URL("./runtime-client.mjs", import.meta.url),
    ),
  };
  async function check() {
    let h;
    try {
      h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const st = await h.stat();
      if (
        !st.isFile() ||
        st.uid !== process.getuid() ||
        st.mode & 0o077 ||
        st.size > 16384
      )
        throw Error("unsafe");
      const saved = JSON.parse(await h.readFile("utf8"));
      if (
        saved.version !== expected.version ||
        new URL(saved.runtimeUrl).href !== expected.runtimeUrl ||
        saved.callerTokenFile !== expected.callerTokenFile ||
        saved.clientModule !== expected.clientModule
      )
        throw Error("conflict");
      return true;
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw Error(
        "The saved Runtime connection is invalid or conflicts with local service settings. It was kept for review: " +
          path,
      );
    } finally {
      await h?.close();
    }
  }
  if (await check()) return { created: false };
  const temporary = path + "." + randomUUID() + ".tmp";
  let h,
    created = false;
  try {
    h = await open(temporary, "wx", 0o600);
    await h.writeFile(JSON.stringify(expected) + "\n");
    await h.sync();
    await h.close();
    h = null;
    // Do not replace a connection published by another process during preparation.
    try {
      await link(temporary, path);
      created = true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (!(await check()))
        throw Error("Runtime connection changed during preparation. Retry.");
    }
    const d = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } finally {
    await h?.close();
    await unlink(temporary).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  if (created)
    write("Local Skill connection restored from your Runtime settings.");
  return { created };
}
