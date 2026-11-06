// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  symlink,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { invocationResults } from "../src/invocation-result.mjs";
const entry = {
  invocationId: "0x" + "1".repeat(64),
  requestHash: "0x" + "2".repeat(64),
  serviceBinding: "test-binding",
};
test("pending results persist privately and cannot be mistaken for verified results or replaced", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pending-result-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.json"),
    store = invocationResults(path),
    result = { output: { text: "private" }, outputHash: "hash" };
  await store.savePending(entry, result);
  assert.equal(await store.read(entry), null);
  assert.deepEqual(await invocationResults(path).readPending(entry), result);
  const file = join(path + ".pending-results", entry.invocationId + ".json");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(
    store.savePending(entry, { ...result, outputHash: "different" }),
    /CONFLICT/,
  );
  await assert.rejects(
    store.readPending({ ...entry, requestHash: "different" }),
    /CONFLICT/,
  );
  await store.save(entry, { ...result, deliveryEvidenceVerified: true });
  assert.equal((await store.read(entry)).deliveryEvidenceVerified, true);
  assert.deepEqual(await store.readPending(entry), result);
  await writeFile(file, "broken", { mode: 0o600 });
  await assert.rejects(store.readPending(entry));
});
test("oversized and unsafe result targets are rejected", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pending-result-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.json"),
    store = invocationResults(path);
  await assert.rejects(
    store.savePending(entry, { text: "x".repeat(2 * 1048576) }),
    /TOO_LARGE/,
  );
  await store.savePending(entry, { text: "safe" });
  const target = join(path + ".pending-results", entry.invocationId + ".json");
  await rm(target);
  await symlink(join(dir, "outside"), target);
  await writeFile(join(dir, "outside"), "unchanged");
  await assert.rejects(store.readPending(entry));
  assert.equal(await readFile(join(dir, "outside"), "utf8"), "unchanged");
});
