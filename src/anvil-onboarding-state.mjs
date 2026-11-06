// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { createHash } from "node:crypto";
import { hashPrivateRequest } from "@agentpay/types";

// These are local guide checks, not a new Policy or payment authority.
export function sameWalletPolicy(actual, expected) {
  if (!actual || !expected) return false;
  const keys = Object.keys(expected);
  return (
    Object.keys(actual).length === keys.length &&
    keys.every((key) => {
      if (key === "registryRpcUrl")
        return new URL(actual[key]).href === new URL(expected[key]).href;
      if (typeof expected[key] === "string" && expected[key].startsWith("0x")) {
        return (
          typeof actual[key] === "string" &&
          actual[key].toLowerCase() === expected[key].toLowerCase()
        );
      }
      return actual[key] === expected[key];
    })
  );
}
export function validateGuideTestCheckpoint(checkpoint, history, skill) {
  if (!checkpoint) return null;
  const b32 = (value) => /^0x[0-9a-f]{64}$/.test(value || "");
  if (
    checkpoint.version !== "agentpay.model-ack-smoke.v1" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      checkpoint.key || "",
    ) ||
    typeof checkpoint.confirmed !== "boolean" ||
    !(checkpoint.orderId === null || b32(checkpoint.orderId)) ||
    !(checkpoint.outputHash === null || b32(checkpoint.outputHash)) ||
    (checkpoint.confirmed &&
      (!b32(checkpoint.orderId) || !b32(checkpoint.outputHash)))
  ) {
    throw Error("GUIDE_TEST_CHECKPOINT_INVALID");
  }
  if (!skill) throw Error("GUIDE_TEST_SKILL_REQUIRED");
  if (
    !skill.reference ||
    skill.reference.skillId !== skill.skillId ||
    skill.reference.profileHash !== skill.profileHash
  )
    throw Error("GUIDE_TEST_SKILL_HISTORY_MISMATCH");
  if (checkpoint.routingVersion !== "agentpay.runtime-call.v1")
    throw Error("GUIDE_LEGACY_TEST_REVIEW_REQUIRED");
  const id = `0x${createHash("sha256").update(`agentpay.user-invocation.v1:${checkpoint.key}`).digest("hex")}`;
  if (
    history &&
    (history.version !== "agentpay.user-invocations.v1" ||
      !history.invocations ||
      typeof history.invocations !== "object" ||
      Array.isArray(history.invocations))
  )
    throw Error("GUIDE_INVOCATION_HISTORY_INVALID");
  const entry = history?.invocations?.[id];
  if (checkpoint.orderId && (!entry || entry.orderId !== checkpoint.orderId))
    throw Error("GUIDE_TEST_ORDER_HISTORY_MISMATCH");
  if (entry) {
    const binding = JSON.stringify({
      version: "agentpay.runtime-service.v1",
      reference: skill.reference,
      requestedMaxUsageUnits: "1",
    });
    if (
      entry.invocationId !== id ||
      entry.requestHash !== hashPrivateRequest({ min: 10, max: 99 }) ||
      entry.serviceBinding !== binding
    )
      throw Error("GUIDE_TEST_SKILL_HISTORY_MISMATCH");
  }
  return { ...checkpoint, hasOrder: Boolean(entry?.orderId) };
}
export function guideNextAction({
  initialized,
  plan,
  chain,
  bound,
  installed,
  liveWallet,
  liveRuntime,
  checked,
  test,
}) {
  if (!initialized) return "initialize";
  if (!plan) return "limits";
  if (!chain?.moduleEnabled || !chain?.policyMatches) return "approve";
  if (!bound) return "bind";
  if (!liveWallet || liveWallet.locked || !liveRuntime) return "start";
  if (!installed) return "install";
  return checked || test ? "test" : "check";
}
