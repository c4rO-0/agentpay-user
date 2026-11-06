// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { validateCacheLimits } from "../src/file-cache-settings.mjs";
test("local cache limits are configurable with bounded, dimensionally consistent values", () => {
  assert.equal(
    validateCacheLimits({
      singleBytes: 200 * 1048576,
      totalBytes: 1024 ** 3,
      timeoutMs: 3600000,
    }).timeoutMs,
    3600000,
  );
  for (const input of [
    { totalBytes: 1 },
    { singleBytes: -1 },
    { concurrent: 17 },
    { records: 100001 },
    { timeoutMs: 86400001 },
    { unknown: 1 },
  ])
    assert.throws(() => validateCacheLimits(input));
});
