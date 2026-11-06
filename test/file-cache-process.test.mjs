// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileCache } from "../src/file-cache.mjs";
const orderId = "0x" + "1".repeat(64),
  moduleUrl = new URL("../src/file-cache.mjs", import.meta.url).href;
test("real HTTP transfer, competing process rejection, SIGKILL and original-file retry", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cache-process-")),
    path = join(dir, "state");
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.write("first");
    if (complete) res.end("last");
  });
  let complete = false;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`,
    input = { orderId, fileKey: "original", url: origin + "/file" };
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {createFileCache} from ${JSON.stringify(moduleUrl)};await createFileCache(${JSON.stringify(path)},{privateOrigins:[${JSON.stringify(origin)}]}).cache(${JSON.stringify(input)});`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => child.kill("SIGKILL"));
  let found = false;
  for (let i = 0; i < 100; i++) {
    const names = await readdir(path + ".files").catch(() => []);
    for (const n of names.filter((n) => n.endsWith(".part"))) {
      if ((await readFile(join(path + ".files", n))).length) {
        found = true;
        break;
      }
    }
    if (found) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(found, true, "actual partial bytes were written");
  await assert.rejects(createFileCache(path).list(orderId), {
    code: "FILE_CACHE_IN_USE",
  });
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  complete = true;
  const cache = createFileCache(path, { privateOrigins: [origin] });
  assert.equal(
    (await cache.list(orderId))[0].error,
    "FILE_TRANSFER_INTERRUPTED",
  );
  const row = await cache.cache(input);
  assert.equal(await readFile(row.localPath, "utf8"), "firstlast");
  assert.equal((await cache.cache(input)).id, row.id);
  await cache.remove({ ...input, confirmed: true });
  assert.equal((await cache.list(orderId))[0].state, "removed");
});
