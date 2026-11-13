// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("purchase route rejects unauthenticated callers before parsing or paid Wallet access", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-user-http-auth-"));
  const walletToken = "1".repeat(64);
  const callerToken = "2".repeat(64);
  const walletTokenFile = join(dir, "wallet.token");
  const callerTokenFile = join(dir, "caller.token");
  const stateFile = join(dir, "state.json");
  const socketPath = join(dir, "wallet.sock");
  await writeFile(walletTokenFile, `${walletToken}\n`, { mode: 0o600 });
  await writeFile(callerTokenFile, `${callerToken}\n`, { mode: 0o600 });
  let walletConnections = 0;
  const wallet = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      const request = JSON.parse(buffer.split("\n")[0]);
      if (request.method !== "status") walletConnections++;
      socket.end(
        JSON.stringify({ ok: true, result: { locked: true, bound: true } }) +
          "\n",
      );
    });
  });
  await new Promise((resolveReady, reject) =>
    wallet.once("error", reject).listen(socketPath, resolveReady),
  );
  const port = await reservePort();
  const child = spawn(process.execPath, [resolve("src/index.mjs")], {
    cwd: resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: dir,
      XDG_STATE_HOME: join(dir, "state"),
      AGENTPAY_USER_HOST: "127.0.0.1",
      AGENTPAY_USER_PORT: String(port),
      AGENTPAY_USER_STATE_FILE: stateFile,
      AGENTPAY_USER_CALLER_TOKEN_FILE: callerTokenFile,
      AGENTPAY_WALLET_SOCKET: socketPath,
      AGENTPAY_WALLET_AGENT_TOKEN_FILE: walletTokenFile,
      AGENTPAY_SETTLEMENT_URL: "http://127.0.0.1:1",
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    await waitReady(port, child, () => stderr);
    for (const authorization of [undefined, `Bearer ${"0".repeat(64)}`]) {
      const response = await fetch(`http://127.0.0.1:${port}/services/invoke`, {
        method: "POST",
        headers: authorization ? { authorization } : {},
        body: "{invalid-json",
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "UNAUTHORIZED");
    }
    assert.equal(walletConnections, 0);
    const authorized = await fetch(`http://127.0.0.1:${port}/services/invoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${callerToken}` },
      body: "{invalid-json",
    });
    assert.equal(authorized.status, 400);
    assert.equal(walletConnections, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
      child.kill("SIGTERM");
      await exited;
    }
    await new Promise((resolveClose) => wallet.close(resolveClose));
    await rm(dir, { recursive: true, force: true });
  }
});

async function reservePort() {
  const server = createServer();
  await new Promise((resolveReady, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolveReady),
  );
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitReady(port, child, stderr) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`User Runtime exited ${child.exitCode}: ${stderr()}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
  }
  throw new Error(`User Runtime readiness timeout: ${stderr()}`);
}
