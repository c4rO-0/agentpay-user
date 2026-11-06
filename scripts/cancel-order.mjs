#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  cancelOrder,
  cancellationStatus,
  cancellationOrderForRequest,
} from "../src/order-cancellation.mjs";
const args = process.argv.slice(2),
  [dataDir, settlementUrl] = args;
let orderId, flag;
try {
  if (!dataDir || !settlementUrl)
    throw Object.assign(Error(), { code: "INVALID_ARGUMENTS" });
  if (args[2] === "--request") {
    if (!args[3] || args.length > 5)
      throw Object.assign(Error(), { code: "INVALID_ARGUMENTS" });
    orderId = await cancellationOrderForRequest({
      dataDir,
      requestId: args[3],
    });
    flag = args[4];
  } else {
    orderId = args[2];
    flag = args[3];
    if (args.length > 4)
      throw Object.assign(Error(), { code: "INVALID_ARGUMENTS" });
  }
  if (
    !dataDir ||
    !settlementUrl ||
    !orderId ||
    (flag !== undefined && flag !== "--status")
  )
    throw Object.assign(Error(), { code: "INVALID_ARGUMENTS" });
  const result = await (flag === "--status" ? cancellationStatus : cancelOrder)(
    { dataDir, settlementUrl, orderId },
  );
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  const code = /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.code || "")
    ? error.code
    : "ORDER_CANCEL_FAILED";
  const messages = {
    INVALID_ARGUMENTS:
      "Usage: node scripts/cancel-order.mjs <user-data-dir> <settlement-url> <order-id | --request request-id> [--status]",
    ORDER_NOT_CREATED:
      "This request has no saved Order yet. Retry its status later; no cancellation or payment was submitted.",
    INVOCATION_NOT_FOUND:
      "The original request was not found. Preserve its history; do not create another payment.",
    ORDER_ALREADY_ACCEPTED:
      "Provider already accepted this Order. Its existing delivery and timeout rules still apply.",
    ORDER_CANCEL_FORBIDDEN: "Wallet does not own this Order and Policy.",
    LOCKED:
      "Wallet is locked. Unlock it before querying or cancelling this Order.",
    CANCELLATION_STATE_CONFLICT:
      "Saved cancellation belongs to a different Policy or endpoint. Preserve it for recovery review.",
  };
  console.log(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message:
          messages[code] ||
          "Cancellation could not be confirmed. Check the same Order again; do not create a replacement payment.",
        ...(typeof error?.settlementCode === "string" &&
        /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.settlementCode)
          ? { settlementCode: error.settlementCode }
          : {}),
      },
    }),
  );
  process.exitCode = 1;
}
