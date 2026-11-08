import { requireRunningSoftware } from "../src/software-versions.mjs";
import { walletCliPath } from "../src/wallet-package.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Phase0Wallet } from "@c4roa0/agentpay-wallet/local";
import { initializeCapabilities } from "@c4roa0/agentpay-wallet/local";
import { initializeCallerCredential } from "../src/caller-auth.mjs";
import { saveServiceSettings } from "../src/local-services.mjs";
const exec = promisify(execFile),
  cli = walletCliPath(),
  runner = fileURLToPath(
    new URL("../scripts/local-service.mjs", import.meta.url),
  );
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
test("real isolated Wallet/Runtime restart stays locked and rejects a duplicate Wallet", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "local-service-process-")),
    children = [];
  const completions = new Map();
  t.after(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
    await Promise.all([...completions.values()]);
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(dir, "wallet"), { mode: 0o700 });
  await mkdir(join(dir, "runtime"), { mode: 0o700 });
  await Phase0Wallet.initialize(
    join(dir, "wallet"),
    "disposable fixture password",
  );
  await initializeCapabilities(join(dir, "wallet"));
  await initializeCallerCredential(join(dir, "runtime/caller.token"));
  const key = await readFile(join(dir, "wallet/session.keystore.json"));
  const port = await new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  await saveServiceSettings({
    dataDir: dir,
    runtimeUrl: `http://127.0.0.1:${port}`,
    settlementUrl: "https://unused.invalid/settlement",
  });
  function start(role) {
    const c = spawn(process.execPath, [runner, role, dir], { stdio: "ignore" });
    children.push(c);
    completions.set(c, new Promise((resolve) => c.once("exit", resolve)));
    return c;
  }
  async function wait(check) {
    let error;
    for (let i = 0; i < 60; i++) {
      try {
        return await check();
      } catch (e) {
        error = e;
        await pause(100);
      }
    }
    throw error;
  }
  const status = async () =>
    JSON.parse(
      (
        await exec(process.execPath, [cli, "status", join(dir, "wallet")], {
          timeout: 3000,
        })
      ).stdout,
    );
  const first = start("wallet");
  assert.equal((await wait(status)).locked, true);
  const runtime = start("runtime");
  await wait(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(r.status, 200);
    const {result: body} = await r.json();
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(body.software.name, '@c4roa0/agentpay-user');
    assert.equal(body.software.version, manifest.version);
    assert.equal(body.software.protocolVersion, manifest.dependencies['@c4roa0/agentpay-protocol']);
    requireRunningSoftware(await status(), body);
  });
  const duplicate = start("wallet");
  assert.equal(await completions.get(duplicate), 1);
  assert.equal((await status()).locked, true);
  first.kill("SIGTERM");
  await completions.get(first);
  start("wallet");
  assert.equal((await wait(status)).locked, true);
  assert.deepEqual(
    await readFile(join(dir, "wallet/session.keystore.json")),
    key,
  );
  assert.equal(runtime.exitCode, null);
  await assert.rejects(readFile(join(dir, "runtime/invocations.json")), {
    code: "ENOENT",
  });
});
