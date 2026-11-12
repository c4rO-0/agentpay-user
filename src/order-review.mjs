// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { open, lstat, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
export const recordFingerprint = (entry) =>
  createHash("sha256").update(JSON.stringify(entry)).digest("hex");
export const observationKey = (o) =>
  JSON.stringify([
    o?.source || null,
    o?.errorCode || null,
    o?.financialState || null,
    o?.vaultState || null,
    o?.resultState || null,
  ]);
const bad = () =>
  Object.assign(
    Error(
      "Local review notes could not be verified. Keep the files for support.",
    ),
    { code: "LOCAL_REVIEW_INVALID" },
  );
export async function readPrivateJson(file, max = 4 * 1048576) {
  let h;
  try {
    h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = await h.stat();
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      s.mode & 0o077 ||
      s.size > max
    )
      throw bad();
    return JSON.parse(await h.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw bad();
  } finally {
    await h?.close();
  }
}
export function localOrderReviews(statePath) {
  const file = statePath + ".reviews.json";
  async function load() {
    const d = await readPrivateJson(file);
    if (!d) return { version: 1, records: {} };
    if (
      d.version !== 1 ||
      !d.records ||
      typeof d.records !== "object" ||
      Array.isArray(d.records) ||
      Object.keys(d.records).length > 10000
    )
      throw bad();
    for (const [id, r] of Object.entries(d.records))
      if (
        !/^0x[0-9a-f]{64}$/.test(id) ||
        !r ||
        !Array.isArray(r.events) ||
        !r.events.length ||
        r.events.length > 1000 ||
        r.events.some(
          (e) =>
            !["archive", "unarchive"].includes(e.action) ||
            !Number.isSafeInteger(e.atMs) ||
            e.atMs < 0 ||
            typeof e.note !== "string" ||
            e.note.length > 500 ||
            /[\u0000-\u001f\u007f]/.test(e.note),
        ) ||
        typeof r.archived !== "boolean" ||
        !/^[a-f0-9]{64}$/.test(r.fingerprint) ||
        typeof r.observation !== "string"
      )
        throw bad();
    return d;
  }
  return {
    file,
    load,
    async change(entry, observation, { archive, note = "" }) {
      if (
        typeof archive !== "boolean" ||
        !/^0x[0-9a-f]{64}$/.test(entry.invocationId) ||
        typeof note !== "string" ||
        note.length > 500 ||
        /[\u0000-\u001f\u007f]/.test(note)
      )
        throw bad();
      const parent = await lstat(dirname(file));
      if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        parent.uid !== process.getuid() ||
        parent.mode & 0o077
      )
        throw bad();
      let lock, h;
      const temp = file + "." + randomUUID() + ".tmp";
      try {
        lock = await open(file + ".lock", "wx", 0o600);
        const d = await load(),
          events = d.records[entry.invocationId]?.events || [];
        if (events.length >= 1000) throw bad();
        d.records[entry.invocationId] = {
          archived: archive,
          fingerprint: recordFingerprint(entry),
          observation: observationKey(observation),
          events: [
            ...events,
            {
              action: archive ? "archive" : "unarchive",
              atMs: Date.now(),
              note,
            },
          ],
        };
        const content = JSON.stringify(d);
        if (Buffer.byteLength(content) > 4 * 1048576) throw bad();
        h = await open(temp, "wx", 0o600);
        await h.writeFile(content + "\n");
        await h.sync();
        await h.close();
        h = null;
        await rename(temp, file);
        const dir = await open(dirname(file), "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      } catch (e) {
        if (e.code === "EEXIST")
          throw Error(
            "A local review update is running or was interrupted. If no review command is running, contact support to check the review lock; keep your Order history.",
          );
        throw e;
      } finally {
        await h?.close();
        await unlink(temp).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
        if (lock) {
          await lock.close();
          await unlink(file + ".lock");
        }
      }
    },
  };
}
export function reviewApplies(review, entry, observation) {
  return (
    review?.archived === true &&
    review.fingerprint === recordFingerprint(entry) &&
    review.observation === observationKey(observation)
  );
}
export async function assertNotArchived(statePath, entry) {
  if (
    (await localOrderReviews(statePath).load()).records[entry.invocationId]
      ?.archived
  )
    throw Object.assign(
      Error(
        "This request is archived locally. Review it with agentpay orders details " +
          entry.invocationId +
          "; unarchive it before continuing the original request.",
      ),
      { code: "LOCAL_ORDER_ARCHIVED", status: 409 },
    );
}
export function findLocalOrder(inventory, selector) {
  if (!/^0x[0-9a-f]{10,64}$/i.test(selector || ""))
    throw Error("Use an Order or request ID from agentpay orders list.");
  const key = selector.toLowerCase(),
    matches = Object.values(inventory).filter(
      (v) => v.invocationId.startsWith(key) || v.orderId?.startsWith(key),
    );
  if (matches.length !== 1)
    throw Error(
      matches.length
        ? "That shortened ID matches multiple records. Use the full ID from agentpay orders list."
        : "No matching local record. Run agentpay orders list.",
    );
  return matches[0];
}
export function localReviewDetails(
  entry,
  observation,
  review,
  { selector = entry.invocationId, color = false, columns = 80 } = {},
) {
  const width = Math.max(
    48,
    Math.min(72, Number.isFinite(columns) ? Math.floor(columns) : 80),
  );
  const paint = (s, style) => (color ? `\x1b[${style}m${s}\x1b[0m` : s);
  const lines = [],
    rule = "─".repeat(width);
  const text = (value, style = null) => {
    let line = "  ";
    for (const word of String(value).split(/\s+/)) {
      if (line.trim() && line.length + 1 + word.length > width) {
        lines.push(style ? paint(line, style) : line);
        line = "  ";
      }
      line += (line.trim() ? " " : "") + word;
    }
    lines.push(style ? paint(line, style) : line);
  };
  const section = (title) => lines.push("", paint("> " + title, "1"));
  const date = (ms) =>
    Number.isSafeInteger(ms) ? new Date(ms).toLocaleString() : "Not recorded";
  const o =
    observation?.fingerprint === recordFingerprint(entry) ? observation : null;
  const summary = localOrderSummary(entry, observation, review);
  const scope = entry.recoveryScope,
    c = entry.paymentPayload?.payload?.commitment;
  const safe = (v) =>
    typeof v === "string" && /^0x[0-9a-f]{40,64}$/i.test(v)
      ? v
      : "Not recorded";
  const unknownOriginal = o?.errorCode === "ORIGINAL_POLICY_UNKNOWN";
  const unavailable = o?.errorCode === "RECOVERY_POLICY_UNAVAILABLE";
  lines.push(
    "",
    paint(rule, "2"),
    paint("> Order details", "1"),
    paint(rule, "2"),
  );
  const title = unknownOriginal
    ? "Cannot confirm whether an Order was created"
    : summary.state;
  text(
    `[${summary.marker}] ${title}`,
    summary.marker === "OK"
      ? "1;32"
      : summary.marker === "ARCHIVED"
        ? "2"
        : "1;33",
  );
  if (unknownOriginal)
    text(
      "This computer saved the request, but not its Order ID or original spending authorization (Policy). Automatic checks cannot resolve it.",
    );
  else if (unavailable)
    text(
      "Wallet cannot use the original spending authorization to check this Order. It may have been revoked or require another key.",
    );
  else if (summary.warning) text(summary.warning);
  text("Last saved check: " + date(o?.checkedAtMs), "2");
  section("What to do");
  if (
    unknownOriginal ||
    unavailable ||
    (o?.errorCode && !["ORDER_CHECK_UNAVAILABLE", "CHAIN_RPC_UNAVAILABLE"].includes(o.errorCode))
  ) {
    text(
      "Check the original Agent conversation and payment history. If still unclear, contact AgentPay support with the reference IDs below.",
    );
    text("Do not create another purchase to resolve this record.");
  } else if (o?.errorCode === "CHAIN_RPC_UNAVAILABLE")
    text("Restore the chain RPC connection and any SSH tunnel. Keep Wallet unlocked; Runtime retries automatically. Do not pay again.");
  else if (o?.errorCode === "ORDER_CHECK_UNAVAILABLE")
    text(
      "Runtime retries automatically. Keep Wallet unlocked and check your network if this continues.",
    );
  else if (o?.vaultState === "Released" && o.resultState !== "verified") {
    text(
      "Check your original Agent conversation or ask the Provider for the original result. Do not pay again.",
    );
    text(`agentpay orders retrieve ${selector}`, "36");
  } else if (o?.financialState === "terminal")
    text("No further payment is needed for this record.");
  else text("Refresh the saved status through Wallet:");
  if (!unknownOriginal && !unavailable && o?.financialState !== "terminal")
    text(`agentpay orders status ${selector}`, "36");
  if (review?.archived) {
    text(
      summary.changed
        ? "This record changed after archiving. Review it again."
        : "Archived locally. The original record is kept.",
    );
    text("Restore the reminder:");
    text(`agentpay orders unarchive ${selector}`, "36");
  } else {
    text("After reviewing, add a note and archive this reminder:");
    text(`agentpay orders archive ${selector}`, "36");
    text(
      "Archiving keeps the record. It does not resolve or cancel the Order.",
      "2",
    );
  }
  section("Saved on this computer");
  text("Created: " + date(entry.createdAtMs));
  text("Order ID: " + (entry.orderId ? "Saved (see below)" : "Not saved"));
  text(
    "Original authorization: " +
      (safe(scope?.policyId || c?.policyId) === "Not recorded"
        ? "Not saved"
        : "Saved (see below)"),
  );
  text(
    "Payment submission: " +
      (entry.paymentSubmitted ? "Recorded locally" : "No local record"),
  );
  text(
    "Payment request: " +
      (entry.paymentPayload ? "Saved locally" : "Not saved"),
  );
  text("Missing local records do not prove that no payment occurred.", "2");
  if (review?.events?.length) {
    section("Your review notes");
    for (const e of review.events.slice(-5)) {
      text(
        `${date(e.atMs)} · ${e.action === "archive" ? "Archived" : "Unarchived"}`,
        "2",
      );
      if (e.note) text(e.note);
    }
  }
  section("Reference IDs");
  text(
    "Use these when contacting support. Never share keys or signed payment data.",
    "2",
  );
  const field = (label, value) => {
    text(label, "2");
    lines.push("  " + value);
  };
  if (entry.orderId) field("Order", entry.orderId);
  field("Local request", entry.invocationId);
  field("Order lookup reference", entry.orderRequestId);
  if (safe(scope?.policyId || c?.policyId) !== "Not recorded")
    field("Original Policy", safe(scope?.policyId || c?.policyId));
  if (safe(scope?.safe || c?.safe) !== "Not recorded")
    field("Safe account", safe(scope?.safe || c?.safe));
  lines.push("", paint(rule, "2"));
  text("Local details only · no live check or payment.", "2");
  lines.push("");
  return lines.join("\n");
}

export function localOrderSummary(entry, observation, review) {
  const o =
    observation?.fingerprint === recordFingerprint(entry) ? observation : null;
  const code =
    o?.errorCode ||
    (o?.resultState === "invalid"
      ? "RECOVERY_RESULT_INVALID"
      : o?.resultState === "legacy_unverified"
        ? "LEGACY_RESULT_UNVERIFIED"
        : o?.resultState === "pending"
          ? "RESULT_EVIDENCE_PENDING"
          : null) ||
    (o?.vaultState === "Released" && o.resultState !== "verified"
      ? "SETTLED_RESULT_UNAVAILABLE"
      : null);
  const reasons = {
    CHAIN_RPC_UNAVAILABLE:
      "Cannot connect to the chain RPC. Check your network and any SSH tunnel. Runtime retries automatically; keep the original request.",
    RECOVERY_POLICY_UNAVAILABLE:
      "Original Policy cannot authorize this check (it may be revoked or belong to another key).",
    ORIGINAL_POLICY_UNKNOWN:
      "Original Policy was not saved. No Order was found under the current Policy; payment remains unconfirmed.",
    ORDER_REQUEST_NOT_FOUND:
      "No Order found for the saved request and Policy. This does not prove non-payment.",
    RECOVERY_SCOPE_INVALID:
      "Original authorization does not match this Wallet deployment.",
    ORDER_NOT_FOUND:
      "Order not found under this Wallet authorization or deployment.",
    ORDER_ID_UNRESOLVED:
      "No Order ID was saved. Keep the original request; do not start a replacement purchase.",
    ORDER_IDENTITY_MISMATCH:
      "Returned identity does not match the original request.",
    ORDER_STATE_CONFLICT:
      "The latest response conflicts with a previously confirmed state.",
    RESULT_STORAGE_UNAVAILABLE:
      "The saved result could not be promoted on disk. Check free space and local file access; the pending copy is retained.",
    RECOVERY_RESULT_INVALID:
      "A local result exists but failed validation. Keep the files for review.",
    LEGACY_RESULT_UNVERIFIED:
      "An older local result exists, but its format cannot be verified automatically.",
    RESULT_EVIDENCE_PENDING:
      "The result is saved locally. Runtime is waiting for matching Settlement delivery evidence.",
    SETTLEMENT_RESPONSE_INVALID:
      "The Order status response could not be verified.",
    ORDER_CHECK_UNAVAILABLE:
      "Check temporarily unavailable. Runtime retries automatically; check your network and logs if it persists.",
    SETTLED_RESULT_UNAVAILABLE:
      "Paid out, but no verified result is saved locally. Check the original conversation or retrieve the original result; do not pay again.",
  };
  const state = !o
    ? "Not checked"
    : o.expiredUnpaid
      ? "Expired · unpaid"
      : { Released: "Paid out", Refunded: "Refunded", Cancelled: "Cancelled" }[
          o.vaultState
        ] ||
        (o.financialState === "pending"
          ? "In progress"
          : o.financialState === "closing"
            ? "Finalizing"
            : "Not confirmed");
  const archived = reviewApplies(review, entry, observation);
  return {
    state,
    localResultUnavailable:
      o?.vaultState === "Released" && o.resultState === "missing",
    checkedAtMs: o?.checkedAtMs,
    marker: archived
      ? "ARCHIVED"
      : code
        ? "WAIT"
        : !o || o.financialState !== "terminal"
          ? "WAIT"
          : "OK",
    warning: code
      ? reasons[code] || "Automatic verification needs review. Open details."
      : !o
        ? "No current check is saved. Open details or refresh with the status action."
        : null,
    changed: review?.archived && !archived,
  };
}
