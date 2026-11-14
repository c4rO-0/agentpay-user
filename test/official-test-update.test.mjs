// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { prepareOfficialTestUpdate } from "../src/official-test-update.mjs";
import { OFFICIAL_TEST_PACKAGE } from "../src/official-test-package.mjs";
const source = "http://127.0.0.1:1234/market/skills/bundles/fixture/metadata";
function fixture() {
  const lines = [];
  let installs = 0;
  return {
    lines,
    get installs() {
      return installs;
    },
    opts: {
      userDir: "/repo/user",
      dataDir: "/private",
      write: (s) => lines.push(s),
      readJson: async () => ({ chainId:31337, marketBundleMetadataUrl: source }),
      install: async () => {
        installs++;
        throw Error("must not install");
      },
    },
  };
}
test("official package retry reports missing settings without changing software or making requests", async () => {
  const f = fixture();
  f.opts.readJson = async () => null;
  f.opts.fetchImpl = async () => {
    throw Error("must not fetch");
  };
  assert.equal(
    (await prepareOfficialTestUpdate(f.opts)).status,
    "unconfigured",
  );
  assert.equal(f.installs, 0);
});
test("Market hash cannot override the pin, and redirects and response size remain bounded", async () => {
  const f = fixture();
  f.opts.fetchImpl = async (address, options) => {
    assert.equal(options.redirect, "error");
    return new Response(
      JSON.stringify({ ok: true, result: { sha256: "a".repeat(64) } }),
    );
  };
  assert.equal((await prepareOfficialTestUpdate(f.opts)).status, "unavailable");
  assert.equal(f.installs, 0);
  assert.match(f.lines.join(" "), /does not match/);
  const g = fixture();
  g.opts.fetchImpl = async () => new Response("a".repeat(65537));
  assert.equal((await prepareOfficialTestUpdate(g.opts)).status, "unavailable");
  assert.equal(g.installs, 0);
});
test("matching metadata with substituted bytes never installs a package", async () => {
  const f = fixture();
  let count = 0;
  f.opts.fetchImpl = async (address) => {
    count++;
    assert.match(String(address), new RegExp(`/versions/${OFFICIAL_TEST_PACKAGE.sha256}/(?:metadata|download)$`));
    return String(address).endsWith("/metadata")
      ? new Response(
          JSON.stringify({
            ok: true,
            result: {
              sha256: OFFICIAL_TEST_PACKAGE.sha256,
              marketServiceId: "fixture",
            },
          }),
        )
      : new Response("bad ZIP");
  };
  assert.equal((await prepareOfficialTestUpdate(f.opts)).status, "unavailable");
  assert.equal(count, 2);
  assert.equal(f.installs, 0);
});

test('unavailable pinned release never falls back to the current Market package', async () => {
  const f=fixture();let calls=0;
  f.opts.fetchImpl=async address=>{calls++;assert.match(String(address),new RegExp(`/versions/${OFFICIAL_TEST_PACKAGE.sha256}/metadata$`));return new Response('{}',{status:404});};
  assert.equal((await prepareOfficialTestUpdate(f.opts)).status,'unavailable');
  assert.equal(calls,1);assert.equal(f.installs,0);assert.match(f.lines.join(' '),/no replacement package was selected/);
});
