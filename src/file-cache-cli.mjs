// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { resolveUserDataDir } from "./local-data-directory.mjs";
import {
  loadRuntimeConnection,
  listResultFiles,
  removeResultFile,
} from "./runtime-client.mjs";
export async function runFileCache(
  args,
  {
    write = console.log,
    ask = async (message) => {
      const r = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        return await r.question(message + "\n> ");
      } finally {
        r.close();
      }
    },
  } = {},
) {
  const dataDir = await resolveUserDataDir(),
    state = join(dataDir, "runtime/invocations.json");
  const [orderId, action = "list", key] = args;
  if (
    !/^0x[a-f0-9]{64}$/.test(orderId || "") ||
    !["list", "remove"].includes(action) ||
    (action === "list"
      ? args.length > 3 || (key !== undefined && !/^[1-9][0-9]{0,5}$/.test(key))
      : args.length !== 3)
  ) {
    write(
      "Usage: agentpay orders files ORDER_ID [list PAGE]\n       agentpay orders files ORDER_ID remove FILE_KEY\nUse the full Order ID from agentpay orders details ID.",
    );
    return 2;
  }
  const connection = await loadRuntimeConnection({ dataDir });
  if (action === "remove") {
    if (
      (
        await ask(
          "Remove this local file copy? Order history and payment are unchanged.\nType confirm to remove, or q to return.",
        )
      ).trim() !== "confirm"
    )
      return 0;
    await removeResultFile(connection, {
      orderId,
      fileKey: key,
      confirmed: true,
    });
    write("Local file removed. Its history is kept.");
    return 0;
  }
  const page = Number(key || 1),
    rows = await listResultFiles(connection, orderId, {
      offset: (page - 1) * 100,
    });
  write("\n> Saved result files\n");
  if (!rows.length)
    write(
      "No file copies saved for this Order. A link in a result is not automatically downloaded.",
    );
  for (const row of rows) {
    const safe = (v) => String(v || "").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
    write(
      `  ${safe(row.fileKey)} · ${row.state} · ${row.bytes} bytes\n  ${safe(row.filename)}${row.localPath ? "\n  " + safe(row.localPath) : ""}${row.error ? "\n  " + safe(row.error) : ""}`,
    );
  }
  if (rows.length === 100)
    write(`Next page: agentpay orders files ${orderId} list ${page + 1}`);
  write(
    "\nRuntime must be running; Wallet unlock is not required. File operations never make a payment.",
  );
  return 0;
}
