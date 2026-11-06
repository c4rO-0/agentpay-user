// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
const CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export function walletIpcError(payload) {
  const error = payload?.error;
  const settlementCode =
    typeof error?.settlementCode === "string" && CODE.test(error.settlementCode)
      ? error.settlementCode
      : null;
  return Object.assign(new Error(error?.message || "Wallet request failed"), {
    code: error?.code || "WALLET_FAILED",
    ...(settlementCode ? { settlementCode } : {}),
  });
}
