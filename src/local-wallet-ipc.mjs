// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { checkServiceDirectory } from "./local-services.mjs";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
export async function localWalletAdmin(dataDir, method, params = {}, {timeoutMs = 30000} = {}) {
  await checkServiceDirectory(dataDir);
  const h = await open(
    join(dataDir, "wallet/admin.token"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let token;
  try {
    const s = await h.stat();
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      s.mode & 0o077 ||
      s.size > 4096
    )
      throw Error("Local Wallet access file is unsafe.");
    token = (await h.readFile("utf8")).trim();
  } finally {
    await h.close();
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(dataDir, "wallet/wallet.sock"));
    let text = "",
      done = false;
    const finish = (e, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      e ? reject(e) : resolve(value);
    };
    const timer = setTimeout(
      () => finish(Error("Wallet did not respond. Run agentpay status.")),
      timeoutMs,
    );
    socket.setEncoding("utf8");
    socket.once("error", (e) =>
      finish(
        Object.assign(
          Error(
            "Start Wallet with agentpay service start, then run agentpay wallet unlock.",
          ),
          {
            code: ["ENOENT", "ECONNREFUSED"].includes(e.code)
              ? "WALLET_NOT_RUNNING"
              : "WALLET_CONNECTION_FAILED",
          },
        ),
      ),
    );
    socket.once("connect", () =>
      socket.write(
        JSON.stringify({
          id: randomBytes(8).toString("hex"),
          token,
          method,
          params,
        }) + "\n",
      ),
    );
    socket.on("data", (part) => {
      text += part;
      if (Buffer.byteLength(text) > 65536)
        finish(Error("Wallet response was too large."));
    });
    socket.once("close", () => {
      if (!done)
        finish(Error("Wallet closed the connection. Check agentpay status."));
    });
    socket.once("end", () => {
      try {
        const r = JSON.parse(text);
        if (!r.ok)
          throw Object.assign(
            Error(r.error?.message || "Wallet rejected the connection."),
            { code: r.error?.code },
          );
        finish(null, r.result);
      } catch (e) {
        finish(e);
      }
    });
  });
}
