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
  stat,
  rm,
  chmod,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureRuntimeConnection } from "../src/runtime-connection-settings.mjs";
import { saveServiceSettings } from "../src/local-services.mjs";
import { loadRuntimeConnection } from "../src/runtime-client.mjs";
async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "runtime-locator-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  for (const name of ["runtime", "wallet"])
    await mkdir(join(dataDir, name), { mode: 0o700 });
  await saveServiceSettings({
    dataDir,
    runtimeUrl: "http://127.0.0.1:6490",
    settlementUrl: "https://example.test",
  });
  const protectedFiles = [
    "runtime/caller.token",
    "runtime/invocations.json",
    "wallet/policy.json",
    "wallet/session.keystore.json",
  ];
  for (const name of protectedFiles)
    await writeFile(join(dataDir, name), "existing-" + name, { mode: 0o600 });
  return {
    dataDir,
    path: join(dataDir, "runtime/connection.json"),
    protectedFiles,
  };
}
test("missing locator is reconstructed without changing credentials, Policy or history", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await ensureRuntimeConnection(f), { created: true });
  const c = await loadRuntimeConnection({ dataDir: f.dataDir, env: {} });
  assert.equal(c.runtimeUrl, "http://127.0.0.1:6490/");
  assert.equal(c.callerTokenFile, join(f.dataDir, "runtime/caller.token"));
  assert.equal((await stat(f.path)).mode & 0o777, 0o600);
  for (const name of f.protectedFiles)
    assert.equal(
      await readFile(join(f.dataDir, name), "utf8"),
      "existing-" + name,
    );
  const bytes = await readFile(f.path);
  assert.deepEqual(await ensureRuntimeConnection(f), { created: false });
  assert.deepEqual(await readFile(f.path), bytes);
});
test("conflicting URL, credential path and module path are kept for review", async (t) => {
  const f = await fixture(t);
  await ensureRuntimeConnection(f);
  const original = JSON.parse(await readFile(f.path, "utf8"));
  for (const patch of [
    { runtimeUrl: "http://127.0.0.1:6590/" },
    { callerTokenFile: "/other/caller.token" },
    { clientModule: "/other/runtime-client.mjs" },
    { version: "unknown" },
  ]) {
    const content = JSON.stringify({ ...original, ...patch });
    await writeFile(f.path, content);
    await assert.rejects(ensureRuntimeConnection(f), /kept for review/);
    assert.equal(await readFile(f.path, "utf8"), content);
  }
});
test("corrupt, public or symlinked locator is never overwritten", async (t) => {
  const f = await fixture(t);
  await writeFile(f.path, "not-json", { mode: 0o600 });
  await assert.rejects(ensureRuntimeConnection(f), /kept for review/);
  assert.equal(await readFile(f.path, "utf8"), "not-json");
  await chmod(f.path, 0o644);
  await assert.rejects(ensureRuntimeConnection(f), /kept for review/);
  await rm(f.path);
  await symlink(join(f.dataDir, "missing"), f.path);
  await assert.rejects(ensureRuntimeConnection(f), /kept for review/);
});
test("concurrent preparation only publishes one locator", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([
    ensureRuntimeConnection(f),
    ensureRuntimeConnection(f),
  ]);
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal(
    (await loadRuntimeConnection({ dataDir: f.dataDir, env: {} })).runtimeUrl,
    "http://127.0.0.1:6490/",
  );
});
test("missing connection gives a repair action; malformed content has a distinct diagnostic", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    loadRuntimeConnection({ dataDir: f.dataDir }),
    /missing.*run repair/,
  );
  await writeFile(f.path, "invalid", { mode: 0o600 });
  await assert.rejects(
    loadRuntimeConnection({ dataDir: f.dataDir }),
    /could not be read safely/,
  );
});
