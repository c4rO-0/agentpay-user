// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFinalizationDisclosure } from "@agentpay/types";
import { readFinalizationDisclosure } from "../src/finalization-disclosure.mjs";
const schedule = {
  state: "awaiting_confirmation",
  deliveryAcceptedAt: "2026-09-27T09:00:50.209Z",
  confirmedAt: null,
  releaseScheduledAt: "2026-09-27T09:10:50.209Z",
  automaticReleaseBlocked: false,
  resolution: null,
  automaticReleaseRequiresConfirmation: false,
};
test("Runtime passes Settlement deadline through without recomputing or requiring confirmation", () => {
  assert.deepEqual(
    readFinalizationDisclosure(schedule),
    normalizeFinalizationDisclosure(schedule),
  );
});
test("missing or invalid schedules fail instead of fabricating a deadline", () => {
  for (const v of [
    null,
    {},
    { ...schedule, releaseScheduledAt: null },
    { ...schedule, releaseScheduledAt: "bad" },
    { ...schedule, automaticReleaseRequiresConfirmation: true },
    { ...schedule, deliveryAcceptedAt: "2026-09-27T09:00:50" },
    {
      ...normalizeFinalizationDisclosure(schedule),
      releaseScheduledAtMs: "1790000000000",
    },
  ])
    assert.throws(() => readFinalizationDisclosure(v), {
      code: "FINALIZATION_SCHEDULE_UNAVAILABLE",
    });
});
test("disputed and completed orders retain explicit no-upcoming-release state", () => {
  for (const patch of [
    { state: "disputed", automaticReleaseBlocked: true },
    { state: "finalized" },
    { state: "queued", resolution: "refund" },
  ]) {
    const v = { ...schedule, ...patch, releaseScheduledAt: null };
    assert.deepEqual(
      readFinalizationDisclosure(v),
      normalizeFinalizationDisclosure(v),
    );
  }
});
