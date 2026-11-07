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
  serviceId: "random",
  mcpEndpoint: "https://platform.example/provider/services/random/mcp/invoke",
  paymentEndpoint:
    "https://platform.example/provider/services/random/agentpay/invoke",
  seller: "0x" + "1".repeat(40),
  network: "eip155:31337",
  asset: "0x" + "2".repeat(40),
};
const reference = {
  version: "agentpay.service-reference.v1",
  adapter: "agentpay.json.v1",
  skillId: "0x" + "3".repeat(64),
  profileHash: hashServiceProfile(profile),
  profile,
};
test("common service reference retains its exact prefixed endpoint and source identity", () => {
  const bytes = Buffer.from(JSON.stringify(reference));
  const expected = {
    providerId: profile.providerId,
    serviceId: profile.serviceId,
    skillId: reference.skillId,
    profileHash: reference.profileHash,
    sourceUrl: profile.paymentEndpoint.replace("/invoke", "/skill-package"),
  };
  assert.equal(
    parseServicePackage(bytes, expected).endpointUrl,
    profile.paymentEndpoint,
  );
  assert.throws(() =>
    parseServicePackage(bytes, {
      ...expected,
      sourceUrl:
        "https://platform.example/services/random/agentpay/skill-package",
    }),
  );
  for (const url of [
    "https://platform.example/provider/../services/random/agentpay/invoke",
    profile.paymentEndpoint + "?key=secret",
    profile.paymentEndpoint + "#fragment",
    "http://public.example/provider/services/random/agentpay/invoke",
  ])
    assert.throws(() =>
      parseServicePackage(
        Buffer.from(
          JSON.stringify({
            ...reference,
            profile: { ...profile, paymentEndpoint: url },
          }),
        ),
      ),
    );
  assert.throws(() =>
    parseServicePackage(
      Buffer.from(
        JSON.stringify({ ...reference, adapter: "agentpay.random.v1" }),
      ),
    ),
  );
});
