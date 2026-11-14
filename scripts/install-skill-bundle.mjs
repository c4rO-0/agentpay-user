#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  officialTestPackageForDigest,
  verifyOfficialTestBytes,
  verifyOfficialTestDigest,
} from "../src/official-test-package.mjs";
import { marketDownloadUrl, marketVersionMetadataUrl } from "../src/market-download-url.mjs";
import { resolve } from "node:path";
import {
  inspectInstalledBundle,
  selectInstalledBundle,
} from "../src/active-skill.mjs";
import { confirmSkillAction } from "../src/skill-install-prompt.mjs";
import {
  parseSkillBundle,
  installSkillBundle,
  skillArchiveLimits,
} from "../src/skill-bundle.mjs";
const [mode, data, source, requestedDigest, sourceMode] = process.argv.slice(2);
const official = mode === "--prepare-official-test";
const digest = requestedDigest;
if(official && !officialTestPackageForDigest(digest))verifyOfficialTestDigest(digest);
const marketMode = sourceMode === "--market";
if (
  ![
    "--preview",
    "--execute",
    "--execute-and-select",
    "--prepare-official-test",
  ].includes(mode) ||
  !data ||
  !source ||
  (marketMode ? process.argv.length !== 7 : process.argv.length !== 6) ||
  (sourceMode && !marketMode) ||
  !/^[a-f0-9]{64}$/.test(digest || "")
) {
  throw new Error(
    "Usage: install-skill-bundle.mjs <--preview|--execute|--execute-and-select|--prepare-official-test> <private-data-dir> <provider-bundle-url|market-metadata-url> <expected-sha256> [--market]",
  );
}
if (mode === "--prepare-official-test" && !marketMode)
  throw Error("OFFICIAL_TEST_MARKET_REQUIRED");
const url = official ? marketVersionMetadataUrl(source, digest) : new URL(source);
if (
  url.username ||
  url.password ||
  url.hash ||
  url.search ||
  !(
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  )
)
  throw new Error("BUNDLE_HTTPS_OR_LOOPBACK_REQUIRED");
let downloadUrl = url;
let metadata = null;
if (marketMode) {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (official && [404, 410].includes(r.status))
    throw Error("This official test version is unavailable in Market. Check for a reviewed User update or contact support; no replacement was selected.");
  if (!r.ok) throw new Error(`MARKET_BUNDLE_METADATA_HTTP_${r.status}`);
  const body = await r.json();
  metadata = body.result;
  if (official) verifyOfficialTestDigest(metadata?.sha256, officialTestPackageForDigest(digest));
  if (
    body.ok !== true ||
    metadata.sha256 !== digest ||
    typeof metadata.packageName !== "string" ||
    typeof metadata.packageVersion !== "string" ||
    !Number.isSafeInteger(metadata.byteLength) ||
    metadata.byteLength < 1 ||
    metadata.byteLength > skillArchiveLimits.compressed ||
    typeof metadata.publisherId !== "string" ||
    !metadata.publisherId ||
    typeof metadata.marketServiceId !== "string" ||
    metadata.marketDownloadPath !==
      marketDownloadUrl(url, metadata.marketServiceId).pathname.replace(/^\/market(?=\/skills\/)/, "")
  )
    throw new Error("MARKET_BUNDLE_METADATA_INVALID");
  downloadUrl = marketDownloadUrl(url, metadata.marketServiceId);
  if (downloadUrl.origin !== url.origin)
    throw new Error("MARKET_DOWNLOAD_ORIGIN_MISMATCH");
}
const response = await fetch(downloadUrl, {
  redirect: "error",
  signal: AbortSignal.timeout(5000),
});
if (!response.ok || !response.body)
  throw new Error(`BUNDLE_HTTP_${response.status}`);
const chunks = [];
let length = 0;
for await (const chunk of response.body) {
  length += chunk.length;
  if (length > skillArchiveLimits.compressed)
    throw new Error("BUNDLE_SIZE_INVALID");
  chunks.push(chunk);
}
const bytes = Buffer.concat(chunks);
if (official) verifyOfficialTestBytes(bytes, officialTestPackageForDigest(digest)); // Check raw bytes before parsing or saving any package files.
const bundle = parseSkillBundle(bytes);
if (bundle.sha256 !== digest) throw new Error("BUNDLE_DIGEST_MISMATCH");
if (marketMode) {
  const references = metadata.services ?? {};
  if (
    bundle.manifest.packageName !== metadata.packageName ||
    bundle.manifest.packageVersion !== metadata.packageVersion ||
    bytes.length !== metadata.byteLength ||
    JSON.stringify(bundle.services) !== JSON.stringify(references) ||
    metadata.source !== "publisher-upload"
  )
    throw Error("MARKET_BUNDLE_IDENTITY_MISMATCH");
}
// The explicit download URL and expected digest define the package source.
// Service endpoints and aliases do not determine where a publisher hosts its ZIP.
const details = {
  ok: true,
  mode,
  source: url.href,
  sha256: bundle.sha256,
  manifest: bundle.manifest,
  files: Object.keys(bundle.files),
  publisherId: metadata?.publisherId ?? null,
  marketUsed: marketMode,
  scriptsExecuted: false,
};
if (mode === "--preview") console.log(JSON.stringify(details, null, 2));
if (mode !== "--preview") {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error("SKILL_INSTALL_TTY_REQUIRED");
  console.log(
    `Install Skill: ${bundle.manifest.packageName} ${bundle.manifest.packageVersion}\nDownload and package checks passed. Installation saves local files; it does not start a service or make a payment.`,
  );
  if (mode === "--execute-and-select" || mode === "--prepare-official-test")
    console.log(
      "This saves the official test material, then the guide checks Wallet / Runtime readiness. Unlock may be requested. No purchase is made yet.",
    );
  if (
    mode !== "--prepare-official-test" &&
    !(await confirmSkillAction({
      prompt:
        "Type 'confirm' to install, 'details' to view package information, or 'q' to cancel: ",
      details,
    }))
  )
    throw new Error("SKILL_INSTALL_NOT_CONFIRMED");
  const installed = await installSkillBundle({
    dataDir: resolve(data),
    bytes,
    source: url.href,
    publication: metadata
      ? {
          publisherId: metadata.publisherId,
          marketServiceId: metadata.marketServiceId,
          sourceUrl: metadata.sourceUrl,
        }
      : null,
  });
  if (mode === "--execute-and-select" || mode === "--prepare-official-test") {
    const current = await inspectInstalledBundle(installed.directory);
    if (current.locallyModified)
      throw Error("LOCAL_EDITS_REQUIRE_EXPLICIT_SELECTION_REVIEW");
    await selectInstalledBundle(
      resolve(data),
      installed.directory,
      current.hashes,
    );
    console.log("Official test material prepared.");
  } else
    console.log(
      "Skill installed. Follow its harness installation instructions.",
    );
}
