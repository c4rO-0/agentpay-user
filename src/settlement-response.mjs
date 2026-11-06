// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  normalizeParticipantOrder,
  normalizeFinalizationDisclosure,
  normalizeOrderDeadlines,
  normalizeServiceAuthorization,
  AGENTPAY_SERVICE_AUTHORIZATION_V2,
  normalizeDeliveryResult,
  validateOrderWaiting,
  validateOrderClosure,
  AGENTPAY_DELIVERY_RESULT_V2,
} from "@agentpay/types";

// Keep integer timestamps inside Runtime; v1 is an explicit ingress adapter.
export function readSettlementResult(value) {
  const fail = () => {
    throw Object.assign(
      new Error("Settlement response has invalid fields or timestamps"),
      { code: "SETTLEMENT_RESPONSE_INVALID" },
    );
  };
  if (
    value?.ok !== true ||
    !value.result ||
    typeof value.result !== "object" ||
    Array.isArray(value.result)
  )
    fail();
  try {
    let result = { ...value.result };
    if (
      result.version === AGENTPAY_SERVICE_AUTHORIZATION_V2 ||
      (Object.hasOwn(result, "authorizationId") &&
        (Object.hasOwn(result, "expiresAt") ||
          Object.hasOwn(result, "expiresAtMs") ||
          Object.hasOwn(result, "state") ||
          Object.hasOwn(result, "authorization")))
    )
      result = normalizeServiceAuthorization(result);
    if (
      result.version === AGENTPAY_DELIVERY_RESULT_V2 ||
      Object.hasOwn(result, "confirmedAt") ||
      Object.hasOwn(result, "confirmedAtMs") ||
      (Object.hasOwn(result, "receiptId") && Object.hasOwn(result, "billing"))
    )
      result = normalizeDeliveryResult(result);
    if (Object.hasOwn(result, "order")) {
      result.order = normalizeParticipantOrder(result.order);
      if (result.order.role !== "buyer") fail();
    }
    if (result.waiting != null)
      result.waiting = validateOrderWaiting(result.waiting);
    if (result.closure != null) {
      result.closure = validateOrderClosure(result.closure);
      if (result.paymentRequired != null) fail();
    }
    if (result.deadlines != null)
      result.deadlines = normalizeOrderDeadlines(result.deadlines);
    if (result.finalization != null)
      result.finalization = normalizeFinalizationDisclosure(
        result.finalization,
      );
    return result;
  } catch {
    fail();
  }
}
