// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { hashServiceProfile } from "@agentpay/types";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fetchJsonWithTimeout } from "../src/transport.mjs";

test("HTTP transport bounds stalled headers and stalled body", async () => {
  const server = createHttpServer((request, response) => {
    if (request.url === "/body") {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("{");
    }
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  try {
    for (const path of ["/headers", "/body"]) {
      await assert.rejects(
        fetchJsonWithTimeout(
          `http://127.0.0.1:${server.address().port}${path}`,
          { method: "POST" },
          60,
        ),
        (error) => error?.code === "TRANSPORT_TIMEOUT",
      );
    }
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});

test("Wallet accepted preparation but lost reply: timeout releases lock and retry keeps the same order request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-user-timeout-"));
  const socketPath = join(dir, "wallet.sock");
  const stateFile = join(dir, "state.json");
  const walletTokenFile = join(dir, "wallet.token");
  const callerTokenFile = join(dir, "caller.token");
  const callerToken = "2".repeat(64);
  await writeFile(walletTokenFile, `${"1".repeat(64)}\n`, { mode: 0o600 });
  await writeFile(callerTokenFile, `${callerToken}\n`, { mode: 0o600 });
  // A current offer is required before the Wallet preparation boundary.
  const settlement = createHttpServer((request, response) => {
    assert.equal(
      new URL(request.url, "http://localhost").pathname,
      "/agentpay/purchase-readiness",
    );
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        commercialReady: true,
        quote: { baseAmountAtomic: "1", unitPriceAtomic: "0" },
        orderDeadlinePolicy: { serviceWindowSeconds: 600 },
      }),
    );
  });
  await new Promise((ready) => settlement.listen(0, "127.0.0.1", ready));
  const requests = [];
  const sockets = new Set();
  const wallet = createNetServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk;
      if (!input.includes("\n")) return;
      const request = JSON.parse(input.split("\n")[0]);
      // Status checks are independent of preparation attempts and may run at startup/retry.
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
                safe: "0x" + "b".repeat(40),
                policyId: "0x" + "c".repeat(64),
              },
            },
          }) + "\n",
        );
        return;
      }
      assert.equal(request.method, "prepareSettlementOrder");
      requests.push(request);
      if (requests.length === 4) socket.end();
      else if (requests.length > 1)
        socket.end(
          `${JSON.stringify({
            ok: false,
            error: { code: "TEST_STOP", message: "same purchase recovered" },
          })}\n`,
        );
    });
  });
  await new Promise((ready) => wallet.listen(socketPath, ready));
  const portServer = createNetServer();
  await new Promise((ready) => portServer.listen(0, "127.0.0.1", ready));
  const port = portServer.address().port;
  await new Promise((done) => portServer.close(done));
  const spawnUser = () =>
    spawn(process.execPath, [resolve("src/index.mjs")], {
      cwd: resolve("."),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENTPAY_USER_HOST: "127.0.0.1",
        AGENTPAY_USER_PORT: String(port),
        AGENTPAY_USER_STATE_FILE: stateFile,
        AGENTPAY_USER_CALLER_TOKEN_FILE: callerTokenFile,
        AGENTPAY_WALLET_SOCKET: socketPath,
        AGENTPAY_WALLET_AGENT_TOKEN_FILE: walletTokenFile,
        AGENTPAY_SETTLEMENT_URL: `http://127.0.0.1:${settlement.address().port}`,
        AGENTPAY_USER_OPERATION_TIMEOUT_MS: "80",
      },
    });
  let child = spawnUser();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const waitReady = async () => {
    const readyDeadline = Date.now() + 5_000;
    while (Date.now() < readyDeadline) {
      if (child.exitCode !== null) throw new Error(stderr);
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
      } catch {}
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error(`User Runtime did not become ready: ${stderr}`);
  };
  try {
    await waitReady();
    const profile = {
      version: "agentpay.service-profile.v1",
      providerId: "provider:test",
      serviceId: "echo",
      mcpEndpoint: "http://127.0.0.1:2/services/echo/mcp/invoke",
      paymentEndpoint: "http://127.0.0.1:2/services/echo/agentpay/invoke",
      seller: "0x" + "1".repeat(40),
      network: "eip155:31337",
      asset: "0x" + "2".repeat(40),
    };
    const service = {
      version: "agentpay.service-reference.v1",
      skillId: "0x" + "3".repeat(64),
      profileHash: hashServiceProfile(profile),
      profile,
      adapter: "agentpay.json.v1",
    };
    const invoke = () =>
      fetch(`http://127.0.0.1:${port}/services/invoke`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${callerToken}`,
          "idempotency-key": "same-purchase-001",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          version: "agentpay.runtime-call.v1",
          service,
          request: { text: "hello" },
          requestedMaxUsageUnits: "1",
        }),
        signal: AbortSignal.timeout(2_000),
      });
    const first = await invoke();
    assert.equal((await first.json()).error.code, "WALLET_TIMEOUT");
    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    const entry = Object.values(persisted.invocations)[0];
    assert.equal(entry.orderRequestId, requests[0].params.orderRequestId);
    const second = await invoke();
    assert.equal((await second.json()).error.code, "TEST_STOP");
    assert.equal(requests.length, 2);
    assert.equal(
      requests[1].params.orderRequestId,
      requests[0].params.orderRequestId,
    );
    child.kill("SIGTERM");
    await new Promise((done) => child.once("exit", done));
    child = spawnUser();
    stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    await waitReady();
    const third = await invoke();
    assert.equal((await third.json()).error.code, "TEST_STOP");
    assert.equal(requests.length, 3);
    assert.equal(
      requests[2].params.orderRequestId,
      requests[0].params.orderRequestId,
    );
    const closed = await invoke();
    assert.equal((await closed.json()).error.code, "WALLET_EMPTY_RESPONSE");
    assert.equal(
      requests[3].params.orderRequestId,
      requests[0].params.orderRequestId,
    );
    assert.equal(
      Object.keys(JSON.parse(await readFile(stateFile, "utf8")).invocations)
        .length,
      1,
    );
    const incompatible = JSON.parse(await readFile(stateFile, "utf8"));
    incompatible.version = "agentpay.user-invocations.v2";
    const incompatibleBytes = JSON.stringify(incompatible);
    await writeFile(stateFile, incompatibleBytes);
    const blocked = await invoke();
    assert.equal(
      (await blocked.json()).error.code,
      "RUNTIME_RECOVERY_REQUIRED",
    );
    assert.equal(requests.length, 4, "invalid state must not reach Wallet");
    assert.equal(await readFile(stateFile, "utf8"), incompatibleBytes);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((done) => child.once("exit", done));
    }
    settlement.closeAllConnections();
    await new Promise((done) => settlement.close(done));
    for (const socket of sockets) socket.destroy();
    await new Promise((done) => wallet.close(done));
    await rm(dir, { recursive: true, force: true });
  }
});

test("Provider redirect cannot forward a private request or authorization to another endpoint", async () => {
  let targetCalls = 0;
  const target = createHttpServer((_req, res) => {
    targetCalls++;
    res.end("{}");
  });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  const redirect = createHttpServer((_req, res) => {
    res.writeHead(307, {
      location: `http://127.0.0.1:${target.address().port}/private`,
    });
    res.end();
  });
  await new Promise((r) => redirect.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(
      fetchJsonWithTimeout(
        `http://127.0.0.1:${redirect.address().port}`,
        {
          method: "POST",
          headers: { authorization: "AgentPay private-fixture" },
          body: "private-input",
        },
        1000,
      ),
      { code: "TRANSPORT_REDIRECT_REJECTED" },
    );
    assert.equal(targetCalls, 0);
  } finally {
    redirect.closeAllConnections();
    target.closeAllConnections();
    await new Promise((r) => redirect.close(r));
    await new Promise((r) => target.close(r));
  }
});
