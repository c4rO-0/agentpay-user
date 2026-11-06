// Private content storage with explicit ownership, limits and integrity metadata.
// Cache cleanup must preserve protected request inputs and original-result recovery.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { cacheOwner } from "./file-cache-owner.mjs";
import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink, readdir } from "node:fs/promises";
import { join, dirname, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readPrivateJson } from "./order-review.mjs";
import { downloadFile, fileError } from "./file-download.mjs";
import {
  fileCacheLimits,
  validateCacheLimits,
} from "./file-cache-settings.mjs";
export { fileCacheLimits } from "./file-cache-settings.mjs";
const digest = (v) => createHash("sha256").update(v).digest("hex");
const hex = /^[a-f0-9]{64}$/,
  order = /^0x[a-f0-9]{64}$/,
  request = /^[A-Za-z0-9._:-]{16,128}$/;
const states = ["downloading", "available", "failed", "deleting", "removed"];
const privateFile = (s) =>
  s.isFile() &&
  s.nlink === 1 &&
  (typeof process.getuid !== "function" ||
    (s.uid === process.getuid() && !(s.mode & 0o077)));
const scope = (r) => (r.purpose === "input" ? r.requestId : r.orderId);
// Preserve the original output IDs; inputs occupy an explicitly separate namespace.
const recordId = (r) =>
  digest(
    r.purpose === "input"
      ? "input\n" + r.requestId + "\n" + r.fileKey
      : r.orderId + "\n" + r.fileKey,
  );
const generation = (r) => digest(JSON.stringify(r));
const fail = (code, message) => fileError(code, message);
export function createFileCache(
  statePath,
  {
    download = downloadFile,
    limits = fileCacheLimits,
    privateOrigins = [],
  } = {},
) {
  limits = validateCacheLimits(limits);
  const directory = statePath + ".files",
    index = join(directory, "index.json");
  let owner;
  async function exclusive(fn) {
    await mkdir(directory, { mode: 0o700 }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    const s = await lstat(directory);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      (typeof process.getuid === "function" &&
        (s.uid !== process.getuid() || s.mode & 0o077))
    )
      throw fail("FILE_CACHE_UNSAFE", "File cache permissions need review.");
    owner = await cacheOwner(directory);
    const next = owner.tail.then(fn);
    owner.tail = next.catch(() => {});
    return next;
  }
  async function sync(path = directory) {
    const h = await open(path, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
  }
  async function atomic(path, value) {
    const temp = join(dirname(path), ".index-" + randomUUID());
    let h;
    try {
      h = await open(temp, "wx", 0o600);
      await h.writeFile(JSON.stringify(value));
      await h.sync();
      await h.close();
      h = null;
      await rename(temp, path);
      await sync(dirname(path));
    } finally {
      await h?.close();
      await unlink(temp).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
  }
  async function persist(doc) {
    if (Buffer.byteLength(JSON.stringify(doc)) > 8 * 1048576)
      throw fail("FILE_COUNT_LIMIT", "File cache metadata limit reached.");
    await atomic(index, doc);
  }
  async function discard(path) {
    try {
      const st = await lstat(path);
      if (!privateFile(st) || st.isSymbolicLink())
        throw fail(
          "FILE_CACHE_UNSAFE",
          "A cache file needs inspection before cleanup.",
        );
      await unlink(path);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  async function load() {
    const doc = (await readPrivateJson(index, 8 * 1048576)) || {
      version: 2,
      files: {},
    };
    if (
      ![1, 2].includes(doc.version) ||
      !doc.files ||
      Array.isArray(doc.files) ||
      typeof doc.files !== "object" ||
      Object.keys(doc.files).length > 100000
    )
      throw fail("FILE_CACHE_INVALID", "File cache metadata needs review.");
    const upgrading = doc.version === 1;
    for (const [id, r] of Object.entries(doc.files)) {
      if (upgrading && r) {
        r.purpose = "output";
        r.sourceKind = "url";
      }
      if (
        !hex.test(id) ||
        !r ||
        !["input", "output"].includes(r.purpose) ||
        !["url", "local"].includes(r.sourceKind) ||
        (r.purpose === "input"
          ? !request.test(r.requestId || "")
          : !order.test(r.orderId || "") || r.sourceKind !== "url") ||
        (r.revision !== undefined &&
          (typeof r.revision !== "string" ||
            !/^[a-f0-9-]{36}$/.test(r.revision))) ||
        !states.includes(r.state) ||
        !Number.isSafeInteger(r.bytes) ||
        r.bytes < 0 ||
        typeof r.fileKey !== "string" ||
        !/^[A-Za-z0-9._-]{1,80}$/.test(r.fileKey) ||
        id !== recordId(r) ||
        (r.sourceKind === "url"
          ? typeof r.url !== "string" || r.url.length > 8192
          : typeof r.sourcePath !== "string" ||
            !isAbsolute(r.sourcePath) ||
            r.sourcePath.length > 8192) ||
        typeof r.filename !== "string" ||
        r.filename.length > 200 ||
        /[\x00-\x1f\x7f/\\]/.test(r.filename) ||
        !Number.isSafeInteger(r.updatedAtMs) ||
        r.updatedAtMs < 0 ||
        (r.sha256 != null && !hex.test(r.sha256)) ||
        (r.expectedSha256 != null && !hex.test(r.expectedSha256)) ||
        (r.state === "available" && !r.sha256) ||
        (r.purpose === "input" && typeof r.protected !== "boolean") ||
        (r.reservation !== undefined &&
          (!Number.isSafeInteger(r.reservation) || r.reservation < 0))
      )
        throw fail("FILE_CACHE_INVALID", "File cache metadata needs review.");
    }
    doc.version = 2;
    if (!owner.initialized) {
      for (const name of await readdir(directory))
        if (/^\.index-[a-f0-9-]{36}$/.test(name))
          await discard(join(directory, name));
      let changed = upgrading;
      for (const [id, r] of Object.entries(doc.files)) {
        if (["deleting", "removed"].includes(r.state)) {
          await discard(join(directory, id + ".bin"));
          await discard(join(directory, id + ".part"));
          if (r.state === "deleting") {
            r.state = "removed";
            r.updatedAtMs = Date.now();
            changed = true;
          }
        } else if (r.state === "downloading") {
          // A durable final file may precede the index commit. Preserve it only when a
          // saved digest proves this is the completed transfer, otherwise fail closed.
          let recovered = false;
          if (r.sha256) {
            try {
              await verify(id, r);
              recovered = true;
            } catch {
              try {
                await verify(id, r, ".part");
                await rename(
                  join(directory, id + ".part"),
                  join(directory, id + ".bin"),
                );
                await sync();
                recovered = true;
              } catch {}
            }
            if (recovered) r.state = "available";
          }
          if (!recovered) {
            await discard(join(directory, id + ".bin"));
            r.state = "failed";
            r.error = "FILE_TRANSFER_INTERRUPTED";
            r.bytes = 0;
          }
          await discard(join(directory, id + ".part"));
          delete r.reservation;
          r.updatedAtMs = Date.now();
          changed = true;
        }
      }
      await sync();
      if (changed) await persist(doc);
      owner.initialized = true;
    } else if (upgrading)
      throw fail(
        "FILE_CACHE_INVALID",
        "Cache metadata changed while this Runtime was running.",
      );
    return doc;
  }
  const publicRow = (id, r) => ({
    id,
    purpose: r.purpose,
    ...(r.purpose === "input"
      ? { requestId: r.requestId, protected: r.protected }
      : { orderId: r.orderId }),
    fileKey: r.fileKey,
    filename: r.filename,
    transport:
      r.sourceKind === "local"
        ? "local"
        : r.url.startsWith("https:")
          ? "https"
          : "http",
    state: r.state,
    bytes: r.bytes,
    sha256: r.sha256 || null,
    integrity:
      r.state !== "available"
        ? "not_verified"
        : r.expectedSha256
          ? "expected_digest_matched"
          : "local_digest_only",
    updatedAtMs: r.updatedAtMs,
    error: r.error || null,
    ...(r.state === "available"
      ? { localPath: join(directory, id + ".bin") }
      : {}),
  });
  async function usage(doc) {
    let bytes = 0,
      inputBytes = 0,
      outputBytes = 0,
      otherBytes = 0,
      reservedBytes = 0;
    const sizes = new Map();
    for (const name of await readdir(directory)) {
      const st = await lstat(join(directory, name));
      if (!privateFile(st) || st.isSymbolicLink())
        throw fail(
          "FILE_CACHE_UNSAFE",
          "File cache contains an unsafe entry. Inspect it before continuing.",
        );
      if (
        name === "index.json" ||
        name === "owner.lock" ||
        name.startsWith(".index-")
      ) {
        otherBytes += st.size;
        continue;
      }
      bytes += st.size;
      sizes.set(name, st.size);
      const r = doc.files[name.slice(0, 64)];
      if (/^[a-f0-9]{64}\.(bin|part)$/.test(name) && r) {
        if (r.purpose === "input") inputBytes += st.size;
        else outputBytes += st.size;
      }
    }
    for (const [id, r] of Object.entries(doc.files))
      if (r.state === "downloading")
        reservedBytes += Math.max(
          0,
          (r.reservation ?? limits.singleBytes) -
            (sizes.get(id + ".part") || sizes.get(id + ".bin") || 0),
        );
    return {
      bytes,
      inputBytes,
      outputBytes,
      unknownBytes: bytes - inputBytes - outputBytes,
      metadataBytes: otherBytes,
      reservedBytes,
    };
  }
  async function verify(id, row, extension = ".bin") {
    const h = await open(
      join(directory, id + extension),
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    try {
      const s = await h.stat();
      if (!privateFile(s) || s.size !== row.bytes)
        throw Error("Invalid cache file");
      const hash = createHash("sha256");
      for await (const part of h.createReadStream({ autoClose: false }))
        hash.update(part);
      if (hash.digest("hex") !== row.sha256)
        throw Error("Invalid cache digest");
    } finally {
      await h.close();
    }
  }
  function rowFor(doc, id) {
    if (!hex.test(id || "") || !doc.files[id])
      throw fail("FILE_NOT_FOUND", "Use a full file ID from ./run cache list.");
    return doc.files[id];
  }
  async function deleteRow(doc, id) {
    const r = rowFor(doc, id);
    if (r.purpose === "input" && r.protected)
      throw fail(
        "FILE_PROTECTED",
        "This input is kept for request recovery and cannot be cleaned yet.",
      );
    if (r.state === "downloading")
      throw fail("FILE_BUSY", "Wait for this transfer before removing it.");
    r.state = "deleting";
    r.updatedAtMs = Date.now();
    await persist(doc);
    await discard(join(directory, id + ".bin"));
    await discard(join(directory, id + ".part"));
    await sync();
    r.state = "removed";
    r.updatedAtMs = Date.now();
    await persist(doc);
    return publicRow(id, r);
  }
  async function transfer(input, local = false) {
    const {
      orderId,
      requestId,
      fileKey,
      url,
      sourcePath,
      filename = "download",
      sha256 = null,
    } = input;
    const purpose = requestId !== undefined ? "input" : "output";
    if (
      (purpose === "input"
        ? !request.test(requestId || "")
        : !order.test(orderId || "")) ||
      (purpose === "input" && orderId !== undefined) ||
      (local && purpose !== "input") ||
      typeof fileKey !== "string" ||
      !/^[A-Za-z0-9._-]{1,80}$/.test(fileKey) ||
      (local
        ? typeof sourcePath !== "string" ||
          !isAbsolute(sourcePath) ||
          sourcePath.length > 8192
        : typeof url !== "string" || url.length > 8192) ||
      typeof filename !== "string" ||
      filename.length > 200 ||
      /[\x00-\x1f\x7f/\\]/.test(filename) ||
      (sha256 !== null && !hex.test(sha256))
    )
      throw fail(
        "FILE_INPUT_INVALID",
        "Supply the original scope, file key and explicit source.",
      );
    const identity =
      purpose === "input"
        ? { purpose, requestId, protected: true }
        : { purpose, orderId };
    const id = recordId({ ...identity, fileKey });
    let reused, previousDigest, source, sourceStat;
    const part = join(directory, id + ".part");
    let h,
      started = false;
    try {
      await exclusive(async () => {
        const doc = await load(),
          old = doc.files[id];
        previousDigest = old?.sha256;
        if (
          old &&
          (old.expectedSha256 !== sha256 ||
            old.sourceKind !== (local ? "local" : "url") ||
            (!local &&
              old.url !== url &&
              !(old.sha256 || old.expectedSha256)) ||
            (local && old.sourcePath !== sourcePath))
        )
          throw fail(
            "FILE_REFERENCE_CONFLICT",
            "Keep the original file identity and digest when retrying.",
          );
        if (old?.state === "downloading" || old?.state === "deleting")
          throw fail("FILE_BUSY", "This file is being changed. Retry shortly.");
        if (old?.state === "available") {
          try {
            await verify(id, old);
            reused = publicRow(id, old);
            return;
          } catch {
            old.state = "failed";
            old.error = "FILE_CACHE_CORRUPT";
            await persist(doc);
            throw fail(
              "FILE_CACHE_CORRUPT",
              "The saved copy changed or disappeared. Preserve the original request and inspect this file.",
            );
          }
        }
        if (old?.purpose === "input" && old.sha256)
          throw fail(
            "FILE_CACHE_CORRUPT",
            "Original input bytes are unavailable. Keep this request for recovery; do not substitute new input.",
          );
        const rows = Object.values(doc.files);
        if (
          rows.filter((r) => r.state === "downloading").length >=
          limits.concurrent
        )
          throw fail(
            "FILE_BUSY",
            "Other files are being saved. Retry shortly.",
          );
        if (
          (!old || old.state === "removed") &&
          rows.filter(
            (r) =>
              r.state !== "removed" &&
              r.purpose === purpose &&
              scope(r) === scope(identity),
          ).length >= limits.filesPerResult
        )
          throw fail(
            "FILE_COUNT_LIMIT",
            "The file limit for this request or Order was reached.",
          );
        if (!old && rows.length >= limits.records)
          throw fail(
            "FILE_HISTORY_LIMIT",
            "File history is full. Increase the record limit with ./run cache settings.",
          );
        let reservation = limits.singleBytes;
        if (local) {
          source = await open(
            sourcePath,
            constants.O_RDONLY |
              (constants.O_NOFOLLOW || 0) |
              (constants.O_NONBLOCK || 0),
          );
          sourceStat = await source.stat();
          if (!sourceStat.isFile())
            throw fail(
              "FILE_INPUT_INVALID",
              "Select a regular file, not a directory or device.",
            );
          if (sourceStat.size > limits.singleBytes)
            throw fail(
              "FILE_TOO_LARGE",
              "Input file exceeds the local size limit.",
            );
          reservation = sourceStat.size;
        }
        const used = await usage(doc);
        if (used.bytes + used.reservedBytes + reservation > limits.totalBytes)
          throw fail(
            "FILE_CACHE_FULL",
            "Cache is full. Run ./run cache to review space and limits.",
          );
        await discard(part);
        await discard(join(directory, id + ".bin"));
        doc.files[id] = {
          ...identity,
          fileKey,
          revision: randomUUID(),
          ...(local
            ? { sourceKind: "local", sourcePath }
            : { sourceKind: "url", url }),
          filename,
          expectedSha256: sha256,
          ...(previousDigest ? { sha256: previousDigest } : {}),
          state: "downloading",
          bytes: 0,
          reservation,
          updatedAtMs: Date.now(),
        };
        await persist(doc);
        started = true;
      });
      if (reused) return reused;
      h = await open(part, "wx", 0o600);
      const hash = createHash("sha256");
      let bytes = 0;
      const write = async (chunk) => {
        bytes += chunk.length;
        if (bytes > limits.singleBytes || (local && bytes > sourceStat.size))
          throw fail("FILE_TOO_LARGE", "File exceeds its reserved size.");
        hash.update(chunk);
        await h.writeFile(chunk);
      };
      if (local) {
        for await (const chunk of source.createReadStream({ autoClose: false }))
          await write(chunk);
        const after = await source.stat();
        if (
          after.size !== sourceStat.size ||
          after.mtimeMs !== sourceStat.mtimeMs ||
          after.ctimeMs !== sourceStat.ctimeMs ||
          bytes !== sourceStat.size
        )
          throw fail(
            "FILE_SOURCE_CHANGED",
            "The source changed while saving. Wait for it to finish before retrying.",
          );
      } else
        await download(url, {
          maxBytes: limits.singleBytes,
          timeoutMs: limits.timeoutMs,
          privateOrigins,
          write,
        });
      const actual = hash.digest("hex");
      if ((sha256 || previousDigest) && actual !== (sha256 || previousDigest))
        throw fail(
          "FILE_DIGEST_MISMATCH",
          "File contents do not match the original digest.",
        );
      await h.sync();
      await h.close();
      h = null;
      return await exclusive(async () => {
        const doc = await load(),
          r = doc.files[id];
        Object.assign(r, { bytes, sha256: actual, updatedAtMs: Date.now() });
        await persist(doc); // durable digest before publishing bytes: restart can reconcile.
        await rename(part, join(directory, id + ".bin"));
        await sync();
        r.state = "available";
        delete r.reservation;
        r.error = null;
        await persist(doc);
        return publicRow(id, r);
      });
    } catch (error) {
      await h?.close();
      h = null;
      if (started)
        await exclusive(async () => {
          const doc = await load(),
            r = doc.files[id];
          // Never discard a completed final file after an index write failure.
          try {
            if (r.sha256) {
              await verify(id, r);
              r.state = "available";
              r.error = null;
              delete r.reservation;
              await persist(doc);
              return;
            }
          } catch {}
          await discard(part);
          r.state = "failed";
          r.bytes = 0;
          delete r.reservation;
          r.error = error.code?.startsWith("FILE_")
            ? error.code
            : "FILE_STORAGE_FAILED";
          await persist(doc);
        }).catch(() => {});
      if (error.code?.startsWith("FILE_")) throw error;
      throw fail(
        "FILE_STORAGE_FAILED",
        "Could not save this file. Check disk space and permissions; no purchase was made.",
      );
    } finally {
      await source?.close();
    }
  }
  const api = {
    async list(orderId, { offset = 0, limit = 100 } = {}) {
      return (await api.listAll({ orderId, offset, limit })).items;
    },
    async listAll({
      purpose,
      state,
      orderId,
      requestId,
      offset = 0,
      limit = 100,
    } = {}) {
      if (
        (purpose !== undefined && !["input", "output"].includes(purpose)) ||
        (state !== undefined && !states.includes(state)) ||
        (orderId !== undefined && !order.test(orderId)) ||
        (requestId !== undefined && !request.test(requestId)) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw fail(
          "FILE_INPUT_INVALID",
          "Use valid filters and a page size from 1 to 100.",
        );
      return exclusive(async () => {
        const doc = await load(),
          rows = Object.entries(doc.files)
            .filter(
              ([, r]) =>
                (!purpose || r.purpose === purpose) &&
                (!state || r.state === state) &&
                (!orderId || r.orderId === orderId) &&
                (!requestId || r.requestId === requestId),
            )
            .sort(
              (a, b) =>
                b[1].updatedAtMs - a[1].updatedAtMs || a[0].localeCompare(b[0]),
            );
        return {
          total: rows.length,
          items: rows
            .slice(offset, offset + limit)
            .map(([id, r]) => publicRow(id, r)),
        };
      });
    },
    async summary() {
      return exclusive(async () => {
        const doc = await load(),
          used = await usage(doc);
        return {
          ...used,
          limits,
          records: Object.keys(doc.files).length,
          overLimit: used.bytes + used.reservedBytes > limits.totalBytes,
          directory,
        };
      });
    },
    async details(id) {
      return exclusive(async () => {
        const doc = await load();
        return publicRow(id, rowFor(doc, id));
      });
    },
    async verified(id) {
      return exclusive(async () => {
        const doc = await load(),
          r = rowFor(doc, id);
        if (r.state !== "available")
          throw fail(
            "FILE_NOT_AVAILABLE",
            "This file has no complete local copy.",
          );
        try {
          await verify(id, r);
        } catch {
          throw fail(
            "FILE_CACHE_CORRUPT",
            "The saved bytes could not be verified.",
          );
        }
        return publicRow(id, r);
      });
    },
    async remove({ orderId, fileKey, confirmed }) {
      if (
        !order.test(orderId || "") ||
        typeof fileKey !== "string" ||
        !/^[A-Za-z0-9._-]{1,80}$/.test(fileKey)
      )
        throw fail(
          "FILE_INPUT_INVALID",
          "Supply the original Order ID and file key.",
        );
      if (confirmed !== true)
        throw fail(
          "FILE_CONFIRM_REQUIRED",
          "Confirm removal of this local copy.",
        );
      return exclusive(async () =>
        deleteRow(await load(), recordId({ orderId, fileKey })),
      );
    },
    async cleanPreview() {
      return exclusive(async () => {
        const doc = await load();
        return Object.entries(doc.files)
          .filter(
            ([, r]) =>
              !r.protected && ["available", "failed"].includes(r.state),
          )
          .slice(0, 100)
          .map(([id, r]) => ({
            id,
            generation: generation(r),
            filename: r.filename,
            bytes: r.bytes,
          }));
      });
    },
    async clean({ items, confirmed }) {
      if (
        confirmed !== true ||
        !Array.isArray(items) ||
        items.length > 100 ||
        items.some(
          (i) => !i || !hex.test(i.id || "") || !hex.test(i.generation || ""),
        ) ||
        new Set(items.map((i) => i.id)).size !== items.length
      )
        throw fail(
          "FILE_CONFIRM_REQUIRED",
          "Confirm the exact preview before cleanup.",
        );
      return exclusive(async () => {
        const doc = await load();
        for (const i of items) {
          const r = rowFor(doc, i.id);
          if (
            r.protected ||
            !["available", "failed"].includes(r.state) ||
            generation(r) !== i.generation
          )
            throw fail(
              "FILE_PREVIEW_CHANGED",
              "Files changed since preview. Review cleanup again.",
            );
        }
        for (const i of items) await deleteRow(doc, i.id);
        return { removed: items.length };
      });
    },
    // Internal only: caller must first verify this request's durable delivery.
    async releaseInputs(requestId) {
      if (!request.test(requestId || ""))
        throw fail("FILE_INPUT_INVALID", "Invalid original request ID.");
      return exclusive(async () => {
        const doc = await load();
        let changed = 0;
        for (const r of Object.values(doc.files))
          if (
            r.purpose === "input" &&
            r.requestId === requestId &&
            r.protected
          ) {
            if (r.state === "downloading")
              throw fail(
                "FILE_BUSY",
                "Input saving is still running. Retry release later.",
              );
            r.protected = false;
            r.updatedAtMs = Date.now();
            changed++;
          }
        if (changed) await persist(doc);
        return { released: changed };
      });
    },
    async settings(overrides) {
      return exclusive(async () => {
        await load();
        if (overrides === undefined) return limits;
        if (
          !overrides ||
          typeof overrides !== "object" ||
          Array.isArray(overrides)
        )
          throw fail("FILE_INPUT_INVALID", "Supply a settings object.");
        const next = validateCacheLimits({ ...limits, ...overrides });
        await atomic(statePath + ".file-cache-settings.json", next);
        limits = next;
        return limits;
      });
    },
    cache: (input) => transfer(input),
    importInput: (input) => transfer(input, true),
  };
  return api;
}
