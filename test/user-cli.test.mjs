// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { runUserCli } from "../src/user-cli.mjs";
test("grouped services preserve lifecycle/startup separation and reject old/unsafe commands", async () => {
  const calls = [];
  let removed = 0;
  const opts = {
    run: async (a) => {
      calls.push(a);
      return 0;
    },
    write: () => {},
    uninstall: async () => {
      removed++;
      return 0;
    },
  };
  await runUserCli(["service", "start"], opts);
  assert.equal(calls[0].at(-1), "prepare");
  assert.equal(calls[1].at(-1), "start");
  await runUserCli(["service", "autostart", "off"], opts);
  assert.equal(calls.at(-1).at(-1), "disable");
  await runUserCli(["wallet", "unlock"], opts);
  assert.ok(calls.at(-1)[0].endsWith("unlock.mjs"));
  await runUserCli(["policy", "renew"], opts);
  assert.ok(calls.at(-1)[0].endsWith("renew.mjs"));
  await runUserCli(["policy", "revoke"], opts);
  assert.ok(calls.at(-1)[0].endsWith("revoke.mjs"));
  await runUserCli(["payment", "test"], opts);
  assert.ok(calls.at(-1)[0].endsWith("official-paid-test.mjs"));
  for (const args of [
    ["unlock"],
    ["renew"],
    ["autostart-off"],
    ["policy", "revoke", "-f"],
    ["uninstall", "--yes"],
  ])
    assert.equal(await runUserCli(args, opts), 2);
  assert.equal(removed, 0);
  await runUserCli(["uninstall"], opts);
  assert.equal(removed, 1);
});
test("help works at every group without loading keys or running operations", async () => {
  let calls = 0,
    text = "";
  const opts = {
    run: async () => {
      calls++;
      return 0;
    },
    write: (s) => (text = s),
  };
  for (const group of [
    "wallet",
    "policy",
    "service",
    "market",
    "orders",
    "cache",
    "payment",
  ]) {
    await runUserCli([group], opts);
    assert.match(text, new RegExp("run " + group));
    await runUserCli([group, "help"], opts);
  }
  await runUserCli(["service", "autostart", "help"], opts);
  assert.match(text, /future logins/);
  assert.equal(calls, 0);
  await runUserCli(["help"], opts);
  assert.match(text, /policy help/);
  assert.ok(text.length < 2400);
});
test("repair -f and Market connection retain bounded options", async () => {
  const calls = [];
  const opts = {
    run: async (a) => {
      calls.push(a);
      return 0;
    },
    write: () => {},
    connect: async (a) => {
      calls.push(a);
      return 0;
    },
  };
  await runUserCli(["repair", "-f"], opts);
  assert.equal(calls.at(-1).at(-1), "-f");
  assert.equal(await runUserCli(["repair", "-f", "-f"], opts), 2);
  await runUserCli(
    ["market", "connect", "--market", "https://market.example"],
    opts,
  );
  assert.deepEqual(calls.at(-1), ["--market", "https://market.example"]);
  assert.equal(
    await runUserCli(["market", "connect", "--password", "secret"], opts),
    2,
  );
});
test("failed service preparation prevents start", async () => {
  let calls = 0;
  assert.equal(
    await runUserCli(["service", "start"], {
      run: async () => {
        calls++;
        return 1;
      },
    }),
    1,
  );
  assert.equal(calls, 1);
});

test("help explains Git and ZIP updates and old update cannot change services", async () => {
  let text = "",
    calls = 0;
  const opts = {
    write: (s) => (text = s),
    run: async () => {
      calls++;
      return 0;
    },
  };
  await runUserCli(["help"], opts);
  assert.match(text, /git pull --ff-only/);
  assert.match(text, /ZIP:/);
  assert.doesNotMatch(text, /does not download/);
  assert.match(text, /run repair/);
  assert.equal(await runUserCli(["update"], opts), 2);
  assert.equal(calls, 0);
  await runUserCli(["repair", "-f"], {
    ...opts,
    run: async (args) => {
      assert.ok(args[0].endsWith("repair.mjs"));
      return 0;
    },
  });
});
