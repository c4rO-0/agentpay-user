// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashServiceProfile } from "@agentpay/types";
import { randomBytes } from "node:crypto";
import { randomSkillBundle, packSkillFiles } from "./fixtures/skill-bundle.mjs";
import { installSkillBundle } from "../src/skill-bundle.mjs";
import {
  selectInstalledBundle,
  loadActiveSkill,
} from "../src/active-skill.mjs";
async function fixture(t) {
  const data = await mkdtemp(join(tmpdir(), "official-material-"));
  t.after(() => rm(data, { recursive: true, force: true }));
  await mkdir(join(data, "runtime"), { mode: 0o700 });
  const profile = {
    version: "agentpay.service-profile.v1",
    providerId: "provider:official",
    serviceId: "random",
    mcpEndpoint: "http://127.0.0.1:6571/services/random/mcp/invoke",
    paymentEndpoint: "http://127.0.0.1:6571/services/random/agentpay/invoke",
    seller: "0x" + "1".repeat(40),
    network: "eip155:31337",
    asset: "0x" + "2".repeat(40),
  };
  const bytes = (
    await randomSkillBundle({
      skillId: "0x" + "3".repeat(64),
      profileHash: hashServiceProfile(profile),
      profile,
    })
  ).bytes;
  const installed = await installSkillBundle({
    dataDir: data,
    bytes,
    source: "official fixture",
  });
  return { data, dir: installed.directory };
}
test("official material is independently inspected; transaction history is preserved", async (t) => {
  const { data, dir } = await fixture(t);
  const history = "retained transaction history";
  await writeFile(join(data, "runtime/invocations.json"), history);
  const selected = await selectInstalledBundle(data, dir);
  assert.equal(
    (await loadActiveSkill(selected.path)).reference.adapter,
    "agentpay.json.v1",
  );
  assert.equal(
    await readFile(join(data, "runtime/invocations.json"), "utf8"),
    history,
  );
  await writeFile(join(dir, "random-skill/SKILL.md"), "edited");
  await assert.rejects(
    loadActiveSkill(selected.path),
    /SKILL_CHANGED_RESELECT_REQUIRED/,
  );
  await writeFile(join(data, "runtime/model-ack-smoke.json"), "saved test");
  await assert.rejects(
    selectInstalledBundle(data, dir),
    /TEST_SELECTION_REQUIRES_CHECKPOINT_REVIEW/,
  );
});
test("valid large official test material can be selected and loaded after installation", async (t) => {
  const data = await mkdtemp(join(tmpdir(), "official-large-"));
  t.after(() => rm(data, { recursive: true, force: true }));
  await mkdir(join(data, "runtime"), { mode: 0o700 });
  const profile = {
    version: "agentpay.service-profile.v1",
    providerId: "provider:official",
    serviceId: "echo",
    mcpEndpoint: "http://127.0.0.1:6571/services/echo/mcp/invoke",
    paymentEndpoint: "http://127.0.0.1:6571/services/echo/agentpay/invoke",
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
  const bytes = packSkillFiles({
    "echo/SKILL.md": "# Official test",
    "echo/agentpay.json": JSON.stringify({
      packageName: "official-large",
      packageVersion: "1.0.0",
      services: { main: reference },
    }),
    "echo/assets/fixture.bin": randomBytes(400 * 1024),
  });
  assert(bytes.length > 262144);
  const installed = await installSkillBundle({
    dataDir: data,
    bytes,
    source: "official fixture",
  });
  const selected = await selectInstalledBundle(data, installed.directory);
  assert.equal(
    (await loadActiveSkill(selected.path)).reference.skillId,
    reference.skillId,
  );
});
