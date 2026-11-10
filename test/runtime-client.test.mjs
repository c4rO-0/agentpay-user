// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  hashPrivateRequest,
  hashServiceProfile,
  hashServiceOutput,
} from "@c4roa0/agentpay-protocol";
import {
  saveRuntimeConnection,
  loadRuntimeConnection,
  checkRuntime,
  prepareInvocation,
  resumeInvocation,
  invokeService,
  runtimeBase,
  selectInvocation,
  completeInvocation,
} from "../src/runtime-client.mjs";
import { runSkill } from "../src/skill-client.mjs";
const profile = {
  version: "agentpay.service-profile.v1",
  providerId: "provider:test",
  serviceId: "echo",
  mcpEndpoint: "https://example.test/services/echo/mcp/invoke",
  paymentEndpoint: "https://example.test/services/echo/agentpay/invoke",
  seller: "0x" + "1".repeat(40),
  network: "eip155:31337",
  asset: "0x" + "2".repeat(40),
};
const service = {
  version: "agentpay.service-reference.v1",
  skillId: "0x" + "a".repeat(64),
  profileHash: hashServiceProfile(profile),
  profile,
  adapter: "agentpay.json.v1",
};
const input = (text) => ({ request: { text }, requestedMaxUsageUnits: "1" });
function result(request) {
  const output = { echo: request.text };
  return {
    ok: true,
    result: {
      version: "agentpay.runtime-result.v1",
      service: { skillId: service.skillId, profileHash: service.profileHash },
      orderId: "0x" + "3".repeat(64),
      requestHash: hashPrivateRequest(request),
      output,
      outputHash: hashServiceOutput(output),
      usageUnits: "1",
      deliveryEvidenceVerified: true,
    },
  };
}
async function fixture(t, handler, { supportsRecovery = true } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "runtime-client-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    if (req.url === "/services/check") {
      res.end(
        JSON.stringify({
          ok: true,
          result: {
            role: "user-runtime",
            service,
            capabilities: supportsRecovery
              ? ["agentpay.original-request.v1"]
              : [],
          },
        }),
      );
      return;
    }
    if (req.url === "/services/history") {
      res.end(
        JSON.stringify({
          ok: true,
          result: { orderRequestId: "0x" + "9".repeat(64), orderId: null },
        }),
      );
      return;
    }
    await handler(req, res, body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  await saveRuntimeConnection({
    dataDir,
    runtimeUrl: `http://127.0.0.1:${server.address().port}`,
  });
  const token = "d".repeat(64);
  await writeFile(join(dataDir, "runtime/caller.token"), token, {
    mode: 0o600,
  });
  return {
    dataDir,
    token,
    connection: await loadRuntimeConnection({ dataDir, env: {} }),
  };
}
test("discovery/check does not pay; malformed identity and input fail before invoke", async (t) => {
  let posts = 0;
  const f = await fixture(t, (_req, res) => {
    posts++;
    res.end("{}");
  });
  assert.equal(
    (await checkRuntime(f.connection, service)).purchaseReadinessChecked,
    false,
  );
  await assert.rejects(
    checkRuntime(f.connection, {
      ...service,
      profileHash: "0x" + "c".repeat(64),
    }),
    { code: "SKILL_SERVICE_INVALID" },
  );
  for (const url of [
    "https://127.0.0.1",
    "http://example.com",
    "http://127.0.0.1/a",
    "http://user:pass@localhost",
  ])
    assert.throws(() => runtimeBase(url));
  await assert.rejects(
    prepareInvocation(f.connection, service, input("hello"), "short"),
    { code: "INVALID_REQUEST_ID" },
  );
  await assert.rejects(
    prepareInvocation(f.connection, service, { ...input("hello"), price: "1" }),
    { code: "INVALID_INPUT" },
  );
  assert.equal(
    (await stat(join(f.dataDir, "runtime/connection.json"))).mode & 0o777,
    0o600,
  );
  assert.equal(posts, 0);
});
test("durable checkpoint binds original input/service and refuses concurrent conflicts", async (t) => {
  const f = await fixture(t, () => {
    throw Error("must not send");
  });
  const saved = await prepareInvocation(f.connection, service, input("one"));
  assert.deepEqual(
    await resumeInvocation(f.connection, service, saved.requestId),
    saved,
  );
  await assert.rejects(
    prepareInvocation(f.connection, service, input("two"), saved.requestId),
    { code: "REQUEST_CONFLICT" },
  );
  const racing = await Promise.allSettled([
    prepareInvocation(
      f.connection,
      service,
      input("a"),
      "concurrent-request-001",
    ),
    prepareInvocation(
      f.connection,
      service,
      input("b"),
      "concurrent-request-001",
    ),
  ]);
  assert.equal(racing.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    racing.find((r) => r.status === "rejected").reason.code,
    "REQUEST_CONFLICT",
  );
  await assert.rejects(
    invokeService(f.connection, service, {
      requestId: "missing-checkpoint-001",
      input: input("one"),
    }),
    { code: "REQUEST_NOT_FOUND" },
  );
});
test("lost response resumes original request; verified result is cached without another POST", async (t) => {
  const received = [];
  const f = await fixture(t, (req, res, body) => {
    assert.equal(req.headers.authorization, `Bearer ${f.token}`);
    received.push({ id: req.headers["idempotency-key"], body });
    if (received.length === 1) {
      req.socket.destroy();
      return;
    }
    res.end(JSON.stringify(result(body.request)));
  });
  const saved = await selectInvocation(f.connection, service, input("hello"));
  await assert.rejects(invokeService(f.connection, service, saved), {
    code: "RUNTIME_UNAVAILABLE",
  });
  assert.equal(
    (
      await invokeService(
        f.connection,
        service,
        await resumeInvocation(f.connection, service, saved.requestId),
      )
    ).result.output.echo,
    "hello",
  );
  await completeInvocation(f.connection, service, saved);
  assert.equal(
    (await selectInvocation(f.connection, service, input("hello"))).requestId,
    saved.requestId,
  );
  assert.equal(
    (await invokeService(f.connection, service, saved)).reusedResult,
    true,
  );
  assert.deepEqual(received[0], received[1]);
  assert.equal(received.length, 2);
  const forced = await selectInvocation(f.connection, service, input("hello"), {
    force: true,
  });
  assert.notEqual(forced.requestId, saved.requestId);
});
test("sanitized errors retain request identity and do not echo upstream secrets", async (t) => {
  let code = "LOCKED";
  const f = await fixture(t, (_req, res) => {
    res.statusCode = 502;
    res.end(JSON.stringify({ ok: false, error: { code, message: f.token } }));
  });
  const output = [];
  const options = {
    service,
    env: { AGENTPAY_USER_DATA_DIR: f.dataDir },
    write: (v) => output.push(v),
    notice: () => {},
  };
  assert.equal(
    await runSkill({ ...options, args: ["--invoke", '{"text":"hello"}'] }),
    1,
  );
  const id = output[0].requestId;
  assert.equal(output[0].error.code, "LOCKED");
  code = "FUTURE_RUNTIME_ERROR";
  assert.equal(await runSkill({ ...options, args: ["--resume", id] }), 1);
  assert.equal(output.at(-1).error.runtimeCode, code);
  assert.ok(!JSON.stringify(output).includes(f.token));
});
test("invalid output evidence never creates a verified-result cache", async (t) => {
  const f = await fixture(t, (_req, res, body) => {
    const bad = result(body.request);
    bad.result.outputHash = "0x" + "f".repeat(64);
    res.end(JSON.stringify(bad));
  });
  const saved = await prepareInvocation(f.connection, service, input("hello"));
  await assert.rejects(invokeService(f.connection, service, saved), {
    code: "RUNTIME_RESPONSE_INVALID",
  });
});

for (const [name, code, handler] of [
  [
    "invalid JSON",
    "RUNTIME_RESPONSE_INVALID",
    (_req, res) => res.end("private-output-not-json"),
  ],
  [
    "oversized response",
    "RUNTIME_RESPONSE_TOO_LARGE",
    (_req, res) => res.end("x".repeat(2 * 1048576 + 1)),
  ],
  ["headers timeout", "RUNTIME_TIMEOUT", () => {}],
  [
    "body timeout",
    "RUNTIME_TIMEOUT",
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("{");
    },
  ],
])
  test(`default transport distinguishes ${name} and preserves the request`, async (t) => {
    let calls = 0;
    const f = await fixture(t, (req, res, body) => {
      calls++;
      handler(req, res, body);
    });
    const saved = await prepareInvocation(
      f.connection,
      service,
      input("transport-boundary"),
    );
    await assert.rejects(
      invokeService(f.connection, service, saved, { timeoutMs: 500 }),
      (error) => {
        assert.equal(error.code, code);
        assert.ok(!error.message.includes(f.token));
        assert.ok(!error.message.includes("private-output-not-json"));
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      await resumeInvocation(f.connection, service, saved.requestId),
      { ...saved, submissionState: "possible" },
    );
  });

test("old URL-keyed selections retain original IDs and ambiguous histories require explicit resume", async (t) => {
  const { readdir, unlink } = await import("node:fs/promises"),
    { createHash } = await import("node:crypto");
  const f = await fixture(t, () => {
      throw Error("no request");
    }),
    saved = await selectInvocation(f.connection, service, input("legacy-port"));
  const parent = join(f.dataDir, "runtime/client-pending"),
    name = (await readdir(parent)).find((n) => n.endsWith(".json"));
  const state = JSON.parse(await readFile(join(parent, name), "utf8"));
  await unlink(join(parent, name));
  const old = {
    ...state,
    version: "agentpay.runtime-client-pending.v1",
    binding: { runtimeUrl: f.connection.runtimeUrl, ...state.binding },
  };
  const oldName =
    createHash("sha256").update(JSON.stringify(old.binding)).digest("hex") +
    ".json";
  await writeFile(join(parent, oldName), JSON.stringify(old), { mode: 0o600 });
  const relocated = { ...f.connection, runtimeUrl: "http://127.0.0.1:60001/" };
  assert.equal(
    (await selectInvocation(relocated, service, input("legacy-port")))
      .requestId,
    saved.requestId,
  );
  assert.equal(
    (await resumeInvocation(relocated, service, saved.requestId)).requestId,
    saved.requestId,
  );
  assert.ok(
    (await readdir(parent)).includes(oldName),
    "historical selection remains traceable",
  );
  const next = await selectInvocation(
    relocated,
    service,
    input("legacy-port"),
    { force: true },
  );
  await assert.rejects(
    selectInvocation(relocated, service, input("legacy-port")),
    { code: "REQUEST_AMBIGUOUS" },
  );
  assert.equal(
    (
      await selectInvocation(relocated, service, input("legacy-port"), {
        requestId: next.requestId,
      })
    ).requestId,
    next.requestId,
  );
});

test("concurrent attempts for one checkpoint execute the paid POST only once", async (t) => {
  let calls = 0;
  const f = await fixture(t, async (_req, res, body) => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    res.end(JSON.stringify(result(body.request)));
  });
  const saved = await prepareInvocation(
    f.connection,
    service,
    input("concurrent"),
  );
  const results = await Promise.all([
    invokeService(f.connection, service, saved),
    invokeService(f.connection, service, saved),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter((r) => r.reusedResult).length, 1);
});

test("damaged snapshot metadata cannot silently become a file-free paid request", async (t) => {
  const { createHash } = await import("node:crypto");
  let calls = 0;
  const f = await fixture(t, () => {
      calls++;
    }),
    saved = await prepareInvocation(f.connection, service, input("private"));
  const path = join(
    f.dataDir,
    "runtime/client-requests",
    createHash("sha256").update(saved.requestId).digest("hex") + ".json",
  );
  for (const patch of [
    { fileDeclarations: {} },
    { preparedRequest: { text: "other" } },
    { originalOrderRequestId: "wrong" },
  ]) {
    await writeFile(path, JSON.stringify({ ...saved, ...patch }), {
      mode: 0o600,
    });
    await assert.rejects(invokeService(f.connection, service, saved), {
      code: "REQUEST_STATE_INVALID",
    });
  }
  assert.equal(calls, 0);
});
test("older Runtime cannot silently ignore original-request recovery protections", async (t) => {
  let calls = 0;
  const f = await fixture(
      t,
      () => {
        calls++;
      },
      { supportsRecovery: false },
    ),
    saved = await prepareInvocation(f.connection, service, input("old-server"));
  await assert.rejects(invokeService(f.connection, service, saved), {
    code: "RUNTIME_UPDATE_REQUIRED",
  });
  assert.equal(
    (await resumeInvocation(f.connection, service, saved.requestId))
      .submissionState,
    "prepared",
  );
  assert.equal(calls, 0);
});


test("maintenance keeps the original request and retries only when requested",async t=>{
 let maintenance=true,calls=0;const requests=[];
 const f=await fixture(t,(_req,res,body)=>{
  calls++;requests.push(body);
  if(maintenance){res.statusCode=503;res.end(JSON.stringify({ok:false,error:{code:"SERVICE_MAINTENANCE"}}));}
  else res.end(JSON.stringify(result(body.request)));
 });
 const saved=await prepareInvocation(f.connection,service,input("maintenance"));
 await assert.rejects(invokeService(f.connection,service,saved),e=>e.code==="SERVICE_MAINTENANCE"&&e.message.includes("same request"));
 assert.equal(calls,1);
 const resumed=await resumeInvocation(f.connection,service,saved.requestId);
 assert.equal(resumed.requestId,saved.requestId);
 maintenance=false;await invokeService(f.connection,service,resumed);
 assert.equal(calls,2);assert.deepEqual(requests[0],requests[1]);
});
