// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { open, unlink, realpath } from "node:fs/promises";
import { join, resolve, dirname, sep, extname } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { resolveUserDataDir } from "./local-data-directory.mjs";
import { loadRuntimeConnection, cacheManagement } from "./runtime-client.mjs";
import { createFileCache } from "./file-cache.mjs";
import { readCacheLimits } from "./file-cache-settings.mjs";
import { manageCache } from "./cache-management.mjs";
import { withResultCacheView } from "./result-cache-view.mjs";
const safe = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
const size = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1048576).toFixed(1)} MiB`;
const contentSize = (row) => {
  if (row.kind === "result")
    return `Text (JSON) · content ${Number.isSafeInteger(row.contentBytes) ? size(row.contentBytes) : "unknown"} · cached ${size(row.storageBytes ?? row.bytes)}`;
  const extension = extname(row.filename || "")
    .slice(1)
    .toUpperCase();
  const type = /^[A-Z0-9]{1,12}$/.test(extension)
    ? `File (.${extension.toLowerCase()})`
    : "File";
  return `${type} · ${row.purpose === "input" ? "input" : "output"} · cached ${size(row.bytes)}`;
};
const prompt = async (message) => {
  const r = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await r.question(message + "\n> ");
  } finally {
    r.close();
  }
};
export async function exportCacheFile(row, target) {
  const destination = resolve(target),
    parent = await realpath(dirname(destination)),
    cacheDir = await realpath(dirname(row.localPath));
  if (parent === cacheDir || parent.startsWith(cacheDir + sep))
    throw Error("Choose an export location outside the managed cache.");
  let input,
    output,
    created = false;
  try {
    input = await open(
      row.localPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    const st = await input.stat();
    if (
      !st.isFile() ||
      st.nlink !== 1 ||
      st.size !== row.bytes ||
      (typeof process.getuid === "function" &&
        (st.uid !== process.getuid() || st.mode & 0o077))
    )
      throw Error("Saved file is unavailable or changed.");
    output = await open(destination, "wx", 0o600);
    created = true;
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > row.bytes) throw Error("Saved file changed during export.");
      hash.update(chunk);
      await output.writeFile(chunk);
    }
    if (bytes !== row.bytes || hash.digest("hex") !== row.sha256)
      throw Error("Saved file failed verification.");
    await output.sync();
    await output.close();
    output = null;
    const h = await open(parent, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
    return destination;
  } catch (e) {
    await output?.close();
    output = null;
    if (created) await unlink(destination).catch(() => {});
    if (e.code === "EEXIST")
      throw Error("Export destination already exists. Choose a new filename.");
    throw e;
  } finally {
    await input?.close();
    await output?.close();
  }
}
export async function runCacheManagement(
  args,
  { write = console.log, ask = prompt, operate, dataDir } = {},
) {
  const values = [...args],
    offline = values.includes("--offline");
  if (offline) values.splice(values.indexOf("--offline"), 1);
  const [action = "summary", ...rest] = values;
  const filters = {};
  let invalidFilter = false;
  if (action === "list")
    for (let i = 0; i < rest.length; ) {
      const fields = {
        "--state": "state",
        "--request": "requestId",
        "--order": "orderId",
      };
      if (Object.hasOwn(fields, rest[i])) {
        const key = fields[rest[i]];
        if (
          filters[key] !== undefined ||
          !rest[i + 1] ||
          rest[i + 1].startsWith("--")
        ) {
          invalidFilter = true;
          break;
        }
        filters[key] = rest[i + 1];
        rest.splice(i, 2);
      } else i++;
    }
  const usage =
    "Usage: agentpay cache [info | list [PAGE] [input|output] [--state STATE] [--request ID | --order ID] | details ID | export ID PATH | clean | settings [KEY VALUE]]\nAdd --offline only when managing stopped Runtime storage. Wallet unlock is not required.";
  if (
    invalidFilter ||
    !["summary", "list", "details", "export", "clean", "settings"].includes(
      action,
    ) ||
    (["summary", "clean"].includes(action) && rest.length) ||
    (action === "details" && rest.length !== 1) ||
    (action === "export" && rest.length !== 2) ||
    (action === "settings" && ![0, 2].includes(rest.length)) ||
    (action === "list" &&
      (rest.length > 2 ||
        (rest[0] !== undefined && !/^[1-9][0-9]{0,5}$/.test(rest[0])) ||
        (rest[1] !== undefined && !["input", "output"].includes(rest[1]))))
  ) {
    write(usage);
    return 2;
  }
  try {
    if (!operate) {
      dataDir ??= await resolveUserDataDir();
      if (offline) {
        const state = join(dataDir, "runtime/invocations.json"),
          cache = createFileCache(state, {
            limits: await readCacheLimits(state),
          });
        operate = (body) => manageCache(cache, body);
      } else {
        const connection = await loadRuntimeConnection({ dataDir });
        operate = (body) => cacheManagement(connection, body);
      }
    }
    if (dataDir)
      operate = withResultCacheView(
        operate,
        dataDir,
        process.env.AGENTPAY_USER_STATE_FILE
          ? { statePath: resolve(process.env.AGENTPAY_USER_STATE_FILE) }
          : {},
      );
    write(
      "\n------------------------------------------------------------\n> Local cache\n------------------------------------------------------------",
    );
    if (action === "summary") {
      const r = await operate({ action });
      write(
        `\n> Saved locally\n  Text  ${r.resultRecords || 0} · ${size(r.resultBytes || 0)}\n  Files         ${r.records} · ${size(r.bytes)}\n\n> Attachment storage\n  ${size(r.bytes)} / ${size(r.limits.totalBytes)}${r.overLimit ? " · LIMIT EXCEEDED" : ""}`,
      );
      if (r.reservedBytes)
        write(`  Transfers in progress: ${size(r.reservedBytes)}`);
      if (r.unknownBytes)
        write(
          `[!] ${size(r.unknownBytes)} needs inspection; cleanup will keep it.`,
        );
      write("\n> Next\n  agentpay cache list");
    } else if (action === "list") {
      const page = Number(rest[0] || 1),
        r = await operate({
          action: "list",
          offset: (page - 1) * 20,
          limit: 20,
          ...filters,
          ...(rest[1] ? { purpose: rest[1] } : {}),
        });
      write(
        `\n${r.total} entries · page ${page}\nDetails: agentpay cache details <Cache ID>`,
      );
      if (!r.items.length)
        write("No saved results or attachments match this view.");
      for (const [index, row] of r.items.entries()) {
        const label = safe(
          row.skillName ||
            row.providerId ||
            (row.skillId ? "Service " + row.skillId : "Source not recorded"),
        );
        const identity = row.orderId || row.requestId || "";
        write(
          `\n────────────────────────────────────────────────────────────\n${(page - 1) * 20 + index + 1}. ${label}\n   ${contentSize(row)}\n   ${new Date(row.updatedAtMs).toLocaleString()}${row.kind === "result" ? "" : " · " + safe(row.state)}${row.kind === "result" ? "" : "\n   " + safe(row.filename)}\n   ${row.orderId ? "Order" : "Request"}: ${safe(identity)}\n   Cache ID: ${row.id}`,
        );
      }
      if (page * 20 < r.total)
        write(
          `\nNext page: agentpay cache list ${page + 1}${rest[1] ? " " + rest[1] : ""}${Object.entries(
            filters,
          )
            .map(
              ([k, v]) =>
                " --" +
                { state: "state", requestId: "request", orderId: "order" }[k] +
                " " +
                v,
            )
            .join("")}`,
        );
    } else if (action === "details") {
      const r = await operate({ action, id: rest[0] });
      write(
        `${safe(r.filename)}\n  ${contentSize(r)} · ${r.state}\n  ${r.requestId ? "Request" : "Order"}: ${safe(r.requestId || r.orderId)}\n  File key: ${safe(r.fileKey)}\n  SHA-256: ${r.sha256 || "Not available"}\n  Updated: ${new Date(r.updatedAtMs).toLocaleString()}`,
      );
      if (r.protected)
        write(
          r.kind === "result"
            ? "Saved result retained for recovery. Cleanup will not remove it."
            : "Kept for original-request recovery. Cleanup will not remove this input.",
        );
      if (r.error) write("Issue: " + safe(r.error));
      if (r.state === "available")
        write(
          `Export a copy: agentpay cache export ${r.id} /your/destination/filename`,
        );
    } else if (action === "export") {
      const row = await operate({ action: "verified", id: rest[0] });
      write("Exported: " + safe(await exportCacheFile(row, rest[1])));
    } else if (action === "settings") {
      if (rest.length && !/^[0-9]+$/.test(rest[1]))
        throw Error("Use a positive integer value. Byte limits are in bytes.");
      const r = await operate({
        action,
        ...(rest.length ? { overrides: { [rest[0]]: Number(rest[1]) } } : {}),
      });
      for (const [k, v] of Object.entries(r))
        write(
          `  ${k}: ${k.endsWith("Bytes") ? size(v) + " (" + v + " bytes)" : v}`,
        );
      write(
        rest.length
          ? "Limits saved and applied. Existing copies are kept."
          : "Change a limit: agentpay cache settings totalBytes 1073741824\nfilesPerResult applies per input request or output Order.",
      );
    } else if (action === "clean") {
      const items = await operate({ action: "preview" });
      if (!items.length) {
        write(
          "No eligible file copies to clean. Protected inputs and history are kept.",
        );
        return 0;
      }
      write(
        `${items.length} file copies · ${size(items.reduce((n, r) => n + r.bytes, 0))}\n` +
          items
            .map((r) => "  " + safe(r.filename) + " · " + size(r.bytes))
            .join("\n"),
      );
      if (
        (
          await ask(
            "These local copies will be deleted. Original download links may no longer work.\nPayments, Order history and protected inputs are unchanged.\nType confirm to clean, or q to return.",
          )
        ).trim() !== "confirm"
      ) {
        write("Cleanup cancelled.");
        return 0;
      }
      const r = await operate({
        action: "clean",
        items: items.map(({ id, generation }) => ({ id, generation })),
        confirmed: true,
      });
      write(
        `${r.removed} local copies removed. History kept. Run clean again to review any remaining copies.`,
      );
    }
    return 0;
  } catch (error) {
    write("Cache operation stopped: " + safe(error.message));
    write(
      offline
        ? "If another Runtime owns this cache, use the command without --offline. Do not delete its lock file."
        : "Check agentpay status. When Runtime is stopped, add --offline. No automatic offline fallback or payment was made.",
    );
    return 1;
  }
}
