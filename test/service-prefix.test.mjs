// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { serviceBase, serviceUrl } from "../src/service-url.mjs";
import { marketDownloadUrl, marketVersionMetadataUrl } from "../src/market-download-url.mjs";
import { marketSettingsUrl } from "../src/install-user.mjs";
import { validatePublicDeployment } from "../src/prepare-onboarding.mjs";

test("installer, public deployment and package URLs retain ingress paths", () => {
  assert.equal(
    marketSettingsUrl("http://localhost:18080"),
    "http://localhost:18080/market/web/onboarding/user-config",
  );
  const input = {
    mode: "private-anvil",
    chainId: 31337,
    source: "test",
    rpcUrl: "http://127.0.0.1:8547",
    settlementUrl: "http://127.0.0.1:18080/settlement",
    marketBundleMetadataUrl:
      "http://127.0.0.1:18080/market/skills/bundles/test/metadata",
    module: "0x" + "1".repeat(40),
    token: "0x" + "2".repeat(40),
    factory: "0x" + "3".repeat(40),
    registry: "0x" + "4".repeat(40),
    tokenDecimals: 6,
    tokenSymbol: "rUSDC",
    bundleSha256: "a".repeat(64),
    maxUsageUnits: 1,
  };
  assert.deepEqual(validatePublicDeployment(input), input);
  assert.equal(
    validatePublicDeployment({ ...input, rpcUrl: "https://public.example/rpc" })
      .rpcUrl,
    "https://public.example/rpc",
  );
  assert.equal(
    marketDownloadUrl(input.marketBundleMetadataUrl, "test").href,
    "http://127.0.0.1:18080/market/skills/bundles/test/download",
  );
  assert.equal(
    marketDownloadUrl("https://market.test/skills/bundles/id/metadata", "id")
      .href,
    "https://market.test/skills/bundles/id/download",
  );
  assert.throws(() =>
    marketDownloadUrl(input.marketBundleMetadataUrl, "another"),
  );
  assert.throws(() =>
    marketDownloadUrl(
      "https://market.test/private/skills/bundles/id/metadata",
      "id",
    ),
  );
  assert.throws(() =>
    marketDownloadUrl(input.marketBundleMetadataUrl + "?key=secret", "test"),
  );
});
test("service requests preserve prefixes without accepting URL credentials or escapes", () => {
  assert.equal(
    serviceUrl(
      "https://platform.test/settlement/",
      "/agentpay/purchase-readiness?skillId=id",
    ).href,
    "https://platform.test/settlement/agentpay/purchase-readiness?skillId=id",
  );
  assert.equal(
    serviceBase("http://[::1]:18080/settlement/"),
    "http://[::1]:18080/settlement",
  );
  for (const value of [
    "http://remote.test/settlement",
    "https://u:p@platform.test/settlement",
    "https://platform.test/market/../internal",
    "https://platform.test/market%2finternal",
    "https://platform.test/market?x=1",
    "https://platform.test/market#x",
  ])
    assert.throws(() => serviceBase(value));
  assert.throws(() =>
    serviceUrl("https://platform.test/settlement", "//evil.test/steal"),
  );
  assert.throws(() =>
    serviceUrl("https://platform.test/settlement", "/../internal"),
  );
});

test('fixed package URLs retain ingress and never change the requested digest or service', () => {
  const digest = 'a'.repeat(64);
  for (const prefix of ['', '/market']) {
    const source = `https://market.test${prefix}/skills/bundles/test/metadata`;
    const pinned = marketVersionMetadataUrl(source, digest);
    assert.equal(pinned.href, `https://market.test${prefix}/skills/bundles/test/versions/${digest}/metadata`);
    assert.equal(marketDownloadUrl(pinned, 'test').href, pinned.href.replace(/metadata$/, 'download'));
    assert.equal(marketVersionMetadataUrl(pinned, digest).href, pinned.href);
    assert.throws(() => marketVersionMetadataUrl(pinned, 'b'.repeat(64)));
    assert.throws(() => marketDownloadUrl(pinned, 'other'));
  }
});
