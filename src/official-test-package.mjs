// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { createHash } from "node:crypto";

// Release-reviewed ZIP bytes, not a value supplied by Market or deployment config.
// Update only after reviewing the actual official package. See the release runbook.
// This belongs to the official onboarding test, never generic Runtime routing.
export const OFFICIAL_TEST_PACKAGE = Object.freeze({
  name: "agentpay-random",
  version: "1.2.1",
  sha256: "20633b314c66166f94dc6e7d7eb5bce54ab5901fb1ed314a04ea3fd49ca8a9a4",
});
const mismatch = () =>
  Object.assign(
    new Error(
      "The official test package does not match this User release. Keep your existing files and requests. Check for a reviewed User update; do not bypass the file check.",
    ),
    { code: "OFFICIAL_TEST_PACKAGE_MISMATCH" },
  );

export function verifyOfficialTestBytes(bytes) {
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    OFFICIAL_TEST_PACKAGE.sha256
  )
    throw mismatch();
}
export function verifyOfficialTestDigest(digest) {
  if (digest !== OFFICIAL_TEST_PACKAGE.sha256) throw mismatch();
}
// A saved test may recover using its original locally verified material. This
// never selects a replacement package or grants permission for another purchase.
// The caller must still validate the checkpoint against local invocation history.
export function verifyOfficialTestSelection(skill, checkpoint, savedDigest) {
  if (!skill) return;
  if (skill.bundle?.locallyModified) throw mismatch();
  if (skill.bundle?.sha256 === OFFICIAL_TEST_PACKAGE.sha256) return;
  if (checkpoint && skill.bundle?.sha256 === savedDigest) return;
  throw mismatch();
}
