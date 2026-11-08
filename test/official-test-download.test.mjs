// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { OFFICIAL_TEST_PACKAGE } from "../src/official-test-package.mjs";
const exec = promisify(execFile);
test("official installer rejects both substituted metadata and bytes even with matching supplied hash", async (t) => {
  const bytes = Buffer.from("not the official ZIP");
  const attackerHash = createHash("sha256").update(bytes).digest("hex");
  let claimed = attackerHash,
    downloads = 0;
  const server = createServer((req, res) => {
    assert.equal(req.url, `/skills/bundles/fixture/versions/${OFFICIAL_TEST_PACKAGE.sha256}/${req.url.endsWith("/metadata") ? "metadata" : "download"}`);
    if (req.url.endsWith("/metadata")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          result: {
            sha256: claimed,
            packageName: "agentpay-random",
            packageVersion: "1.2.0",
            byteLength: bytes.length,
            publisherId: "fixture",
            marketServiceId: "fixture",
            marketDownloadPath: `/skills/bundles/fixture/versions/${OFFICIAL_TEST_PACKAGE.sha256}/download`,
          },
        }),
      );
    } else {
      downloads++;
      res.end(bytes);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/skills/bundles/fixture/metadata`;
  const args = [
    fileURLToPath(
      new URL("../scripts/install-skill-bundle.mjs", import.meta.url),
    ),
    "--prepare-official-test",
    "/unused-no-writes",
    url,
    attackerHash,
    "--market",
  ];
  await assert.rejects(exec(process.execPath, args), (e) =>
    e.stderr.includes("official test package does not match"),
  );
  assert.equal(downloads, 0, "untrusted metadata rejected before download");
  claimed = OFFICIAL_TEST_PACKAGE.sha256;
  await assert.rejects(exec(process.execPath, args), (e) =>
    e.stderr.includes("official test package does not match"),
  );
  assert.equal(
    downloads,
    1,
    "raw bytes independently checked before ZIP parsing or installation",
  );
});
