// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyLocalUpdate,
  checkUpdatePair,
  updateSnapshot,
} from "../src/local-update.mjs";
function fixture() {
  const calls = [],
    lines = [],
    state = {};
  const context = {
    logPath: "/private/update.log",
    state,
    initial: { ok: true },
    saveState: async () => {},
  };
  const opts = {
    userDir: "/source/user",
    dataDir: "/private/user",
    platform: "linux",
    write: (s) => lines.push(s),
    pairCheck: async () => ({ userVersion: "1.0.0", walletVersion: "0.5.0" }),
    checkDirectory: async () => {},
    settings: async () => {},
    connection: async () => {},
    pause: async () => {},
    ask: async () => "confirm",
    snapshot: async () => ({ inputs: "source", outputs: "build" }),
    officialTest: async () => ({ status: "ready" }),
    service: async (action) => {
      calls.push(action);
    },
    wallet: async () => ({ locked: true }),
    runtime: async () => ({ role: "user-runtime" }),
    prepare: async (options) => {
      assert.equal(options.prepareOnly, true);
      assert.equal(options.forceWalletBuild, true);
      assert.equal(options.market, undefined);
      if ((await options.beforePrepare(context)) === false)
        return { completed: true, skipped: true };
      calls.push("build");
      await options.afterPrepare(context);
      return { completed: true };
    },
  };
  return { calls, lines, opts, state, context };
}
test("local update orchestrates build and restart, with no Git or Market step or automatic unlock", async () => {
  const f = fixture();
  assert.equal(await applyLocalUpdate(f.opts), 0);
  assert.deepEqual(f.calls, ["prepare", "stop", "build", "start"]);
  assert.match(f.lines.join("\n"), /Next: .\/run wallet unlock/);
  assert.doesNotMatch(f.calls.join(","), /enable|disable|unlock/);
});
test("mismatched pair, unsupported platform and installer contention never pause services", async () => {
  for (const change of [
    {
      pairCheck: async () => {
        throw Error("Wrong pair");
      },
    },
    { platform: "darwin" },
    {
      prepare: async () => {
        throw Error("Another installation is running");
      },
    },
  ]) {
    const f = fixture();
    assert.equal(await applyLocalUpdate({ ...f.opts, ...change }), 1);
    assert.deepEqual(f.calls, []);
    assert.match(f.lines.join("\n"), /before pausing/);
  }
});
test("failed build leaves services stopped and gives one retry command", async () => {
  const f = fixture();
  f.opts.prepare = async (o) => {
    await o.beforePrepare(f.context);
    throw Error("build error");
  };
  assert.equal(await applyLocalUpdate(f.opts), 1);
  assert.deepEqual(f.calls, ["prepare", "stop"]);
  assert.match(f.lines.join("\n"), /remain stopped/);
  assert.match(f.lines.join("\n"), /run repair again/);
  assert.doesNotMatch(f.lines.join("\n"), /Repair complete/);
});
test("failed stop never reaches build; unhealthy restart never claims completion", async () => {
  const f = fixture();
  f.opts.service = async (action) => {
    f.calls.push(action);
    if (action === "stop") throw Error("stop failed");
  };
  assert.equal(await applyLocalUpdate(f.opts), 1);
  assert.deepEqual(f.calls, ["prepare", "stop"]);
  assert.match(f.lines.join("\n"), /could not be confirmed/);
  const g = fixture();
  g.opts.runtime = async () => {
    throw Error("unhealthy");
  };
  assert.equal(await applyLocalUpdate(g.opts), 1);
  assert.doesNotMatch(g.lines.join("\n"), /Repair complete/);
});
test("pair check works with ZIP folders (no Git) and Git metadata; mismatched Wallet is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "update-pair-"));
  try {
    const user = join(dir, "user"),
      wallet = join(dir, "wallet");
    await mkdir(user);
    await mkdir(wallet);
    const types = "0.14.3";
    await writeFile(
      join(user, "update-pair.json"),
      JSON.stringify({
        format: "agentpay.local-update-pair.v1",
        userVersion: "1.0.0",
        walletVersion: "0.5.0",
        typesDependency: types,
      }),
    );
    await writeFile(
      join(user, "package.json"),
      JSON.stringify({
        name: "@agentpay/user-runtime",
        version: "1.0.0",
        dependencies: { "@c4roa0/agentpay-protocol": types },
      }),
    );
    const pkg = {
      name: "agentpay-wallet",
      version: "0.5.0",
      dependencies: { "@c4roa0/agentpay-protocol": types },
    };
    await writeFile(join(wallet, "package.json"), JSON.stringify(pkg));
    assert.equal((await checkUpdatePair(user)).walletVersion, "0.5.0");
    await mkdir(join(user, ".git"));
    await writeFile(join(wallet, ".git"), "gitdir: retained-submodule");
    await checkUpdatePair(user);
    await writeFile(
      join(wallet, "package.json"),
      JSON.stringify({ ...pkg, version: "0.4.0" }),
    );
    await assert.rejects(checkUpdatePair(user), /do not match/);
    for (const dependencies of [
      { "@c4roa0/agentpay-protocol": "0.14.2" },
      { "@agentpay/types": "file:vendor/protocol/agentpay-types-0.14.1.tgz" },
    ]) {
      await writeFile(join(wallet, "package.json"), JSON.stringify({ ...pkg, dependencies }));
      await assert.rejects(checkUpdatePair(user), /do not match/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancellation has no service or build side effects; force skips only the prompt", async () => {
  const f = fixture();
  f.opts.ask = async () => "q";
  assert.equal(await applyLocalUpdate(f.opts), 0);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.state, {});
  const g = fixture();
  g.opts.ask = async () => {
    throw Error("must not prompt");
  };
  assert.equal(await applyLocalUpdate({ ...g.opts, force: true }), 0);
  assert.equal(g.state.localUpdate.status, "complete");
  const bad = fixture();
  bad.opts.pairCheck = async () => {
    throw Error("bad pair");
  };
  assert.equal(await applyLocalUpdate({ ...bad.opts, force: true }), 1);
  assert.deepEqual(bad.calls, []);
});
test("successful unchanged updates neither prompt nor restart, including -f", async () => {
  const f = fixture();
  await applyLocalUpdate(f.opts);
  f.calls.length = 0;
  f.opts.ask = async () => {
    throw Error("no prompt");
  };
  assert.equal(await applyLocalUpdate(f.opts), 0);
  assert.deepEqual(f.calls, []);
  assert.equal(await applyLocalUpdate({ ...f.opts, force: true }), 0);
  assert.deepEqual(f.calls, []);
  assert.match(f.lines.join(" "), /already up to date/);
});
test("changed source at confirmation stops; incomplete update still prompts on retry", async () => {
  const f = fixture();
  let reads = 0;
  f.opts.snapshot = async () => ({
    inputs: reads++ ? "different" : "source",
    outputs: "build",
  });
  assert.equal(await applyLocalUpdate(f.opts), 1);
  assert.deepEqual(f.calls, []);
  const g = fixture();
  g.state.localUpdate = { status: "pending", inputs: "source" };
  let asked = 0;
  g.opts.ask = async () => {
    asked++;
    return "q";
  };
  assert.equal(await applyLocalUpdate(g.opts), 0);
  assert.equal(asked, 1);
  assert.deepEqual(g.calls, []);
  assert.equal(g.state.localUpdate.status, "pending");
});

test("update detection includes same-version source and generated Wallet changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "update-snapshot-"));
  try {
    const user = join(dir, "user"),
      wallet = join(dir, "wallet");
    for (const root of [user, wallet])
      for (const sub of ["src", "scripts", "dist/src"])
        await mkdir(join(root, sub), { recursive: true });
    for (const name of [
      "package.json",
      "package-lock.json",
      "update-pair.json",
      "run",
    ])
      await writeFile(join(user, name), "fixture");
    for (const name of ["package.json", "pnpm-lock.yaml", "tsconfig.json"])
      await writeFile(join(wallet, name), "fixture");
    await writeFile(join(user, "src/example.mjs"), "before");
    await writeFile(join(wallet, "dist/src/cli.js"), "built");
    const a = await updateSnapshot(user);
    assert.deepEqual(await updateSnapshot(user), a);
    await writeFile(join(user, "src/example.mjs"), "after");
    const b = await updateSnapshot(user);
    assert.notEqual(b.inputs, a.inputs);
    assert.equal(b.outputs, a.outputs);
    await writeFile(join(wallet, "dist/src/cli.js"), "modified");
    const c = await updateSnapshot(user);
    assert.equal(c.inputs, b.inputs);
    assert.notEqual(c.outputs, b.outputs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("official test preparation runs after update and on unchanged retry, never on cancellation or failure", async () => {
  const f = fixture();
  let checked = 0;
  f.opts.officialTest = async () => {
    checked++;
    return { status: "unavailable" };
  };
  assert.equal(await applyLocalUpdate(f.opts), 0);
  assert.equal(checked, 1);
  f.calls.length = 0;
  assert.equal(await applyLocalUpdate(f.opts), 0);
  assert.equal(checked, 2);
  assert.deepEqual(f.calls, []);
  const g = fixture();
  g.opts.ask = async () => "q";
  g.opts.officialTest = async () => {
    throw Error("must not check");
  };
  assert.equal(await applyLocalUpdate(g.opts), 0);
});

test("repair checks client connection even with unchanged source; conflicts stop before services", async () => {
  const f = fixture();
  let checks = 0;
  f.opts.connection = async () => {
    checks++;
  };
  await applyLocalUpdate(f.opts);
  assert.equal(checks, 1);
  f.calls.length = 0;
  assert.equal(await applyLocalUpdate(f.opts), 0);
  assert.equal(checks, 2);
  assert.deepEqual(f.calls, []);
  const g = fixture();
  g.opts.connection = async () => {
    throw Error("Connection conflict");
  };
  assert.equal(await applyLocalUpdate(g.opts), 1);
  assert.deepEqual(g.calls, []);
  const h = fixture();
  h.opts.ask = async () => "q";
  h.opts.connection = async () =>
    assert.fail("cancelled repair must not write");
  assert.equal(await applyLocalUpdate(h.opts), 0);
});
