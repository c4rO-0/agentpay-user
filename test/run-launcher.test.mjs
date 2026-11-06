// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile),
  launcher = fileURLToPath(new URL("../run", import.meta.url));
test("explicit Node works without PATH and accepts spaces in its path", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "agentpay node "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const node = join(dir, "node");
  await symlink(process.execPath, node);
  const { stdout } = await execute("/bin/sh", [launcher, "help"], {
    env: { ...process.env, PATH: "/nonexistent", AGENTPAY_NODE: node },
  });
  assert.match(stdout, /wallet help\s+Local Wallet/);
});
test("PATH fallback works; missing or invalid explicit Node explains recovery", async () => {
  const { stdout } = await execute("/bin/sh", [launcher, "help"], {
    env: { ...process.env, PATH: dirname(process.execPath), AGENTPAY_NODE: "" },
  });
  assert.match(stdout, /service help\s+Background processes/);
  for (const node of ["", "relative/node", "/nonexistent/node"])
    await assert.rejects(
      execute("/bin/sh", [launcher, "help"], {
        env: { ...process.env, PATH: "/nonexistent", AGENTPAY_NODE: node },
      }),
      (e) => {
        assert.match(e.stderr, /AGENTPAY_NODE/);
        return true;
      },
    );
});
