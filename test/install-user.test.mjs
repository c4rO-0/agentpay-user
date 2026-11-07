// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstall, marketSettingsUrl } from "../src/install-user.mjs";
const config = {
  mode: "private-anvil",
  chainId: 31337,
  source: "test",
  rpcUrl: "http://127.0.0.1:8547",
  settlementUrl: "http://127.0.0.1:6572",
  marketBundleMetadataUrl: "http://127.0.0.1:6583/skills/bundles/test/metadata",
  module: "0x" + "1".repeat(40),
  token: "0x" + "2".repeat(40),
  factory: "0x" + "3".repeat(40),
  registry: "0x" + "4".repeat(40),
  tokenDecimals: 6,
  tokenSymbol: "rUSDC",
  bundleSha256: "a".repeat(64),
  maxUsageUnits: 1,
};
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "install-user-")),
    user = join(parent, "user"),
    wallet = join(parent, "wallet");
  for (const dir of [user, wallet]) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(
    join(user, "package.json"),
    JSON.stringify({ name: "@agentpay/user-runtime", dependencies: {} }),
  );
  await writeFile(join(user, "package-lock.json"), "{}");
  await writeFile(
    join(wallet, "package.json"),
    JSON.stringify({
      name: "agentpay-wallet",
      packageManager: "pnpm@10.0.0",
      dependencies: {},
    }),
  );
  await writeFile(join(wallet, "pnpm-lock.yaml"), "lock");
  await writeFile(join(wallet, "tsconfig.json"), "{}");
  await mkdir(join(wallet, "src"));
  await writeFile(join(wallet, "src", "wallet.ts"), "source");
  return { parent, user, wallet };
}
test("install resumes successful stages, rebuilds modified source and retains downloaded settings on failure", async () => {
  const f = await fixture();
  try {
    const calls = [];
    let fail = true;
    let response = config;
    const opts = {
      userDir: f.user,
      dataDir: join(f.parent, "private"),
      market: "http://localhost:6470",
      write: () => {},
      nodeVersion: "24.21.0",
      run: async (cmd, args) => {
        calls.push([cmd, args.join(" ")]);
        if (args.at(-1) === "build") {
          await mkdir(join(f.wallet, "dist/src"), { recursive: true });
          for (const name of ["wallet", "cli", "index"])
            await writeFile(join(f.wallet, `dist/src/${name}.js`), "built");
        }
        if (cmd === "npm" && args[0] === "ci" && fail)
          throw Error("simulated install interruption");
      },
      fetchImpl: async (url) => {
        assert.equal(
          url,
          "http://localhost:6470/market/web/onboarding/user-config",
        );
        return new Response(JSON.stringify(response));
      },
    };
    await assert.rejects(runInstall(opts), /interruption/);
    assert.equal(calls.filter((c) => c[1] === "pnpm@10.0.0 build").length, 1);
    fail = false;
    await runInstall(opts);
    assert.equal(
      calls.filter((c) => c[1] === "pnpm@10.0.0 build").length,
      1,
      "skip completed Wallet build",
    );
    assert.equal(
      calls.filter((c) => c[1] === "ci").length,
      2,
      "retry failed User dependencies",
    );
    const path = join(f.parent, "user-deployment.json");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), config);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await writeFile(join(f.wallet, "src/wallet.ts"), "changed");
    await runInstall(opts);
    assert.equal(
      calls.filter((c) => c[1] === "pnpm@10.0.0 build").length,
      2,
      "modified source invalidates build",
    );
    response = { ...config, privateKey: "secret" };
    await assert.rejects(runInstall(opts), /participant data/);
    assert.deepEqual(
      JSON.parse(await readFile(path, "utf8")),
      config,
      "failed validation preserves previous config",
    );
    let failureLog;
    await assert.rejects(
      runInstall({
        ...opts,
        write: (line) => {
          if (line.includes("Log: ")) failureLog = line.split("Log: ")[1];
        },
        fetchImpl: async () => {
          throw Object.assign(Error("fetch failed"), {
            cause: { code: "ECONNREFUSED" },
          });
        },
      }),
      /Market settings.*ECONNREFUSED/,
    );
    assert.match(
      await readFile(failureLog, "utf8"),
      /Market settings request failed: http:\/\/localhost:6470\/market\/web\/onboarding\/user-config \(ECONNREFUSED\)/,
    );
    await assert.rejects(
      stat(join(f.parent, ".agentpay-install/install.lock")),
      { code: "ENOENT" },
    );
    await writeFile(
      join(f.parent, ".agentpay-install/install.lock"),
      "existing",
    );
    await assert.rejects(runInstall(opts), /Another installation/);
  } finally {
    await rm(f.parent, { recursive: true, force: true });
  }
});
test("installer rejects credentials, remote HTTP and incompatible Node before installation", async () => {
  for (const url of [
    "http://remote.example",
    "https://user:pass@market.example",
    "https://market.example/path",
    "https://market.example?key=secret",
  ])
    assert.throws(() => marketSettingsUrl(url));
  assert.equal(
    marketSettingsUrl("https://market.example"),
    "https://market.example/market/web/onboarding/user-config",
  );
  await assert.rejects(
    runInstall({
      userDir: "/unused/user",
      dataDir: "/unused/private",
      market: "https://market.example",
      nodeVersion: "20.0.0",
    }),
    /Node 22/,
  );
});

test("local preparation rebuilds already-downloaded code without fetching or replacing deployment settings", async () => {
  const f = await fixture();
  try {
    const configPath = join(f.parent, "user-deployment.json");
    await writeFile(configPath, "original deployment");
    let builds = 0;
    const opts = {
      userDir: f.user,
      dataDir: join(f.parent, "private"),
      prepareOnly: true,
      forceWalletBuild: true,
      write: () => {},
      nodeVersion: "24.21.0",
      fetchImpl: async () =>
        assert.fail("Local preparation must not download settings"),
      run: async (cmd, args) => {
        if (args.at(-1) === "build") {
          builds++;
          await mkdir(join(f.wallet, "dist/src"), { recursive: true });
          for (const name of ["wallet", "cli", "index"])
            await writeFile(join(f.wallet, `dist/src/${name}.js`), "built");
        }
      },
    };
    await runInstall(opts);
    await runInstall(opts);
    assert.equal(builds, 2);
    assert.equal(await readFile(configPath, "utf8"), "original deployment");
    await assert.rejects(
      stat(join(f.parent, ".agentpay-install/install.lock")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(f.parent, { recursive: true, force: true });
  }
});

test("post-install verification names the missing dependency and records the failure in the log", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.wallet, "package.json"),
      JSON.stringify({
        name: "agentpay-wallet",
        packageManager: "pnpm@10.0.0",
        dependencies: { "missing-install-fixture": "1" },
      }),
    );
    let failure;
    try {
      await runInstall({
        userDir: f.user,
        dataDir: join(f.parent, "private"),
        prepareOnly: true,
        write: () => {},
        run: async () => {},
      });
    } catch (e) {
      failure = e;
    }
    assert.ok(failure);
    assert.match(
      failure.preparationMessage,
      /Wallet dependencies.*missing-install-fixture/,
    );
    assert.match(
      await readFile(failure.logPath, "utf8"),
      /Installation stopped: Wallet dependencies.*missing-install-fixture/,
    );
    await assert.rejects(
      stat(join(f.parent, ".agentpay-install/install.lock")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(f.parent, { recursive: true, force: true });
  }
});

test("missing toolchain stops before dependency changes and names the repair", async () => {
  const f = await fixture();
  try {
    const calls = [];
    await assert.rejects(
      runInstall({
        userDir: f.user,
        dataDir: join(f.parent, "private"),
        prepareOnly: true,
        write: () => {},
        run: async (command, args) => {
          calls.push([command, args]);
          if (command === "corepack") throw Error("ENOENT");
        },
      }),
      /npm install --global corepack/,
    );
    assert.deepEqual(
      calls.map((c) => c[1]),
      [["--version"], ["--version"]],
    );
    await assert.rejects(
      stat(join(f.parent, ".agentpay-install/install.lock")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(f.parent, { recursive: true, force: true });
  }
});

test("update handoff callbacks keep the installer lock through service restart", async () => {
  const f = await fixture();
  try {
    let phase = "before";
    const options = {
      userDir: f.user,
      dataDir: join(f.parent, "private"),
      prepareOnly: true,
      write: () => {},
      run: async (cmd, args) => {
        if (args.at(-1) === "build") {
          assert.equal(phase, "paused");
          await mkdir(join(f.wallet, "dist/src"), { recursive: true });
          for (const name of ["wallet", "cli", "index"])
            await writeFile(join(f.wallet, `dist/src/${name}.js`), "built");
        }
      },
      beforePrepare: async () => {
        await stat(join(f.parent, ".agentpay-install/install.lock"));
        phase = "paused";
      },
      afterPrepare: async () => {
        await stat(join(f.parent, ".agentpay-install/install.lock"));
        await assert.rejects(
          runInstall({
            ...options,
            beforePrepare: () => {
              throw Error("must not pause");
            },
          }),
          /Another installation/,
        );
        phase = "restarted";
      },
    };
    await runInstall(options);
    assert.equal(phase, "restarted");
    await assert.rejects(
      stat(join(f.parent, ".agentpay-install/install.lock")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(f.parent, { recursive: true, force: true });
  }
});
