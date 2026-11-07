// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { hashServiceProfile } from "@c4roa0/agentpay-protocol";
import { parseServicePackage } from "../src/skill-package.mjs";
const profile = {
  version: "agentpay.service-profile.v1",
  providerId: "provider:test",
  serviceId: "echo",
  mcpEndpoint: "https://example.test/provider/services/echo/mcp/invoke",
  paymentEndpoint:
    "https://example.test/provider/services/echo/agentpay/invoke",
  seller: "0x" + "1".repeat(40),
  network: "eip155:31337",
  asset: "0x" + "2".repeat(40),
};
const reference = {
  version: "agentpay.service-reference.v1",
  skillId: "0x" + "a".repeat(64),
  profileHash: hashServiceProfile(profile),
  profile,
  adapter: "agentpay.json.v1",
};
const bytes = (value) => Buffer.from(JSON.stringify(value));
test("service reference inspection works for different business names and controlled prefixes", () => {
  const view = parseServicePackage(bytes(reference));
  assert.equal(view.serviceId, "echo");
  assert.equal(view.endpointUrl, profile.paymentEndpoint);
  assert.equal(
    parseServicePackage(bytes(reference), {
      providerId: view.providerId,
      serviceId: view.serviceId,
      skillId: view.skillId,
      profileHash: view.profileHash,
      sourceUrl: profile.paymentEndpoint.replace("/invoke", "/skill-package"),
    }).skillId,
    view.skillId,
  );
});
test("forged profiles, unsupported business variants and source mismatches are rejected", () => {
  for (const value of [
    { ...reference, profileHash: "0x" + "b".repeat(64) },
    { ...reference, adapter: "agentpay.random.v1" },
    {
      ...reference,
      profile: { ...profile, paymentEndpoint: "https://evil.test" },
    },
  ])
    assert.throws(() => parseServicePackage(bytes(value)));
  assert.throws(
    () =>
      parseServicePackage(bytes(reference), {
        providerId: profile.providerId,
        serviceId: "other",
        skillId: reference.skillId,
        profileHash: reference.profileHash,
      }),
    /IDENTITY_MISMATCH/,
  );
  assert.throws(() => parseServicePackage(Buffer.alloc(16385)), /SIZE_INVALID/);
});
