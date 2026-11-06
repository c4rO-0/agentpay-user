// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { open, opendir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const b32 = /^0x[0-9a-f]{64}$/;
// A display-only view. No Skill package selection, execution or payment is involved.
// Both durable result stores stay unchanged and excluded from attachment cleanup.
export function withResultCacheView(
  operate,
  dataDir,
  { statePath = join(dataDir, "runtime", "invocations.json") } = {},
) {
  const clientDirectory = join(dataDir, "runtime", "client-requests");
  async function privateJson(path, max = 2 * 1048576) {
    let h;
    try {
      h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await h.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > max ||
        (typeof process.getuid === "function" &&
          (stat.uid !== process.getuid() || stat.mode & 0o077))
      )
        throw Error("Saved cache metadata needs inspection.");
      const bytes = await h.readFile();
      if (bytes.length > max) throw Error("Saved cache metadata is too large.");
      return { value: JSON.parse(bytes.toString("utf8")), stat, bytes };
    } finally {
      await h?.close();
    }
  }
  async function scan(directory, pattern, read) {
    let st;
    try {
      st = await lstat(directory);
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
    if (
      !st.isDirectory() ||
      st.isSymbolicLink() ||
      (typeof process.getuid === "function" &&
        (st.uid !== process.getuid() || st.mode & 0o077))
    )
      throw Error("Saved cache directory needs inspection.");
    const rows = [];
    for await (const entry of await opendir(directory))
      if (pattern.test(entry.name))
        rows.push(await read(join(directory, entry.name), entry.name));
    return rows;
  }
  const source = (reference) =>
    typeof reference?.profile?.providerId === "string"
      ? reference.profile.providerId
      : undefined;
  function row(file, result, id, requestId, providerId) {
    if (!b32.test(result?.orderId || "") || result.output === undefined)
      throw Error("Saved result needs inspection.");
    return {
      id,
      kind: "result",
      purpose: "output",
      state: "available",
      filename: "Result.json",
      fileKey: "structured-result",
      contentDigest: hash(JSON.stringify(result.output)),
      contentBytes: Buffer.byteLength(JSON.stringify(result.output)),
      bytes: file.bytes.length,
      sha256: hash(file.bytes),
      localPath: file.path,
      requestId,
      orderId: result.orderId,
      providerId,
      skillId: result.service?.skillId,
      profileHash: result.service?.profileHash,
      requestHash: result.requestHash,
      outputHash: result.outputHash,
      updatedAtMs: file.stat.mtimeMs,
      protected: true,
    };
  }
  async function inventory() {
    const clients = await scan(
      clientDirectory,
      /^[0-9a-f]{64}\.result\.json$/,
      async (path, name) => {
        const file = await privateJson(path),
          v = file.value;
        if (
          v.version !== "agentpay.runtime-client-result.v1" ||
          typeof v.requestId !== "string" ||
          hash(v.requestId) + ".result.json" !== name ||
          v.body?.ok !== true
        )
          throw Error("Saved result needs inspection.");
        let reference;
        try {
          const c = (
            await privateJson(path.replace(/\.result\.json$/, ".json"))
          ).value;
          if (
            c.version === "agentpay.runtime-client-request.v1" &&
            c.requestId === v.requestId
          )
            reference = c.service;
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        return row(
          { ...file, path },
          v.body.result,
          "result:" + name.slice(0, 64),
          v.requestId,
          source(reference),
        );
      },
    );
    const runtime = await scan(
      statePath + ".results",
      /^0x[0-9a-f]{64}\.json$/,
      async (path, name) => {
        const file = await privateJson(path),
          v = file.value;
        if (
          v.version !== "agentpay.invocation-result.v1" ||
          v.invocationId + ".json" !== name
        )
          throw Error("Saved Runtime result needs inspection.");
        let reference;
        try {
          reference = JSON.parse(v.serviceBinding).reference;
        } catch {}
        return row(
          { ...file, path },
          v.result,
          "runtime-result:" + v.invocationId,
          undefined,
          source(reference),
        );
      },
    );
    const all = [...clients, ...runtime],
      logical = new Map();
    for (const r of all) {
      // Merge only proven identical output for the same Order/service/request. Missing
      // legacy identity stays separate rather than guessing that two records match.
      const key = [
        r.orderId,
        r.skillId,
        r.profileHash,
        r.requestHash,
        r.outputHash,
      ].every(Boolean)
        ? JSON.stringify([
            r.orderId,
            r.skillId,
            r.profileHash,
            r.requestHash,
            r.outputHash,
            r.contentDigest,
          ])
        : r.id;
      const previous = logical.get(key);
      if (previous) {
        previous.storageBytes += r.bytes;
        previous.copyIds.push(r.id);
        previous.providerId ??= r.providerId;
        previous.requestIds.push(...(r.requestId ? [r.requestId] : []));
      } else
        logical.set(key, {
          ...r,
          storageBytes: r.bytes,
          copyIds: [r.id],
          requestIds: r.requestId ? [r.requestId] : [],
        });
    }
    return {
      all,
      rows: [...logical.values()],
      bytes: all.reduce((n, r) => n + r.bytes, 0),
    };
  }
  return async (body) => {
    if (
      ["details", "verified"].includes(body.action) &&
      /^(?:result|runtime-result):/.test(String(body.id))
    ) {
      if (
        !/^(?:result:[0-9a-f]{64}|runtime-result:0x[0-9a-f]{64})$/.test(body.id)
      )
        throw Error("Invalid cache ID.");
      const inv = await inventory(),
        found = inv.all.find((r) => r.id === body.id);
      if (!found) throw Error("Cached result not found.");
      return {
        ...found,
        storageBytes: inv.rows.find((r) => r.copyIds.includes(body.id))
          ?.storageBytes,
      };
    }
    if (body.action === "summary") {
      const base = await operate(body),
        results = await inventory();
      return {
        ...base,
        resultRecords: results.rows.length,
        resultBytes: results.bytes,
      };
    }
    if (body.action === "list") {
      const { offset = 0, limit = 100 } = body;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw Error("Invalid cache page.");
      const first = await operate({
          ...body,
          offset: 0,
          limit: Math.min(100, offset + limit),
        }),
        items = [...first.items];
      // Only the first offset+limit attachments can occur in the merged page.
      for (
        let at = items.length;
        at < Math.min(first.total, offset + limit);

      ) {
        const page = await operate({
          ...body,
          offset: at,
          limit: Math.min(100, offset + limit - at),
        });
        if (!page.items.length) break;
        items.push(...page.items);
        at += page.items.length;
      }
      const results = await inventory();
      for (const r of items) {
        const matching = results.rows.find(
          (v) =>
            (r.orderId && v.orderId === r.orderId) ||
            (r.requestId && v.requestIds.includes(r.requestId)),
        );
        r.providerId = matching?.providerId;
      }
      const text = results.rows.filter(
        (r) =>
          (!body.purpose || body.purpose === r.purpose) &&
          (!body.state || body.state === r.state) &&
          (!body.requestId || r.requestIds.includes(body.requestId)) &&
          (!body.orderId || body.orderId === r.orderId),
      );
      items.push(...text);
      items.sort(
        (a, b) => b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id),
      );
      return {
        total: first.total + text.length,
        items: items.slice(offset, offset + limit),
      };
    }
    return operate(body);
  };
}
