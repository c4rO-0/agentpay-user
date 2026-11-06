// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { showOrderStatus } from "./order-status-panel.mjs";
import { renderOrderList } from "./order-list-panel.mjs";
import { createInterface } from "node:readline/promises";
import {
  localOrderReviews,
  readPrivateJson,
  findLocalOrder,
  localReviewDetails,
  recordFingerprint,
  observationKey,
} from "./order-review.mjs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolveUserDataDir } from "./local-data-directory.mjs";
import { readServiceSettings } from "./local-services.mjs";
import { createInvocationStore } from "./invocation-store.mjs";
import { invocationResults } from "./invocation-result.mjs";
import {
  parseServiceReference,
  providerOutput,
  normalizeRuntimeResult,
} from "./service-reference.mjs";
import { fetchJsonWithTimeout } from "./transport.mjs";
import { readSettlementResult } from "./settlement-response.mjs";
async function privateText(path) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      s.mode & 0o077 ||
      s.size > 65536
    )
      throw Error("Unsafe local credential");
    return await f.readFile("utf8");
  } finally {
    await f.close();
  }
}
async function wallet(dataDir, method, params) {
  const token = (await privateText(join(dataDir, "wallet/agent.token"))).trim();
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(dataDir, "wallet/wallet.sock"));
    let text = "",
      done = false;
    const finish = (e, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      e ? reject(e) : resolve(v);
    };
    const timer = setTimeout(
      () => finish(Error("Wallet did not respond. Run ./run status.")),
      40000,
    );
    socket.setEncoding("utf8");
    socket.once("error", (e) => finish(e));
    socket.once("connect", () =>
      socket.write(
        JSON.stringify({
          id: randomBytes(8).toString("hex"),
          token,
          method,
          params,
        }) + "\n",
      ),
    );
    socket.on("data", (part) => {
      text += part;
      if (text.length > 8 * 1048576) finish(Error("Wallet response too large"));
    });
    socket.once("end", () => {
      try {
        const result = JSON.parse(text);
        if (!result.ok)
          throw Object.assign(
            Error(result.error?.message || "Wallet rejected this operation"),
            { code: result.error?.code },
          );
        finish(null, result.result);
      } catch (e) {
        finish(e);
      }
    });
  });
}
async function askTerminal(message) {
  if (!process.stdin.isTTY)
    throw Error("Run this command in an interactive terminal.");
  const r = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await r.question(message + "\n> ");
  } finally {
    r.close();
  }
}
export async function runOrderSupport(
  args,
  {
    write = console.log,
    dataDir: chosen,
    ask = askTerminal,
    color = Boolean(process.stdout.isTTY) &&
      process.env.TERM !== "dumb" &&
      !Object.hasOwn(process.env, "NO_COLOR"),
    columns = process.stdout.columns || 80,
  } = {},
) {
  try {
    const dataDir = chosen || (await resolveUserDataDir()),
      path = join(dataDir, "runtime/invocations.json");
    const store = createInvocationStore(path),
      inventory = await store.inventory();
    const reviews = localOrderReviews(path),
      notes = (await reviews.load()).records;
    const observations =
      (await readPrivateJson(path + ".recovery.json", 16 * 1048576))
        ?.observations || {};
    if (args.length === 0) {
      const entries = Object.values(inventory).sort(
        (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0),
      );
      write(renderOrderList(entries, observations, notes, { color, columns }));
      return 0;
    }
    const [selector, action = "details"] = args;
    if (
      ![
        "details",
        "archive",
        "unarchive",
        "status",
        "case",
        "retrieve",
      ].includes(action) ||
      args.length > 2
    ) {
      write(
        "Usage: ./run orders details|status|archive|unarchive|case|retrieve ID",
      );
      return 2;
    }
    const entry = findLocalOrder(inventory, selector),
      orderId = entry.orderId,
      observation = observations[entry.invocationId],
      review = notes[entry.invocationId];
    if (["details", "archive", "unarchive"].includes(action)) {
      write(
        localReviewDetails(entry, observation, review, {
          selector,
          color,
          columns,
        }),
      );
      if (action === "details") return 0;
      if (action === "unarchive") {
        await reviews.change(entry, observation, { archive: false, note: "" });
        write(
          "Unarchived. Original records and payment permissions are unchanged.",
        );
        return 0;
      }
      write(
        "Archive hides this checked warning, not the record. It does not cancel an Order or stop work already in progress.",
      );
      const note = (
        await ask(
          "Review note (up to 500 characters; no passwords or private content). Type 'q' to return.",
        )
      ).trim();
      if (note === "q") return 0;
      if (!note || note.length > 500 || /[\u0000-\u001f\u007f]/.test(note))
        throw Error("Enter a short, single-line review note.");
      if (
        (
          await ask(
            "Type 'confirm' to archive locally, or anything else to return.",
          )
        ).trim() !== "confirm"
      )
        return 0;
      const fresh = (await store.inventory())[entry.invocationId],
        latest = (await readPrivateJson(path + ".recovery.json", 16 * 1048576))
          ?.observations?.[entry.invocationId];
      if (
        !fresh ||
        recordFingerprint(fresh) !== recordFingerprint(entry) ||
        observationKey(latest) !== observationKey(observation)
      )
        throw Error(
          "The record changed while you were reviewing it. Open details again before archiving.",
        );
      await reviews.change(entry, observation, { archive: true, note });
      write(
        "Archived locally. Same-request execution is blocked until you unarchive it. Status updates on the next local check.",
      );
      return 0;
    }
    if (action === "case") {
      if (!orderId)
        throw Error(
          "No Order ID is saved. Open local details before requesting support.",
        );
      write(
        `Connect this Wallet to your Market account:\n  ./run market connect\nThen open Market → Account → My Orders and choose Order ${orderId}.\nThe connection covers this Wallet authorization; no one-Order access code is needed.`,
      );
      return 0;
    }
    if (action === "status")
      return showOrderStatus({
        entry,
        observation,
        review,
        selector,
        write,
        read: async () => {
          const settings = await readServiceSettings(dataDir);
          const w = await wallet(dataDir, "status", {}),
            c = entry.paymentPayload?.payload?.commitment;
          const recoveryScope =
            entry.recoveryScope ||
            (c?.policyId && w.recoveryScope
              ? {
                  ...w.recoveryScope,
                  policyId: c.policyId,
                  safe: c.safe,
                  network: entry.paymentPayload.accepted?.network,
                }
              : null);
          const result = readSettlementResult(
            await wallet(dataDir, "readSettlementOrder", {
              settlementUrl: settings.settlementUrl,
              ...(orderId
                ? { orderId }
                : { orderRequestId: entry.orderRequestId }),
              ...(recoveryScope ? { recoveryScope } : {}),
            }),
          );
          return result;
        },
      });
    const settings = await readServiceSettings(dataDir),
      params = { settlementUrl: settings.settlementUrl, orderId };
    if (!orderId)
      throw Error(
        "No Order ID is saved. Open local details; do not start a replacement purchase.",
      );
    const response = await wallet(dataDir, "requestSettlementResult", {
        ...params,
        operationId: "0x" + randomBytes(32).toString("hex"),
      }),
      permission = response?.result;
    if (
      !response?.ok ||
      permission?.orderId !== orderId ||
      permission.requestHash !== entry.requestHash
    )
      throw Error("Result retrieval identity mismatch");
    if (entry.routingVersion === "agentpay.runtime-call.v1") {
      const binding = JSON.parse(entry.serviceBinding),
        reference = parseServiceReference(binding.reference);
      if (permission.endpoint !== reference.profile.paymentEndpoint)
        throw Error("Retrieval endpoint differs from the original service");
    }
    if (typeof permission.endpoint !== "string" || !permission.endpoint)
      throw Error(
        "Original Provider endpoint is unavailable. Contact the Provider with this Order ID; no replacement purchase was started.",
      );
    const endpoint = new URL(permission.endpoint);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw Error("Provider retrieval endpoint is unsafe");
    const fetched = await fetchJsonWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          authorization:
            "AgentPayResult " +
            Buffer.from(JSON.stringify(permission)).toString("base64url"),
        },
      },
      35000,
    );
    if (!fetched.response.ok || !fetched.result?.ok)
      throw Error(
        fetched.result?.error?.message ||
          "Original result is unavailable; open a case before its deadline.",
      );
    const status = readSettlementResult(
        await wallet(dataDir, "readSettlementOrder", params),
      ),
      evidence = status.deliveryEvidence;
    const output = fetched.result.result;
    if (
      !evidence ||
      output?.orderId !== orderId ||
      output.requestHash !== entry.requestHash ||
      output.outputHash !== evidence.outputHash ||
      String(output.usageUnits) !== String(evidence.usageUnits)
    )
      throw Error("Recovered result does not match original delivery evidence");
    if (entry.routingVersion !== "agentpay.runtime-call.v1")
      throw Error(
        "Original result was returned, but this older request needs a reviewed format adapter. No replacement purchase was made.",
      );
    const binding = JSON.parse(entry.serviceBinding),
      reference = parseServiceReference(binding.reference),
      context = {
        reference,
        skillId: reference.skillId,
        profileHash: reference.profileHash,
        requestedMaxUsageUnits: binding.requestedMaxUsageUnits,
      };
    const result = providerOutput(
      fetched.result,
      context,
      null,
      orderId,
      entry.requestHash,
    );
    const restored = normalizeRuntimeResult(
      {
        version: "agentpay.runtime-result.v1",
        orderId,
        requestHash: entry.requestHash,
        service: { skillId: context.skillId, profileHash: context.profileHash },
        output: result.output,
        outputHash: result.outputHash,
        usageUnits: result.usageUnits,
        deliveryEvidenceVerified: true,
        finalization: status.finalization,
        deadlines: status.deadlines,
      },
      context,
      entry.requestHash,
      orderId,
    );
    await invocationResults(path).save(entry, restored);
    write(
      "Original result restored. Resume the original Skill request to read it. No new service execution or payment was requested.",
    );
    return 0;
  } catch (e) {
    write(
      ["WALLET_LOCKED", "LOCKED"].includes(e.code)
        ? "Wallet is locked. Run ./run wallet unlock, then repeat this command."
        : String(e.message || e),
    );
    return 1;
  }
}
