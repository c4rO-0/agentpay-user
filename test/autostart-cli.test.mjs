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
  chmod,
  stat,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { saveServiceSettings } from "../src/local-services.mjs";
import { ensureRuntimeConnection } from "../src/runtime-connection-settings.mjs";
import { autostartFiles } from "../src/autostart-files.mjs";
const execute = promisify(execFile);
test("CLI enables without starting, refuses foreign files and removes only managed files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "autostart-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "data"),
    bin = join(root, "bin");
  for (const path of [
    dataDir,
    join(dataDir, "wallet"),
    join(dataDir, "runtime"),
    bin,
  ])
    await mkdir(path, { mode: 0o700 });
  await saveServiceSettings({
    dataDir,
    runtimeUrl: "http://127.0.0.1:6490",
    settlementUrl: "https://example.invalid/settlement",
  });
  await writeFile(
    join(bin, "systemctl"),
    `#!${process.execPath}\nimport('node:fs').then(fs=>fs.appendFileSync(process.env.TEST_LOG,JSON.stringify(process.argv.slice(2))+'\\n'));\n`,
    { mode: 0o700 },
  );
  await mkdir(join(root, ".config"), { mode: 0o755 });
  const desktop = join(root, ".config/autostart");
  await mkdir(desktop);
  await chmod(desktop, 0o775);
  const other = join(desktop, "other-app.desktop");
  await writeFile(other, "unrelated startup item");
  const log = join(root, "calls"),
    env = {
      ...process.env,
      HOME: root,
      AGENTPAY_USER_DATA_DIR: dataDir,
      PATH: bin + ":" + dirname(process.execPath) + ":/usr/bin:/bin",
      TEST_LOG: log,
    };
  const cli = fileURLToPath(
    new URL("../scripts/autostart.mjs", import.meta.url),
  );
  const run = (action) =>
    execute(process.execPath, [cli, action], { env, timeout: 10000 });
  await run("enable");
  const calls = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(calls, [
    ["--user", "daemon-reload"],
    [
      "--user",
      "enable",
      "agentpay-local-wallet.service",
      "agentpay-local-runtime.service",
      "agentpay-wallet-reminder.service",
    ],
  ]);
  const file = join(root, ".config/systemd/user/agentpay-local-wallet.service"),
    original = await readFile(file, "utf8");
  const connectionPath = join(dataDir, "runtime/connection.json");
  const oldConnection = JSON.parse(await readFile(connectionPath, "utf8"));
  oldConnection.clientModule = "/previous/user/src/runtime-client.mjs";
  await writeFile(connectionPath, JSON.stringify(oldConnection), {mode:0o600});
  await writeFile(file, autostartFiles({node:process.execPath,userDir:"/previous/user",dataDir})["agentpay-local-wallet.service"]);
  await assert.rejects(run("prepare"));
  await run("prepare-repair");
  assert.equal(JSON.parse(await readFile(connectionPath)).clientModule,oldConnection.clientModule);
  assert.equal(await readFile(file,"utf8"),original);
  await ensureRuntimeConnection({dataDir,refreshClientModule:true});
  await run("prepare");
  await writeFile(file, "foreign");
  await assert.rejects(run("enable"));
  assert.equal(await readFile(file, "utf8"), "foreign");
  await writeFile(file, original);
  await run("start");
  const started = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((c) => c[1] === "start");
  assert.deepEqual(started, [
    [
      "--user",
      "start",
      "agentpay-local-wallet.service",
      "agentpay-local-runtime.service",
    ],
  ]);
  await run("stop");
  await run("status");
  const statuses = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((c) => c[1] === "status");
  assert.deepEqual(statuses, [
    [
      "--user",
      "status",
      "--no-pager",
      "agentpay-local-wallet.service",
      "agentpay-local-runtime.service",
    ],
  ]);
  await run("disable");
  assert.equal(await readFile(file, "utf8"), original);
  const disabled = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((c) => c[1] === "disable");
  assert.equal(disabled.length, 1);
  assert.ok(!disabled[0].includes("--now"));
  await run("start");
  await run("remove");
  await assert.rejects(readFile(file), { code: "ENOENT" });
  assert.equal(
    JSON.parse(await readFile(join(dataDir, "runtime/local-services.json")))
      .version,
    1,
  );
  assert.equal((await stat(desktop)).mode & 0o777, 0o775);
  assert.equal(await readFile(other, "utf8"), "unrelated startup item");
  await assert.rejects(
    readFile(join(desktop, "agentpay-wallet-reminder.desktop")),
    { code: "ENOENT" },
  );
});
