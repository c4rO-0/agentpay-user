// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  authorizeCaller,
  initializeCallerCredential,
  readCallerToken,
} from "../src/caller-auth.mjs";

test("caller credential is private, reusable and authenticates only an exact bearer token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-user-caller-"));
  const path = join(dir, "runtime", "caller.token");
  try {
    const first = await initializeCallerCredential(path);
    const second = await initializeCallerCredential(path);
    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readFile(path, "utf8")).trim(), first);
    assert.equal(await readCallerToken(path), first);
    assert.equal(authorizeCaller(`Bearer ${first}`, first), true);
    assert.equal(authorizeCaller(undefined, first), false);
    assert.equal(authorizeCaller(`Bearer ${"0".repeat(64)}`, first), false);
    assert.equal(authorizeCaller(`AgentPay ${first}`, first), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
