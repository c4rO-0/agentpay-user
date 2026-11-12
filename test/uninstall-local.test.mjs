import { isolateState } from "./helpers/installed-user.mjs";
import { installationDirectory } from "../src/installation-paths.mjs";
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
  isolateState(t, home);
  await mkdir(join(home, "state/agentpay"),{recursive:true});
  t.after(() => rm(home, { recursive: true, force: true }));
  const userDir = join(home, "repos/user"),
    dataDir = join(home, "data");
  for (const path of [userDir, join(home, "repos/wallet"), dataDir])
    await mkdir(path, { recursive: true, mode: 0o700 });
  await writeFile(join(dataDir, "session-key"), "fixture");
  return { home, userDir, dataDir, removeData:true };
}
test("explicit confirmation required; cancellation does not stop services", async () => {
  let removed = 0;
  const opts = {
    terminal: true,
    removeData: true,
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
  const install = installationDirectory();
  await mkdir(install, { mode: 0o700 });
  await writeFile(join(install, "install.lock"), "busy", {mode:0o600});
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
    install = installationDirectory();
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
    await writeFile(join(name === "keep.txt" ? parent : f.dataDir, name), "fixture", { mode: 0o600 });
  await writeFile(join(install,'other-installation.json'),'keep',{mode:0o600});
  const plan = await uninstallPlan(f);
  await removeInstallation(plan, { probe: async () => false });
  assert.equal(await readFile(join(install,'other-installation.json'),'utf8'),'keep');
  for (const path of [
    join(install, 'state.json'),
    join(f.dataDir, "user-deployment.json"),
    join(f.dataDir, "anvil-onboarding.json"),
  ])
    await assert.rejects(lstat(path), { code: "ENOENT" });
  assert.equal(await readFile(join(parent, "keep.txt"), "utf8"), "fixture");
});

test('ordinary uninstall keeps keys and history',async t=>{
 const f=await fixture(t);const plan=await uninstallPlan({...f,removeData:false});
 await removeInstallation(plan,{probe:async()=>false});
 assert.equal(await readFile(join(f.dataDir,'session-key'),'utf8'),'fixture');
});

test("explicit purge retires only matching legacy configuration and cannot reimport it", async t => {
  const f = await fixture(t);
  const {dirname} = await import('node:path');
  const {rememberUserDataDir,resolveUserDataDir} = await import('../src/local-data-directory.mjs');
  const {importSetupFiles} = await import('../src/installation-paths.mjs');
  const legacy = join(dirname(f.userDir),'.agentpay-install');
  await mkdir(legacy,{mode:0o700});
  await writeFile(join(legacy,'state.json'),JSON.stringify({version:1,dataDir:f.dataDir}),{mode:0o600});
  await writeFile(join(dirname(f.userDir),'anvil-onboarding.json'),'{}',{mode:0o600});
  await rememberUserDataDir(f);
  await removeInstallation(await uninstallPlan(f),{probe:async()=>false});
  assert.notEqual(await resolveUserDataDir({userDir:f.userDir,env:{}}),f.dataDir);
  await importSetupFiles(f.dataDir,f.userDir);
  await assert.rejects(readFile(join(f.dataDir,'anvil-onboarding.json')),{code:'ENOENT'});
});

test('inactive uninstall preserves the other installation service pair and data', async t => {
  const f = await fixture(t);
  const other = {userDir:join(f.home,'other-user'), dataDir:join(f.home,'other-data'), node:process.execPath};
  const unitDir = join(f.home,'.config/systemd/user');
  await mkdir(unitDir,{recursive:true,mode:0o700});
  await mkdir(other.dataDir,{mode:0o700});
  await writeFile(join(other.dataDir,'history'),'keep');
  const files = autostartFiles(other);
  for (const [name,body] of Object.entries(files)) await writeFile(join(unitDir,name),body,{mode:0o600});
  const plan = await uninstallPlan(f);
  assert.equal(plan.units.length,0);
  await removeInstallation(plan,{probe:async()=>false,manage:async()=>{throw Error('Must not stop the active installation');}});
  await assert.rejects(lstat(f.dataDir),{code:'ENOENT'});
  for (const [name,body] of Object.entries(files)) assert.equal(await readFile(join(unitDir,name),'utf8'),body);
  assert.equal(await readFile(join(other.dataDir,'history'),'utf8'),'keep');
});

test('uninstall rechecks a completed switch after confirmation and preserves shared data', async t => {
  const f = await fixture(t);
  const plan = await uninstallPlan(f);
  const unitDir = join(f.home,'.config/systemd/user');
  await mkdir(unitDir,{recursive:true,mode:0o700});
  for (const [name,body] of Object.entries(autostartFiles({...f,node:process.execPath,userDir:join(f.home,'another-user')})))
    await writeFile(join(unitDir,name),body,{mode:0o600});
  await assert.rejects(removeInstallation(plan,{probe:async()=>false}),/Another installation uses this data/);
  assert.equal(await readFile(join(f.dataDir,'session-key'),'utf8'),'fixture');
});

test('uninstall refuses a busy service transition lock and rejects a changed removal scope', async t => {
  const f = await fixture(t);
  const {withServiceLifecycleLock} = await import('../src/service-selection.mjs');
  const plan = await uninstallPlan(f);
  let release, entered;
  const ready = new Promise(resolve=>{entered=resolve;});
  const gate = new Promise(resolve=>{release=resolve;});
  const transition = withServiceLifecycleLock(async()=>{
    entered(); await gate;
    const unitDir=join(f.home,'.config/systemd/user');
    await mkdir(unitDir,{recursive:true,mode:0o700});
    for(const [name,body] of Object.entries(autostartFiles({...f,node:process.execPath})))
      await writeFile(join(unitDir,name),body,{mode:0o600});
  });
  await ready;
  await assert.rejects(removeInstallation(plan,{probe:async()=>false}),/Another AgentPay/);
  assert.equal(await readFile(join(f.dataDir,'session-key'),'utf8'),'fixture');
  release(); await transition;
  await assert.rejects(removeInstallation(plan,{probe:async()=>false}),/changed since confirmation/);
  assert.equal(await readFile(join(f.dataDir,'session-key'),'utf8'),'fixture');
});

test('retry after partial unit removal finishes only the remaining managed files', async t => {
  const f = await fixture(t);
  const unitDir=join(f.home,'.config/systemd/user');
  await mkdir(unitDir,{recursive:true,mode:0o700});
  const files=autostartFiles({...f,node:process.execPath});
  for(const [name,body] of Object.entries(files)) await writeFile(join(unitDir,name),body,{mode:0o600});
  await rm(join(unitDir,'agentpay-local-wallet.service'));
  const plan=await uninstallPlan(f);
  assert.equal(plan.units.length,2);
  await removeInstallation(plan,{probe:async()=>false,manage:async()=>({stdout:'MainPID=0\nActiveState=inactive\n'})});
  await assert.rejects(lstat(f.dataDir),{code:'ENOENT'});
  for(const name of Object.keys(files)) await assert.rejects(lstat(join(unitDir,name)),{code:'ENOENT'});
});

test('uninstall can retry a recognized interrupted operation without manual lock deletion',async t=>{
 const f=await fixture(t);
 const {installationLockMarker}=await import('../src/installation-operation.mjs');
 await mkdir(installationDirectory(),{recursive:true,mode:0o700});
 await writeFile(join(installationDirectory(),'install.lock'),installationLockMarker,{mode:0o600});
 const plan=await uninstallPlan(f);
 await removeInstallation(plan,{probe:async()=>false});
 await assert.rejects(lstat(f.dataDir),{code:'ENOENT'});
});
