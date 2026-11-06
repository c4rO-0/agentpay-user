// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { connectMarket, marketOrigin } from "../src/connect-market.mjs";
const scope = {
  safe: "0x" + "1".repeat(40),
  module: "0x" + "2".repeat(40),
  policyId: "0x" + "3".repeat(64),
  network: "eip155:31337",
};
function fixture({
  cancel = false,
  locked = false,
  patch = null,
  verifyFail = false,
} = {}) {
  const writes = [],
    requests = [],
    signs = [],
    saved = [];
  let hidden = false;
  const options = {
    unlock: async () => 1,
    dataDir: "/not-used",
    write: (m) => writes.push(m),
    load: async () => null,
    save: async (dir, v) => saved.push(v),
    ask: async (message, opt) => {
      if (message === "Market account email") return "alice@example.com";
      if (opt?.hidden) {
        hidden = true;
        return "secret-not-to-log";
      }
      if (message.startsWith("Wallet nickname")) return "Work PC";
      if (message.startsWith("Type 'confirm'")) return cancel ? "q" : "confirm";
      throw Error("Unexpected prompt " + message);
    },
    wallet: async (dir, method, payload) => {
      if (method === "status") return { locked };
      if (method === "marketConnectionScope") return scope;
      assert.equal(method, "signMarketConnection");
      signs.push(payload);
      return { authorization: { request: { action: "market.connect" } } };
    },
    fetchJson: async (url, opts) => {
      const body = opts.body === undefined ? undefined : JSON.parse(opts.body);
      requests.push({ url, body, headers: opts.headers });
      let result;
      if (url.endsWith("/connections")) result = { connections: [] };
      else if (url.endsWith("/login"))
        result = {
          sessionToken: "temporary-session",
          developer: { id: "alice" },
        };
      else if (url.endsWith("/challenge"))
        result = {
          scope: patch ? { ...scope, ...patch } : scope,
          payload: {
            marketOrigin: "https://market.example",
            accountId: "alice",
            label: body.label,
            challengeId: "a".repeat(64),
            nonce: "b".repeat(64),
            expiresAtMs: Date.now() + 60000,
          },
        };
      else if (url.endsWith("/verify")) {
        if (verifyFail)
          return {
            response: { ok: false, status: 503 },
            result: { ok: false },
          };
        result = {
          connection: {
            ...scope,
            id: "c".repeat(64),
            label: "Work PC",
            delegate: "0x" + "4".repeat(40),
            verifiedAtMs: Date.now(),
          },
        };
      } else {
        assert.ok(url.endsWith("/logout"));
        result = { revoked: true };
      }
      return {
        response: { ok: true, status: 200 },
        result: { ok: true, result },
      };
    },
  };
  return { options, writes, requests, signs, saved, hidden: () => hidden };
}
test("User connects named local authorization and revokes the temporary login without storing credentials", async () => {
  const f = fixture();
  assert.equal(
    await connectMarket(["--market", "https://market.example"], f.options),
    0,
  );
  assert.equal(f.hidden(), true);
  assert.equal(f.signs[0].label, "Work PC");
  assert.equal(f.saved[0].connection.label, "Work PC");
  assert.equal(
    f.requests.at(-1).url,
    "https://market.example/market/developers/logout",
  );
  assert.equal(
    f.requests.find((r) => r.url.endsWith("/challenge")).body.scope.policyId,
    scope.policyId,
  );
  assert.doesNotMatch(
    JSON.stringify(f.saved) + f.writes.join(""),
    /secret-not-to-log|temporary-session/,
  );
  assert.match(f.writes.join(""), /guide has finished/);
  assert.match(f.writes.join(""), /Market → Account → My Orders/);
  assert.doesNotMatch(f.writes.join(""), /\/account\/orders/);
});
test("cancel or locked Wallet signs nothing; signed-in cancellation still ends its temporary session", async () => {
  for (const mode of [{ cancel: true }, { locked: true }]) {
    const f = fixture(mode);
    assert.equal(
      await connectMarket(["--market", "https://market.example"], f.options),
      mode.cancel ? 0 : 1,
    );
    assert.equal(f.signs.length, 0);
    assert.equal(f.saved.length, 0);
    if (mode.cancel) assert.match(f.requests.at(-1).url, /logout$/);
    else assert.equal(f.requests.length, 0);
  }
});
test("different scope and failed verification never save a false connection", async () => {
  for (const patch of [
    { patch: { policyId: "0x" + "8".repeat(64) } },
    { verifyFail: true },
  ]) {
    const f = fixture(patch);
    assert.equal(
      await connectMarket(["--market", "https://market.example"], f.options),
      1,
    );
    assert.equal(f.saved.length, 0);
    assert.match(f.requests.at(-1).url, /logout$/);
    if (patch.patch) assert.equal(f.signs.length, 0);
  }
});
test("credential requests require a fixed HTTPS or loopback origin", () => {
  assert.equal(marketOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  for (const value of [
    "http://public.example",
    "https://user:secret@market.example",
    "https://market.example/path",
    "https://market.example/?key=x",
  ])
    assert.throws(() => marketOrigin(value));
});

test("a lost local shortcut does not misreport a confirmed remote connection as failed", async () => {
  const f = fixture();
  f.options.save = async () => {
    throw Error("write failed");
  };
  assert.equal(
    await connectMarket(["--market", "https://market.example"], f.options),
    0,
  );
  assert.match(f.writes.join(""), /local shortcut could not be saved/);
  assert.match(f.writes.at(-1), /Wallet connected: Work PC/);
  assert.match(f.requests.at(-1).url, /logout$/);
});

test("old Wallet offers one preparation step and continues the same connection", async () => {
  const f = fixture(),
    original = f.options.wallet;
  let ready = false,
    repairs = 0;
  f.options.wallet = async (...args) => {
    if (args[1] === "marketConnectionScope" && !ready)
      throw Object.assign(Error("old"), { code: "METHOD_NOT_ALLOWED" });
    return original(...args);
  };
  const ask = f.options.ask;
  f.options.ask = (message, opt) =>
    message.includes("Type 'confirm' to continue")
      ? "confirm"
      : ask(message, opt);
  f.options.repair = async ({ dataDir }) => {
    assert.equal(dataDir, "/not-used");
    repairs++;
    ready = true;
    return true;
  };
  assert.equal(
    await connectMarket(["--market", "https://market.example"], f.options),
    0,
  );
  assert.equal(repairs, 1);
  assert.equal(f.saved.length, 1);
  assert.match(f.writes.at(-1), /guide has finished/);
});
test("declined or failed preparation never signs in, signs or saves a connection", async () => {
  for (const confirm of [false, true]) {
    const f = fixture();
    let repairs = 0;
    f.options.wallet = async () => {
      throw Object.assign(Error("stopped"), { code: "WALLET_NOT_RUNNING" });
    };
    f.options.ask = async () => (confirm ? "confirm" : "q");
    f.options.repair = async () => {
      repairs++;
      return false;
    };
    assert.equal(await connectMarket([], f.options), confirm ? 1 : 0);
    assert.equal(repairs, confirm ? 1 : 0);
    assert.equal(f.requests.length, 0);
    assert.equal(f.saved.length, 0);
  }
});
test("a current locked Wallet prompts once for unlock and continues without rebuilding", async () => {
  const f = fixture(),
    original = f.options.wallet;
  let locked = true,
    unlocks = 0;
  f.options.wallet = (dir, method, ...args) =>
    method === "status" ? { locked } : original(dir, method, ...args);
  f.options.unlock = async () => {
    unlocks++;
    locked = false;
    return 0;
  };
  f.options.repair = async () => assert.fail("No rebuild for a current Wallet");
  assert.equal(
    await connectMarket(["--market", "https://market.example"], f.options),
    0,
  );
  assert.equal(unlocks, 1);
  assert.equal(f.saved.length, 1);
});

test("nickname collision asks again in the same login without signing the rejected name", async () => {
  const f = fixture(),
    ask = f.options.ask,
    fetch = f.options.fetchJson;
  let attempts = 0,
    labels = 0,
    confirmations = 0;
  f.options.ask = async (message, opt) => {
    if (message.startsWith("Type 'confirm'")) confirmations++;
    return message.startsWith("Wallet nickname")
      ? ++labels === 1
        ? "Taken"
        : "Work PC"
      : ask(message, opt);
  };
  f.options.fetchJson = async (url, opts) => {
    if (url.endsWith("/challenge") && ++attempts === 1)
      return {
        response: { ok: false, status: 422 },
        result: { ok: false, error: { code: "ORDER_CONNECTION_LABEL_TAKEN" } },
      };
    return fetch(url, opts);
  };
  assert.equal(
    await connectMarket(["--market", "https://market.example"], f.options),
    0,
  );
  assert.equal(confirmations, 1);
  assert.equal(labels, 2);
  assert.equal(f.signs.length, 1);
  assert.equal(f.signs[0].label, "Work PC");
  assert.equal(f.requests.filter((r) => r.url.endsWith("/login")).length, 1);
  assert.match(f.writes.join(" "), /nickname is already used/);
  assert.equal(f.saved[0].connection.label, "Work PC");
});

test("a new Policy under an existing Wallet reuses its server nickname without prompting", async () => {
  const f = fixture(),
    fetch = f.options.fetchJson,
    ask = f.options.ask;
  const delegate = "0x" + "4".repeat(40),
    local = { ...scope, delegate };
  const wallet = f.options.wallet;
  f.options.wallet = (dir, method, ...args) =>
    method === "marketConnectionScope" ? local : wallet(dir, method, ...args);
  f.options.fetchJson = (url, opts) =>
    url.endsWith("/connections")
      ? Promise.resolve({
          response: { ok: true, status: 200 },
          result: {
            ok: true,
            result: {
              connections: [
                { ...local, policyId: "0x" + "8".repeat(64), label: "Work PC" },
              ],
            },
          },
        })
      : fetch(url, opts);
  f.options.ask = (message, opt) => {
    assert.ok(
      !message.startsWith("Wallet nickname"),
      "Existing Wallet must not ask for a nickname",
    );
    return ask(message, opt);
  };
  assert.equal(
    await connectMarket(["--market", "https://market.example"], f.options),
    0,
  );
  assert.equal(f.saved[0].connection.policyId, scope.policyId);
  assert.equal(f.signs[0].label, "Work PC");
});
