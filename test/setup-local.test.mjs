// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Phase0Wallet } from "../../wallet/dist/src/wallet.js";
import { initializeCallerCredential } from "../src/caller-auth.mjs";

const cli = new URL("../scripts/setup-local.mjs", import.meta.url).pathname;
test("read-only setup check reports an unbound local installation without disclosing credentials", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-user-setup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const walletDir = join(dir, "wallet");
  const runtimeDir = join(dir, "runtime");
  await mkdir(walletDir, { mode: 0o700 });
  await mkdir(runtimeDir, { mode: 0o700 });
  const wallet = await Phase0Wallet.initialize(
    walletDir,
    "disposable test-only password",
  );
  const token = await initializeCallerCredential(
    join(runtimeDir, "caller.token"),
  );
  const result = spawnSync(process.execPath, [cli, "check", dir], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(
    output.wallet.delegate.toLowerCase(),
    (await wallet.address()).toLowerCase(),
  );
  assert.equal(output.wallet.policyBoundLocalFile, false);
  assert.equal(output.userRuntime.callerCredential, "ready");
  assert.equal(output.readyToPurchase, false);
  assert.equal(result.stdout.includes(token), false);
  assert.equal(result.stdout.includes("disposable test-only password"), false);
  await chmod(join(runtimeDir, "caller.token"), 0o644);
  const unsafe = spawnSync(process.execPath, [cli, "check", dir], {
    encoding: "utf8",
  });
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /caller credential permissions invalid/);
  await chmod(join(runtimeDir, "caller.token"), 0o600);
});
test("install refuses a non-interactive password source before writing state", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-user-setup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [cli, "install", join(dir, "new")],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /interactive terminal required/);
  await assert.rejects(
    readFile(join(dir, "new", "wallet", "session.keystore.json")),
    /ENOENT/,
  );
});
