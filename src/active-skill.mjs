// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  readFile,
  lstat,
  realpath,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  parseSkillBundle,
  bundleDigest,
  skillArchiveLimits,
} from "./skill-bundle.mjs";
import { parseServicePackage } from "./skill-package.mjs";
async function privateFile(path, maxBytes = 262144) {
  const st = await lstat(path);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    st.mode & 0o077
  )
    throw new Error("SKILL_FILE_PERMISSIONS_INVALID");
  if (st.size > maxBytes) throw new Error("SKILL_FILE_TOO_LARGE");
  return readFile(path);
}
export async function inspectInstalledBundle(directory) {
  const dir = resolve(directory);
  if ((await realpath(dir)) !== dir)
    throw new Error("SKILL_SYMLINK_PATH_INVALID");
  const original = parseSkillBundle(
    await privateFile(
      join(dir, "publisher.zip"),
      skillArchiveLimits.compressed,
    ),
  );
  const receipt = JSON.parse(await privateFile(join(dir, "installation.json")));
  if (
    receipt.format !== "agentpay.skill-installation.v1" ||
    receipt.sha256 !== original.sha256
  )
    throw new Error("SKILL_INSTALLATION_RECEIPT_MISMATCH");
  const files = {};
  const hashes = {};
  let locallyModified = false;
  for (const name of Object.keys(original.files)) {
    const path = join(dir, name);
    if ((await realpath(path)) !== path)
      throw new Error("SKILL_SYMLINK_PATH_INVALID");
    files[name] = await privateFile(path, skillArchiveLimits.file);
    hashes[name] = bundleDigest(files[name]);
    if (!files[name].equals(original.files[name])) locallyModified = true;
  }
  const manifest = JSON.parse(files[original.root + "agentpay.json"]);
  if (JSON.stringify(manifest) !== JSON.stringify(original.manifest))
    throw Error("SKILL_MANIFEST_INVALID");
  const reference = original.services.main;
  if (!reference) throw Error("TEST_SERVICE_REFERENCE_REQUIRED");
  const service = parseServicePackage(Buffer.from(JSON.stringify(reference)));
  return {
    directory: dir,
    sha256: original.sha256,
    locallyModified,
    hashes,
    service,
    publication: receipt.publication ?? null,
  };
}
export async function loadActiveSkill(path) {
  const selected = JSON.parse(await privateFile(path));
  if (
    selected.version !== "agentpay.active-skill.v1" ||
    typeof selected.directory !== "string"
  )
    throw new Error("SKILL_SELECTION_INVALID");
  const current = await inspectInstalledBundle(selected.directory);
  if (
    current.sha256 !== selected.sha256 ||
    JSON.stringify(current.hashes) !== JSON.stringify(selected.hashes)
  )
    throw new Error("SKILL_CHANGED_RESELECT_REQUIRED");
  return {
    ...current.service,
    bundle: {
      directory: current.directory,
      sha256: current.sha256,
      filesHash: bundleDigest(Buffer.from(JSON.stringify(current.hashes))),
      locallyModified: current.locallyModified,
    },
  };
}
export async function selectInstalledBundle(
  dataDir,
  directory,
  expectedHashes = null,
) {
  const runtime = join(resolve(dataDir), "runtime");
  const dir = resolve(directory);
  if (dirname(dir) !== join(runtime, "skill-bundles"))
    throw new Error("SKILL_NOT_IN_USER_INSTALL_DIRECTORY");
  const info = await lstat(runtime);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077
  )
    throw new Error("PRIVATE_RUNTIME_REQUIRED");
  const current = await inspectInstalledBundle(dir);
  if (
    expectedHashes &&
    JSON.stringify(expectedHashes) !== JSON.stringify(current.hashes)
  )
    throw new Error("SKILL_CHANGED_DURING_CONFIRMATION");
  const selected = {
    version: "agentpay.active-skill.v1",
    directory: dir,
    sha256: current.sha256,
    hashes: current.hashes,
  };
  const path = join(runtime, "active-skill.json");
  let existing = null;
  try {
    existing = JSON.parse(await privateFile(path));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (JSON.stringify(existing) === JSON.stringify(selected))
    return { changed: false, path, ...current };
  // This file selects only the official test material. Runtime binds each call
  // independently. Never replace material while a test checkpoint still refers to it.
  try {
    await lstat(join(runtime, "model-ack-smoke.json"));
    throw Error("TEST_SELECTION_REQUIRES_CHECKPOINT_REVIEW");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(selected) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  return { changed: true, path, ...current };
}
// Retained checkpoint filename selects official test material only.
export async function installedSkillPath(dataDir) {
  return join(dataDir, "runtime", "active-skill.json");
}
