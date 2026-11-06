// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { localWalletAdmin } from "../src/local-wallet-ipc.mjs";
test("administrative client keeps its socket open for an asynchronous reply and validates the private token file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "user-market-ipc-"));
  let server;
  let calls = 0;
  try {
    for (const name of ["wallet", "runtime"])
      await mkdir(join(dir, name), { mode: 0o700 });
    const path = join(dir, "wallet/admin.token");
    await writeFile(path, "fixture-admin", { mode: 0o600 });
    server = createServer((socket) => {
      let text = "";
      socket.on("data", (part) => {
        text += part;
        if (!text.includes("\n")) return;
        calls++;
        const r = JSON.parse(text);
        assert.equal(r.token, "fixture-admin");
        assert.equal(r.method, "marketConnectionScope");
        setTimeout(
          () =>
            socket.end(
              JSON.stringify({ ok: true, result: { network: "eip155:31337" } }),
            ),
          20,
        );
      });
    });
    await new Promise((r) => server.listen(join(dir, "wallet/wallet.sock"), r));
    assert.deepEqual(await localWalletAdmin(dir, "marketConnectionScope"), {
      network: "eip155:31337",
    });
    assert.equal(calls, 1);
    await chmod(path, 0o644);
    await assert.rejects(
      () => localWalletAdmin(dir, "marketConnectionScope"),
      /unsafe/,
    );
    assert.equal(calls, 1);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
