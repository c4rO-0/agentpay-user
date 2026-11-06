// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureGuidedConfig } from "../src/guided-setup.mjs";
const publicConfig = {
  mode: "private-anvil",
  chainId: 31337,
  source: "test",
  rpcUrl: "http://127.0.0.1:8547",
  settlementUrl: "http://127.0.0.1:6572",
  marketBundleMetadataUrl: "http://127.0.0.1:6583/skills/bundles/test/metadata",
  module: "0x" + "1".repeat(40),
  token: "0x" + "2".repeat(40),
  factory: "0x" + "3".repeat(40),
  registry: "0x" + "4".repeat(40),
  tokenDecimals: 6,
  tokenSymbol: "rUSDC",
  bundleSha256: "a".repeat(64),
  maxUsageUnits: 1,
};
test("guided entry prepares once, reuses matching settings and rejects deployment mismatch without replacing state", async () => {
  const parent = await mkdtemp(join(tmpdir(), "guided-user-"));
  try {
    const { validateConfig } = await import("../src/anvil-onboarding.mjs");
    await writeFile(
      join(parent, "user-deployment.json"),
      JSON.stringify(publicConfig),
    );
    const answers = [
      "0x" + "5".repeat(40),
      "0x" + "6".repeat(40),
      "anvil",
      "",
      "confirm",
    ];
    const options = {
      parent,
      ask: async () => {
        assert.ok(answers.length);
        return answers.shift();
      },
      write: () => {},
      validateConfig,
    };
    const file = await ensureGuidedConfig(options),
      saved = await readFile(file, "utf8");
    validateConfig(JSON.parse(saved));
    await ensureGuidedConfig(options);
    assert.equal(answers.length, 0, "reuse without more prompts");
    assert.equal(await readFile(file, "utf8"), saved);
    await writeFile(
      join(parent, "user-deployment.json"),
      JSON.stringify({ ...publicConfig, bundleSha256: "b".repeat(64) }),
    );
    await ensureGuidedConfig(options);
    assert.equal(
      await readFile(file, "utf8"),
      saved,
      "Market hash change never rewrites local recovery state",
    );
    await writeFile(
      join(parent, "user-deployment.json"),
      JSON.stringify({ ...publicConfig, factory: "0x" + "9".repeat(40) }),
    );
    await assert.rejects(ensureGuidedConfig(options), (error) => {
      assert.match(error.message, /different deployment/);
      assert.match(error.message, /factory\n    Saved:/);
      assert.match(error.message, /Downloaded:/);
      return true;
    });
    assert.equal(await readFile(file, "utf8"), saved);
    await rm(file);
    await symlink(join(parent, "user-deployment.json"), file);
    await assert.rejects(
      ensureGuidedConfig(options),
      /owner-held regular file/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
