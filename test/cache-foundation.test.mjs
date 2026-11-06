// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  unlink,
  symlink,
  mkdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createFileCache } from "../src/file-cache.mjs";
import { manageCache } from "../src/cache-management.mjs";
import {
  runCacheManagement,
  exportCacheFile,
} from "../src/cache-management-cli.mjs";
const execute = promisify(execFile),
  oid = "0x" + "1".repeat(64),
  rid = "original-request-001",
  url = "https://example.com/file",
  hash = (v) => createHash("sha256").update(v).digest("hex");
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cache-foundation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state");
  return {
    dir,
    path,
    cache: createFileCache(path, {
      limits: { singleBytes: 100, totalBytes: 200 },
      download: async (_, { write }) => write(Buffer.from("result")),
      ...options,
    }),
  };
}
test("arbitrary input bytes, deleted sources, protected input and shared output storage", async (t) => {
  const f = await fixture(t);
  for (const [i, bytes] of [
    Buffer.alloc(0),
    Buffer.from("你好\n"),
    Buffer.from([0, 255, 10, 128, 1]),
  ].entries()) {
    const sourcePath = join(f.dir, "input" + i);
    await writeFile(sourcePath, bytes);
    const args = {
        requestId: rid,
        fileKey: "f" + i,
        sourcePath,
        filename: "测试.bin",
      },
      row = await f.cache.importInput(args);
    assert.deepEqual(await readFile(row.localPath), bytes);
    assert.equal(row.sha256, hash(bytes));
    assert.equal(row.protected, true);
    await unlink(sourcePath);
    assert.equal((await f.cache.importInput(args)).id, row.id);
  }
  assert.deepEqual(await f.cache.cleanPreview(), []);
  const output = await f.cache.cache({ orderId: oid, fileKey: "result", url }),
    preview = await f.cache.cleanPreview();
  assert.equal(preview.length, 1);
  await f.cache.clean({ items: preview, confirmed: true });
  assert.equal((await f.cache.details(output.id)).state, "removed");
  assert.equal((await f.cache.listAll({ purpose: "input" })).total, 3);
});
test("shared quota and lowered caps preserve reads and cleanup", async (t) => {
  const f = await fixture(t, { limits: { singleBytes: 10, totalBytes: 15 } }),
    sourcePath = join(f.dir, "input");
  await writeFile(sourcePath, "123456");
  const input = await f.cache.importInput({
    requestId: rid,
    fileKey: "in",
    sourcePath,
  });
  await assert.rejects(f.cache.cache({ orderId: oid, fileKey: "out", url }), {
    code: "FILE_CACHE_FULL",
  });
  await f.cache.settings({ totalBytes: 30 });
  await f.cache.cache({ orderId: oid, fileKey: "out", url });
  await f.cache.settings({
    singleBytes: 1,
    totalBytes: 1,
    records: 1,
    filesPerResult: 1,
  });
  assert.equal((await f.cache.summary()).overLimit, true);
  assert.equal((await f.cache.verified(input.id)).bytes, 6);
  await f.cache.clean({ items: await f.cache.cleanPreview(), confirmed: true });
  assert.equal((await f.cache.summary()).bytes, 6);
  await assert.rejects(f.cache.settings({ unknown: 4 }));
  await assert.rejects(f.cache.settings([]));
});
test("corrupt original input cannot be substituted or cleaned with forged scope", async (t) => {
  const f = await fixture(t),
    sourcePath = join(f.dir, "in");
  await writeFile(sourcePath, "old");
  const args = { requestId: rid, fileKey: "f", sourcePath },
    row = await f.cache.importInput(args);
  await writeFile(row.localPath, "bad");
  await writeFile(sourcePath, "new");
  await assert.rejects(f.cache.importInput(args), {
    code: "FILE_CACHE_CORRUPT",
  });
  await assert.rejects(f.cache.importInput(args), {
    code: "FILE_CACHE_CORRUPT",
  });
  await assert.rejects(
    f.cache.clean({
      items: [{ id: row.id, generation: "a".repeat(64) }],
      confirmed: true,
    }),
    { code: "FILE_PREVIEW_CHANGED" },
  );
});
test("cleanup preview cannot delete a new generation", async (t) => {
  const f = await fixture(t),
    args = { orderId: oid, fileKey: "f", url };
  await f.cache.cache(args);
  const items = await f.cache.cleanPreview();
  await f.cache.remove({ ...args, confirmed: true });
  await f.cache.cache(args);
  await assert.rejects(f.cache.clean({ items, confirmed: true }), {
    code: "FILE_PREVIEW_CHANGED",
  });
  assert.equal((await f.cache.list(oid))[0].state, "available");
});
test("source types and exports: symlink rejection, integrity, private destination, no overwrite", async (t) => {
  const f = await fixture(t),
    sourcePath = join(f.dir, "source");
  await writeFile(sourcePath, "bytes");
  await symlink(sourcePath, join(f.dir, "link"));
  await assert.rejects(
    f.cache.importInput({
      requestId: rid,
      fileKey: "link",
      sourcePath: join(f.dir, "link"),
    }),
  );
  await assert.rejects(
    f.cache.importInput({ requestId: rid, fileKey: "dir", sourcePath: f.dir }),
    { code: "FILE_INPUT_INVALID" },
  );
  const row = await f.cache.importInput({
      requestId: rid,
      fileKey: "ok",
      sourcePath,
    }),
    dest = join(f.dir, "copy");
  await exportCacheFile(row, dest);
  assert.equal(await readFile(dest, "utf8"), "bytes");
  assert.equal((await stat(dest)).mode & 0o777, 0o600);
  await assert.rejects(exportCacheFile(row, dest), /already exists/);
  await assert.rejects(
    exportCacheFile(row, join(f.path + ".files", "extra")),
    /outside/,
  );
  await writeFile(row.localPath, "wrong");
  await assert.rejects(
    exportCacheFile(row, join(f.dir, "bad")),
    /verification/,
  );
  await assert.rejects(stat(join(f.dir, "bad")), { code: "ENOENT" });
});
test("old index upgrades once without changing output identity or bytes", async (t) => {
  const f = await fixture(t),
    id = hash(oid + "\nf");
  await mkdir(f.path + ".files", { mode: 0o700 });
  const r = {
    orderId: oid,
    fileKey: "f",
    url,
    filename: "old",
    state: "available",
    bytes: 3,
    sha256: hash("old"),
    expectedSha256: null,
    updatedAtMs: 1,
  };
  await writeFile(
    join(f.path + ".files", "index.json"),
    JSON.stringify({ version: 1, files: { [id]: r } }),
    { mode: 0o600 },
  );
  await writeFile(join(f.path + ".files", id + ".bin"), "old", { mode: 0o600 });
  assert.equal((await f.cache.list(oid))[0].id, id);
  assert.equal((await f.cache.verified(id)).sha256, hash("old"));
  assert.equal(
    JSON.parse(await readFile(join(f.path + ".files", "index.json"))).version,
    2,
  );
});
test("recovery of deletion and publication checkpoints makes no network call", async (t) => {
  const f = await fixture(t),
    folder = f.path + ".files";
  await mkdir(folder, { mode: 0o700 });
  const rows = {};
  for (const [key, state] of [
    ["delete", "deleting"],
    ["publish", "downloading"],
  ]) {
    const id = hash(oid + "\n" + key);
    rows[id] = {
      purpose: "output",
      sourceKind: "url",
      orderId: oid,
      fileKey: key,
      url,
      filename: key,
      state,
      bytes: 3,
      sha256: hash("abc"),
      expectedSha256: null,
      updatedAtMs: 1,
    };
    await writeFile(join(folder, id + ".bin"), "abc", { mode: 0o600 });
  }
  await writeFile(
    join(folder, "index.json"),
    JSON.stringify({ version: 2, files: rows }),
    { mode: 0o600 },
  );
  const cache = createFileCache(f.path, {
      download: () => {
        throw Error("must not fetch");
      },
    }),
    listed = await cache.list(oid);
  assert.equal(listed.find((r) => r.fileKey === "delete").state, "removed");
  assert.equal(listed.find((r) => r.fileKey === "publish").state, "available");
  await assert.rejects(stat(join(folder, hash(oid + "\ndelete") + ".bin")), {
    code: "ENOENT",
  });
});
test("large binary import and actual competing-process exclusion", async (t) => {
  const f = await fixture(t, {
      limits: { singleBytes: 16 * 1048576, totalBytes: 32 * 1048576 },
    }),
    sourcePath = join(f.dir, "large"),
    bytes = Buffer.alloc(8 * 1048576, 233);
  await writeFile(sourcePath, bytes);
  assert.equal(
    (
      await f.cache.importInput({
        requestId: rid,
        fileKey: "large",
        sourcePath,
      })
    ).sha256,
    hash(bytes),
  );
  const module = new URL("../src/file-cache.mjs", import.meta.url).href;
  const { stdout } = await execute(process.execPath, [
    "--input-type=module",
    "-e",
    `import {createFileCache} from ${JSON.stringify(module)};try{await createFileCache(${JSON.stringify(f.path)}).summary();process.exitCode=2;}catch(e){console.log(e.code);}`,
  ]);
  assert.match(stdout, /FILE_CACHE_IN_USE/);
});
test("CLI preview cancellation, export, confirmed cleanup and management allowlist", async (t) => {
  const f = await fixture(t),
    row = await f.cache.cache({
      orderId: oid,
      fileKey: "file",
      url,
      filename: "report.pdf",
    }),
    lines = [];
  const options = {
    operate: (b) => manageCache(f.cache, b),
    write: (s) => lines.push(s),
    ask: async () => "q",
  };
  for (const args of [
    [],
    ["list"],
    ["details", row.id],
    ["settings"],
    ["clean"],
    ["export", row.id, join(f.dir, "export.pdf")],
  ])
    assert.equal(await runCacheManagement(args, options), 0);
  assert.match(lines.join("\n"), /Cleanup cancelled/);
  assert.doesNotMatch(lines.join("\n"), /https:\/\/example/);
  assert.equal((await f.cache.details(row.id)).state, "available");
  assert.equal(
    await runCacheManagement(["clean"], {
      ...options,
      ask: async () => "confirm",
    }),
    0,
  );
  assert.equal((await f.cache.details(row.id)).state, "removed");
  await assert.rejects(
    manageCache(f.cache, { action: "import", sourcePath: "/secret" }),
    { code: "FILE_INPUT_INVALID" },
  );
});

for (const point of ["before-publish", "after-publish", "delete"])
  test(
    "actual process interruption at " + point + " reconciles without fetching",
    async (t) => {
      const f = await fixture(t),
        module = new URL("../src/file-cache.mjs", import.meta.url).href;
      const code = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
 const rename=fs.rename,unlink=fs.unlink;let armed=false;
 fs.rename=async(a,b)=>{if(armed&&String(b).endsWith('.bin')){if(${JSON.stringify(point)}==='before-publish')process.kill(process.pid,'SIGKILL');const result=await rename(a,b);if(${JSON.stringify(point)}==='after-publish')process.kill(process.pid,'SIGKILL');return result;}return rename(a,b);};
 fs.unlink=async p=>{if(armed&&${JSON.stringify(point)}==='delete'&&String(p).endsWith('.bin'))process.kill(process.pid,'SIGKILL');return unlink(p);};syncBuiltinESMExports();
 const {createFileCache}=await import(${JSON.stringify(module)});const c=createFileCache(${JSON.stringify(f.path)},{download:async(_,{write})=>write(Buffer.from('abc'))});
 const args={orderId:${JSON.stringify(oid)},fileKey:'crash',url:${JSON.stringify(url)}};
 if(${JSON.stringify(point)}==='delete'){await c.cache(args);armed=true;await c.remove({...args,confirmed:true});}else{armed=true;await c.cache(args);}`;
      await assert.rejects(
        execute(process.execPath, ["--input-type=module", "-e", code]),
        (e) => e.signal === "SIGKILL",
      );
      const cache = createFileCache(f.path, {
          download: () => {
            throw Error("must not fetch");
          },
        }),
        row = (await cache.list(oid))[0];
      assert.equal(row.state, point === "delete" ? "removed" : "available");
      if (point !== "delete")
        assert.equal(await readFile(row.localPath, "utf8"), "abc");
    },
  );
test("injected disk-full write fails safely; unknown files count but are never cleaned", async (t) => {
  const f = await fixture(t),
    module = new URL("../src/file-cache.mjs", import.meta.url).href;
  const code = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';const open=fs.open;
 fs.open=async(p,...args)=>{const h=await open(p,...args);if(String(p).endsWith('.part'))h.writeFile=async()=>{throw Object.assign(Error('full'),{code:'ENOSPC'});};return h;};syncBuiltinESMExports();
 const {createFileCache}=await import(${JSON.stringify(module)});try{await createFileCache(${JSON.stringify(f.path)},{download:async(_,{write})=>write(Buffer.from('abc'))}).cache({orderId:${JSON.stringify(oid)},fileKey:'full',url:${JSON.stringify(url)}});}catch(e){console.log(e.code);}`;
  const { stdout } = await execute(process.execPath, [
    "--input-type=module",
    "-e",
    code,
  ]);
  assert.match(stdout, /FILE_STORAGE_FAILED/);
  assert.equal((await f.cache.list(oid))[0].state, "failed");
  await writeFile(join(f.path + ".files", "unknown"), Buffer.alloc(11), {
    mode: 0o600,
  });
  assert.equal((await f.cache.summary()).unknownBytes, 11);
  await f.cache.clean({ items: await f.cache.cleanPreview(), confirmed: true });
  assert.equal((await stat(join(f.path + ".files", "unknown"))).size, 11);
});

test("source mutation during import is rejected rather than snapshotting a mixed file", async (t) => {
  const f = await fixture(t),
    sourcePath = join(f.dir, "changing"),
    module = new URL("../src/file-cache.mjs", import.meta.url).href;
  await writeFile(sourcePath, "old");
  const code = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';const open=fs.open;
 fs.open=async(p,...args)=>{const h=await open(p,...args);if(p===${JSON.stringify(sourcePath)}){const read=h.createReadStream.bind(h);h.createReadStream=options=>({async *[Symbol.asyncIterator](){for await(const chunk of read(options)){yield chunk;await fs.writeFile(p,'new');}}});}return h;};syncBuiltinESMExports();
 const {createFileCache}=await import(${JSON.stringify(module)});try{await createFileCache(${JSON.stringify(f.path)}).importInput({requestId:${JSON.stringify(rid)},fileKey:'changing',sourcePath:${JSON.stringify(sourcePath)}});}catch(e){console.log(e.code);}`;
  const { stdout } = await execute(process.execPath, [
    "--input-type=module",
    "-e",
    code,
  ]);
  assert.match(stdout, /FILE_SOURCE_CHANGED/);
  assert.equal((await f.cache.listAll()).items[0].state, "failed");
});
