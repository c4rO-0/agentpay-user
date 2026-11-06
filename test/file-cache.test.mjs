// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createFileCache } from "../src/file-cache.mjs";
import { publicFileAddress, downloadFile } from "../src/file-download.mjs";
const orderId = "0x" + "1".repeat(64),
  url = "https://files.example.com/result?private=secret",
  hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const limits = {
  singleBytes: 10,
  totalBytes: 25,
  filesPerResult: 2,
  concurrent: 1,
  records: 10,
};
async function fixture(t, download) {
  const dir = await mkdtemp(join(tmpdir(), "file-cache-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "invocations.json");
  return { dir, path, cache: createFileCache(path, { limits, download }) };
}
test("binary download is durable, private, independently hashed, reusable and deliberately removable", async (t) => {
  const bytes = Buffer.from([0, 255, 1, 3]);
  let calls = 0;
  const f = await fixture(t, async (_url, { write }) => {
    calls++;
    await write(bytes);
  });
  const input = {
    orderId,
    fileKey: "image",
    url,
    filename: "image.png",
    sha256: hash(bytes),
  };
  const row = await f.cache.cache(input);
  assert.equal(row.state, "available");
  assert.equal(row.integrity, "expected_digest_matched");
  assert.deepEqual(await readFile(row.localPath), bytes);
  assert.equal((await stat(row.localPath)).mode & 0o777, 0o600);
  assert.equal((await f.cache.cache(input)).id, row.id);
  assert.equal(calls, 1);
  assert.doesNotMatch(
    JSON.stringify(await f.cache.list(orderId)),
    /private=secret/,
  );
  await assert.rejects(f.cache.remove({ ...input, confirmed: false }), {
    code: "FILE_CONFIRM_REQUIRED",
  });
  await f.cache.remove({ ...input, confirmed: true });
  await assert.rejects(readFile(row.localPath), { code: "ENOENT" });
  assert.equal((await f.cache.list(orderId))[0].state, "removed");
  assert.equal(
    (await createFileCache(f.path, { limits }).list(orderId))[0].state,
    "removed",
  );
});
test("oversize, wrong digest and source changes never publish ready files", async (t) => {
  const f = await fixture(t, async (_url, { write }) =>
    write(Buffer.alloc(11)),
  );
  await assert.rejects(f.cache.cache({ orderId, fileKey: "big", url }), {
    code: "FILE_TOO_LARGE",
  });
  assert.equal((await f.cache.list(orderId))[0].state, "failed");
  const g = await fixture(t, async (_url, { write }) =>
    write(Buffer.from("abc")),
  );
  await assert.rejects(
    g.cache.cache({ orderId, fileKey: "wrong", url, sha256: "a".repeat(64) }),
    { code: "FILE_DIGEST_MISMATCH" },
  );
  await assert.rejects(
    g.cache.cache({ orderId, fileKey: "wrong", url: url + "changed" }),
    { code: "FILE_REFERENCE_CONFLICT" },
  );
  const row = await g.cache.cache({ orderId, fileKey: "ok", url });
  await writeFile(row.localPath, "changed");
  await assert.rejects(g.cache.cache({ orderId, fileKey: "ok", url }), {
    code: "FILE_CACHE_CORRUPT",
  });
});
test("concurrent download rejects duplicate and cleanup; reservations bound capacity", async (t) => {
  let release, started;
  const ready = new Promise((r) => (started = r)),
    wait = new Promise((r) => (release = r));
  const f = await fixture(t, async (_url, { write }) => {
    started();
    await wait;
    await write(Buffer.from("abc"));
  });
  const input = { orderId, fileKey: "one", url },
    transfer = f.cache.cache(input);
  await ready;
  await assert.rejects(f.cache.cache(input), { code: "FILE_BUSY" });
  await assert.rejects(f.cache.cache({ ...input, fileKey: "two" }), {
    code: "FILE_BUSY",
  });
  await assert.rejects(f.cache.remove({ ...input, confirmed: true }), {
    code: "FILE_BUSY",
  });
  release();
  await transfer;
  const g = createFileCache(f.path, {
    limits: { ...limits, totalBytes: 12 },
    download: async () => {
      throw Error("should not download");
    },
  });
  await assert.rejects(g.cache({ ...input, fileKey: "two" }), {
    code: "FILE_CACHE_FULL",
  });
});
test("destination policy denies private, reserved, mixed DNS and non-HTTPS addresses", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "::1",
    "::ffff:8.8.8.8",
    "2001:db8::1",
    "2001::1",
    "2002::1",
  ])
    assert.equal(publicFileAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(publicFileAddress(ip), true, ip);
  for (const source of [
    "ftp://example.com/file",
    "https://user:pass@example.com/file",
    "file:///etc/passwd",
  ])
    await assert.rejects(
      downloadFile(source, { write: async () => {}, maxBytes: 10 }),
      { code: "FILE_URL_INVALID" },
    );
  await assert.rejects(
    downloadFile(url, {
      maxBytes: 10,
      write: async () => {},
      resolveHost: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
    { code: "FILE_DESTINATION_BLOCKED" },
  );
});

test("private exceptions bind an exact origin and never permit metadata destinations", async () => {
  let connected = 0;
  const options = {
    maxBytes: 10,
    write: async () => {},
    privateOrigins: ["http://127.0.0.1:8123"],
    requestHttp: () => {
      connected++;
      throw Error("test connection");
    },
  };
  await assert.rejects(downloadFile("http://127.0.0.1:8123/file", options), {
    code: "FILE_DOWNLOAD_FAILED",
  });
  assert.equal(connected, 1);
  await assert.rejects(downloadFile("http://127.0.0.1:8124/file", options), {
    code: "FILE_DESTINATION_BLOCKED",
  });
  await assert.rejects(
    downloadFile("http://169.254.169.254/file", {
      ...options,
      privateOrigins: ["http://169.254.169.254"],
    }),
    { code: "FILE_DESTINATION_BLOCKED" },
  );
});

test("refresh signed URL preserves known digest; removed entries free per-order slots", async (t) => {
  const f = await fixture(t, async (_url, { write }) =>
    write(Buffer.from("abc")),
  );
  const input = { orderId, fileKey: "one", url };
  await f.cache.cache(input);
  await f.cache.remove({ ...input, confirmed: true });
  const refreshed = await f.cache.cache({ ...input, url: url + "&renewed=1" });
  assert.equal(refreshed.sha256, hash("abc"));
  await f.cache.remove({ ...input, confirmed: true });
  await f.cache.cache({ ...input, fileKey: "two" });
  await f.cache.cache({ ...input, fileKey: "three" });
  await assert.rejects(f.cache.cache({ ...input, fileKey: "four" }), {
    code: "FILE_COUNT_LIMIT",
  });
});
