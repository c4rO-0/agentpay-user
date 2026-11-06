// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  access,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLocalInstallation } from "../src/install-preflight.mjs";
test("preflight reports missing software, rejects unsafe private paths and never creates data", async () => {
  const root = await mkdtemp(join(tmpdir(), "install-preflight-"));
  try {
    const userDir = join(root, "user"),
      walletDir = join(root, "wallet"),
      dataDir = join(root, "private");
    await mkdir(userDir);
    await writeFile(
      join(userDir, "package.json"),
      JSON.stringify({
        name: "@agentpay/user-runtime",
        dependencies: { "not-installed-agentpay-test": "1" },
      }),
    );
    await writeFile(join(userDir, "package-lock.json"), "{}");
    const check = (extra = {}) =>
      checkLocalInstallation({
        userDir,
        dataDir,
        nodeVersion: "22.22.3",
        ...extra,
      });
    let result = await check();
    assert.equal(result.ok, false);
    assert.ok(
      result.checks.some(
        (c) => c.code === "WALLET_REPOSITORY" && c.status === "failed",
      ),
    );
    assert.ok(
      result.checks.some(
        (c) => c.code.startsWith("USER_DEPENDENCY") && c.status === "failed",
      ),
    );
    await assert.rejects(access(dataDir));
    await mkdir(walletDir);
    await writeFile(
      join(walletDir, "package.json"),
      JSON.stringify({
        name: "agentpay-wallet",
        packageManager: "pnpm@10.0.0",
      }),
    );
    await writeFile(join(walletDir, "pnpm-lock.yaml"), "");
    await mkdir(join(walletDir, "dist/src"), { recursive: true });
    for (const name of ["cli.js", "wallet.js", "index.js"])
      await writeFile(
        join(walletDir, "dist/src", name),
        'throw new Error("must not execute")',
      );
    await writeFile(
      join(userDir, "package.json"),
      JSON.stringify({ name: "@agentpay/user-runtime" }),
    );
    await mkdir(join(userDir, "node_modules/esm-only"), { recursive: true });
    await writeFile(
      join(userDir, "node_modules/esm-only/package.json"),
      JSON.stringify({
        name: "esm-only",
        exports: { ".": { import: "./index.mjs" } },
      }),
    );
    await writeFile(
      join(userDir, "node_modules/esm-only/index.mjs"),
      'throw new Error("must not execute")',
    );
    await writeFile(
      join(userDir, "package.json"),
      JSON.stringify({
        name: "@agentpay/user-runtime",
        dependencies: { "esm-only": "1" },
      }),
    );
    result = await check();
    assert.equal(result.ok, true);
    assert.equal(result.readyToPurchase, false);
    await assert.rejects(access(dataDir));
    assert.equal((await check({ nodeVersion: "22.22.2" })).ok, false);
    for (const version of [
      "22.22.3",
      "22.23.0",
      "23.0.0",
      "24.0.0",
      "24.21.0",
      "25.0.0",
      "26.0.0",
    ])
      assert.equal((await check({ nodeVersion: version })).ok, true, version);
    for (const version of [
      "20.0.0",
      "22.22.0",
      "22.22.2",
      "24.0.0-rc.1",
      "24",
      "invalid",
    ])
      assert.equal((await check({ nodeVersion: version })).ok, false, version);
    assert.equal((await check({ dataDir: join(userDir, "keys") })).ok, false);
    await mkdir(dataDir, { mode: 0o700 });
    await chmod(dataDir, 0o755);
    assert.equal((await check()).ok, false);
    await chmod(dataDir, 0o700);
    assert.equal((await check()).ok, true);
    await symlink(userDir, join(root, "alias"));
    assert.equal(
      (await check({ dataDir: join(root, "alias", "new", "keys") })).ok,
      false,
    );
    await symlink(dataDir, join(root, "private-link"));
    assert.equal(
      (await check({ dataDir: join(root, "private-link") })).ok,
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
