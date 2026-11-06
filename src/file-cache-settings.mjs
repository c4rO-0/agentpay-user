// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { readPrivateJson } from "./order-review.mjs";
export const fileCacheLimits = Object.freeze({
  singleBytes: 100 * 1048576,
  totalBytes: 512 * 1048576,
  filesPerResult: 20,
  concurrent: 2,
  records: 10000,
  timeoutMs: 900000,
});
export function validateCacheLimits(input = {}) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !Object.hasOwn(fileCacheLimits, k))
  )
    throw Error("Invalid file cache settings.");
  const limits = { ...fileCacheLimits, ...input };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw Error(`File cache ${key} must be a positive integer.`);
  if (
    limits.singleBytes > limits.totalBytes ||
    limits.totalBytes > 1024 ** 4 ||
    limits.concurrent > 16 ||
    limits.records > 100000 ||
    limits.filesPerResult > limits.records ||
    limits.timeoutMs > 86400000
  )
    throw Error("File cache settings exceed supported bounds.");
  return limits;
}
export async function readCacheLimits(statePath) {
  try {
    return validateCacheLimits(
      (await readPrivateJson(statePath + ".file-cache-settings.json", 16384)) ||
        {},
    );
  } catch {
    throw Object.assign(
      Error(
        "File cache settings could not be read. Check the private JSON file shown by ./run cache settings.",
      ),
      { code: "FILE_SETTINGS_INVALID", status: 409 },
    );
  }
}
