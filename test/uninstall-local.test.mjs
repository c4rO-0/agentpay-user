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
  lstat,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  uninstallPlan,
  uninstallLocal,
  removeInstallation,
} from "../src/uninstall-local.mjs";
import { autostartFiles } from "../src/autostart-files.mjs";
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "agentpay-uninstall-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const userDir = join(home, "repos/user"),
    dataDir = join(home, "data");
  for (const path of [userDir, join(home, "repos/wallet"), dataDir])
    await mkdir(path, { recursive: true, mode: 0o700 });
  await writeFile(join(dataDir, "session-key"), "fixture");
  return { home, userDir, dataDir };
}
test("explicit confirmation required; cancellation does not stop services", async () => {
  let removed = 0;
  const opts = {
    terminal: true,
    plan: async () => ({ targets: [], units: [] }),
    remove: async () => {
      removed++;
    },
    write: () => {},
  };
  await uninstallLocal({ ...opts, ask: async () => "yes" });
  assert.equal(removed, 0);
  await uninstallLocal({
    ...opts,
    ask: async () => "DELETE LOCAL AGENTPAY DATA",
  });
  assert.equal(removed, 1);
  await assert.rejects(uninstallLocal({ ...opts, terminal: false }));
});
test("only selected data is removed; repositories and unrelated files remain", async (t) => {
  const f = await fixture(t);
  const plan = await uninstallPlan(f);
  await removeInstallation(plan, {
    probe: async () => false,
    manage: async () => {
      throw Error("unexpected systemctl");
    },
  });
  await assert.rejects(lstat(f.dataDir), { code: "ENOENT" });
  assert.ok((await lstat(f.userDir)).isDirectory());
  assert.ok((await lstat(join(f.home, "repos/wallet"))).isDirectory());
});
test("unsafe roots, symlinks, concurrent installer and foreign services are refused", async (t) => {
  const f = await fixture(t);
  await assert.rejects(uninstallPlan({ ...f, dataDir: f.home }));
  await symlink(f.dataDir, join(f.home, "alias"));
  await assert.rejects(uninstallPlan({ ...f, dataDir: join(f.home, "alias") }));
  const install = join(f.home, "repos/.agentpay-install");
  await mkdir(install, { mode: 0o700 });
  await writeFile(join(install, "install.lock"), "busy");
  await assert.rejects(uninstallPlan(f), /installer lock/);
  await rm(join(install, "install.lock"));
  const units = join(f.home, ".config/systemd/user");
  await mkdir(units, { recursive: true, mode: 0o700 });
  await writeFile(join(units, "agentpay-local-wallet.service"), "foreign", {
    mode: 0o600,
  });
  await assert.rejects(uninstallPlan(f), /managed file/);
  assert.equal(
    await readFile(join(f.dataDir, "session-key"), "utf8"),
    "fixture",
  );
});
test("active external listeners preserve data; managed units stop before deletion", async (t) => {
  const f = await fixture(t),
    unitDir = join(f.home, ".config/systemd/user");
  await mkdir(unitDir, { recursive: true, mode: 0o700 });
  for (const [name, body] of Object.entries(
    autostartFiles({ ...f, node: process.execPath }),
  ))
    await writeFile(join(unitDir, name), body, { mode: 0o600 });
  const plan = await uninstallPlan(f),
    calls = [],
    manage = async (args) => {
      calls.push(args);
      return { stdout: "MainPID=0\nActiveState=inactive\n" };
    };
  await assert.rejects(
    removeInstallation(plan, { manage, probe: async () => true }),
    /still running/,
  );
  assert.equal(
    await readFile(join(f.dataDir, "session-key"), "utf8"),
    "fixture",
  );
  assert.ok(!calls.some((a) => a[0] === "disable"));
  await removeInstallation(plan, { manage, probe: async () => false });
  assert.ok(calls.some((a) => a[0] === "disable"));
  await assert.rejects(lstat(f.dataDir), { code: "ENOENT" });
});

test("installation checkpoint and exported settings are cleaned; unrelated repository files remain", async (t) => {
  const f = await fixture(t),
    parent = join(f.home, "repos"),
    install = join(parent, ".agentpay-install");
  await mkdir(install, { mode: 0o700 });
  await writeFile(
    join(install, "state.json"),
    JSON.stringify({ version: 1, dataDir: f.dataDir }),
    { mode: 0o600 },
  );
  for (const name of [
    "user-deployment.json",
    "anvil-onboarding.json",
    "keep.txt",
  ])
    await writeFile(join(parent, name), "fixture", { mode: 0o600 });
  const plan = await uninstallPlan(f);
  await removeInstallation(plan, { probe: async () => false });
  for (const path of [
    install,
    join(parent, "user-deployment.json"),
    join(parent, "anvil-onboarding.json"),
  ])
    await assert.rejects(lstat(path), { code: "ENOENT" });
  assert.equal(await readFile(join(parent, "keep.txt"), "utf8"), "fixture");
});
