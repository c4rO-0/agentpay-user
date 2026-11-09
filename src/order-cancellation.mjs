// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { sameSettlementAddress } from "./settlement-address-history.mjs";
import { isUnpaidExpiry } from "./order-closure.mjs";
import { randomBytes, createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, link, unlink } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { callWallet, readCapability } from "@c4roa0/agentpay-wallet";
import { readPrivateFile } from "./runtime-client.mjs";
import { readSettlementResult } from "./settlement-response.mjs";
const B32 = /^0x[0-9a-f]{64}$/;
const fail = (code) => Object.assign(Error(code), { code });
export function cancellationSettlementUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("INVALID_SETTLEMENT_URL");
  }
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw fail("INVALID_SETTLEMENT_URL");
  return url.href.replace(/\/$/, "");
}
async function sync(path) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const h = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const s = await h.stat();
    if (s.uid !== process.getuid() || s.mode & 0o077)
      throw fail("LOCAL_STATE_UNSAFE");
  } finally {
    await h.close();
  }
  await sync(dirname(path));
}
async function context(input, walletCall) {
  if (
    !input ||
    Object.keys(input).sort().join(",") !== "dataDir,orderId,settlementUrl"
  )
    throw fail("INVALID_CANCEL_INPUT");
  const dataDir = resolve(input.dataDir),
    orderId = String(input.orderId).toLowerCase();
  if (!B32.test(orderId)) throw fail("INVALID_ORDER_ID");
  const settlementUrl = cancellationSettlementUrl(input.settlementUrl);
  const call =
    walletCall ||
    (async (method, params = {}) =>
      callWallet(
        join(dataDir, "wallet/wallet.sock"),
        await readCapability(join(dataDir, "wallet"), "agent"),
        method,
        params,
      ));
  const status = await call("status");
  if (!status.bound || !B32.test(status.policyId || ""))
    throw fail("POLICY_UNBOUND");
  return {
    dataDir,
    orderId,
    settlementUrl,
    policyId: status.policyId,
    call,
    path: join(
      dataDir,
      "runtime/order-cancellations",
      createHash("sha256").update(orderId).digest("hex") + ".json",
    ),
  };
}
async function readIntent(ctx) {
  let intent;
  try {
    intent = JSON.parse(await readPrivateFile(ctx.path));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw fail("CANCELLATION_STATE_INVALID");
  }
  if (
    !intent ||
    Object.keys(intent).sort().join(",") !==
      "cancellationId,createdAtMs,orderId,policyId,settlementUrl,version" ||
    intent.version !== "agentpay.user-order-cancellation.v1" ||
    !B32.test(intent.cancellationId || "") ||
    intent.orderId !== ctx.orderId ||
    intent.policyId !== ctx.policyId ||
    !(await sameSettlementAddress(ctx.dataDir,intent.settlementUrl,ctx.settlementUrl,ctx.policyId)) ||
    !Number.isSafeInteger(intent.createdAtMs) ||
    intent.createdAtMs < 0
  )
    throw fail("CANCELLATION_STATE_CONFLICT");
  return intent;
}
async function ensureIntent(ctx) {
  const existing = await readIntent(ctx);
  if (existing) return existing;
  await privateDirectory(ctx.dataDir);
  await privateDirectory(join(ctx.dataDir, "runtime"));
  await privateDirectory(dirname(ctx.path));
  const value = {
    version: "agentpay.user-order-cancellation.v1",
    orderId: ctx.orderId,
    policyId: ctx.policyId,
    settlementUrl: ctx.settlementUrl,
    cancellationId: "0x" + randomBytes(32).toString("hex"),
    createdAtMs: Date.now(),
  };
  const temp = ctx.path + "." + randomBytes(12).toString("hex") + ".tmp";
  const h = await open(temp, "wx", 0o600);
  try {
    try {
      await h.writeFile(JSON.stringify(value) + "\n");
      await h.sync();
    } finally {
      await h.close();
    }
    try {
      await link(temp, ctx.path);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    await sync(dirname(ctx.path));
  } finally {
    await unlink(temp).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  return readIntent(ctx);
}
async function readOrder(ctx, intent) {
  const result = readSettlementResult(
    await ctx.call("readSettlementOrder", {
      settlementUrl: ctx.settlementUrl,
      orderId: ctx.orderId,
    }),
  );
  if (result.order?.orderId !== ctx.orderId)
    throw fail("CANCELLATION_RESPONSE_INVALID");
  const state = result.closure?.state,
    terminal = state === "cancelled" || state === "refunded";
  return {
    orderId: ctx.orderId,
    cancellationId: intent?.cancellationId || null,
    orderStatus: result.order.orderStatus,
    vaultState: result.order.vaultState,
    waiting: result.waiting || null,
    closure: result.closure || null,
    message: isUnpaidExpiry(result)
      ? "Order expired without payment. No service result is expected."
      : terminal
        ? state === "refunded"
          ? "Principal refunded; cumulative Policy spend is not restored."
          : "Order cancelled."
        : state
          ? "Closure is pending. Check this same Order again."
          : "No confirmed cancellation. Check this same Order before retrying.",
  };
}
export async function cancelOrder(input, { walletCall } = {}) {
  const ctx = await context(input, walletCall),
    intent = await ensureIntent(ctx);
  // The immutable identity is durable before the first HTTP request. Response loss
  // retries the same cancellation; no invocation/Commitment or payment is created.
  const response = readSettlementResult(
    await ctx.call("cancelSettlementOrder", {
      settlementUrl: ctx.settlementUrl,
      orderId: ctx.orderId,
      cancellationId: intent.cancellationId,
    }),
  );
  if (
    response.orderId !== ctx.orderId ||
    !response.closure ||
    typeof response.duplicate !== "boolean"
  )
    throw fail("CANCELLATION_RESPONSE_INVALID");
  return readOrder(ctx, intent);
}
export async function cancellationStatus(input, { walletCall } = {}) {
  const ctx = await context(input, walletCall);
  return readOrder(ctx, await readIntent(ctx));
}

// Resolve only existing Runtime history; never prepare a replacement Order here.
export async function cancellationOrderForRequest({ dataDir, requestId }) {
  if (
    typeof requestId !== "string" ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)
  )
    throw fail("INVALID_REQUEST_ID");
  const document = JSON.parse(
    await readPrivateFile(
      join(resolve(dataDir), "runtime/invocations.json"),
      16 * 1048576,
    ),
  );
  const id =
    "0x" +
    createHash("sha256")
      .update("agentpay.user-invocation.v1:" + requestId)
      .digest("hex");
  const entry =
    document?.version === "agentpay.user-invocations.v1"
      ? document.invocations?.[id]
      : null;
  if (
    !entry ||
    entry.invocationId !== id ||
    entry.routingVersion !== "agentpay.runtime-call.v1" ||
    !B32.test(entry.requestHash || "")
  )
    throw fail("INVOCATION_NOT_FOUND");
  if (entry.orderId === null) throw fail("ORDER_NOT_CREATED");
  if (!B32.test(entry.orderId || "")) throw fail("CANCELLATION_STATE_INVALID");
  return entry.orderId;
}
