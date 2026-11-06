// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCurrentDeployment,
  inspectDeploymentStatus,
  syncSetupDeployment,
} from "../src/deployment-status.mjs";
const at = (n) => "0x" + String(n).repeat(40);
const config = {
  mode: "private-anvil",
  chainId: 31337,
  source: "test",
  rpcUrl: "http://127.0.0.1:8547",
  settlementUrl: "http://127.0.0.1:6572",
  marketBundleMetadataUrl: "http://127.0.0.1:6583/skills/bundles/test/metadata",
  module: at(1),
  token: at(2),
  factory: at(3),
  registry: at(4),
  tokenDecimals: 6,
  tokenSymbol: "TEST",
  bundleSha256: "a".repeat(64),
  maxUsageUnits: 1,
};
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "deployment-status-")),
    dataDir = join(root, "data"),
    userDir = join(root, "user");
  const save = async (p, v) => writeFile(p, JSON.stringify(v), { mode: 0o600 });
  await mkdir(join(dataDir, "wallet"), { recursive: true });
  await mkdir(join(dataDir, "runtime"));
  await mkdir(userDir);
  await save(join(root, "user-deployment.json"), config);
  await save(join(dataDir, "wallet/policy.json"), {
    ...config,
    policyId: "0x" + "a".repeat(64),
    factory: at(5),
    safe: at(6),
    delegate: at(7),
  });
  try {
    await run({ root, dataDir, userDir, save });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("downloaded mismatch is visible without contacting services", () =>
  fixture(async (o) => {
    assert.deepEqual(
      (await inspectDeploymentStatus(o.dataDir, { userDir: o.userDir }))
        .changed,
      ["factory"],
    );
  }));
test("shared short-lived cache reuses successes and errors, fresh checks bypass it", () =>
  fixture(async (o) => {
    await o.save(join(o.dataDir, "market-connection.json"), {
      marketOrigin: "https://market.example",
    });
    let calls = 0;
    const opts = {
      ...o,
      now: 100000,
      fetchImpl: async () => {
        calls++;
        return new Response(JSON.stringify(config));
      },
    };
    await loadCurrentDeployment(opts);
    await loadCurrentDeployment(opts);
    assert.equal(calls, 1);
    await loadCurrentDeployment({ ...opts, fresh: true });
    assert.equal(calls, 2);
    await assert.rejects(
      loadCurrentDeployment({
        ...opts,
        fresh: true,
        fetchImpl: async () => {
          throw Error("offline");
        },
      }),
    );
    await assert.rejects(loadCurrentDeployment(opts));
    assert.equal(calls, 2);
    assert.equal(
      (await inspectDeploymentStatus(o.dataDir, opts)).state,
      "unknown",
    );
  }));
test("setup projection requires verified binding and preserves old draft", () =>
  fixture(async (o) => {
    await o.save(join(o.root, "anvil-onboarding.json"), {
      ...config,
      ownerAddress: at(8),
      safe: at(6),
      runtimeUrl: "http://127.0.0.1:6590",
      ownerSigner: "external",
    });
    await assert.rejects(syncSetupDeployment({ ...o, config }), /binding/);
    const policy = {
      ...config,
      policyId: "0x" + "b".repeat(64),
      safe: at(6),
      delegate: at(7),
    };
    await o.save(join(o.dataDir, "wallet/policy.json"), policy);
    const path = join(o.dataDir, "runtime/authorization-draft.json");
    await o.save(path, { policyId: "old" });
    await syncSetupDeployment({ ...o, config, authorization: policy });
    assert.equal(JSON.parse(await readFile(path)).policyId, policy.policyId);
    assert.ok(
      (await readdir(join(o.dataDir, "runtime"))).some((n) =>
        n.endsWith(".previous"),
      ),
    );
    assert.equal(
      JSON.parse(await readFile(join(o.root, "anvil-onboarding.json")))
        .ownerSigner,
      "external",
    );
  }));
