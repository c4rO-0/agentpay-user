import { publishRuntimeReady } from "./runtime-selection-ready.mjs";
import { acquireRuntimeOwner } from "./runtime-owner.mjs";
import { runtimeSoftware } from "./software-versions.mjs";
// Authenticated local invocation engine. Preserve durable request/payment checkpoints before
// network calls; startup reconciliation observes history without creating replacement purchases.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { manageCache } from "./cache-management.mjs";
import { readCacheLimits } from "./file-cache-settings.mjs";
import { createFileCache } from "./file-cache.mjs";
import { assertNotArchived } from "./order-review.mjs";
import {
  assertPreparedCommercialTerms,
  normalizeAcceptedTerms,
} from "./service-reference.mjs";
import { serviceUrl } from "./service-url.mjs";
import { createRuntimeRecovery } from "./runtime-recovery.mjs";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { open } from "node:fs/promises";
import { assertOrderCanContinue } from "./order-closure.mjs";
import { invocationResults } from "./invocation-result.mjs";
import { normalizeRuntimeResult } from "./service-reference.mjs";
import {
  parseServiceReference,
  serviceContext,
  assertPreparedService,
  providerRequest,
  providerOutput,
} from "./service-reference.mjs";
import { readSettlementResult as settlementResult } from "./settlement-response.mjs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { hashPrivateRequest } from "@c4roa0/agentpay-protocol";
import { createInvocationStore } from "./invocation-store.mjs";
import { authorizeCaller, readCallerToken } from "./caller-auth.mjs";
import { fetchJsonWithTimeout } from "./transport.mjs";
import { readFinalizationDisclosure } from "./finalization-disclosure.mjs";
import { walletIpcError } from "./wallet-ipc-error.mjs";

// Retain the FileHandle for the entire server lifetime; process exit releases it.
const runtimeOwner = await acquireRuntimeOwner();
process.once('exit', () => { void runtimeOwner; });
const host = String(process.env.AGENTPAY_USER_HOST || "127.0.0.1").trim();
if (!["127.0.0.1", "localhost", "::1"].includes(host))
  throw Error("User Runtime must listen on loopback");
const originHost = host.includes(":") ? `[${host}]` : host;
const port = Number(process.env.AGENTPAY_USER_PORT || 6490);
const walletSocket = requiredEnv("AGENTPAY_WALLET_SOCKET");
const walletCapabilityFile = requiredEnv("AGENTPAY_WALLET_AGENT_TOKEN_FILE");
const callerCredentialFile = requiredEnv("AGENTPAY_USER_CALLER_TOKEN_FILE");
const settlementUrl = requiredEnv("AGENTPAY_SETTLEMENT_URL").replace(
  /\/+$/,
  "",
);
const operationTimeoutMs = Number(
  process.env.AGENTPAY_USER_OPERATION_TIMEOUT_MS || 90_000,
);
if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1) {
  throw new Error(
    "AGENTPAY_USER_OPERATION_TIMEOUT_MS must be a positive number of milliseconds",
  );
}
const includeProviderEvidence =
  process.env.AGENTPAY_USER_INCLUDE_PROVIDER_EVIDENCE === "true";
const invocationStore = createInvocationStore(
  requiredEnv("AGENTPAY_USER_STATE_FILE"),
);

let localFileCache;
async function getFileCache() {
  if (localFileCache) return localFileCache;
  const privateFileOrigins = JSON.parse(
    process.env.AGENTPAY_USER_FILE_CACHE_PRIVATE_ORIGINS || "[]",
  );
  if (
    !Array.isArray(privateFileOrigins) ||
    privateFileOrigins.length > 16 ||
    privateFileOrigins.some((origin) => {
      try {
        return (
          typeof origin !== "string" ||
          !["http:", "https:"].includes(new URL(origin).protocol) ||
          new URL(origin).origin !== origin
        );
      } catch {
        return true;
      }
    })
  )
    throw coded("FILE_SETTINGS_INVALID", "Invalid private file-cache origins.");
  const path = requiredEnv("AGENTPAY_USER_STATE_FILE");
  localFileCache = createFileCache(path, {
    privateOrigins: privateFileOrigins,
    limits: await readCacheLimits(path),
  });
  return localFileCache;
}

const resultStore = invocationResults(requiredEnv("AGENTPAY_USER_STATE_FILE"));
const invocationLocks = new Map();
let activeInvocations = 0;
const callerCredential = await readCallerToken(callerCredentialFile);
const recovery = createRuntimeRecovery({
  store: invocationStore,
  results: resultStore,
  statePath: requiredEnv("AGENTPAY_USER_STATE_FILE"),
  settlementUrl,
  readWallet: () => callWallet("status", {}, 1500),
  readOrder: (orderId, recoveryScope) =>
    callWallet(
      "readSettlementOrder",
      { settlementUrl, orderId, ...(recoveryScope ? { recoveryScope } : {}) },
      35000,
    ),
  readRequest: (orderRequestId, recoveryScope) =>
    callWallet(
      "readSettlementOrder",
      {
        settlementUrl,
        orderRequestId,
        ...(recoveryScope ? { recoveryScope } : {}),
      },
      35000,
    ),
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${originHost}`);
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      result: {
        role: "user-runtime",
        software: runtimeSoftware,
        capabilities: ["agentpay.runtime-call.v1"],
        walletTransport: "unix",
      },
    });
  }
  if (req.method === "GET" && url.pathname === "/status") {
    if (!authorizeCaller(req.headers.authorization, callerCredential))
      return json(res, 401, {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Valid caller credential required",
        },
      });
    void recovery.refresh();
    return json(res, 200, {
      ok: true,
      result: { role: "user-runtime", software: runtimeSoftware, ...recovery.status() },
    });
  }
  if (
    req.method !== "POST" ||
    ![
      "/services/invoke",
      "/services/check",
      "/services/offer",
      "/files/cache",
      "/files/list",
      "/files/remove",
      "/files/input",
      "/files/input-release",
      "/cache/manage",
      "/services/history",
    ].includes(url.pathname)
  )
    return json(res, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "route not found" },
    });
  if (!authorizeCaller(req.headers.authorization, callerCredential))
    return json(res, 401, {
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "valid caller credential is required",
      },
    });
  let releaseInvocation = () => {};
  try {
    const body = await readJson(req);
    if (url.pathname === "/cache/manage")
      return json(res, 200, {
        ok: true,
        result: await manageCache(await getFileCache(), body),
      });
    if (url.pathname === "/files/input") {
      if (
        !body ||
        Object.keys(body).sort().join(",") !== "files,requestId" ||
        !/^[A-Za-z0-9._:-]{16,128}$/.test(body.requestId || "") ||
        !Array.isArray(body.files) ||
        body.files.length > 20
      )
        throw coded(
          "FILE_INPUT_INVALID",
          "Supply an original request ID and explicit input files.",
        );
      const keys = new Set();
      for (const f of body.files) {
        if (
          !f ||
          typeof f !== "object" ||
          Array.isArray(f) ||
          Object.keys(f).some(
            (k) =>
              !["fileKey", "sourcePath", "url", "filename", "sha256"].includes(
                k,
              ),
          ) ||
          typeof f.fileKey !== "string" ||
          !/^[A-Za-z0-9._-]{1,80}$/.test(f.fileKey) ||
          keys.has(f.fileKey) ||
          (typeof f.sourcePath === "string") === (typeof f.url === "string")
        )
          throw coded(
            "FILE_INPUT_INVALID",
            "Declare distinct file keys and one source per input.",
          );
        keys.add(f.fileKey);
      }
      const cache = await getFileCache(),
        rows = [];
      for (const f of body.files)
        rows.push(
          await (f.sourcePath
            ? cache.importInput({ ...f, requestId: body.requestId })
            : cache.cache({ ...f, requestId: body.requestId })),
        );
      return json(res, 200, { ok: true, result: rows });
    }
    if (url.pathname === "/files/input-release") {
      const context = serviceContext(
        body,
        process.env.AGENTPAY_USER_MAX_REQUEST_USAGE_UNITS || "1000000",
      );
      const requestHash = hashPrivateRequest(context.request),
        requestId = req.headers["idempotency-key"];
      const entry = await invocationStore.lookup({
        invocationKey: requestId,
        requestHash,
        binding: context.binding,
        routingVersion: "agentpay.runtime-call.v1",
      });
      const saved = await resultStore.read(entry);
      if (!saved)
        throw coded(
          "FILE_RESULT_UNVERIFIED",
          "Verified durable delivery is required before releasing input protection.",
        );
      normalizeRuntimeResult(saved, context, requestHash, entry.orderId);
      return json(res, 200, {
        ok: true,
        result: await (await getFileCache()).releaseInputs(requestId),
      });
    }
    if (url.pathname.startsWith("/files/")) {
      const fileCache = await getFileCache();
      const allowed =
        url.pathname === "/files/cache"
          ? ["orderId", "fileKey", "url", "filename", "sha256"]
          : url.pathname === "/files/remove"
            ? ["orderId", "fileKey", "confirmed"]
            : ["orderId", "offset", "limit"];
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((k) => !allowed.includes(k)) ||
        !/^0x[0-9a-f]{64}$/.test(body.orderId || "")
      )
        throw coded(
          "FILE_INPUT_INVALID",
          "Supply the original Order ID and file operation fields.",
        );
      if (url.pathname !== "/files/cache") {
        const result =
          url.pathname === "/files/remove"
            ? await fileCache.remove(body)
            : await fileCache.list(body.orderId, body);
        return json(res, 200, { ok: true, result });
      }
      const entries = Object.values(await invocationStore.inventory()).filter(
        (v) => v.orderId === body.orderId,
      );
      if (entries.length !== 1)
        throw coded(
          "FILE_ORDER_UNAVAILABLE",
          "No unique local result is associated with this Order.",
        );
      const entry = entries[0],
        saved = await resultStore.read(entry);
      if (!saved || entry.routingVersion !== "agentpay.runtime-call.v1")
        throw coded(
          "FILE_RESULT_UNVERIFIED",
          "A verified local result is required before caching files.",
        );
      const binding = JSON.parse(entry.serviceBinding),
        reference = parseServiceReference(binding.reference);
      normalizeRuntimeResult(
        saved,
        {
          reference,
          skillId: reference.skillId,
          profileHash: reference.profileHash,
          requestedMaxUsageUnits: binding.requestedMaxUsageUnits,
        },
        entry.requestHash,
        entry.orderId,
      );
      const result = await fileCache.cache(body);
      return json(res, 200, { ok: true, result });
    }

    if (url.pathname === "/services/offer") {
      if (!body || Object.keys(body).join(",") !== "service")
        throw coded("INVALID_INPUT", "Supply a service reference");
      const reference = parseServiceReference(body.service),
        url = serviceUrl(settlementUrl, "/agentpay/purchase-readiness");
      url.searchParams.set("skillId", reference.skillId);
      url.searchParams.set("profileHash", reference.profileHash);
      const offer = await fetchJsonWithTimeout(url, {}, 5000);
      if (!offer.response.ok || offer.result?.ok !== true)
        throw coded("OFFER_UNAVAILABLE", "Current offer could not be read");
      return json(res, 200, { ok: true, result: offer.result.result });
    }
    if (url.pathname === "/services/check") {
      if (!body || Object.keys(body).join(",") !== "service")
        throw coded(
          "INVALID_INPUT",
          "Supply the public service reference only",
        );
      const reference = parseServiceReference(body.service);
      return json(res, 200, {
        ok: true,
        result: {
          role: "user-runtime",
          service: reference,
          runtimeIdentityMatches: true,
          purchaseReadinessChecked: false,
          orderCreated: false,
          capabilities: ["agentpay.original-request.v1"],
        },
      });
    }
    const context = serviceContext(
      body,
      process.env.AGENTPAY_USER_MAX_REQUEST_USAGE_UNITS || "1000000",
    );
    const {
      skillId: callSkillId,
      profileHash: callProfileHash,
      requestedMaxUsageUnits: callUsage,
    } = context;
    const input = { request: context.request };
    const requestHash = hashPrivateRequest(input.request);
    if (url.pathname === "/services/history") {
      const entry = await invocationStore.lookup({
        invocationKey: req.headers["idempotency-key"],
        requestHash,
        binding: context.binding,
        routingVersion: "agentpay.runtime-call.v1",
      });
      const saved = await resultStore.read(entry);
      const delivery = saved
        ? normalizeRuntimeResult(saved, context, requestHash, entry.orderId)
        : null;
      return json(res, 200, {
        ok: true,
        result: {
          orderRequestId: entry.orderRequestId,
          orderId: entry.orderId,
          recoveryScope: entry.recoveryScope || null,
          delivery,
        },
      });
    }
    const originalOrderRequestId =
      req.headers["x-agentpay-original-request"] ?? null;
    if (
      originalOrderRequestId !== null &&
      !/^0x[0-9a-f]{64}$/.test(originalOrderRequestId)
    )
      throw coded("INVALID_INPUT", "Invalid original request reference.");
    releaseInvocation = await acquireInvocation(req.headers["idempotency-key"]);
    await recovery.assertLocalHistory();
    let invocation = await invocationStore.begin({
      invocationKey: req.headers["idempotency-key"],
      requestHash,
      binding: context.binding,
      routingVersion: "agentpay.runtime-call.v1",
      originalOrderRequestId,
      readRecoveryScope: async () =>
        (await callWallet("status", {}, 1500)).recoveryScope,
    });
    {
      const savedResult = await resultStore.read(invocation);
      if (savedResult)
        return json(res, 200, {
          ok: true,
          reusedResult: true,
          result: normalizeRuntimeResult(
            savedResult,
            context,
            requestHash,
            invocation.orderId,
          ),
        });
    }
    await assertNotArchived(
      requiredEnv("AGENTPAY_USER_STATE_FILE"),
      invocation,
    );
    const pendingResult = await resultStore.readPending(invocation);
    if (pendingResult) {
      const delivered = providerOutput(
        { result: pendingResult },
        context,
        input.request,
        invocation.orderId,
        requestHash,
      );
      const evidence = await waitForDeliveryEvidence(
        invocation.orderId,
        delivered.outputHash,
        invocation.recoveryScope,
        context,
        requestHash,
      );
      if (String(evidence.usageUnits) !== String(delivered.usageUnits))
        throw coded(
          "DELIVERY_EVIDENCE_MISMATCH",
          "Settlement usage differs from the saved result",
        );
      const result = normalizeRuntimeResult(
        {
          version: "agentpay.runtime-result.v1",
          orderId: invocation.orderId,
          requestHash,
          service: { skillId: callSkillId, profileHash: callProfileHash },
          output: delivered.output,
          outputHash: delivered.outputHash,
          usageUnits: delivered.usageUnits,
          deliveryEvidenceVerified: true,
          finalization: evidence.finalization,
          deadlines: evidence.deadlines,
        },
        context,
        requestHash,
        invocation.orderId,
      );
      await resultStore.save(invocation, result);
      return json(res, 200, { ok: true, reusedResult: true, result });
    }

    if (
      invocation.quoteAcceptanceRejected &&
      !invocation.orderId &&
      !invocation.paymentPayload
    ) {
      invocation = await invocationStore.update(
        invocation.invocationId,
        requestHash,
        { acceptedTerms: null, quoteAcceptanceRejected: false },
      );
    }
    if (
      context.acceptedTerms &&
      invocation.acceptedTerms &&
      JSON.stringify(context.acceptedTerms) !==
        JSON.stringify(invocation.acceptedTerms)
    )
      throw coded(
        "QUOTE_TERMS_CONFLICT",
        "This request already accepted different terms; preserve its original identity.",
      );
    recovery.assertInvocation(invocation);
    if (invocation.orderId) await assertOriginalOrderOpen(invocation.orderId);
    if (!invocation.paymentPayload) {
      if (
        !invocation.orderId &&
        !invocation.acceptedTerms &&
        !invocation.quoteAcceptanceRequired
      )
        throw coded(
          "RUNTIME_RECOVERY_REQUIRED",
          "An older preparation may already exist. Preserve the original request for review; do not create a replacement purchase.",
        );
      if (!invocation.orderId && !invocation.acceptedTerms) {
        const url = serviceUrl(settlementUrl, "/agentpay/purchase-readiness");
        url.searchParams.set("skillId", callSkillId);
        url.searchParams.set("profileHash", callProfileHash);
        const response = await fetchJsonWithTimeout(
          url.toString(),
          {},
          operationTimeoutMs,
        );
        const snapshot = response.result?.result || response.result;
        if (
          !response.response.ok ||
          !snapshot?.commercialReady ||
          !snapshot.quote
        )
          throw coded(
            "PURCHASE_NOT_READY",
            "Current service offer is unavailable",
          );
        const terms =
          context.acceptedTerms ||
          normalizeAcceptedTerms({
            baseAmountAtomic: String(snapshot.quote.baseAmountAtomic),
            unitPriceAtomic: String(snapshot.quote.unitPriceAtomic),
            serviceWindowSeconds:
              snapshot.orderDeadlinePolicy?.serviceWindowSeconds,
          });
        if (
          !Number.isSafeInteger(terms.serviceWindowSeconds) ||
          terms.serviceWindowSeconds < 1
        )
          throw coded(
            "QUOTE_TERMS_INVALID",
            "Current service duration is unavailable",
          );
        invocation = await invocationStore.update(
          invocation.invocationId,
          requestHash,
          { acceptedTerms: terms },
        );
      }
      if (!invocation.recoveryScope)
        throw coded(
          "RUNTIME_RECOVERY_REQUIRED",
          "Original authorization was not saved. Preserve this request for review.",
        );
      const activeScope = (await callWallet("status", {}, 1500)).recoveryScope;
      if (
        !activeScope ||
        ["network", "module", "safe", "policyId"].some(
          (k) =>
            String(activeScope[k]).toLowerCase() !==
            String(invocation.recoveryScope[k]).toLowerCase(),
        )
      )
        throw coded(
          "RUNTIME_RECOVERY_REQUIRED",
          "This request uses an earlier authorization. Keep its original identity.",
        );
      await assertNotArchived(
        requiredEnv("AGENTPAY_USER_STATE_FILE"),
        invocation,
      );
      let prepared;
      try {
        prepared = settlementResult(
          await callWallet("prepareSettlementOrder", {
            settlementUrl,
            orderRequestId: invocation.orderRequestId,
            expectedScope: invocation.recoveryScope,
            skillId: callSkillId,
            profileHash: callProfileHash,
            requestHash,
            requestedMaxUsageUnits: callUsage,
            ...(invocation.acceptedTerms
              ? { acceptedTerms: invocation.acceptedTerms }
              : {}),
          }),
        );
      } catch (error) {
        if (
          error.code === "QUOTE_TERMS_CHANGED" &&
          !invocation.orderId &&
          !invocation.paymentPayload
        )
          await invocationStore.update(invocation.invocationId, requestHash, {
            quoteAcceptanceRejected: true,
          });
        throw error;
      }
      // Keep the Order identity even if preparation/polling is interrupted.
      invocation = await invocationStore.update(
        invocation.invocationId,
        requestHash,
        { orderId: prepared.order.orderId },
      );
      assertOrderCanContinue(prepared);
      const payable = await waitForPaymentRequired(prepared);
      assertPreparedService(payable, context, requestHash);
      assertPreparedCommercialTerms(payable, invocation.acceptedTerms);
      const requirements = payable.paymentRequired;
      invocation = await invocationStore.update(
        invocation.invocationId,
        requestHash,
        { orderId: requirements.extra.orderId },
      );
      let signed;
      try {
        signed = await signCommitment(
          requirements,
          payable,
          invocation.commitmentNonce,
          context,
        );
      } catch (error) {
        if (error?.code !== "DUPLICATE_REQUEST") throw error;
        invocation = await invocationStore.update(
          invocation.invocationId,
          requestHash,
          { commitmentNonce: `0x${randomBytes(32).toString("hex")}` },
        );
        signed = await signCommitment(
          requirements,
          payable,
          invocation.commitmentNonce,
          context,
        );
      }
      const validBefore = signed.validBefore;
      const paymentPayload = {
        x402Version: 2,
        accepted: requirements,
        payload: {
          commitment: {
            binding: "agentpay.safe-module.v1",
            safe: requirements.extra.safe,
            policyId: requirements.extra.policyId,
            factory: requirements.extra.factory,
            orderId: requirements.extra.orderId,
            vault: requirements.payTo,
            token: requirements.asset,
            amount: requirements.amount,
            termsHash: requirements.extra.termsHash,
            scopeProofHash: requirements.extra.scopeProofHash,
            commitmentNonce: invocation.commitmentNonce,
            validBefore: String(validBefore),
          },
          signature: signed.signature,
        },
      };
      invocation = await invocationStore.update(
        invocation.invocationId,
        requestHash,
        { paymentPayload },
      );
    }
    const orderId = invocation.orderId;
    if (!invocation.paymentSubmitted) {
      await assertOriginalOrderOpen(orderId);
      await assertNotArchived(
        requiredEnv("AGENTPAY_USER_STATE_FILE"),
        invocation,
      );
      await submitPayment(
        invocation.paymentPayload,
        orderId,
        requestHash,
        input.request,
        context,
      );
      invocation = await invocationStore.update(
        invocation.invocationId,
        requestHash,
        { paymentSubmitted: true },
      );
    }
    const readiness = await waitForServiceReady(orderId, requestHash);
    if (
      readiness?.skillId !== context.skillId ||
      readiness?.profileHash !== context.profileHash ||
      readiness?.orderId !== orderId ||
      readiness?.requestHash !== requestHash ||
      BigInt(readiness.maxUsageUnits) > BigInt(context.requestedMaxUsageUnits)
    )
      throw coded(
        "SERVICE_AUTHORIZATION_MISMATCH",
        "Service Authorization differs from the bound Order",
      );
    if (!readiness?.authorization)
      throw coded(
        "SERVICE_NOT_READY",
        "Wallet did not return a Service Authorization",
      );
    await assertOriginalOrderOpen(orderId);
    const { response, payload } = await invokeProviderWithRetry(
      {
        authorization: readiness.authorization,
        orderId,
        requestHash,
        request: input.request,
      },
      context,
    );
    if (!response.ok || !payload?.ok)
      throw Object.assign(
        new Error(
          payload?.error?.message || `Provider HTTP ${response.status}`,
        ),
        {
          code: payload?.error?.code || "PROVIDER_FAILED",
          status: response.status,
        },
      );
    const delivered = providerOutput(
      payload,
      context,
      input.request,
      orderId,
      requestHash,
    );
    await resultStore.savePending(invocation, delivered);
    const output = delivered.output,
      outputHash = delivered.outputHash;
    const evidence = await waitForDeliveryEvidence(
      orderId,
      outputHash,
      invocation.recoveryScope,
      context,
      requestHash,
    );
    if (String(evidence.usageUnits) !== String(delivered.usageUnits)) {
      throw coded(
        "DELIVERY_EVIDENCE_MISMATCH",
        "Settlement Receipt usage does not match the Provider result",
      );
    }
    const result = {
      orderId,
      requestHash,
      version: "agentpay.runtime-result.v1",
      service: { skillId: callSkillId, profileHash: callProfileHash },
      output,
      outputHash,
      usageUnits: delivered.usageUnits,
      deliveryEvidenceVerified: true,
      confirmationRequired: false,
      finalization: evidence.finalization,
      deadlines: evidence.deadlines,
      ...(includeProviderEvidence && payload.negativeProbe
        ? { providerEvidence: payload.negativeProbe }
        : {}),
    };
    await resultStore.save(
      invocation,
      normalizeRuntimeResult(result, context, requestHash, orderId),
    );
    return json(res, 200, { ok: true, result });
  } catch (error) {
    const status =
      error?.status ||
      ([
        "FILE_INPUT_INVALID",
        "INVALID_INPUT",
        "INVALID_USAGE_CAP",
        "SERVICE_REFERENCE_INVALID",
        "INVALID_IDEMPOTENCY_KEY",
      ].includes(error?.code)
        ? 400
        : [
              "FILE_ORDER_UNAVAILABLE",
              "FILE_RESULT_UNVERIFIED",
              "QUOTE_TERMS_CHANGED",
              "QUOTE_TERMS_CONFLICT",
              "SERVICE_NOT_READY",
              "INVOCATION_CONFLICT",
              "INVOCATION_SERVICE_BINDING_MISMATCH",
              "ORDER_CLOSING",
              "ORDER_CANCELLED",
              "ORDER_REFUNDED",
            ].includes(error?.code)
          ? 409
          : 502);
    return json(res, status, {
      ok: false,
      error: {
        code: error?.code || "SKILL_INVOCATION_FAILED",
        message: String(error?.message || error),
        ...(error?.settlementCode
          ? { settlementCode: error.settlementCode }
          : {}),
        ...(error?.detail ? { detail: error.detail } : {}),
      },
    });
  } finally {
    releaseInvocation();
  }
});

server.listen(port, host, () => {
  void publishRuntimeReady(dirname(dirname(callerCredentialFile))).catch(error=>{
    console.error('Default Runtime connection could not be refreshed:',error.message);
  });
  process.stdout.write(
    `${JSON.stringify({
      ready: true,
      role: "user-runtime",
      url: `http://${originHost}:${port}`,
    })}\n`,
  );
  recovery.start();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void recovery.stop();
    server.close(() => process.exit(0));
  });

async function assertOriginalOrderOpen(orderId) {
  const result = settlementResult(
    await callWallet("readSettlementOrder", { settlementUrl, orderId }),
  );
  if (result.order?.orderId !== orderId)
    throw coded(
      "SETTLEMENT_RESPONSE_INVALID",
      "Settlement returned a different Order. Preserve the original request.",
    );
  assertOrderCanContinue(result);
  if (result.order.vaultState === "Released")
    throw Object.assign(
      coded(
        "ORDER_ALREADY_SETTLED",
        "This Order is settled but no verified local result is available. Preserve its request; do not repeat the purchase.",
      ),
      { status: 409 },
    );
  return result;
}
async function waitForPaymentRequired(initial) {
  const deadline = Date.now() + operationTimeoutMs;
  let current = initial;
  while (!current?.paymentRequired) {
    assertOrderCanContinue(current);
    if (Date.now() >= deadline)
      throw coded(
        "ORDER_PREPARATION_TIMEOUT",
        "Vault creation did not finish in time",
      );
    await delay(Math.min(250, remaining(deadline)));
    current = settlementResult(
      await callWallet(
        "readSettlementOrder",
        { settlementUrl, orderId: current?.order?.orderId },
        remaining(deadline),
      ),
    );
  }
  assertOrderCanContinue(current);
  return current;
}
async function waitForServiceReady(orderId, requestHash) {
  const deadline = Date.now() + operationTimeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      return settlementResult(
        await callWallet(
          "requestSettlementServiceReady",
          { settlementUrl, orderId, requestHash },
          remaining(deadline),
        ),
      );
    } catch (error) {
      if (
        [
          "ORDER_CLOSING",
          "ORDER_CANCELLED",
          "ORDER_REFUNDED",
          "ORDER_RESPONSE_DEADLINE_PASSED",
          "ORDER_PAYMENT_DEADLINE_PASSED",
        ].includes(error?.settlementCode || error?.code)
      )
        throw error;
      await assertOriginalOrderOpen(orderId);
      last = error;
      await delay(Math.min(350, remaining(deadline)));
    }
  }
  throw Object.assign(new Error("Payment was not activated in time"), {
    code: "SERVICE_READY_TIMEOUT",
    cause: last,
    detail: last?.code
      ? `${last.code}: ${last.message}`
      : String(last?.message || last || "unknown"),
  });
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function signCommitment(requirements, payable, commitmentNonce, context) {
  const { skillId, profileHash } = context;
  const validBefore =
    Math.floor(Date.now() / 1000) + Number(requirements.maxTimeoutSeconds);
  const signed = await callWallet("signAgentPayCommitment", {
    commitment: {
      version: "agentpay.safe-module.v1",
      orderId: requirements.extra.orderId,
      vault: requirements.payTo,
      amount: requirements.amount,
      termsHash: requirements.extra.termsHash,
      skillId,
      profileHash,
      seller: payable.commitmentContext?.seller,
      commitmentNonce,
      validBefore,
    },
  });
  return { ...signed, validBefore };
}
async function submitPayment(
  paymentPayload,
  orderId,
  requestHash,
  request,
  context,
) {
  const { response, result } = await fetchJsonWithTimeout(
    context.endpointUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": Buffer.from(
          JSON.stringify(paymentPayload),
        ).toString("base64"),
      },
      body: JSON.stringify(
        providerRequest(context, orderId, requestHash, request),
      ),
    },
    operationTimeoutMs,
  );
  if (![200, 202].includes(response.status))
    throw Object.assign(
      new Error(
        result?.error?.message || `Provider payment HTTP ${response.status}`,
      ),
      {
        code: result?.error?.code || "PAYMENT_FAILED",
        status: response.status,
      },
    );
  if (
    !result?.result?.success &&
    result?.result?.errorReason !== "settlement_pending"
  )
    throw Object.assign(
      new Error(result?.result?.errorMessage || "Settlement rejected payment"),
      { code: result?.result?.errorReason || "PAYMENT_REJECTED", status: 422 },
    );
}
async function waitForDeliveryEvidence(
  orderId,
  outputHash,
  recoveryScope,
  context,
  requestHash,
) {
  const deadline = Date.now() + operationTimeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const current = settlementResult(
        await callWallet(
          "readSettlementOrder",
          {
            settlementUrl,
            orderId,
            ...(recoveryScope ? { recoveryScope } : {}),
          },
          remaining(deadline),
        ),
      );
      const o = current.order,
        p = context.reference.profile;
      if (
        !o ||
        o.orderId !== orderId ||
        o.requestHash !== requestHash ||
        o.skillId !== context.skillId ||
        o.profileHash !== context.profileHash ||
        o.providerId !== p.providerId ||
        String(o.assetAddress).toLowerCase() !== p.asset ||
        `eip155:${o.chainId}` !== p.network
      )
        throw coded(
          "DELIVERY_EVIDENCE_MISMATCH",
          "Settlement Order identity differs from the saved result",
        );
      const evidence = current.deliveryEvidence;
      if (evidence) {
        if (String(evidence.outputHash).toLowerCase() !== outputHash)
          throw coded(
            "DELIVERY_EVIDENCE_MISMATCH",
            "Settlement Receipt does not match the returned output",
          );
        return {
          ...evidence,
          deadlines: current.deadlines,
          finalization: readFinalizationDisclosure(current.finalization),
        };
      }
    } catch (error) {
      if (error?.code === "DELIVERY_EVIDENCE_MISMATCH") throw error;
      last = error;
    }
    await delay(Math.min(250, remaining(deadline)));
  }
  throw Object.assign(
    new Error("Settlement did not expose accepted delivery evidence in time"),
    {
      code: "DELIVERY_EVIDENCE_TIMEOUT",
      detail: String(last?.message || last || "unknown"),
    },
  );
}
async function invokeProviderWithRetry(input, context) {
  const deadline = Date.now() + operationTimeoutMs;
  let last;
  let retryDelayMs = 200;
  const pause = async () => {
    await delay(Math.min(retryDelayMs, remaining(deadline)));
    retryDelayMs = Math.min(5000, retryDelayMs * 2);
  };
  while (Date.now() < deadline) {
    try {
      const { response, result: payload } = await fetchJsonWithTimeout(
        context.endpointUrl,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `AgentPay ${input.authorization}`,
          },
          body: JSON.stringify(
            providerRequest(
              context,
              input.orderId,
              input.requestHash,
              input.request,
            ),
          ),
        },
        remaining(deadline),
      );
      if (
        response.status === 502 &&
        payload?.error?.code === "PROVIDER_REJECTED"
      )
        return { response, payload };
      if (response.status >= 500) {
        last = Object.assign(
          new Error(
            payload?.error?.message || `Provider HTTP ${response.status}`,
          ),
          { code: payload?.error?.code || "PROVIDER_RETRY" },
        );
        await pause();
        continue;
      }
      return { response, payload };
    } catch (error) {
      if (
        [
          "TRANSPORT_REDIRECT_REJECTED",
          "TRANSPORT_RESPONSE_TOO_LARGE",
        ].includes(error?.code)
      )
        throw error;
      last = error;
      await pause();
    }
  }
  throw Object.assign(
    new Error("Provider did not recover before the invocation deadline"),
    {
      code: "PROVIDER_RECOVERY_TIMEOUT",
      detail: String(last?.message || last || "unknown"),
    },
  );
}

async function callWallet(method, params, timeoutMs = operationTimeoutMs) {
  const handle = await open(
    walletCapabilityFile,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let walletCapability;
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      info.size > 1024
    )
      throw coded(
        "WALLET_CREDENTIAL_UNAVAILABLE",
        "Check local Wallet installation.",
      );
    walletCapability = (await handle.readFile("utf8")).trim();
  } finally {
    await handle.close();
  }
  if (
    !/^[0-9a-f]{64}$/.test(walletCapability) ||
    walletCapability === callerCredential
  )
    throw coded(
      "WALLET_CREDENTIAL_UNAVAILABLE",
      "Check local Wallet installation.",
    );
  const request = `${JSON.stringify({ id: randomBytes(8).toString("hex"), token: walletCapability, method, params })}\n`;
  return new Promise((resolve, reject) => {
    const socket = createConnection(walletSocket);
    let response = "";
    socket.setEncoding("utf8");
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(coded("WALLET_TIMEOUT", "Wallet IPC did not respond in time")),
      Math.max(1, timeoutMs),
    );
    socket.once("error", (error) => finish(error));
    socket.once("close", () =>
      finish(
        coded(
          "WALLET_EMPTY_RESPONSE",
          "Wallet IPC closed without a complete response",
        ),
      ),
    );
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.length > 2 * 1048576)
        finish(
          coded(
            "WALLET_RESPONSE_TOO_LARGE",
            "Wallet response exceeds the size limit",
          ),
        );
    });
    socket.on("end", () => {
      try {
        if (!response.trim())
          throw coded(
            "WALLET_EMPTY_RESPONSE",
            "Wallet IPC closed without a response",
          );
        const payload = JSON.parse(response);
        if (!payload.ok) throw walletIpcError(payload);
        finish(null, payload.result);
      } catch (error) {
        finish(error);
      }
    });
    socket.write(request);
  });
}
function remaining(deadline) {
  return Math.max(1, deadline - Date.now());
}
async function readJson(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 300000)
      throw coded(
        "INVALID_INPUT",
        "Request body exceeds the local JSON size limit",
      );
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw coded("INVALID_INPUT", "invalid JSON body");
  }
}
function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}
function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function bytes32(value, name) {
  const text = String(value || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(text))
    throw new Error(`${name} must be bytes32`);
  return text;
}
function uint(value, name) {
  const text = String(value || "");
  if (!/^[1-9][0-9]*$/.test(text))
    throw new Error(`${name} must be a positive uint`);
  return text;
}
function coded(code, message) {
  return Object.assign(new Error(message), { code });
}
async function acquireInvocation(value) {
  const key = String(value || "");
  if (activeInvocations >= 64)
    throw Object.assign(
      coded("INVOCATION_BUSY", "Runtime is busy; retry the same request later"),
      { status: 503 },
    );
  activeInvocations++;
  const previous = invocationLocks.get(key) || Promise.resolve();
  let unlock;
  const current = new Promise((resolve) => {
    unlock = resolve;
  });
  invocationLocks.set(key, current);
  await previous;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeInvocations--;
    unlock();
    if (invocationLocks.get(key) === current) invocationLocks.delete(key);
  };
}
