#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Poll only through the authenticated, bounded Wallet IPC notice operation.
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertUnixMilliseconds } from "@c4roa0/agentpay-protocol";
import { callWallet } from "@c4roa0/agentpay-wallet";

const [dataArg, settlementArg] = process.argv.slice(2);
if (!dataArg || !settlementArg || process.argv.length !== 4)
  throw new Error(
    "usage: poll-unconfirmed-notice.mjs <user-dir> <settlement-url>",
  );
const url = new URL(settlementArg);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
)
  throw new Error("loopback required");
const dataDir = resolve(dataArg);
const checkpoint = JSON.parse(
  await readFile(join(dataDir, "runtime/unconfirmed-smoke.json"), "utf8"),
);
if (!/^0x[0-9a-f]{64}$/.test(checkpoint.orderId || ""))
  throw new Error("Order checkpoint missing");
const tokenPath = join(dataDir, "wallet/agent.token");
const info = await lstat(tokenPath);
if (
  !info.isFile() ||
  info.isSymbolicLink() ||
  info.uid !== process.getuid() ||
  info.mode & 0o077
)
  throw new Error("unsafe Wallet capability");
const token = (await readFile(tokenPath, "utf8")).trim();
if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("invalid Wallet capability");
const answer = await callWallet(
  join(dataDir, "wallet/wallet.sock"),
  token,
  "pollSettlementNotices",
  { settlementUrl: url.toString(), limit: 50 },
);
const notices = answer?.notices || [];
const matches = notices.filter(
  (notice) =>
    notice.orderId === checkpoint.orderId &&
    notice.type === "delivery_confirmation_required",
);
if (
  matches.length !== 1 ||
  matches[0].state !== "delivered" ||
  matches[0].payload?.orderId !== checkpoint.orderId ||
  !Number.isSafeInteger(matches[0].payload?.releaseScheduledAtMs)
) {
  throw new Error("one bound Wallet reminder was not returned");
}
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      orderId: checkpoint.orderId,
      walletAuthenticated: true,
      uniqueOrderNotice: true,
      noticeState: matches[0].state,
      availableActions: matches[0].payload.actions,
      releaseScheduledAtMs: assertUnixMilliseconds(
        matches[0].payload.releaseScheduledAtMs,
      ),
    },
    null,
    2,
  )}\n`,
);
