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
  chmod,
  symlink,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  resolveUserDataDir,
  rememberUserDataDir,
} from "../src/local-data-directory.mjs";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "user-location-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    userDir: join(root, "user"),
    directory: join(root, ".agentpay-install"),
  };
}
test("installation location survives rereads and preserves build checkpoints", async (t) => {
  const f = await fixture(t);
  await mkdir(f.directory, { mode: 0o700 });
  const state = join(f.directory, "state.json");
  await writeFile(state, JSON.stringify({ version: 1, walletBuild: "hash" }), {
    mode: 0o600,
  });
  await rememberUserDataDir({ ...f, dataDir: "/existing/private user" });
  assert.equal(
    await resolveUserDataDir({ ...f, env: {} }),
    "/existing/private user",
  );
  assert.equal(JSON.parse(await readFile(state)).walletBuild, "hash");
  assert.equal((await stat(state)).mode & 0o777, 0o600);
  assert.equal(
    await resolveUserDataDir({ ...f, env: { AGENTPAY_USER_DATA_DIR: "/env" } }),
    "/env",
  );
  assert.equal(
    await resolveUserDataDir({
      ...f,
      env: { AGENTPAY_USER_DATA_DIR: "/env" },
      argument: "/explicit",
    }),
    "/explicit",
  );
});
test("missing or old record uses standard default, not an invented rehearsal path", async (t) => {
  const f = await fixture(t);
  assert.equal(
    await resolveUserDataDir({ ...f, env: {} }),
    join(homedir(), ".local/share/agentpay/user"),
  );
  await mkdir(f.directory, { mode: 0o700 });
  await writeFile(join(f.directory, "state.json"), '{"version":1}', {
    mode: 0o600,
  });
  assert.equal(
    await resolveUserDataDir({ ...f, env: {} }),
    join(homedir(), ".local/share/agentpay/user"),
  );
});
test("invalid, public and symlink records fail closed", async (t) => {
  const f = await fixture(t);
  await mkdir(f.directory, { mode: 0o700 });
  const path = join(f.directory, "state.json");
  for (const body of [
    "not json",
    '{"version":1,"dataDir":"relative"}',
    '{"version":2,"dataDir":"/wrong"}',
  ]) {
    await writeFile(path, body, { mode: 0o600 });
    await assert.rejects(resolveUserDataDir({ ...f, env: {} }));
  }
  await writeFile(path, '{"version":1,"dataDir":"/ok"}');
  await chmod(path, 0o644);
  await assert.rejects(resolveUserDataDir({ ...f, env: {} }));
  await rm(path);
  await symlink("/no-such-target", path);
  await assert.rejects(resolveUserDataDir({ ...f, env: {} }));
});
test("active installation lock prevents checkpoint overwrite", async (t) => {
  const f = await fixture(t);
  await rememberUserDataDir({ ...f, dataDir: "/first" });
  await writeFile(join(f.directory, "install.lock"), "busy", { mode: 0o600 });
  await assert.rejects(
    rememberUserDataDir({ ...f, dataDir: "/second" }),
    /installation/,
  );
  assert.equal(await resolveUserDataDir({ ...f, env: {} }), "/first");
});
