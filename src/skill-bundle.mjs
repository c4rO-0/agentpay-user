// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { currentTimeMs } from "./local-time.mjs";
import { readSkillZip } from "./skill-zip.mjs";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { normalizeServiceReference } from "@c4roa0/agentpay-protocol";
export const bundleDigest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const skillArchiveLimits = Object.freeze({
  compressed: 2097152,
  expanded: 8388608,
  file: 1048576,
  entries: 256,
});
export function parseSkillBundle(bytes) {
  const archive = readSkillZip(bytes, skillArchiveLimits),
    files = Object.fromEntries(archive.files);
  const entries = Object.keys(files).filter(
    (name) => name === "SKILL.md" || name.endsWith("/SKILL.md"),
  );
  if (entries.length !== 1) throw Error("BUNDLE_INSTRUCTIONS_REQUIRED");
  const root = entries[0].slice(0, -8);
  if (
    archive.entries.some(
      (e) => root && e.path !== root.slice(0, -1) && !e.path.startsWith(root),
    )
  )
    throw Error("BUNDLE_ROOT_INVALID");
  if (!files[entries[0]].length || !files[root + "agentpay.json"])
    throw Error("BUNDLE_MANIFEST_INVALID");
  const manifest = JSON.parse(files[root + "agentpay.json"].toString("utf8"));
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    typeof manifest.packageName !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(manifest.packageName) ||
    typeof manifest.packageVersion !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/.test(manifest.packageVersion)
  )
    throw Error("BUNDLE_MANIFEST_INVALID");
  const services = manifest.services ?? {};
  if (!services || typeof services !== "object" || Array.isArray(services))
    throw Error("BUNDLE_SERVICES_INVALID");
  for (const [alias, reference] of Object.entries(services)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(alias))
      throw Error("BUNDLE_SERVICES_INVALID");
    normalizeServiceReference(reference);
  }
  return { manifest, services, root, files, sha256: bundleDigest(bytes) };
}
async function privateDir(path) {
  const st = await lstat(path);
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    st.mode & 0o077
  )
    throw new Error("PRIVATE_USER_DIRECTORY_REQUIRED");
}
export async function installSkillBundle({
  dataDir,
  bytes,
  source,
  publication = null,
}) {
  const parsed = parseSkillBundle(bytes);
  await privateDir(dataDir);
  const runtime = join(dataDir, "runtime");
  await privateDir(runtime);
  const parent = join(runtime, "skill-bundles");
  await mkdir(parent, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  await privateDir(parent);
  const target = join(
    parent,
    `${parsed.manifest.packageName}-${parsed.manifest.packageVersion}-${parsed.sha256}`,
  );
  const exists = await lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (exists) {
    await privateDir(target);
    const original = await readFile(join(target, "publisher.zip"));
    if (!original.equals(bytes)) throw new Error("BUNDLE_RELEASE_CONFLICT");
    let locallyModified = false;
    for (const [name, value] of Object.entries(parsed.files)) {
      const file = join(target, name);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("BUNDLE_LOCAL_FILE_INVALID");
      if (!(await readFile(file)).equals(value)) locallyModified = true;
    }
    return { directory: target, changed: false, locallyModified };
  }
  // Unique staging directory; only this invocation's incomplete files are removed.
  const staging = join(parent, `.install-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const [name, value] of Object.entries(parsed.files)) {
      const destination = join(staging, name);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, value, { flag: "wx", mode: 0o600 });
    }
    await writeFile(join(staging, "publisher.zip"), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      join(staging, "installation.json"),
      JSON.stringify(
        {
          format: "agentpay.skill-installation.v1",
          source,
          sha256: parsed.sha256,
          publication,
          installedAtMs: currentTimeMs(),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await rename(staging, target);
    return { directory: target, changed: true, locallyModified: false };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
