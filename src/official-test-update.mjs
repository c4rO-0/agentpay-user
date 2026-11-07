import { deploymentFilePath, importSetupFiles } from "./installation-paths.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  OFFICIAL_TEST_PACKAGE,
  verifyOfficialTestBytes,
  verifyOfficialTestDigest,
} from "./official-test-package.mjs";
import { marketDownloadUrl } from "./market-download-url.mjs";

async function localJson(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size > 65536)
      throw Error("Invalid saved configuration");
    return JSON.parse(await handle.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await handle?.close();
  }
}
function url(value) {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
    )
  )
    throw Error("Invalid package source");
  return u;
}
async function download(fetchImpl, address, max) {
  const response = await fetchImpl(address, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !response.body) throw Error("Market request failed");
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > max) throw Error("Market response too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function prepareOfficialTestUpdate({
  userDir,
  dataDir,
  write = console.log,
  fetchImpl = fetch,
  readJson = localJson,
  install,
} = {}) {
  write("\n> Official test Skill");
  try {
    let source;
    for (const name of ["anvil-onboarding.json", "user-deployment.json"]) {
      const saved = await readJson(await deploymentFilePath(dataDir, userDir, name));
      if (saved?.marketBundleMetadataUrl) {
        source = saved.marketBundleMetadataUrl;
        break;
      }
    }
    if (!source) {
      const saved = await readJson(join(dataDir, "market-connection.json"));
      if (saved?.marketOrigin) {
        const origin = url(saved.marketOrigin);
        if (origin.pathname !== "/") throw Error("Invalid Market origin");
        const deployment = JSON.parse(
          (
            await download(
              fetchImpl,
              new URL("/market/web/onboarding/user-config", origin),
              16384,
            )
          ).toString("utf8"),
        );
        source = deployment.marketBundleMetadataUrl;
      }
    }
    if (!source) {
      write(
        "Not checked: no saved Market test source. Continue agentpay setup when ready.",
      );
      return { status: "unconfigured" };
    }
    const metadataUrl = url(source);
    if (
      !/^\/(?:market\/)?skills\/bundles\/[^/]+\/metadata$/.test(
        metadataUrl.pathname,
      )
    )
      throw Error("Invalid package metadata path");
    const body = JSON.parse(
      (await download(fetchImpl, metadataUrl, 65536)).toString("utf8"),
    );
    if (body.ok !== true) throw Error("Metadata unavailable");
    verifyOfficialTestDigest(body.result?.sha256);
    const downloadUrl = marketDownloadUrl(
      metadataUrl,
      body.result.marketServiceId,
    );
    const bytes = await download(fetchImpl, downloadUrl, 2097152);
    verifyOfficialTestBytes(bytes);
    // Load package dependencies only after the software dependency update completed.
    const { parseSkillBundle, installSkillBundle } = await import(
      "./skill-bundle.mjs"
    );
    const bundle = parseSkillBundle(bytes);
    if (
      bundle.manifest.packageName !== OFFICIAL_TEST_PACKAGE.name ||
      bundle.manifest.packageVersion !== OFFICIAL_TEST_PACKAGE.version
    )
      throw Error("Official package identity mismatch");
    const saved = await (install || installSkillBundle)({
      dataDir,
      bytes,
      source: metadataUrl.href,
    });
    if (saved.locallyModified) {
      write(
        "Official ZIP verified, but its installed files have local edits. Existing files were kept; review them before testing.",
      );
      return { status: "local_edits" };
    }
    write(
      `Version ${OFFICIAL_TEST_PACKAGE.version} verified against User's built-in SHA-256 and saved locally.`,
    );
    write(
      "Original test records and package selection were kept. No test or payment was started.",
    );
    return { status: "ready", directory: saved.directory };
  } catch (error) {
    if (error.code === "OFFICIAL_TEST_PACKAGE_MISMATCH")
      write(
        "Not updated: the published ZIP does not match this User release. Check for a reviewed User update; do not bypass the file check.",
      );
    else
      write(
        "Could not prepare the official test Skill. Check your Market connection and retry agentpay repair.",
      );
    write(
      "The software update is kept; existing test files and Orders were not replaced.",
    );
    return { status: "unavailable" };
  }
}
