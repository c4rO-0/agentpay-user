// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { ensureLocalServices } from "../src/prepare-local-services.mjs";
import { saveServiceSettings } from "../src/local-services.mjs";
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "startup-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dataDir = join(base, "data"),
    userDir = join(base, "user");
  for (const d of [
    dataDir,
    userDir,
    join(dataDir, "wallet"),
    join(dataDir, "runtime"),
  ])
    await mkdir(d, { mode: 0o700 });
  const put = (path, value) =>
    writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await put(join(dataDir, "wallet/session.keystore.json"), {
    address: "original",
  });
  await put(join(dataDir, "wallet/policy.json"), {
    chainId: 31337,
    safe: "safe",
    module: "module",
    policyId: "original",
  });
  return { base, dataDir, userDir, put };
}
test("missing settings use saved Runtime plus explicit Settlement without changing identity or autostart", async (t) => {
  const f = await fixture(t),
    key = await readFile(join(f.dataDir, "wallet/session.keystore.json")),
    policy = await readFile(join(f.dataDir, "wallet/policy.json"));
  await f.put(join(f.dataDir, "runtime/connection.json"), {
    version: "agentpay.runtime-connection.v1",
    runtimeUrl: "http://127.0.0.1:6590",
    callerTokenFile: join(f.dataDir, "runtime/caller.token"),
    clientModule: fileURLToPath(
      new URL("../src/runtime-client.mjs", import.meta.url),
    ),
  });
  let prompts = 0;
  const result = await ensureLocalServices({
    ...f,
    write: () => {},
    ask: async (p) => {
      prompts++;
      assert.match(p, /Settlement/);
      return "https://example.test/settlement";
    },
  });
  assert.equal(prompts, 1);
  assert.equal(result.runtimeUrl, "http://127.0.0.1:6590");
  assert.equal(result.startupChoice, undefined);
  assert.deepEqual(
    await readFile(join(f.dataDir, "wallet/policy.json")),
    policy,
  );
  assert.deepEqual(
    await readFile(join(f.dataDir, "wallet/session.keystore.json")),
    key,
  );
});
test("existing service settings retain choice and do not ask or re-read stale setup", async (t) => {
  const f = await fixture(t);
  await saveServiceSettings({
    ...f,
    runtimeUrl: "http://127.0.0.1:6490",
    settlementUrl: "https://example.test",
    startupChoice: "disabled",
  });
  await f.put(join(f.base, "anvil-onboarding.json"), { safe: "other" });
  const result = await ensureLocalServices({
    ...f,
    ask: () => assert.fail(),
    write: () => {},
  });
  assert.equal(result.startupChoice, "disabled");
});
test("matching private setup is reused; identity mismatch never falls back", async (t) => {
  const f = await fixture(t);
  const setup = {
    chainId: 31337,
    safe: "safe",
    module: "module",
    runtimeUrl: "http://127.0.0.1:6490",
    settlementUrl: "https://example.test",
  };
  await f.put(join(f.base, "anvil-onboarding.json"), {
    ...setup,
    safe: "other",
  });
  await assert.rejects(
    ensureLocalServices({ ...f, ask: () => assert.fail(), write: () => {} }),
    /different authorization/,
  );
  await f.put(join(f.base, "anvil-onboarding.json"), setup);
  assert.equal(
    (
      await ensureLocalServices({
        ...f,
        ask: () => assert.fail(),
        write: () => {},
      })
    ).runtimeUrl,
    setup.runtimeUrl,
  );
});
test("cancel and unsafe remote URL do not save startup settings", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    ensureLocalServices({ ...f, ask: async () => "q", write: () => {} }),
    /cancelled/,
  );
  let count = 0;
  await assert.rejects(
    ensureLocalServices({
      ...f,
      ask: async () =>
        ++count === 1 ? "http://0.0.0.0:6490" : "https://example.test",
      write: () => {},
    }),
    /loopback/,
  );
  await assert.rejects(
    readFile(join(f.dataDir, "runtime/local-services.json")),
    { code: "ENOENT" },
  );
});
