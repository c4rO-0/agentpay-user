// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { controlWallet } from "../src/wallet-control.mjs";
function fixture({
  code = 0,
  output = '{"address":"0x123"}',
  errors = "",
} = {}) {
  const calls = [],
    messages = [],
    prompts = [];
  return {
    calls,
    messages,
    prompts,
    options: {
      args: [],
      env: {},
      terminal: true,
      probe: async () => true,
      resolveDirectory: async ({ argument, env }) =>
        resolve(
          argument ||
            env.AGENTPAY_USER_DATA_DIR ||
            join(homedir(), ".local/share/agentpay/user"),
        ),
      inspect: async () => ({
        isFile: () => true,
        isDirectory: () => true,
        isSocket: () => true,
        isSymbolicLink: () => false,
        uid: process.getuid(),
        mode: 0o700,
      }),
      write: (m) => messages.push(m),
      prompt: (m) => prompts.push(m),
      spawnWallet(...args) {
        calls.push(args);
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        queueMicrotask(() => {
          child.stderr.emit("data", "Unlock sec");
          child.stderr.emit("data", "ret: ");
          child.stdout.emit("data", output);
          child.stderr.emit("data", "\n" + errors);
          child.emit("close", code);
        });
        return child;
      },
    },
  };
}
test("unlock inherits only stdin, forwards hidden prompt and formats success", async () => {
  const f = fixture();
  assert.equal(await controlWallet("unlock", f.options), 0);
  const [node, args, options] = f.calls[0];
  assert.equal(node, process.execPath);
  assert(args[0].endsWith("/bin/agentpay-wallet.mjs"));
  assert.deepEqual(args.slice(1), [
    "unlock",
    join(homedir(), ".local/share/agentpay/user/wallet"),
  ]);
  assert.deepEqual(options, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  });
  assert.deepEqual(f.prompts, ["Wallet password (input hidden): ", "\n"]);
  assert.equal(f.messages.length, 1);
  assert(!f.messages[0].includes("0x123"));
});
test("custom directory precedence and shell metacharacters remain literal", async () => {
  const f = fixture();
  await controlWallet("unlock", {
    ...f.options,
    args: ["./data; x"],
    env: { AGENTPAY_USER_DATA_DIR: "/other" },
  });
  assert.equal(f.calls[0][1][2], join(resolve("./data; x"), "wallet"));
  const g = fixture();
  await controlWallet("unlock", {
    ...g.options,
    env: { AGENTPAY_USER_DATA_DIR: "/other" },
  });
  assert.equal(g.calls[0][1][2], "/other/wallet");
});
test("missing setup fails before password or child process", async () => {
  const f = fixture();
  assert.equal(
    await controlWallet("unlock", {
      ...f.options,
      inspect: async (p) => {
        if (p.endsWith("agentpay-wallet.mjs")) return { isFile: () => true };
        throw Object.assign(Error("missing"), { code: "ENOENT" });
      },
    }),
    1,
  );
  assert.equal(f.calls.length, 0);
  assert(f.messages[0].includes("setup files are missing"));
});
test("noninteractive unlock, extra args, unsafe permissions and missing socket fail closed", async () => {
  for (const extra of [
    { terminal: false },
    { args: ["/data", "password"] },
    {
      inspect: async () => ({
        isFile: () => true,
        isDirectory: () => true,
        uid: -1,
      }),
    },
    {
      inspect: async (p) => {
        if (p.endsWith("wallet.sock")) throw Error();
        return {
          isFile: () => true,
          isDirectory: () => true,
          isSymbolicLink: () => false,
          uid: process.getuid(),
          mode: 0o700,
        };
      },
    },
  ]) {
    const f = fixture();
    assert.notEqual(
      await controlWallet("unlock", { ...f.options, ...extra }),
      0,
    );
    assert.equal(f.calls.length, 0);
  }
});
test("lock uses formal Wallet CLI and does not require interactive input", async () => {
  const f = fixture({ output: '{"locked":true}' });
  assert.equal(
    await controlWallet("lock", { ...f.options, terminal: false }),
    0,
  );
  assert.equal(f.calls[0][1][1], "lock");
  assert(f.messages[0].includes("on-chain spending permission is unchanged"));
});
test("public errors are translated without exposing raw internal details", async () => {
  for (const code of ["UNLOCK_FAILED", "INTERNAL_ERROR", "CANCELLED"]) {
    const f = fixture({
      code: 1,
      output: "",
      errors: JSON.stringify({
        ok: false,
        error: { code, message: "private stack" },
      }),
    });
    assert.equal(await controlWallet("unlock", f.options), 1);
    assert(!f.messages.join("").includes("private stack"));
    assert(!f.messages.join("").includes("{"));
  }
});
test("exit alone or interrupted child cannot report unlocked", async () => {
  for (const opts of [{ code: null }, { code: 0, output: "not json" }]) {
    const f = fixture(opts);
    assert.equal(await controlWallet("unlock", f.options), 1);
    assert(!f.messages.some((m) => m.startsWith("Wallet unlocked.")));
  }
});

test("stale socket refuses unlock before password input; no file is deleted", async () => {
  const f = fixture();
  assert.equal(
    await controlWallet("unlock", { ...f.options, probe: async () => false }),
    1,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.prompts.length, 0);
  assert(f.messages[0].includes("stale"));
  const g = fixture();
  assert.equal(
    await controlWallet("unlock", {
      ...g.options,
      probe: async () => {
        throw Error("EACCES");
      },
    }),
    1,
  );
  assert.equal(g.calls.length, 0);
});
test("status is read-only and reports running/locked without password", async () => {
  const f = fixture({ output: '{"locked":true}' });
  assert.equal(
    await controlWallet("status", { ...f.options, terminal: false }),
    0,
  );
  assert.equal(f.calls[0][1][1], "status");
  assert.equal(f.messages[0], "Wallet: running (locked).");
});
