// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// A business expiry is not a claim that the old Vault was cancelled on chain.
export function isUnpaidExpiry(result) {
  return (
    result?.preparationState === "expired" &&
    result?.closure?.state === "cancelled" &&
    result.closure.reason === "payment_timeout" &&
    result.closure.transactionHash === null &&
    result.order?.vaultState === "Created" &&
    result.order?.serviceState === "closed"
  );
}
// Closure is independent of the frozen participant Order status enum.
export function assertOrderCanContinue(result) {
  const state = result?.closure?.state,
    vault = result?.order?.vaultState;
  if (isUnpaidExpiry(result))
    throw coded(
      "ORDER_EXPIRED",
      "This Order expired without payment. No service result is expected. Keep the original request; it will not be paid again automatically.",
    );
  if (state === "cancelled" || vault === "Cancelled")
    throw coded(
      "ORDER_CANCELLED",
      "This Order was cancelled. Preserve its request and payment history.",
    );
  if (state === "refunded" || vault === "Refunded")
    throw coded(
      "ORDER_REFUNDED",
      "This Order was refunded. Its cumulative Policy spend is not restored.",
    );
  if (state)
    throw coded(
      "ORDER_CLOSING",
      "This Order is closing. Query the same Order; do not submit another payment or service request.",
    );
}
function coded(code, message) {
  return Object.assign(Error(message), { code });
}
