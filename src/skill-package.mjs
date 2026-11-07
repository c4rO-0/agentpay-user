// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { normalizeServiceReference } from "@c4roa0/agentpay-protocol";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
export function skillPackageDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
// Public reference inspection; no business-specific package or adapter parsing.
export function parseServicePackage(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 16384)
    throw Error("SKILL_PACKAGE_SIZE_INVALID");
  const reference = normalizeServiceReference(
      JSON.parse(bytes.toString("utf8")),
    ),
    profile = reference.profile;
  const view = {
    ...reference,
    reference,
    providerId: profile.providerId,
    serviceId: profile.serviceId,
    endpointUrl: profile.paymentEndpoint,
  };
  if (
    expected &&
    ["providerId", "serviceId", "skillId", "profileHash"].some(
      (key) => view[key] !== expected[key],
    )
  )
    throw Error("SKILL_PACKAGE_IDENTITY_MISMATCH");
  if (
    expected?.sourceUrl &&
    profile.paymentEndpoint.replace(/\/invoke$/, "/skill-package") !==
      expected.sourceUrl
  )
    throw Error("SKILL_PACKAGE_SOURCE_MISMATCH");
  return Object.freeze(view);
}
export async function loadInstalledServiceReference(packageFile) {
  const bytes = await readFile(packageFile);
  if (
    JSON.parse(bytes.toString("utf8"))?.version === "agentpay.active-skill.v1"
  )
    return (await import("./active-skill.mjs")).loadActiveSkill(packageFile);
  const digest = (await readFile(packageFile + ".sha256", "utf8")).trim();
  if (skillPackageDigest(bytes) !== digest)
    throw Error("INSTALLED_SKILL_DIGEST_MISMATCH");
  return parseServicePackage(bytes);
}
