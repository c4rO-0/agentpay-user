// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { createInvocationStore } from "../src/invocation-store.mjs";
import { selectInstalledBundle } from "../src/active-skill.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer as httpServer } from "node:http";
import { createServer as netServer } from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  randomSkillBundle,
  RANDOM_SKILL_BUNDLE_VERSION,
} from "./fixtures/skill-bundle.mjs";
import { installSkillBundle } from "../src/skill-bundle.mjs";
import { saveRuntimeConnection } from "../src/runtime-client.mjs";
import {
  hashPrivateRequest,
  hashServiceProfile,
  hashServiceOutput,
  normalizeServiceInvocation,
} from "@agentpay/types";
const load = async (path) =>
  JSON.parse(
    await readFile(
      new URL(path, import.meta.resolve("@agentpay/types")),
      "utf8",
    ),
  );
const orderFixture = (
  await load("../fixtures/agentpay-participant-order-v2/records.json")
).buyerOrder;
const authFixture = (
  await load("../fixtures/agentpay-service-authorization-v2/records.json")
).v2;
const finalization = (
  await load("../fixtures/agentpay-finalization-disclosure-v2/records.json")
).v2;
const b32 = (n) => "0x" + n.toString(16).padStart(64, "0");
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "multi-service-runtime-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const walletToken = "1".repeat(64),
    caller = "2".repeat(64);
  await writeFile(join(dir, "wallet.token"), walletToken, { mode: 0o600 });
  await writeFile(join(dir, "caller.token"), caller, { mode: 0o600 });
  const orders = new Map(),
    byRequest = new Map(),
    calls = [],
    providerCalls = [];
  let transientFailures = 0;
  const retryTimes = [];
  let tamper = false,
    mismatch = false,
    dropPrepare = false,
    closure = null,
    vaultOverride = null,
    quoteReject = false,
    offerDuration = 3600;
  const provider = httpServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    if (req.headers["payment-signature"]) {
      const payment = JSON.parse(
        Buffer.from(req.headers["payment-signature"], "base64").toString(),
      );
      const order = orders.get(payment.accepted.extra.orderId);
      assert.ok(order);
      order.fundings++;
      res.end(JSON.stringify({ ok: true, result: { success: true } }));
      return;
    }
    if (transientFailures > 0) {
      transientFailures--;
      retryTimes.push(Date.now());
      res.writeHead(503);
      res.end(JSON.stringify({ ok: false, error: { code: "TEMPORARY" } }));
      return;
    }
    const invocation =
        body.version === "agentpay.service-invocation.v1"
          ? normalizeServiceInvocation(body)
          : body,
      order = orders.get(invocation.orderId);
    assert.equal(hashPrivateRequest(body.request), body.requestHash);
    assert.equal(
      req.headers.authorization,
      "AgentPay opaque-fixture-" + order.id,
    );
    assert.equal(
      req.url,
      `/services/${order.service.profile.serviceId}/agentpay/invoke`,
    );
    providerCalls.push({ orderId: order.id, request: body.request });
    const output =
      order.service.profile.serviceId === "echo"
        ? { echo: body.request.text, details: { a: 1, b: 2 } }
        : order.service.profile.serviceId === "sum"
          ? { sum: body.request.values.reduce((a, b) => a + b, 0) }
          : { kind: "random", value: body.request.min };
    order.output = output;
    order.outputHash = hashServiceOutput(output);
    res.end(
      JSON.stringify({
        ok: true,
        result: {
          ...(body.version === "agentpay.service-invocation.v1"
            ? { version: "agentpay.service-result.v1", output }
            : output),
          orderId: order.id,
          requestHash: order.requestHash,
          outputHash: tamper ? b32(99) : order.outputHash,
          usageUnits: "1",
        },
      }),
    );
  });
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        provider.closeAllConnections();
        provider.close(r);
      }),
  );
  const settlement = httpServer((req, res) =>
    res.end(
      JSON.stringify({
        ok: true,
        result: {
          commercialReady: true,
          quote: {
            baseAmountAtomic: orderFixture.basePriceAtomic,
            unitPriceAtomic: orderFixture.unitPriceAtomic,
          },
          orderDeadlinePolicy: { serviceWindowSeconds: offerDuration },
        },
      }),
    ),
  );
  await new Promise((r) => settlement.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        settlement.closeAllConnections();
        settlement.close(r);
      }),
  );
  const providerBase = `http://127.0.0.1:${provider.address().port}`;
  const refs = ["echo", "sum", "random"].map((name, index) => {
    const profile = {
      version: "agentpay.service-profile.v1",
      providerId: "provider:" + name,
      serviceId: name,
      mcpEndpoint: `${providerBase}/services/${name}/mcp/invoke`,
      paymentEndpoint: `${providerBase}/services/${name}/agentpay/invoke`,
      seller: "0x" + "3".repeat(40),
      network: "eip155:31337",
      asset: "0x" + "4".repeat(40),
    };
    return {
      version: "agentpay.service-reference.v1",
      adapter: "agentpay.json.v1",
      skillId: b32(index + 1),
      profileHash: hashServiceProfile(profile),
      profile,
    };
  });
  const sockets = new Set();
  const wallet = netServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk;
      if (!text.includes("\n")) return;
      const request = JSON.parse(text.split("\n")[0]);
      calls.push(request);
      assert.equal(request.token, walletToken);
      if (request.method === "status") calls.pop();
      const p = request.params;
      let result;
      if (request.method === "status") {
        socket.end(
          JSON.stringify({
            id: request.id,
            ok: true,
            result: {
              locked: true,
              bound: true,
              recoveryScope: {
                network: "eip155:31337",
                module: "0x" + "a".repeat(40),
                safe: orderFixture.buyerAddress,
                policyId: b32(5),
              },
            },
          }) + "\n",
        );
        return;
      }
      if (request.method === "prepareSettlementOrder") {
        if (quoteReject) {
          quoteReject = false;
          socket.end(
            JSON.stringify({
              id: request.id,
              ok: false,
              error: {
                code: "QUOTE_TERMS_CHANGED",
                message: "Offer changed before creation",
              },
            }) + "\n",
          );
          return;
        }
        const service = refs.find(
          (ref) =>
            ref.skillId === p.skillId && ref.profileHash === p.profileHash,
        );
        if (!service) {
          socket.end(
            JSON.stringify({
              ok: false,
              error: {
                code: "UNKNOWN_SERVICE",
                message: "Unknown qualified tuple",
              },
            }) + "\n",
          );
          return;
        }
        let order = byRequest.get(p.orderRequestId);
        if (!order) {
          const id = b32(100 + orders.size);
          order = {
            id,
            service,
            requestHash: p.requestHash,
            units: p.requestedMaxUsageUnits,
            fundings: 0,
            serviceWindowSeconds: offerDuration,
          };
          orders.set(id, order);
          byRequest.set(p.orderRequestId, order);
        }
        const publicOrder = {
          ...orderFixture,
          orderId: order.id,
          skillId: service.skillId,
          profileHash: service.profileHash,
          providerId: service.profile.providerId,
          assetAddress: service.profile.asset,
          chainId: "31337",
          requestHash: order.requestHash,
          maxUsageUnits: order.units,
          prepaidAmountAtomic: String(
            BigInt(orderFixture.basePriceAtomic) +
              BigInt(orderFixture.unitPriceAtomic) * BigInt(order.units),
          ),
        };
        result = {
          order: publicOrder,
          deadlines: {
            deliveryDueAtMs:
              publicOrder.createdAtMs + order.serviceWindowSeconds * 1000,
            chainDeliveryDueAtMs:
              publicOrder.createdAtMs +
              order.serviceWindowSeconds * 1000 +
              60000,
            refundAvailableAtMs:
              publicOrder.createdAtMs +
              order.serviceWindowSeconds * 1000 +
              4000000,
            providerResponseDueAtMs: null,
            chainMarginMs: 60000,
            deadlinePolicyVersion: "agentpay.order-deadlines.v1",
            version: "agentpay.order-deadlines.v2",
          },
          closure,
          commitmentContext: {
            seller: mismatch ? "0x" + "9".repeat(40) : service.profile.seller,
          },
          paymentRequired: {
            scheme: "agentpay",
            network: service.profile.network,
            asset: service.profile.asset,
            amount: String(
              BigInt(publicOrder.basePriceAtomic) +
                BigInt(publicOrder.unitPriceAtomic) *
                  BigInt(publicOrder.maxUsageUnits),
            ),
            payTo: publicOrder.vaultAddress,
            maxTimeoutSeconds: 90,
            extra: {
              orderId: order.id,
              safe: publicOrder.buyerAddress,
              policyId: b32(5),
              factory: "0x" + "6".repeat(40),
              termsHash: b32(7),
              scopeProofHash: b32(8),
            },
          },
        };
        if (closure) delete result.paymentRequired;
        if (dropPrepare) {
          dropPrepare = false;
          return;
        }
      } else if (request.method === "signAgentPayCommitment")
        result = { signature: "0x1234" };
      else if (request.method === "requestSettlementServiceReady") {
        const order = orders.get(p.orderId);
        assert.equal(p.requestHash, order.requestHash);
        result = {
          ...authFixture,
          orderId: order.id,
          providerId: order.service.profile.providerId,
          skillId: order.service.skillId,
          profileHash: order.service.profileHash,
          requestHash: order.requestHash,
          maxUsageUnits: order.units,
          authorization: "opaque-fixture-" + order.id,
        };
      } else if (request.method === "readSettlementOrder") {
        const order = orders.get(p.orderId);
        result = {
          closure,
          order: {
            ...orderFixture,
            assetAddress: order.service.profile.asset,
            chainId: "31337",
            ...(vaultOverride
              ? { vaultState: vaultOverride, orderStatus: vaultOverride }
              : {}),
            orderId: order.id,
            skillId: order.service.skillId,
            profileHash: order.service.profileHash,
            providerId: order.service.profile.providerId,
            requestHash: order.requestHash,
          },
          deliveryEvidence: { outputHash: order.outputHash, usageUnits: "1" },
          finalization,
        };
      } else if (request.method === "confirmSettlementDelivery")
        result = { confirmed: true };
      else throw Error("Unexpected Wallet method " + request.method);
      socket.end(
        JSON.stringify({
          id: request.id,
          ok: true,
          result:
            request.method === "signAgentPayCommitment"
              ? result
              : { ok: true, result },
        }) + "\n",
      );
    });
  });
  await new Promise((r) => wallet.listen(join(dir, "wallet.sock"), r));
  t.after(
    () =>
      new Promise((r) => {
        for (const socket of sockets) socket.destroy();
        wallet.close(r);
      }),
  );
  const reservation = httpServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const children = [];
  t.after(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((r) => child.once("exit", r));
        child.kill("SIGKILL");
        await exited;
      }
  });
  const start = async (
    crash = "",
    instrument = true,
    privateOrigins = [],
    operationMs = "180",
    runtimePort = port,
  ) => {
    const env = {
      ...process.env,
      AGENTPAY_USER_FILE_CACHE_PRIVATE_ORIGINS: JSON.stringify(privateOrigins),
      AGENTPAY_USER_HOST: "127.0.0.1",
      AGENTPAY_USER_PORT: String(runtimePort),
      AGENTPAY_USER_STATE_FILE: join(dir, "state.json"),
      AGENTPAY_USER_CALLER_TOKEN_FILE: join(dir, "caller.token"),
      AGENTPAY_WALLET_AGENT_TOKEN_FILE: join(dir, "wallet.token"),
      AGENTPAY_WALLET_SOCKET: join(dir, "wallet.sock"),
      AGENTPAY_SETTLEMENT_URL: `http://127.0.0.1:${settlement.address().port}`,
      AGENTPAY_USER_OPERATION_TIMEOUT_MS: operationMs,
      AGENTPAY_USER_CRASH_AFTER: crash,
    };
    for (const key of [
      "AGENTPAY_USER_SKILL_PACKAGE_FILE",
      "AGENTPAY_RANDOM_PROVIDER_URL",
      "AGENTPAY_RANDOM_SKILL_ID",
      "AGENTPAY_RANDOM_PROFILE_HASH",
    ])
      delete env[key];
    const child = spawn(
      process.execPath,
      [
        ...(crash && instrument
          ? ["--import", resolve("test/fixtures/runtime-fault-loader.mjs")]
          : []),
        resolve("src/index.mjs"),
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(child);
    let error = "";
    child.stderr.on("data", (part) => (error += part));
    child.stdout.resume();
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw Error(error);
      try {
        if ((await fetch(`http://127.0.0.1:${runtimePort}/health`)).ok)
          return child;
      } catch {}
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("Runtime not ready " + error);
  };
  const post = async (
    path,
    body,
    id = "multi-service-request-001",
    authenticated = true,
  ) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authenticated ? { authorization: `Bearer ${caller}` } : {}),
        "idempotency-key": id,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const invoke = (service, request, id, patch = {}) =>
    post(
      "/services/invoke",
      {
        version: "agentpay.runtime-call.v1",
        service,
        request,
        requestedMaxUsageUnits: "1",
        ...patch,
      },
      id,
    );
  return {
    retryTimes,
    failTemporarily: (n) => (transientFailures = n),
    rejectQuote: () => (quoteReject = true),
    setDuration: (value) => (offerDuration = value),
    setVaultState: (value) => (vaultOverride = value),
    dir,
    runtimeUrl: `http://127.0.0.1:${port}`,
    refs,
    calls,
    orders,
    providerCalls,
    start,
    post,
    invoke,
    setTamper: (value) => (tamper = value),
    setMismatch: (value) => (mismatch = value),
    dropPrepare: () => (dropPrepare = true),
    setClosure: (value) => (closure = value),
  };
}
test("one Runtime routes two JSON services without selection/restart and isolates retry identity", async (t) => {
  const f = await fixture(t);
  await f.start();
  assert.equal(
    (await f.post("/services/check", { service: f.refs[0] })).result
      .orderCreated,
    false,
  );
  assert.equal(f.calls.length, 0);
  const [echo, sum] = await Promise.all([
    f.invoke(f.refs[0], { text: "private-example" }, "echo-request-0001"),
    f.invoke(f.refs[1], { values: [2, 3, 4] }, "sum-request-0001"),
  ]);
  assert.equal(echo.ok, true, JSON.stringify(echo));
  assert.equal(sum.ok, true, JSON.stringify(sum));
  assert.equal(echo.result.output.echo, "private-example");
  assert.equal(sum.result.output.sum, 9);
  assert.notEqual(echo.result.orderId, sum.result.orderId);
  const count = f.calls.length,
    providers = f.providerCalls.length;
  assert.equal(
    (
      await f.invoke(
        f.refs[0],
        { text: "private-example" },
        "echo-request-0001",
      )
    ).reusedResult,
    true,
  );
  assert.equal(f.calls.length, count);
  assert.equal(f.providerCalls.length, providers);
  assert.equal(
    (await f.invoke(f.refs[1], { values: [2, 3, 4] }, "echo-request-0001"))
      .error.code,
    "INVOCATION_SERVICE_BINDING_MISMATCH",
  );
  assert.equal(
    (await f.invoke(f.refs[0], { text: "changed" }, "echo-request-0001")).error
      .code,
    "INVOCATION_CONFLICT",
  );
  assert.equal(f.orders.size, 2);
  for (const order of f.orders.values()) assert.equal(order.fundings, 1);
  assert.ok(!JSON.stringify(f.calls).includes("private-example"));
  assert.equal((await readdir(f.dir)).includes("state.json.results"), true);
});
test("official test passes an explicit request ID through the Skill client and repeats without another payment", async (t) => {
  const f = await fixture(t);
  await f.start();
  const connection = await localClient(f);
  const { runSkill } = await import("../src/skill-client.mjs"),
    output = [];
  const id = "official-paid-test-request-0001";
  const args = [
    "--invoke",
    '{"min":10,"max":99}',
    "--request-id",
    id,
    "--accept-terms",
    JSON.stringify({
      baseAmountAtomic: orderFixture.basePriceAtomic,
      unitPriceAtomic: orderFixture.unitPriceAtomic,
      serviceWindowSeconds: 3600,
    }),
  ];
  const options = {
    service: f.refs[2],
    env: { AGENTPAY_USER_DATA_DIR: connection.dataDir },
    args,
    write: (value) => output.push(value),
    notice: () => {},
  };
  assert.equal(await runSkill(options), 0);
  assert.equal(output.at(-1).requestId, id);
  const orderId = output.at(-1).result.orderId,
    firstOutput = output.at(-1).result.output;
  assert.equal(await runSkill(options), 0);
  assert.equal(output.at(-1).requestId, id);
  assert.equal(output.at(-1).result.orderId, orderId);
  assert.deepEqual(output.at(-1).result.output, firstOutput);
  assert.equal(f.orders.size, 1);
  assert.equal([...f.orders.values()][0].fundings, 1);
  assert.equal(f.providerCalls.length, 1);
});
test("invalid profiles, injected prices, usage overflow and unverified output fail safely", async (t) => {
  const f = await fixture(t);
  await f.start();
  assert.equal(
    (await f.post("/services/check", { service: f.refs[0] }, undefined, false))
      .status,
    401,
  );
  assert.equal(
    (
      await f.invoke(
        { ...f.refs[0], profileHash: b32(90) },
        { text: "a" },
        "invalid-service-001",
      )
    ).error.code,
    "SERVICE_REFERENCE_INVALID",
  );
  assert.equal(
    (
      await f.invoke(f.refs[0], { text: "a" }, "invalid-fields-001", {
        amount: "1",
      })
    ).error.code,
    "INVALID_INPUT",
  );
  assert.equal(
    (
      await f.invoke(f.refs[0], { text: "a" }, "invalid-usage-001", {
        requestedMaxUsageUnits: "1000001",
      })
    ).error.code,
    "INVALID_USAGE_CAP",
  );
  assert.equal(f.calls.length, 0);
  f.setMismatch(true);
  assert.equal(
    (await f.invoke(f.refs[0], { text: "a" }, "wrong-seller-001")).error.code,
    "SETTLEMENT_SERVICE_MISMATCH",
  );
  assert.equal(
    f.calls.filter((c) => c.method === "signAgentPayCommitment").length,
    0,
  );
  f.setMismatch(false);
  f.setTamper(true);
  assert.equal(
    (await f.invoke(f.refs[0], { text: "a" }, "tampered-output-001")).error
      .code,
    "PROVIDER_RESPONSE_INVALID",
  );
  const count = f.orders.size;
  f.setTamper(false);
  assert.equal(
    (await f.invoke(f.refs[0], { text: "a" }, "tampered-output-001")).ok,
    true,
  );
  assert.equal(f.orders.size, count);
  assert.equal([...f.orders.values()].find((o) => o.fundings).fundings, 1);
});
for (const point of ["payment_submitted", "delivery_evidence_verified"])
  test(`Runtime restart at ${point} preserves original funding and result`, async (t) => {
    const f = await fixture(t),
      child = await f.start(point),
      exited = new Promise((r) => child.once("exit", r));
    await assert.rejects(
      f.invoke(f.refs[1], { values: [8, 9] }, "restart-request-001"),
    );
    assert.equal(await exited, 86);
    const order = [...f.orders.values()][0],
      fundings = order.fundings,
      calls = f.calls.length,
      providerCalls = f.providerCalls.length;
    await f.start();
    const recovered = await f.invoke(
      f.refs[1],
      { values: [8, 9] },
      "restart-request-001",
    );
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.result.output.sum, 17);
    assert.equal(f.orders.size, 1);
    assert.equal(order.fundings, fundings);
    if (point === "delivery_evidence_verified") {
      assert.equal(f.calls.length, calls);
      assert.equal(f.providerCalls.length, providerCalls);
    }
  });
test("lost Wallet preparation reply resumes the original orderRequestId after restart", async (t) => {
  const f = await fixture(t),
    child = await f.start();
  f.dropPrepare();
  assert.equal(
    (await f.invoke(f.refs[0], { text: "once" }, "wallet-lost-reply-001")).error
      .code,
    "WALLET_TIMEOUT",
  );
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await exited;
  await f.start();
  assert.equal(
    (await f.invoke(f.refs[0], { text: "once" }, "wallet-lost-reply-001")).ok,
    true,
  );
  assert.equal(f.orders.size, 1);
  const prepares = f.calls.filter((c) => c.method === "prepareSettlementOrder");
  assert.equal(prepares.length, 2);
  assert.equal(
    prepares[0].params.orderRequestId,
    prepares[1].params.orderRequestId,
  );
});

test("new random bundle executes through per-service Runtime without global package selection", async (t) => {
  const f = await fixture(t);
  await f.start();
  const service = f.refs[2];
  await saveRuntimeConnection({ dataDir: f.dir, runtimeUrl: f.runtimeUrl });
  await writeFile(join(f.dir, "runtime/caller.token"), "2".repeat(64), {
    mode: 0o600,
  });
  const bundle = await randomSkillBundle({
    skillId: service.skillId,
    profileHash: service.profileHash,
    profile: service.profile,
  });
  const installed = await installSkillBundle({
    dataDir: f.dir,
    bytes: bundle.bytes,
    source: "fixture",
  });
  assert.ok(installed.directory.includes(RANDOM_SKILL_BUNDLE_VERSION));
  const script = join(installed.directory, "random-skill/scripts/random.mjs"),
    exec = promisify(execFile),
    env = { ...process.env, AGENTPAY_USER_DATA_DIR: f.dir };
  assert.equal(
    JSON.parse(
      (await exec(process.execPath, [script, "--check"], { cwd: f.dir, env }))
        .stdout,
    ).orderCreated,
    false,
  );
  assert.equal(
    JSON.parse(
      (
        await exec(process.execPath, [script, "--invoke", "10", "20"], {
          cwd: f.dir,
          env,
        })
      ).stdout,
    ).result.output.value,
    10,
  );
  assert.equal(
    JSON.parse(
      (
        await exec(process.execPath, [script, "--invoke", "10", "20"], {
          cwd: f.dir,
          env,
        })
      ).stdout,
    ).reusedResult,
    true,
  );
  assert.equal(f.orders.size, 1);
  await assert.rejects(readFile(join(f.dir, "runtime/active-skill.json")), {
    code: "ENOENT",
  });
});

test("official connectivity suite uses the common client and confirms the original simulated Order", async (t) => {
  const f = await fixture(t);
  await f.start();
  const service = f.refs[2];
  await saveRuntimeConnection({ dataDir: f.dir, runtimeUrl: f.runtimeUrl });
  await writeFile(join(f.dir, "runtime/caller.token"), "2".repeat(64), {
    mode: 0o600,
  });
  await mkdir(join(f.dir, "wallet"), { mode: 0o700 });
  await writeFile(join(f.dir, "wallet/agent.token"), "1".repeat(64), {
    mode: 0o600,
  });
  await symlink(join(f.dir, "wallet.sock"), join(f.dir, "wallet/wallet.sock"));
  const bundle = await randomSkillBundle(service),
    installed = await installSkillBundle({
      dataDir: f.dir,
      bytes: bundle.bytes,
      source: "official fixture",
    });
  await selectInstalledBundle(f.dir, installed.directory);
  const execute = promisify(execFile),
    script = resolve("scripts/random-model-ack-smoke.mjs");
  const invoke = JSON.parse(
    (
      await execute(
        process.execPath,
        [script, "invoke", f.dir, "http://127.0.0.1:1", f.runtimeUrl],
        { timeout: 5000 },
      )
    ).stdout,
  );
  const confirmed = JSON.parse(
    (
      await execute(
        process.execPath,
        [script, "confirm", f.dir, "http://127.0.0.1:1", f.runtimeUrl],
        { timeout: 5000 },
      )
    ).stdout,
  );
  assert.equal(confirmed.orderId, invoke.orderId);
  assert.equal(confirmed.sameOrderAndResultAfterRetry, true);
  assert.equal(f.orders.size, 1);
  assert.equal([...f.orders.values()][0].fundings, 1);
  assert.equal(
    JSON.parse(
      await readFile(join(f.dir, "runtime/model-ack-smoke.json"), "utf8"),
    ).confirmed,
    true,
  );
});

test("older routing identity is retained and cannot become a replacement paid call", async (t) => {
  const f = await fixture(t),
    key = "retained-legacy-request-001";
  const old = await createInvocationStore(
    join(f.dir, "state.json"),
    "retained binding",
  ).begin({
    invocationKey: key,
    requestHash: hashPrivateRequest({ text: "hello" }),
  });
  await f.start();
  const response = await f.invoke(f.refs[0], { text: "hello" }, key);
  assert.equal(response.error.code, "INVOCATION_SERVICE_BINDING_MISMATCH");
  assert.equal(f.orders.size, 0);
  const retained = JSON.parse(await readFile(join(f.dir, "state.json"), "utf8"))
    .invocations[old.invocationId];
  assert.equal(retained.orderRequestId, old.orderRequestId);
  assert.equal(retained.serviceBinding, "retained binding");
});

test("Runtime restart with an unpaid cancellation retains Order identity and never signs or submits another payment", async (t) => {
  const f = await fixture(t);
  f.setClosure({
    version: "agentpay.order-closure.v1",
    state: "requested",
    reason: "user_cancel",
    requestedAtMs: 1792677004000,
    completedAtMs: null,
    transactionHash: null,
    errorCode: null,
  });
  const child = await f.start(),
    id = "closing-original-request-001";
  const first = await f.invoke(
    f.refs[0],
    { text: "cancelled before funding" },
    id,
  );
  assert.equal(first.error.code, "ORDER_CLOSING");
  assert.equal(f.orders.size, 1);
  assert.equal(
    f.calls.filter((c) => c.method === "signAgentPayCommitment").length,
    0,
  );
  const saved = JSON.parse(await readFile(join(f.dir, "state.json"), "utf8")),
    entry = Object.values(saved.invocations)[0];
  assert.equal(entry.orderId, [...f.orders.keys()][0]);
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await exited;
  f.setClosure({
    version: "agentpay.order-closure.v1",
    state: "cancelled",
    reason: "user_cancel",
    requestedAtMs: 1792677004000,
    completedAtMs: 1792677005000,
    transactionHash: "0x" + "c".repeat(64),
    errorCode: null,
  });
  await f.start();
  const resumed = await f.invoke(
    f.refs[0],
    { text: "cancelled before funding" },
    id,
  );
  assert.equal(resumed.error.code, "ORDER_CANCELLED");
  assert.equal(f.orders.size, 1);
  assert.equal(
    f.calls.filter((c) => c.method === "prepareSettlementOrder").length,
    1,
  );
  assert.equal(
    f.calls.filter((c) => c.method === "signAgentPayCommitment").length,
    0,
  );
  assert.equal([...f.orders.values()][0].fundings, 0);
  assert.equal(f.providerCalls.length, 0);
});

test("normal Runtime ignores historical crash environment without explicit test loader", async (t) => {
  const f = await fixture(t);
  const child = await f.start("payment_submitted", false);
  const response = await f.invoke(
    f.refs[0],
    { text: "normal runtime" },
    "no-test-loader-001",
  );
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(child.exitCode, null);
  assert.equal([...f.orders.values()][0].fundings, 1);
});

test("legacy and damaged history keep authenticated status alive; missing Wallet does not stop Runtime", async (t) => {
  const f = await fixture(t),
    path = join(f.dir, "state.json");
  await createInvocationStore(path, "legacy").begin({
    invocationKey: "legacy-startup-001",
    requestHash: hashPrivateRequest({ text: "history" }),
  });
  const original = await readFile(path);
  await f.start();
  const status = async (authenticated) => {
    const r = await fetch(f.runtimeUrl + "/status", {
      headers: authenticated
        ? { authorization: "Bearer " + "2".repeat(64) }
        : {},
    });
    return { status: r.status, ...(await r.json()) };
  };
  assert.equal((await status(false)).status, 401);
  let state;
  for (let i = 0; i < 40; i++) {
    state = await status(true);
    if (state.result.inventory === "complete") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(state.result.orders.legacy, 1);
  assert.deepEqual(await readFile(path), original);
  await writeFile(path, "broken state");
  const bad = await f.invoke(
    f.refs[0],
    { text: "do not pay" },
    "new-blocked-001",
  );
  assert.equal(bad.error.code, "RUNTIME_RECOVERY_REQUIRED");
  assert.equal(f.orders.size, 0);
  assert.equal(await readFile(path, "utf8"), "broken state");
  assert.equal((await status(true)).status, 200);
  await writeFile(path, original);
  await rm(join(f.dir, "wallet.token"));
  for (let i = 0; i < 40; i++) {
    state = await status(true);
    if (state.result.wallet === "unavailable") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(state.result.wallet, "unavailable");
  assert.equal((await fetch(f.runtimeUrl + "/health")).status, 200);
  assert.equal(f.orders.size, 0);
});

test("released Order without cached output cannot call Provider or sign another payment", async (t) => {
  const f = await fixture(t);
  await f.start();
  const key = "settled-missing-output-001";
  assert.equal((await f.invoke(f.refs[0], { text: "one" }, key)).ok, true);
  const calls = f.providerCalls.length,
    fundings = [...f.orders.values()][0].fundings;
  await rm(join(f.dir, "state.json.results"), { recursive: true });
  await rm(join(f.dir, "state.json.pending-results"), { recursive: true });
  f.setVaultState("Released");
  const response = await f.invoke(f.refs[0], { text: "one" }, key);
  assert.equal(response.error.code, "ORDER_ALREADY_SETTLED");
  assert.equal(f.providerCalls.length, calls);
  assert.equal([...f.orders.values()][0].fundings, fundings);
  assert.equal(f.orders.size, 1);
});

test("an older uncertain preparation never silently acquires new accepted terms", async (t) => {
  const f = await fixture(t);
  await f.start();
  f.dropPrepare();
  assert.equal(
    (
      await f.invoke(
        f.refs[0],
        { text: "old uncertain" },
        "old-preparation-001",
      )
    ).error.code,
    "WALLET_TIMEOUT",
  );
  const path = join(f.dir, "state.json"),
    doc = JSON.parse(await readFile(path, "utf8"));
  for (const v of Object.values(doc.invocations)) {
    delete v.quoteAcceptanceRequired;
    delete v.acceptedTerms;
  }
  await writeFile(path, JSON.stringify(doc), { mode: 0o600 });
  const before = f.calls.filter(
    (c) => c.method === "prepareSettlementOrder",
  ).length;
  assert.equal(
    (
      await f.invoke(
        f.refs[0],
        { text: "old uncertain" },
        "old-preparation-001",
      )
    ).error.code,
    "RUNTIME_RECOVERY_REQUIRED",
  );
  assert.equal(
    f.calls.filter((c) => c.method === "prepareSettlementOrder").length,
    before,
  );
  assert.equal(f.orders.size, 1);
  assert.equal(
    (await f.invoke(f.refs[1], { values: [1, 2] }, "independent-new-001")).ok,
    true,
  );
});

test("definitive pre-Order quote rejection permits reevaluation with the same request identity", async (t) => {
  const f = await fixture(t);
  await f.start();
  f.rejectQuote();
  const rejected = await f.invoke(
    f.refs[0],
    { text: "quote changed" },
    "quote-change-001",
  );
  assert.equal(rejected.error.code, "QUOTE_TERMS_CHANGED");
  assert.equal(f.orders.size, 0);
  f.setDuration(7200);
  const accepted = await f.invoke(
    f.refs[0],
    { text: "quote changed" },
    "quote-change-001",
    {
      acceptedTerms: {
        baseAmountAtomic: orderFixture.basePriceAtomic,
        unitPriceAtomic: orderFixture.unitPriceAtomic,
        serviceWindowSeconds: 7200,
      },
    },
  );
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(f.orders.size, 1);
  const prepares = f.calls.filter((c) => c.method === "prepareSettlementOrder");
  assert.equal(prepares.length, 2);
  assert.equal(
    prepares[0].params.orderRequestId,
    prepares[1].params.orderRequestId,
  );
  assert.equal([...f.orders.values()][0].fundings, 1);
});
test("archived original request cannot create or pay an Order on resume", async (t) => {
  const f = await fixture(t);
  await f.start();
  f.rejectQuote();
  const key = "archive-paused-request";
  const first = await f.invoke(f.refs[0], { text: "archive test" }, key);
  assert.equal(first.error.code, "QUOTE_TERMS_CHANGED");
  const state = join(f.dir, "state.json"),
    store = createInvocationStore(state),
    entry = Object.values(await store.inventory())[0];
  const { localOrderReviews } = await import("../src/order-review.mjs");
  await localOrderReviews(state).change(entry, null, {
    archive: true,
    note: "Unresolved request; do not resume.",
  });
  const before = await readFile(state, "utf8"),
    calls = f.calls.length;
  const retry = await f.invoke(f.refs[0], { text: "archive test" }, key);
  assert.equal(retry.error.code, "LOCAL_ORDER_ARCHIVED");
  assert.equal(f.orders.size, 0);
  assert.equal(f.calls.length, calls);
  assert.equal(await readFile(state, "utf8"), before);
});

for (const business of [0, 1])
  test(`pending result survives process exit for business ${business} without another Provider call`, async (t) => {
    const f = await fixture(t),
      child = await f.start("provider_result"),
      exited = new Promise((r) => child.once("exit", r));
    const input = business
        ? { values: [4, 6] }
        : { text: "saved before evidence" },
      key = "pending-process-" + business;
    await assert.rejects(f.invoke(f.refs[business], input, key));
    assert.equal(await exited, 86);
    const providerCalls = f.providerCalls.length,
      order = [...f.orders.values()][0],
      fundings = order.fundings;
    f.setVaultState("Released");
    await f.start();
    const result = await f.invoke(f.refs[business], input, key);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.deliveryEvidenceVerified, true);
    assert.equal(f.providerCalls.length, providerCalls);
    assert.equal(order.fundings, fundings);
    assert.equal(f.orders.size, 1);
  });

test("file-cache routes require caller authentication and verified local delivery; they never call Wallet or Provider", async (t) => {
  const f = await fixture(t);
  await f.start();
  assert.equal(
    (await f.post("/files/list", { orderId: b32(900) }, undefined, false))
      .status,
    401,
  );
  assert.equal(
    (
      await f.post("/files/cache", {
        orderId: b32(900),
        fileKey: "file",
        url: "https://files.example.com/file",
      })
    ).error.code,
    "FILE_ORDER_UNAVAILABLE",
  );
  for (const business of [0, 1]) {
    const result = await f.invoke(
      f.refs[business],
      business
        ? { values: [1, 2] }
        : { text: "file-link is application-owned" },
      "file-api-" + business + "-001",
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    const calls = f.calls.length,
      providerCalls = f.providerCalls.length;
    const { listResultFiles } = await import("../src/runtime-client.mjs");
    assert.deepEqual(
      await listResultFiles(
        {
          runtimeUrl: f.runtimeUrl,
          callerTokenFile: join(f.dir, "caller.token"),
        },
        result.result.orderId,
      ),
      [],
    );
    assert.deepEqual(
      (await f.post("/files/list", { orderId: result.result.orderId })).result,
      [],
    );
    const rejected = await f.post("/files/cache", {
      orderId: result.result.orderId,
      fileKey: "file",
      url: "http://127.0.0.1/private",
    });
    assert.equal(rejected.error.code, "FILE_DESTINATION_BLOCKED");
    assert.equal(f.calls.length, calls);
    assert.equal(f.providerCalls.length, providerCalls);
  }
});

test("installed file client downloads, reuses after Runtime restart and removes with lost result metadata", async (t) => {
  const fileServer = httpServer((_req, res) =>
    res.end(Buffer.from([0, 255, 4, 8])),
  );
  await new Promise((r) => fileServer.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => fileServer.close(r)));
  const origin = `http://127.0.0.1:${fileServer.address().port}`,
    f = await fixture(t);
  const process1 = await f.start("", true, [origin]);
  const { cacheResultFile, listResultFiles, removeResultFile } = await import(
    "../src/runtime-client.mjs"
  );
  const connection = {
    runtimeUrl: f.runtimeUrl,
    callerTokenFile: join(f.dir, "caller.token"),
  };
  const results = [];
  for (const b of [0, 1])
    results.push(
      await f.invoke(
        f.refs[b],
        b ? { values: [2, 3] } : { text: "files" },
        "real-file-api-" + b,
      ),
    );
  for (const result of results) {
    assert.equal(result.ok, true, JSON.stringify(result));
    await cacheResultFile(connection, {
      orderId: result.result.orderId,
      fileKey: "binary",
      url: origin + "/file",
    });
  }
  const counts = [
    f.orders.size,
    f.providerCalls.length,
    [...f.orders.values()].reduce((n, o) => n + o.fundings, 0),
  ];
  const exited = new Promise((r) => process1.once("exit", r));
  process1.kill("SIGKILL");
  await exited;
  await f.start("", true, [origin]);
  const row = await cacheResultFile(connection, {
    orderId: results[0].result.orderId,
    fileKey: "binary",
    url: origin + "/file",
  });
  assert.deepEqual(await readFile(row.localPath), Buffer.from([0, 255, 4, 8]));
  await rm(join(f.dir, "state.json.results"), { recursive: true });
  assert.equal(
    (await listResultFiles(connection, results[0].result.orderId))[0].state,
    "available",
  );
  await removeResultFile(connection, {
    orderId: results[0].result.orderId,
    fileKey: "binary",
    confirmed: true,
  });
  assert.equal(
    (await listResultFiles(connection, results[0].result.orderId))[0].state,
    "removed",
  );
  assert.deepEqual(
    [
      f.orders.size,
      f.providerCalls.length,
      [...f.orders.values()].reduce((n, o) => n + o.fundings, 0),
    ],
    counts,
  );
});

test("temporary Provider errors back off without preparing another purchase", async (t) => {
  const f = await fixture(t);
  f.failTemporarily(3);
  await f.start("", true, [], "2500");
  const result = await f.invoke(
    f.refs[0],
    { text: "retry safely" },
    "backoff-request-0001",
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.orders.size, 1);
  assert.equal(f.retryTimes.length, 3);
  assert.ok(f.retryTimes[1] - f.retryTimes[0] >= 180);
  assert.ok(f.retryTimes[2] - f.retryTimes[1] >= 350);
  assert.equal(
    f.calls.filter((c) => c.method === "prepareSettlementOrder").length,
    1,
  );
});

test("cache management requires local authentication and never signs or creates Orders", async (t) => {
  const f = await fixture(t);
  await f.start();
  assert.equal(
    (await f.post("/cache/manage", { action: "summary" }, undefined, false))
      .status,
    401,
  );
  assert.equal(
    (
      await f.post(
        "/files/input",
        {
          requestId: "private-input-001",
          files: [
            { fileKey: "secret", sourcePath: join(f.dir, "caller.token") },
          ],
        },
        undefined,
        false,
      )
    ).status,
    401,
  );
  assert.equal(
    (await f.post("/files/input-release", {}, undefined, false)).status,
    401,
  );
  assert.equal(
    (await f.post("/cache/manage", { action: "summary" })).result.bytes,
    0,
  );
  assert.equal(
    (
      await f.post("/cache/manage", {
        action: "settings",
        overrides: { totalBytes: 1073741824 },
      })
    ).result.totalBytes,
    1073741824,
  );
  assert.equal(
    (await f.post("/cache/manage", { action: "summary" })).result.limits
      .totalBytes,
    1073741824,
  );
  assert.equal(
    (await f.post("/cache/manage", { action: "list" })).result.total,
    0,
  );
  assert.equal(
    (
      await f.post("/cache/manage", {
        action: "import",
        sourcePath: "/etc/passwd",
      })
    ).error.code,
    "FILE_INPUT_INVALID",
  );
  assert.equal(
    (
      await f.post("/cache/manage", {
        action: "clean",
        items: [],
        confirmed: false,
      })
    ).error.code,
    "FILE_CONFIRM_REQUIRED",
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.orders.size, 0);
  assert.equal(f.providerCalls.length, 0);
});

async function localClient(f) {
  const { loadRuntimeConnection } = await import("../src/runtime-client.mjs");
  const dataDir = join(f.dir, "client");
  await saveRuntimeConnection({ dataDir, runtimeUrl: f.runtimeUrl });
  await writeFile(join(dataDir, "runtime/caller.token"), "2".repeat(64), {
    mode: 0o600,
  });
  return loadRuntimeConnection({ dataDir, env: {} });
}
for (const missing of [false, true])
  test(`client port relocation with ${missing ? "missing" : "retained"} history cannot replace a purchase`, async (t) => {
    const f = await fixture(t),
      child = await f.start(),
      connection = await localClient(f);
    const { selectInvocation, invokeService } = await import(
      "../src/runtime-client.mjs"
    );
    const input = {
        request: { text: "relocate" },
        requestedMaxUsageUnits: "1",
      },
      saved = await selectInvocation(connection, f.refs[0], input);
    f.dropPrepare();
    await assert.rejects(invokeService(connection, f.refs[0], saved));
    const prepares = f.calls.filter(
      (c) => c.method === "prepareSettlementOrder",
    ).length;
    const stopped = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await stopped;
    if (missing) await rm(join(f.dir, "state.json"));
    const reservation = httpServer();
    await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
    const port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    await f.start("", true, [], "1000", port);
    const relocated = {
      ...connection,
      runtimeUrl: `http://127.0.0.1:${port}/`,
    };
    assert.equal(
      (await selectInvocation(relocated, f.refs[0], input)).requestId,
      saved.requestId,
    );
    if (missing) {
      await assert.rejects(invokeService(relocated, f.refs[0], saved), {
        code: "ORIGINAL_REQUEST_NOT_FOUND",
      });
      assert.equal(
        f.calls.filter((c) => c.method === "prepareSettlementOrder").length,
        prepares,
      );
    } else {
      assert.equal(
        (await invokeService(relocated, f.refs[0], saved)).result.output.echo,
        "relocate",
      );
      assert.equal(f.orders.size, 1);
      assert.equal([...f.orders.values()][0].fundings, 1);
    }
  });

for (const business of [0, 1])
  test(`shared Skill input snapshot feeds business ${business} and survives source replacement`, async (t) => {
    const f = await fixture(t);
    await f.start();
    const connection = await localClient(f),
      sourcePath = join(f.dir, "input.bin");
    await writeFile(sourcePath, business === 0 ? "original" : "[2,3,4]");
    const { runSkill } = await import("../src/skill-client.mjs");
    let fail = true;
    const outputs = [];
    const options = {
      service: f.refs[business],
      env: { AGENTPAY_USER_DATA_DIR: connection.dataDir },
      args: ["--invoke", JSON.stringify({ sourcePath })],
      write: (r) => outputs.push(r),
      notice: () => {},
      inputFiles: (r) => [{ fileKey: "source", sourcePath: r.sourcePath }],
      prepareRequest: async ({ files }) => {
        if (fail) throw Error("adapter interrupted");
        const content = await readFile(files[0].localPath, "utf8");
        return business === 0
          ? { text: content }
          : { values: JSON.parse(content) };
      },
    };
    assert.equal(await runSkill(options), 1);
    assert.equal(f.calls.length, 0);
    const id = outputs[0].requestId;
    await writeFile(sourcePath, "changed");
    fail = false;
    assert.equal(await runSkill(options), 0);
    assert.equal(outputs.at(-1).requestId, id);
    assert.deepEqual(
      outputs.at(-1).result.output,
      business === 0
        ? { echo: "original", details: { a: 1, b: 2 } }
        : { sum: 9 },
    );
    const clean = (await f.post("/cache/manage", { action: "preview" })).result;
    assert.equal(clean.length, 1, "verified delivery releases its input copy");
    await f.post("/cache/manage", {
      action: "clean",
      items: clean,
      confirmed: true,
    });
    const { createHash } = await import("node:crypto");
    await rm(
      join(
        connection.dataDir,
        "runtime/client-requests",
        createHash("sha256").update(id).digest("hex") + ".result.json",
      ),
    );
    await rm(sourcePath);
    assert.equal(await runSkill(options), 0);
    assert.equal(f.orders.size, 1);
    assert.equal([...f.orders.values()][0].fundings, 1);
    assert.equal(f.providerCalls.length, 1);
  });

test("failed output download retries using saved delivery without another paid invocation", async (t) => {
  const f = await fixture(t);
  let available = false;
  const files = httpServer((_req, res) => {
    if (!available) {
      res.writeHead(503);
      res.end();
    } else res.end("report");
  });
  await new Promise((r) => files.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        files.closeAllConnections();
        files.close(r);
      }),
  );
  const origin = `http://127.0.0.1:${files.address().port}`;
  await f.start("", true, [origin]);
  const connection = await localClient(f);
  const { runSkill } = await import("../src/skill-client.mjs"),
    outputs = [];
  const options = {
    service: f.refs[0],
    env: { AGENTPAY_USER_DATA_DIR: connection.dataDir },
    args: ["--invoke", '{"text":"report"}'],
    write: (r) => outputs.push(r),
    notice: () => {},
    outputFiles: () => [{ fileKey: "report", url: origin + "/report" }],
  };
  assert.equal(await runSkill(options), 1);
  assert.equal(outputs.at(-1).ok, true);
  assert.equal(outputs.at(-1).fileCache.state, "incomplete");
  const count = f.calls.length;
  available = true;
  assert.equal(await runSkill(options), 0);
  assert.equal(outputs.at(-1).files[0].state, "available");
  assert.equal(f.calls.length, count);
  assert.equal(f.orders.size, 1);
  assert.equal(f.providerCalls.length, 1);
});
