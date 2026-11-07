// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashServiceProfile } from "@c4roa0/agentpay-protocol";
import { packSkillFiles } from "./fixtures/skill-bundle.mjs";
import { bundleDigest, installSkillBundle } from "../src/skill-bundle.mjs";
const execute = promisify(execFile);
test("explicit ZIP URL is independent of canonical service endpoints and non-main aliases", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "download-address-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "runtime"), { mode: 0o700 });
  const ref = (name, n) => {
    const profile = {
      version: "agentpay.service-profile.v1",
      providerId: "provider:example",
      serviceId: name,
      mcpEndpoint: `https://service.example/custom/services/${name}/mcp/invoke`,
      paymentEndpoint: `https://service.example/custom/services/${name}/agentpay/invoke`,
      seller: "0x" + "1".repeat(40),
      network: "eip155:31337",
      asset: "0x" + "2".repeat(40),
    };
    return {
      version: "agentpay.service-reference.v1",
      adapter: "agentpay.json.v1",
      skillId: "0x" + n.repeat(64),
      profileHash: hashServiceProfile(profile),
      profile,
    };
  };
  const bytes = packSkillFiles({
    "suite/SKILL.md": "# Example services",
    "suite/agentpay.json": JSON.stringify({
      packageName: "example-suite",
      packageVersion: "1.0",
      services: {
        render: ref("render", "3"),
        translate: ref("translate", "4"),
      },
    }),
  });
  const server = createServer((req, res) => {
    if (req.url !== "/downloads/custom-name.zip") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.end(bytes);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}/downloads/custom-name.zip`,
    script = new URL("../scripts/install-skill-bundle.mjs", import.meta.url)
      .pathname;
  const { stdout } = await execute(process.execPath, [
    script,
    "--preview",
    dir,
    url,
    bundleDigest(bytes),
  ]);
  const preview = JSON.parse(stdout);
  assert.deepEqual(Object.keys(preview.manifest.services), [
    "render",
    "translate",
  ]);
  assert.equal(preview.scriptsExecuted, false);
  await assert.rejects(
    execute(process.execPath, [script, "--preview", dir, url, "a".repeat(64)]),
    /BUNDLE_DIGEST_MISMATCH/,
  );
  const installed = await installSkillBundle({
    dataDir: dir,
    bytes,
    source: url,
  });
  assert.equal(installed.changed, true);
});
