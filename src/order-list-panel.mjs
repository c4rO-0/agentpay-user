// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { localOrderSummary } from "./order-review.mjs";

// Rendering only: saved observations are not fresh financial verification.
export function renderOrderList(
  entries,
  observations,
  notes,
  { color = false, columns = 80 } = {},
) {
  const width = Math.max(
    48,
    Math.min(72, Number.isFinite(columns) ? Math.floor(columns) : 80),
  );
  const paint = (text, style) =>
    color ? `\x1b[${style}m${text}\x1b[0m` : text;
  const lines = [],
    rule = "─".repeat(width);
  function text(value, { indent = "  ", style = null } = {}) {
    let line = indent;
    for (const word of value.split(/\s+/)) {
      if (line.trim() && line.length + 1 + word.length > width) {
        lines.push(style ? paint(line, style) : line);
        line = indent;
      }
      line += (line.trim() ? " " : "") + word;
    }
    lines.push(style ? paint(line, style) : line);
  }
  lines.push(
    "",
    paint(rule, "2"),
    paint("> Local Orders", "1"),
    paint(rule, "2"),
  );
  text(`${entries.length} saved · latest first`, { style: "2" });
  if (!entries.length) text("No saved Orders or requests.");
  entries.forEach((e, index) => {
    const summary = localOrderSummary(
      e,
      observations[e.invocationId],
      notes[e.invocationId],
    );
    const id = e.orderId || e.invocationId;
    let length = 12;
    while (
      length < 66 &&
      entries.filter(
        (v) =>
          v.invocationId.startsWith(id.slice(0, length)) ||
          v.orderId?.startsWith(id.slice(0, length)),
      ).length > 1
    )
      length++;
    const selector = id.slice(0, length);
    const style =
      summary.marker === "ARCHIVED"
        ? "2"
        : summary.marker === "OK"
          ? "1;32"
          : "1;33";
    lines.push("", paint(rule, "2"));
    text(
      `${index + 1}. [${summary.marker}] ${summary.state}${summary.localResultUnavailable ? " · Local result unavailable" : ""}`,
      { style },
    );
    const date = Number.isSafeInteger(e.createdAtMs)
      ? new Date(e.createdAtMs).toLocaleString()
      : "Date not recorded";
    text(date, { style: "2" });
    if (Number.isSafeInteger(summary.checkedAtMs))
      text("Last check: " + new Date(summary.checkedAtMs).toLocaleString(), {
        style: "2",
      });
    text(
      `${e.orderId ? "Order" : "Request"}  ${id.slice(0, 12)}…${id.slice(-6)}`,
      { style: "2" },
    );
    if (summary.warning) {
      lines.push("");
      text(summary.marker === "ARCHIVED" ? "Saved note" : "Warning", { style });
      text(summary.warning);
    }
    if (summary.changed)
      text("Changed since archiving. Review this record again.", {
        style: "1;33",
      });
    lines.push("");
    text("View details", { style: "1" });
    text(`./run orders details ${selector}`, { style: "36" });
    text(
      notes[e.invocationId]?.archived
        ? "Restore reminder"
        : "Archive after review",
      { style: "2" },
    );
    text(
      `./run orders ${notes[e.invocationId]?.archived ? "unarchive" : "archive"} ${selector}`,
      { style: "36" },
    );
  });
  lines.push("", paint(rule, "2"));
  text("Saved checks only. Full IDs and review notes are in details.", {
    style: "2",
  });
  lines.push("");
  return lines.join("\n");
}
