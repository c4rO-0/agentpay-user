// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { installAndSetup } from "../src/install-and-setup.mjs";
test("unified entry installs before setup and propagates guide exit status", async () => {
  const calls = [],
    identity = {
      userDir: "/tools/user",
      market: "https://market.example",
      dataDir: "/private/user",
    };
  const code = await installAndSetup({
    ...identity,
    write: () => {},
    remember: async (args) => {
      assert.equal(args.dataDir, identity.dataDir);
      calls.push("remember");
    },
    install: async (args) => {
      assert.equal(args.market, identity.market);
      calls.push("install");
      return { completed: true };
    },
    start: async (args) => {
      assert.equal(args.dataDir, identity.dataDir);
      calls.push("setup");
      return 7;
    },
  });
  assert.deepEqual(calls, ["install", "remember", "setup"]);
  assert.equal(code, 7);
});
test("installation failure never starts setup or authorizes anything", async () => {
  let started = false;
  await assert.rejects(
    installAndSetup({
      userDir: "/tools/user",
      market: "https://market.example",
      dataDir: "/private/user",
      write: () => {},
      install: async () => {
        throw Error("dependency install failed");
      },
      start: async () => {
        started = true;
      },
    }),
    /dependency install failed/,
  );
  assert.equal(started, false);
});
