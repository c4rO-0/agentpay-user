// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  normalizeServiceReference,
  canonicalizeServiceJson,
  normalizeServiceResult,
  AGENTPAY_SERVICE_INVOCATION_VERSION,
} from "@agentpay/types";
export const SERVICE_REFERENCE_VERSION = "agentpay.service-reference.v1";
export function parseServiceReference(value) {
  try {
    return normalizeServiceReference(value);
  } catch {
    throw coded(
      "SERVICE_REFERENCE_INVALID",
      "Service reference or registered profile hash is invalid.",
    );
  }
}
export function serviceRequest(value) {
  try {
    return JSON.parse(canonicalizeServiceJson(value));
  } catch {
    throw coded(
      "INVALID_INPUT",
      "Request must be bounded JSON with no more than 32 levels.",
    );
  }
}
export function usageCap(value = "1") {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,76}$/.test(value))
    throw coded(
      "INVALID_USAGE_CAP",
      "Maximum usage must be a positive integer string.",
    );
  return value;
}
export function serviceContext(body, localUsageCap = "1000000") {
  if (
    !body ||
    Object.keys(body)
      .filter((k) => k !== "acceptedTerms")
      .sort()
      .join(",") !== "request,requestedMaxUsageUnits,service,version" ||
    body.version !== "agentpay.runtime-call.v1"
  )
    throw coded(
      "INVALID_INPUT",
      "Use the versioned Runtime call with service, request and maximum usage.",
    );
  const reference = parseServiceReference(body.service),
    requestedMaxUsageUnits = usageCap(body.requestedMaxUsageUnits);
  if (BigInt(requestedMaxUsageUnits) > BigInt(usageCap(localUsageCap)))
    throw coded(
      "INVALID_USAGE_CAP",
      "Requested usage exceeds the local Runtime cap.",
    );
  const request = serviceRequest(body.request);
  return {
    reference,
    skillId: reference.skillId,
    profileHash: reference.profileHash,
    endpointUrl: reference.profile.paymentEndpoint,
    adapter: reference.adapter,
    requestedMaxUsageUnits,
    request,
    ...(body.acceptedTerms === undefined
      ? {}
      : { acceptedTerms: normalizeAcceptedTerms(body.acceptedTerms) }),
    binding: JSON.stringify({
      version: "agentpay.runtime-service.v1",
      reference,
      requestedMaxUsageUnits,
    }),
  };
}
export function assertPreparedService(result, context, requestHash) {
  const order = result?.order,
    profile = context.reference.profile;
  if (
    !order ||
    order.skillId !== context.skillId ||
    order.profileHash !== context.profileHash ||
    order.requestHash !== requestHash ||
    order.providerId !== profile.providerId ||
    String(order.assetAddress).toLowerCase() !== profile.asset ||
    `eip155:${order.chainId}` !== profile.network ||
    String(result.commitmentContext?.seller).toLowerCase() !== profile.seller ||
    BigInt(order.maxUsageUnits) > BigInt(context.requestedMaxUsageUnits)
  )
    throw coded(
      "SETTLEMENT_SERVICE_MISMATCH",
      "Prepared Order does not match the registered service reference.",
    );
}
export function providerRequest(context, orderId, requestHash, request) {
  return {
    version: AGENTPAY_SERVICE_INVOCATION_VERSION,
    orderId,
    requestHash,
    request,
  };
}
export function providerOutput(payload, context, input, orderId, requestHash) {
  let result;
  try {
    result = normalizeServiceResult(payload?.result);
    if (
      result.orderId !== orderId ||
      result.requestHash !== requestHash ||
      !/^(0|[1-9][0-9]{0,76})$/.test(result.usageUnits || "") ||
      BigInt(result.usageUnits) > BigInt(context.requestedMaxUsageUnits)
    )
      throw Error();
  } catch {
    throw coded(
      "PROVIDER_RESPONSE_INVALID",
      "Provider output, hash, usage or request identity does not match this invocation.",
    );
  }
  return result;
}
function coded(code, message) {
  return Object.assign(Error(message), { code });
}

export function normalizeRuntimeResult(
  value,
  context,
  requestHash,
  orderId = null,
) {
  try {
    if (
      value?.version !== "agentpay.runtime-result.v1" ||
      value.service?.skillId !== context.skillId ||
      value.service?.profileHash !== context.profileHash ||
      value.requestHash !== requestHash ||
      !/^0x[0-9a-f]{64}$/.test(value.orderId || "") ||
      (orderId && value.orderId !== orderId) ||
      value.deliveryEvidenceVerified !== true
    )
      throw Error();
    const delivery = normalizeServiceResult({
      version: "agentpay.service-result.v1",
      orderId: value.orderId,
      requestHash,
      output: value.output,
      outputHash: value.outputHash,
      usageUnits: value.usageUnits,
    });
    if (BigInt(delivery.usageUnits) > BigInt(context.requestedMaxUsageUnits))
      throw Error();
    return {
      version: "agentpay.runtime-result.v1",
      orderId: value.orderId,
      requestHash,
      service: { skillId: context.skillId, profileHash: context.profileHash },
      output: delivery.output,
      outputHash: delivery.outputHash,
      usageUnits: delivery.usageUnits,
      deliveryEvidenceVerified: true,
      confirmationRequired: false,
      finalization: value.finalization,
      deadlines: value.deadlines,
    };
  } catch {
    throw coded(
      "RUNTIME_RESPONSE_INVALID",
      "Runtime result does not match the bound service, input or usage cap.",
    );
  }
}

export function normalizeAcceptedTerms(value) {
  if (
    !value ||
    Object.keys(value).sort().join(",") !==
      "baseAmountAtomic,serviceWindowSeconds,unitPriceAtomic" ||
    typeof value.baseAmountAtomic !== "string" ||
    typeof value.unitPriceAtomic !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value.baseAmountAtomic) ||
    !/^(0|[1-9][0-9]*)$/.test(value.unitPriceAtomic) ||
    !Number.isSafeInteger(value.serviceWindowSeconds) ||
    value.serviceWindowSeconds < 1 ||
    value.serviceWindowSeconds > 31536000
  )
    throw coded(
      "QUOTE_TERMS_INVALID",
      "Review the price and maximum delivery duration.",
    );
  return {
    baseAmountAtomic: value.baseAmountAtomic,
    unitPriceAtomic: value.unitPriceAtomic,
    serviceWindowSeconds: value.serviceWindowSeconds,
  };
}

// Check again before signing, including when an older Wallet transport omitted
// the accepted conditions. A mismatch keeps the original Order, never reaccepts it.
export function assertPreparedCommercialTerms(result, accepted) {
  if (!accepted) return;
  const fail = () => {
    throw coded(
      "ORDER_TERMS_MISMATCH",
      "Prepared Order differs from the accepted price or delivery time. Preserve this Order; no payment was authorized.",
    );
  };
  const order = result?.order,
    due = result?.deadlines?.deliveryDueAtMs;
  if (
    !order ||
    order.basePriceAtomic !== accepted.baseAmountAtomic ||
    order.unitPriceAtomic !== accepted.unitPriceAtomic ||
    !Number.isSafeInteger(order.createdAtMs) ||
    due - order.createdAtMs !== accepted.serviceWindowSeconds * 1000
  )
    fail();
  try {
    const amount =
      BigInt(accepted.baseAmountAtomic) +
      BigInt(accepted.unitPriceAtomic) * BigInt(order.maxUsageUnits);
    if (
      amount !== BigInt(order.prepaidAmountAtomic) ||
      (result.paymentRequired &&
        BigInt(result.paymentRequired.amount) !== amount)
    )
      fail();
  } catch {
    fail();
  }
}
