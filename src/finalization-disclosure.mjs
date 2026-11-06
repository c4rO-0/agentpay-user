// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { normalizeFinalizationDisclosure } from "@agentpay/types";

// Settlement owns these instants. Never calculate a deadline from the local clock.
export function readFinalizationDisclosure(value) {
  try {
    return normalizeFinalizationDisclosure(value);
  } catch {
    throw Object.assign(
      new Error("Settlement finalization schedule is missing or invalid"),
      { code: "FINALIZATION_SCHEDULE_UNAVAILABLE" },
    );
  }
}
