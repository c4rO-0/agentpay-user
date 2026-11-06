// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  OFFICIAL_TEST_PACKAGE,
  verifyOfficialTestBytes,
  verifyOfficialTestDigest,
  verifyOfficialTestSelection,
} from "../src/official-test-package.mjs";

test("official package trust comes from the User release, not matching attacker metadata", () => {
  const malicious = Buffer.from("substitute ZIP");
  const claimed = createHash("sha256").update(malicious).digest("hex");
  assert.throws(() => verifyOfficialTestDigest(claimed), {
    code: "OFFICIAL_TEST_PACKAGE_MISMATCH",
  });
  assert.throws(() => verifyOfficialTestBytes(malicious), {
    code: "OFFICIAL_TEST_PACKAGE_MISMATCH",
  });
  assert.doesNotThrow(() =>
    verifyOfficialTestDigest(OFFICIAL_TEST_PACKAGE.sha256),
  );
});
test("new tests require the pinned unmodified package; old material is recovery-only", () => {
  const skill = (sha256) => ({ bundle: { sha256, locallyModified: false } });
  assert.doesNotThrow(() =>
    verifyOfficialTestSelection(
      skill(OFFICIAL_TEST_PACKAGE.sha256),
      null,
      "a".repeat(64),
    ),
  );
  assert.throws(
    () =>
      verifyOfficialTestSelection(skill("a".repeat(64)), null, "a".repeat(64)),
    { code: "OFFICIAL_TEST_PACKAGE_MISMATCH" },
  );
  assert.doesNotThrow(() =>
    verifyOfficialTestSelection(
      skill("a".repeat(64)),
      { key: "original" },
      "a".repeat(64),
    ),
  );
  assert.throws(() =>
    verifyOfficialTestSelection(
      skill("b".repeat(64)),
      { key: "original" },
      "a".repeat(64),
    ),
  );
  assert.throws(() =>
    verifyOfficialTestSelection(
      {
        bundle: { sha256: OFFICIAL_TEST_PACKAGE.sha256, locallyModified: true },
      },
      null,
    ),
  );
});
