#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Release check only: never execute the package or accept a new hash automatically.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  officialTestPackageForDigest,
  verifyOfficialTestBytes,
} from "../src/official-test-package.mjs";
import { parseSkillBundle, skillArchiveLimits } from "../src/skill-bundle.mjs";
try {
  if (process.argv.length !== 3)
    throw Error(
      "Usage: node scripts/check-official-test-package.mjs PATH_TO_REVIEWED_ZIP",
    );
  const path = process.argv[2];
  const info = await stat(path);
  if (!info.isFile() || info.size > skillArchiveLimits.compressed)
    throw Error("Invalid package file or size.");
  const bytes = await readFile(path);
  const OFFICIAL_TEST_PACKAGE=officialTestPackageForDigest(createHash("sha256").update(bytes).digest("hex"));
  if(!OFFICIAL_TEST_PACKAGE)throw Error("ZIP is not in this User release's reviewed official test mappings.");
  verifyOfficialTestBytes(bytes,OFFICIAL_TEST_PACKAGE);
  const bundle = parseSkillBundle(bytes);
  if (
    bundle.manifest.packageName !== OFFICIAL_TEST_PACKAGE.name ||
    bundle.manifest.packageVersion !== OFFICIAL_TEST_PACKAGE.version
  )
    throw Error("Pinned package name/version differ from the release record.");
  console.log(
    `Official test package verified: ${OFFICIAL_TEST_PACKAGE.name} ${OFFICIAL_TEST_PACKAGE.version}\nSHA-256: ${OFFICIAL_TEST_PACKAGE.sha256}\nNo package scripts were executed.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
