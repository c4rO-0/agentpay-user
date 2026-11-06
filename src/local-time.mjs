// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  assertUnixMilliseconds,
  parseLegacyIsoMilliseconds,
  unixSecondsToMilliseconds,
} from "@agentpay/types";
export const currentTimeMs = () => assertUnixMilliseconds(Date.now());
// Explicit migration adapter for known local fields only; never inspect signed payloads.
export function localTimeMs(entry, key) {
  if (Object.hasOwn(entry, key + "Ms")) {
    const ms = assertUnixMilliseconds(entry[key + "Ms"]);
    if (
      Object.hasOwn(entry, key) &&
      parseLegacyIsoMilliseconds(entry[key]) !== ms
    )
      throw Error("LOCAL_TIME_CONFLICT");
    return ms;
  }
  return parseLegacyIsoMilliseconds(entry[key]);
}
export function displayTime(ms) {
  assertUnixMilliseconds(ms);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "long",
      timeZone: zone,
    }).format(ms) + ` (${zone})`
  );
}
export function displaySeconds(seconds) {
  return displayTime(unixSecondsToMilliseconds(seconds));
}
