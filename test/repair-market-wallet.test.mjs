// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { repairMarketWallet } from "../src/repair-market-wallet.mjs";
function fixture() {
  const calls = [],
    lines = [];
  let locked = true,
    notRunning = 2;
  const options = {
    dataDir: "/private/user",
    userDir: "/repositories/user",
    write: (m) => lines.push(m),
    inspectSource: async () => "marketConnectionScope",
    checkDirectory: async () => {},
    ensureSettings: async () => {},
    pause: async () => {},
    manage: async (action, context) => {
      assert.equal(context.dataDir, "/private/user");
      calls.push(action);
    },
    prepare: async (input) => {
      calls.push("build");
      assert.equal(input.prepareOnly, true);
      assert.equal(input.forceWalletBuild, true);
      assert.equal(input.market, undefined);
    },
    wallet: async (dir, method) => {
      if (method === "status" && notRunning-- > 0)
        throw Object.assign(Error(), { code: "WALLET_NOT_RUNNING" });
      return method === "status" ? { locked } : {};
    },
    unlock: async (action, opts) => {
      calls.push("unlock");
      assert.equal(action, "unlock");
      assert.deepEqual(opts.args, ["/private/user"]);
      locked = false;
      return 0;
    },
  };
  return { calls, lines, options };
}
test("preparation pauses services, rebuilds, waits for the new Wallet, unlocks and returns to connection", async () => {
  const f = fixture();
  assert.equal(await repairMarketWallet(f.options), true);
  assert.deepEqual(f.calls, ["prepare", "stop", "build", "start", "unlock"]);
  assert.match(f.lines.at(-1), /Continuing your Market connection/);
});
test("failed build keeps the original state and shows a log plus the same retry command", async () => {
  const f = fixture();
  f.options.prepare = async () => {
    throw Object.assign(Error("private build diagnostics"), {
      logPath: "/private/build.log",
    });
  };
  assert.equal(await repairMarketWallet(f.options), false);
  assert.deepEqual(f.calls, ["prepare", "stop"]);
  assert.match(f.lines.join("\n"), /\.\/run market connect/);
  assert.match(f.lines.join("\n"), /\/private\/build.log/);
  assert.match(f.lines.join("\n"), /Wallet and Runtime remain stopped/);
  assert.doesNotMatch(f.lines.join("\n"), /private build diagnostics/);
});
test("source lacking connection capability never stops services; failed unlock never claims success", async () => {
  const old = fixture();
  old.options.inspectSource = async () => "old source";
  assert.equal(await repairMarketWallet(old.options), false);
  assert.deepEqual(old.calls, []);
  const f = fixture();
  f.options.unlock = async () => 1;
  assert.equal(await repairMarketWallet(f.options), false);
  assert.doesNotMatch(f.lines.join("\n"), /Wallet is ready/);
});

test("a dependency verification failure is explained before the retry and log guidance", async () => {
  const f = fixture();
  f.options.prepare = async () => {
    throw Object.assign(Error("internal details"), {
      preparationMessage: "Wallet dependencies could not be verified: example.",
      logPath: "/private/install.log",
    });
  };
  assert.equal(await repairMarketWallet(f.options), false);
  assert.match(
    f.lines.join("\n"),
    /Wallet dependencies could not be verified: example/,
  );
  assert.doesNotMatch(f.lines.join("\n"), /internal details/);
});
