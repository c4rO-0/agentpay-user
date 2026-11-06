// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  serviceSettings,
  saveServiceSettings,
  readServiceSettings,
  runtimeEnvironment,
} from "../src/local-services.mjs";
import { autostartFiles } from "../src/autostart-files.mjs";
import { remindLockedWallet } from "../src/login-reminder.mjs";
test("settings remain business-neutral, private and loopback bound", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "services-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  for (const dir of ["wallet", "runtime"])
    await mkdir(join(dataDir, dir), { mode: 0o700 });
  const urls = {
    runtimeUrl: "http://127.0.0.1:6490",
    settlementUrl: "https://platform.example/settlement",
  };
  await saveServiceSettings({ dataDir, ...urls });
  const settings = await readServiceSettings(dataDir);
  assert.equal(settings.settlementUrl, urls.settlementUrl);
  const env = runtimeEnvironment(dataDir, settings);
  assert.equal(env.AGENTPAY_USER_HOST, "127.0.0.1");
  assert.equal(
    env.AGENTPAY_USER_STATE_FILE,
    join(dataDir, "runtime/invocations.json"),
  );
  assert(!JSON.stringify(env).includes("random"));
  for (const input of [
    { runtimeUrl: "http://0.0.0.0:6490" },
    { settlementUrl: "http://remote.example" },
    { settlementUrl: "https://name:secret@example.com" },
    { secret: "forbidden" },
  ])
    assert.throws(() => serviceSettings({ version: 1, ...urls, ...input }));
  await chmod(join(dataDir, "runtime/local-services.json"), 0o644);
  await assert.rejects(readServiceSettings(dataDir));
});
test("service files preserve argv and isolate reminder from service restart", () => {
  const files = autostartFiles({
    node: process.execPath,
    userDir: "/tmp/User folder",
    dataDir: "/tmp/private $value%",
  });
  assert(files["agentpay-local-wallet.service"].includes("serve") === false);
  assert(files["agentpay-local-wallet.service"].includes("$$value%%"));
  assert(files["agentpay-local-wallet.service"].includes("RestartSec=10"));
  assert(
    files["agentpay-local-runtime.service"].includes(
      "After=agentpay-local-wallet.service",
    ),
  );
  assert(!files["agentpay-local-wallet.service"].includes("notify"));
  const reminder = files["agentpay-wallet-reminder.service"];
  assert(reminder.includes("login-notify.mjs"));
  assert(reminder.includes("WantedBy=graphical-session.target"));
  assert(reminder.includes("PartOf=graphical-session.target"));
  assert(reminder.includes("RemainAfterExit=yes"));
  assert(!reminder.includes("Restart="));
  assert(!Object.keys(files).some((k) => k.endsWith(".desktop")));
  assert.throws(() =>
    autostartFiles({
      node: process.execPath,
      userDir: "/tmp/\nInjected",
      dataDir: "/tmp/private",
    }),
  );
});
test("headless/unlocked login does not notify; locked login notifies once", async () => {
  let calls = 0,
    notices = 0;
  const status = async () => {
      calls++;
      return { locked: true };
    },
    notify = async () => {
      notices++;
    };
  assert.equal(
    await remindLockedWallet({ env: {}, status, notify }),
    "headless",
  );
  assert.equal(calls, 0);
  assert.equal(
    await remindLockedWallet({ env: { DISPLAY: ":0" }, status, notify }),
    "notified",
  );
  assert.equal(notices, 1);
  assert.equal(
    await remindLockedWallet({
      env: { WAYLAND_DISPLAY: "wayland-0" },
      status: async () => ({ locked: false }),
      notify,
    }),
    "unlocked",
  );
  assert.equal(notices, 1);
});
test("notification failure is bounded and never unlocks or starts services", async () => {
  assert.equal(
    await remindLockedWallet({
      env: { DISPLAY: ":0" },
      status: async () => ({ locked: true }),
      notify: async () => {
        throw Error();
      },
    }),
    "unavailable",
  );
  let attempts = 0;
  assert.equal(
    await remindLockedWallet({
      env: { DISPLAY: ":0" },
      status: async () => {
        attempts++;
        throw Error();
      },
      notify: () => assert.fail(),
      pause: async () => {},
    }),
    "wallet_unavailable",
  );
  assert.equal(attempts, 15);
});
