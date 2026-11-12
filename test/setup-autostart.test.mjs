// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { finishLocalSetup, guideOwnsProcess } from "../src/setup-autostart.mjs";
function fixture(choice) {
  const calls = [],
    messages = [];
  let saved = {
    version: 1,
    runtimeUrl: "http://127.0.0.1:6490",
    settlementUrl: "https://example.invalid",
    ...(choice ? { startupChoice: choice } : {}),
  };
  return {
    calls,
    messages,
    options: {
      dataDir: "/private",
      config: saved,
      platform: "linux",
      write: (m) => messages.push(m),
      save: async (value) => {
        if (value.startupChoice) saved.startupChoice = value.startupChoice;
        calls.push("save");
      },
      readSettings: async () => ({ ...saved }),
      available: async () => calls.push("available"),
      owns: async () => true,
      ask: async () => {
        calls.push("ask");
        return "yes";
      },
      enable: async () => calls.push("enable"),
    },
  };
}
test("installation enables deferred startup only, after explicit choice", async () => {
  const f = fixture();
  assert.equal((await finishLocalSetup(f.options)).state, "enabled");
  assert.deepEqual(f.calls, ["save", "available", "ask", "save", "enable"]);
  assert(f.messages.some((m) => m.includes("Current services are kept")));
});
test("saved yes retries partial enable without asking again", async () => {
  const f = fixture("enabled");
  assert.equal(
    (await finishLocalSetup({ ...f.options, ask: () => assert.fail() })).state,
    "enabled",
  );
  assert(f.calls.includes("enable"));
  const g = fixture();
  assert.equal(
    (
      await finishLocalSetup({
        ...g.options,
        enable: async () => {
          throw Error("interrupted");
        },
      })
    ).state,
    "pending",
  );
  assert.equal(
    (await finishLocalSetup({ ...g.options, ask: () => assert.fail() })).state,
    "enabled",
  );
});
test("declined choice persists; q does not alter the choice", async () => {
  const f = fixture();
  assert.equal(
    (await finishLocalSetup({ ...f.options, ask: async () => "no" })).state,
    "declined",
  );
  await finishLocalSetup({ ...f.options, ask: () => assert.fail() });
  assert(!f.calls.includes("enable"));
  const g = fixture();
  await finishLocalSetup({ ...g.options, ask: async () => "q" });
  assert.equal((await finishLocalSetup(g.options)).state, "enabled");
});
test("external services, missing systemd and unsupported OS never enable or signal", async () => {
  for (const [extra, state] of [
    [{ owns: async () => false }, "external"],
    [
      {
        available: async () => {
          throw Error();
        },
      },
      "pending",
    ],
    [{ platform: "darwin" }, "unsupported"],
  ]) {
    const f = fixture();
    assert.equal(
      (
        await finishLocalSetup({
          ...f.options,
          ...extra,
          ask: () => assert.fail(),
        })
      ).state,
      state,
    );
    assert(!f.calls.includes("enable"));
  }
});
test("stale/unsafe PID, wrong process and system operator ownership are not adopted", async () => {
  const expected = ["/node", "/user/src/index.mjs"];
  let argv = expected.join("\0") + "\0",
    group = "0::/user.slice/session.scope",
    env = "AGENTPAY_USER_STATE_FILE=/private/runtime/invocations.json\0";
  const options = {
    pidFile: "/private/runtime/user-runtime-guide.pid",
    expected,
    expectedEnv: {
      AGENTPAY_USER_STATE_FILE: "/private/runtime/invocations.json",
    },
    inspect: async () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      uid: process.getuid(),
      mode: 0o600,
      size: 5,
    }),
    read: async (path) =>
      path.endsWith(".pid")
        ? "12345"
        : path.endsWith("/cmdline")
          ? argv
          : path.endsWith("/environ")
            ? env
            : group,
  };
  assert.equal(await guideOwnsProcess(options), true);
  env = "AGENTPAY_USER_STATE_FILE=/another/runtime/invocations.json\0";
  assert.equal(await guideOwnsProcess(options), false);
  env = "AGENTPAY_USER_STATE_FILE=/private/runtime/invocations.json\0";
  group = "0::/system.slice/agentpay-user.service";
  assert.equal(await guideOwnsProcess(options), false);
  group = "0::/user.slice";
  argv = "/other\0";
  assert.equal(await guideOwnsProcess(options), false);
  assert.equal(
    await guideOwnsProcess({
      ...options,
      read: async () => {
        throw Error("ENOENT");
      },
    }),
    false,
  );
});

test('setup inherits selected login preference instead of offering a contradictory choice',async t=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {isolateState}=await import('./helpers/installed-user.mjs');
 const root=await mkdtemp(join(tmpdir(),'startup-preference-'));isolateState(t,root);t.after(()=>rm(root,{recursive:true,force:true}));
 const {installationDirectory}=await import('../src/installation-paths.mjs');const dir=installationDirectory();await mkdir(dir,{recursive:true,mode:0o700});
 await writeFile(join(dir,'active-services.json'),JSON.stringify({version:1,phase:'selected',target:{dataDir:'/chosen'},startupChoice:'disabled'}),{mode:0o600});
 const f=fixture('enabled');
 const result=await finishLocalSetup({...f.options,dataDir:'/chosen',config:{runtimeUrl:'http://127.0.0.1:6490',settlementUrl:'https://example.invalid'},ask:()=>{throw Error('must not ask');},write:()=>{},available:async()=>{},owns:async()=>true});
 assert.equal(result.state,'declined');
});
