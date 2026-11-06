// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  rm,
  lstat,
  symlink,
  writeFile,
  copyFile,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { cacheOwner } from "../src/file-cache-owner.mjs";
const ownerModule = new URL("../src/file-cache-owner.mjs", import.meta.url)
  .href;
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "cache-owner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function contender(t, dir) {
  const code = `import {cacheOwner} from ${JSON.stringify(ownerModule)};process.on('message',async()=>{try{await cacheOwner(${JSON.stringify(dir)});process.send({ok:true});}catch(e){process.send({ok:false,code:e.code});}});process.send({ready:true});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
    }
  });
  return {
    child,
    ready: once(child, "message"),
    async acquire() {
      const response = once(child, "message");
      child.send("acquire");
      return (await response)[0];
    },
  };
}
test("real file lock selects one process; crash releases ownership without replacing the lock file", async (t) => {
  const dir = await directory(t),
    clients = Array.from({ length: 3 }, () => contender(t, dir));
  await Promise.all(clients.map((c) => c.ready));
  const results = await Promise.all(clients.map((c) => c.acquire()));
  assert.equal(results.filter((r) => r.ok).length, 1);
  for (const r of results.filter((r) => !r.ok))
    assert.equal(r.code, "FILE_CACHE_IN_USE");
  const before = await lstat(join(dir, "owner.lock"));
  assert.equal(before.size, 0);
  const winner = results.findIndex((r) => r.ok),
    exit = once(clients[winner].child, "exit");
  clients[winner].child.kill("SIGKILL");
  await exit;
  const survivors = clients.filter((_, i) => i !== winner),
    retried = await Promise.all(survivors.map((c) => c.acquire()));
  assert.equal(retried.filter((r) => r.ok).length, 1);
  const after = await lstat(join(dir, "owner.lock"));
  assert.equal(after.ino, before.ino);
  assert.equal(after.size, 0);
});
test("same-process handles and path aliases share ownership and queue state", async (t) => {
  const dir = await directory(t),
    alias = dir + "-alias";
  await symlink(dir, alias, "dir");
  t.after(() => rm(alias, { force: true }));
  const [a, b, c] = await Promise.all([
    cacheOwner(dir),
    cacheOwner(dir),
    cacheOwner(alias),
  ]);
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(a.handle.fd >= 0, true);
});
test("a symlinked lock is rejected without changing its target", async (t) => {
  const dir = await directory(t),
    target = join(dir, "original");
  await writeFile(target, "keep", { mode: 0o600 });
  await symlink(target, join(dir, "owner.lock"));
  await assert.rejects(cacheOwner(dir), (error) =>
    ["FILE_CACHE_UNSAFE", "FILE_CACHE_LOCK_UNAVAILABLE"].includes(error.code),
  );
  assert.equal((await lstat(target)).size, 4);
});
test("missing native dependency fails file caching clearly rather than silently skipping locking", async (t) => {
  const dir = await directory(t),
    source = join(dir, "source"),
    data = join(dir, "data");
  await mkdir(source);
  await mkdir(data);
  for (const name of ["file-cache-owner.mjs", "file-download.mjs"])
    await copyFile(
      new URL("../src/" + name, import.meta.url),
      join(source, name),
    );
  const { cacheOwner: missing } = await import(
    pathToFileURL(join(source, "file-cache-owner.mjs"))
  );
  await assert.rejects(missing(data), { code: "FILE_CACHE_LOCK_UNAVAILABLE" });
});
