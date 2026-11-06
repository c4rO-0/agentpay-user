// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packSkillFiles } from "./fixtures/skill-bundle.mjs";
import { parseSkillBundle, installSkillBundle } from "../src/skill-bundle.mjs";
const files = {
  "echo/SKILL.md": "# Echo",
  "echo/agentpay.json": JSON.stringify({
    packageName: "echo-app",
    packageVersion: "2.3.4",
  }),
  "echo/scripts/call.mjs": 'throw Error("must not execute")',
  "echo/notes.txt": "supporting material",
};
test("general installer accepts variable package identity, support files and nested script", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "generic-bundle-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "runtime"), { mode: 0o700 });
  const bytes = packSkillFiles(files),
    parsed = parseSkillBundle(bytes);
  assert.equal(parsed.manifest.packageName, "echo-app");
  assert.equal(Object.keys(parsed.files).length, 4);
  const installed = await installSkillBundle({
    dataDir: dir,
    bytes,
    source: "official fixture",
  });
  assert.equal(
    await readFile(join(installed.directory, "echo/notes.txt"), "utf8"),
    "supporting material",
  );
  await writeFile(join(installed.directory, "echo/notes.txt"), "local edit");
  const repeated = await installSkillBundle({
    dataDir: dir,
    bytes,
    source: "official fixture",
  });
  assert.equal(repeated.locallyModified, true);
  assert.equal(
    await readFile(join(installed.directory, "echo/notes.txt"), "utf8"),
    "local edit",
  );
});
test("archive boundary rejects traversal, multiple packages, oversize files and forged references", () => {
  for (const bad of [
    { ...files, "../escape": "x" },
    { ...files, "other/SKILL.md": "x" },
    { ...files, "echo/notes.txt": Buffer.alloc(1048577) },
    {
      ...files,
      "echo/agentpay.json": JSON.stringify({
        packageName: "echo",
        packageVersion: "1",
        services: { main: { version: "agentpay.service-reference.v1" } },
      }),
    },
  ])
    assert.throws(() => parseSkillBundle(packSkillFiles(bad)));
});
