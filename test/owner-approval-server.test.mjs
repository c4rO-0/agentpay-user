// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ownerAssets,
  createOwnerServer,
  exportOwnerPage,
  approveOwnerOperations,
  validateOwnerPlan,
} from "../src/owner-approval-server.mjs";
const at = (n) => "0x" + String(n).repeat(40);
const source = {
  chainId: 31337,
  safe: at(1),
  module: at(2),
  privateKey: "NEVER_EXPORT",
};
const call = {
  purpose: "revoke spending permission",
  to: source.module,
  value: "0",
  operation: 0,
  data: new Interface(["function revokePolicy(bytes32)"]).encodeFunctionData(
    "revokePolicy",
    ["0x" + "a".repeat(64)],
  ),
};
test("server serves fixed public assets; wrong host, cross-site, writes and traversal rejected", async (t) => {
  const assets = await ownerAssets({ source, calls: [call] }),
    { server, prefix } = createOwnerServer(assets);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  assert.equal((await fetch(origin + prefix)).status, 200);
  const plan = await (await fetch(origin + prefix + "plan.js")).text();
  assert.doesNotMatch(plan, /NEVER_EXPORT|privateKey/);
  for (const [path, options] of [
    [prefix, { method: "POST" }],
    [prefix, { headers: { "sec-fetch-site": "cross-site" } }],
    ["/plan.js", {}],
  ])
    assert.equal((await fetch(origin + path, options)).status, 403);
  const { request } = await import("node:http");
  assert.equal(
    await new Promise((resolve) => {
      const r = request(
        origin + prefix,
        { headers: { host: "evil.test" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      r.end();
    }),
    403,
  );
  assert.equal((await fetch(origin + prefix + "unknown")).status, 404);
});
test("portable export serves the approval page and denies cross-site/unlisted access without leaking credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "owner-export-"));
  let child;
  try {
    const assets = await ownerAssets({ source, calls: [call] });
    const folder = await exportOwnerPage(assets, dir);
    child = spawn(process.execPath, [join(folder, "serve.mjs")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const origin = await new Promise((resolve, reject) => {
      let output = "",
        errors = "";
      const timer = setTimeout(
        () => reject(new Error("Exported server startup timed out")),
        5000,
      );
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/Open (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Exported server exited ${code}: ${errors}`));
      });
    });
    for (const path of ["/", "/plan.js", "/ethers.js", "/owner-approval.js"]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const text = await response.text();
      assert.ok(text.length > 0);
      if (path === "/plan.js")
        assert.doesNotMatch(text, /NEVER_EXPORT|privateKey|agent.token/);
    }
    for (const [path, options] of [
      ["/serve.mjs", {}],
      ["/", { method: "POST" }],
      ["/plan.js", { headers: { "sec-fetch-site": "cross-site" } }],
    ]) {
      const response = await fetch(origin + path, options);
      assert.equal(response.status, 403);
      await response.text();
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("unapproved targets, value transfer and delegatecall cannot enter the webpage plan", () => {
  for (const patch of [
    { to: at(3) },
    { value: "1" },
    { operation: 1 },
    { data: "0x12345678" },
  ])
    assert.throws(() =>
      validateOwnerPlan({ source, calls: [{ ...call, ...patch }] }),
    );
});
test("terminal requires independent chain verification and closes server after pause", async () => {
  const dir = await mkdtemp(join(tmpdir(), "owner-terminal-"));
  try {
    let checked = 0;
    const answers = ["check", "check"],
      lines = [];
    assert.equal(
      await approveOwnerOperations({
        source,
        calls: [call],
        dataDir: dir,
        write: (s) => lines.push(s),
        ask: async () => answers.shift(),
        check: async () => ++checked === 2,
        openBrowser: () => false,
      }),
      true,
    );
    assert.equal(checked, 2);
    assert.match(lines.join("\n"), /Not complete yet/);
    assert.equal(
      await approveOwnerOperations({
        source,
        calls: [call],
        dataDir: dir,
        write: () => {},
        ask: async () => "q",
        check: async () => {
          throw Error("not checked");
        },
        openBrowser: () => false,
      }),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("journal endpoint accepts only same-origin bounded transaction metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "owner-journal-"));
  const tx = {
    kind: "execute",
    transactionHash: "0x" + "a".repeat(64),
    safeHash: "0x" + "b".repeat(64),
  };
  try {
    // Exercise the real server's narrow journal route separately.
    const assets = await ownerAssets({ source, calls: [call] });
    let saved;
    const { server, prefix } = createOwnerServer(assets, {
      saveJournal: async (v) => {
        saved = v;
      },
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const base = "http://127.0.0.1:" + server.address().port;
      assert.equal(
        (
          await fetch(base + prefix + "journal", {
            method: "POST",
            headers: { origin: base, "content-type": "application/json" },
            body: JSON.stringify(tx),
          })
        ).status,
        200,
      );
      assert.deepEqual(saved, tx);
      for (const [value, status] of [
        [{ kind: "intent", callIndex: 0 }, 200],
        [{ kind: "intent", callIndex: 1 }, 400],
        [{ kind: "intent" }, 400],
      ])
        assert.equal(
          (
            await fetch(base + prefix + "journal", {
              method: "POST",
              headers: { origin: base, "content-type": "application/json" },
              body: JSON.stringify(value),
            })
          ).status,
          status,
        );
      assert.equal(
        (
          await fetch(base + prefix + "journal", {
            method: "POST",
            headers: {
              origin: "https://evil.example",
              "content-type": "application/json",
            },
            body: "null",
          })
        ).status,
        403,
      );
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local guide restores the original pending transaction after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "owner-restart-"));
  let url;
  const tx = {
    kind: "execute",
    transactionHash: "0x" + "a".repeat(64),
    safeHash: "0x" + "b".repeat(64),
  };
  const opts = {
    source,
    calls: [call],
    dataDir: dir,
    write: () => {},
    check: async () => false,
    openBrowser: (v) => {
      url = v;
    },
  };
  try {
    await approveOwnerOperations({
      ...opts,
      ask: async () => {
        const origin = new URL(url).origin;
        assert.equal(
          (
            await fetch(url + "journal", {
              method: "POST",
              headers: { origin, "content-type": "application/json" },
              body: JSON.stringify(tx),
            })
          ).status,
          200,
        );
        return "q";
      },
    });
    await approveOwnerOperations({
      ...opts,
      ask: async () => {
        const body = await (await fetch(url + "plan.js")).text();
        assert.ok(body.includes(tx.transactionHash));
        return "q";
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
