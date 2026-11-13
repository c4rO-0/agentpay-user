import {reportCommandFailure} from "./command-diagnostics.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { localOrderSummary } from "./order-review.mjs";

export async function showOrderStatus({
  entry,
  observation,
  review,
  selector,
  read,
  write = console.log,
  now = Date.now,
}) {
  write("Checking the latest Order status with Settlement…");
  const details = "agentpay orders details " + selector;
  try {
    const result = await read();
    write("\n> Order status");
    write(
      "Source: Settlement · Retrieved: " + new Date(now()).toLocaleString(),
    );
    if (result.found === false) {
      write("[WAIT] Order not found in the checked authorization");
      write("This does not prove non-payment under another Policy.");
      write("Review the original request: " + details);
      return 0;
    }
    const order = result.order;
    const terminal = {
      Released: "Paid out",
      Refunded: "Refunded",
      Cancelled: "Cancelled",
    };
    const status = terminal[order.vaultState] || order.orderStatus;
    write((terminal[order.vaultState] ? "[OK] " : "[WAIT] ") + status);
    write("Order: " + order.orderId);
    if (Number.isSafeInteger(order.updatedAtMs) && order.updatedAtMs > 0)
      write("Record updated: " + new Date(order.updatedAtMs).toLocaleString());
    write("Settlement record; not an independent chain check.");
    write("Local details: " + details);
    return 0;
  } catch (error) {
    await reportCommandFailure(error,{operation:"Read Order status",write,effect:"The online status was not refreshed. This query did not start a payment."});
    write("\n> Order status");
    write(error.code === "CHAIN_RPC_UNAVAILABLE" ? "[WAIT] Cannot connect to the chain RPC" : "[WAIT] Could not update from Settlement");
    write(
      ["LOCKED", "WALLET_LOCKED"].includes(error.code)
        ? "Unlock Wallet: agentpay wallet unlock"
        : error.code === "CHAIN_RPC_UNAVAILABLE"
          ? "Check your network and any SSH port forwarding, then retry this query. No new payment is needed."
          : "Check agentpay status and your network, then retry this query.",
    );
    const summary = localOrderSummary(entry, observation, review);
    write("\n> Last local record · not refreshed");
    write(summary.state);
    // localOrderSummary ignores observations from a different record fingerprint.
    const checked = summary.checkedAtMs;
    write(
      "Last checked: " +
        (Number.isSafeInteger(checked) && checked > 0
          ? new Date(checked).toLocaleString()
          : "Not available"),
    );
    write("Local details: " + details);
    return 1;
  }
}
