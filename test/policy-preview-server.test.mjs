// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { createPolicyPreviewServer } from "../src/policy-preview-server.mjs";
const address = (n) => `0x${String(n).repeat(40)}`;
const deployment = {
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  module: address(1),
  token: address(2),
  factory: address(3),
  registry: address(4),
  tokenDecimals: 6,
  source: "local operator verified test deployment",
};
test("local preview enforces origin/session, builds bounded draft and never claims authorization", async () => {
  let reads = 0;
  const server = createPolicyPreviewServer({
    deployment,
    delegate: address(5),
    inspect: async () => {
      reads++;
      return {
        moduleEnabled: false,
        policyExists: false,
        owners: [address(6)],
        threshold: 1,
      };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + "/context")).status, 403);
    const page = await fetch(base);
    assert.match(await page.text(), /当前仅预览/);
    const cookie = page.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await fetch(base + "/context", { headers: { cookie } })).status,
      200,
    );
    const input = {
      safe: address(6),
      budget: "10",
      perPayment: "1",
      validUntil: new Date(Date.now() + 3600000).toISOString(),
    };
    const post = (body, origin = base) =>
      fetch(base + "/preview", {
        method: "POST",
        headers: {
          cookie,
          origin,
          "content-type": "application/json",
          "x-agentpay-preview": "1",
        },
        body: JSON.stringify(body),
      });
    assert.equal((await post(input, "https://attacker.example")).status, 403);
    assert.equal((await post({ ...input, budget: "0.1" })).status, 400);
    assert.equal((await post({ ...input, to: address(7) })).status, 400);
    assert.equal(reads, 0);
    const result = await (await post(input)).json();
    assert.equal(result.draft.calls.length, 2);
    assert.equal(result.readyToSign, false);
    assert.equal(result.readyToPurchase, false);
    assert.equal(reads, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("demo accepts SSH forwarded localhost and its browser port, rejects unrelated hosts", async () => {
  const { request } = await import("node:http");
  const server = createPolicyPreviewServer({
    deployment,
    delegate: address(5),
    demoNetworkPreview: true,
    inspect: async () => ({ demo: true }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, headers, body) =>
    new Promise((resolve, reject) => {
      const req = request(
        base + path,
        { method: body ? "POST" : "GET", headers },
        (res) => {
          res.resume();
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              cookie: res.headers["set-cookie"]?.[0],
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  try {
    const host = "localhost:16580";
    const page = await send("/", { host });
    assert.equal(page.status, 200);
    const cookie = page.cookie.split(";")[0];
    const input = {
      safe: address(6),
      budget: "10",
      perPayment: "1",
      validUntil: new Date(Date.now() + 3600000).toISOString(),
    };
    const response = await send(
      "/preview",
      {
        host,
        cookie,
        origin: `http://${host}`,
        "content-type": "application/json",
        "x-agentpay-preview": "1",
      },
      JSON.stringify(input),
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await send("/", { host: "attacker.example:16580" })).status,
      403,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
