// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { withResultCacheView } from "../src/result-cache-view.mjs";
test("saved results appear with attachments and remain outside cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "result-view-"));
  try {
    const folder = join(dir, "runtime/client-requests");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const requestId = "official-test-request",
      orderId = "0x" + "a".repeat(64),
      hash = createHash("sha256").update(requestId).digest("hex");
    await writeFile(
      join(folder, hash + ".result.json"),
      JSON.stringify({
        version: "agentpay.runtime-client-result.v1",
        requestId,
        body: { ok: true, result: { orderId, output: { value: 42 } } },
      }),
      { mode: 0o600 },
    );
    const cleanCalls = [];
    const operate = withResultCacheView(async (body) => {
      if (body.action === "summary") return { bytes: 12 };
      if (body.action === "list")
        return { total: 1, items: [{ id: "attachment", updatedAtMs: 1 }] };
      cleanCalls.push(body);
      return [];
    }, dir);
    assert.equal((await operate({ action: "summary" })).resultRecords, 1);
    const list = await operate({ action: "list", limit: 1 });
    assert.equal(list.total, 2);
    assert.equal(list.items[0].kind, "result");
    assert.equal(
      list.items[0].contentBytes,
      Buffer.byteLength(JSON.stringify({ value: 42 })),
    );
    assert.equal(
      (await operate({ action: "list", offset: 1, limit: 1 })).items[0].id,
      "attachment",
    );
    assert.equal(
      (await operate({ action: "details", id: "result:" + hash })).orderId,
      orderId,
    );
    assert.equal(
      (await operate({ action: "verified", id: "result:" + hash })).protected,
      true,
    );
    assert.equal(
      (await operate({ action: "list", purpose: "input" })).items.some(
        (r) => r.kind === "result",
      ),
      false,
    );
    await operate({ action: "preview" });
    await operate({ action: "clean", confirmed: true, items: [] });
    assert.deepEqual(
      cleanCalls.map((r) => r.action),
      ["preview", "clean"],
    );
    assert.equal((await operate({ action: "summary" })).resultRecords, 1);
    await rm(join(folder, hash + ".result.json"));
    await symlink("/etc/passwd", join(folder, hash + ".result.json"));
    await assert.rejects(operate({ action: "summary" }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("list uses the Skill name, full Order ID, and no per-row command", async () => {
  const { runCacheManagement } = await import(
    "../src/cache-management-cli.mjs"
  );
  const lines = [],
    orderId = "0x" + "b".repeat(64);
  assert.equal(
    await runCacheManagement(["list"], {
      write: (s) => lines.push(s),
      operate: async () => ({
        total: 1,
        items: [
          {
            id: "result:abc",
            kind: "result",
            skillName: "example-skill",
            orderId,
            bytes: 123,
            contentBytes: 12,
            updatedAtMs: 1,
          },
        ],
      }),
    }),
    0,
  );
  const output = lines.join("\n");
  assert.match(output, /example-skill/);
  assert.ok(output.includes(orderId));
  assert.doesNotMatch(output, /Saved result/);
  assert.equal((output.match(/agentpay cache details/g) || []).length, 1);
  assert.match(output, /page 1\nDetails: agentpay cache details <Cache ID>/);
  assert.match(output, /Text \(JSON\) · content 12 B · cached 123 B/);
});

test("attachment display identifies file extension without pretending to inspect its format", async () => {
  const { runCacheManagement } = await import(
    "../src/cache-management-cli.mjs"
  );
  const lines = [];
  await runCacheManagement(["list"], {
    write: (s) => lines.push(s),
    operate: async () => ({
      total: 1,
      items: [
        {
          id: "file",
          filename: "image.png",
          purpose: "output",
          bytes: 2048,
          updatedAtMs: 1,
          state: "available",
        },
      ],
    }),
  });
  assert.match(lines.join("\n"), /File \(.png\) · output · cached 2.0 KiB/);
});

test("direct Runtime results and client copies merge without a Skill package; all storage bytes count", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "generic-results-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = join(dir, "runtime/client-requests"),
    state = join(dir, "custom-state.json");
  await mkdir(client, { recursive: true, mode: 0o700 });
  await mkdir(state + ".results", { mode: 0o700 });
  const b = (n) => "0x" + n.repeat(64),
    reference = {
      skillId: b("1"),
      profileHash: b("2"),
      profile: { providerId: "provider:example" },
    };
  const result = {
    orderId: b("3"),
    service: { skillId: reference.skillId, profileHash: reference.profileHash },
    requestHash: b("4"),
    outputHash: b("5"),
    output: { report: ["a", "b"] },
  };
  const requestId = "original-client-request",
    key = createHash("sha256").update(requestId).digest("hex");
  const clientResult = JSON.stringify({
    version: "agentpay.runtime-client-result.v1",
    requestId,
    body: { ok: true, result },
  });
  const runtimeResult = JSON.stringify({
    version: "agentpay.invocation-result.v1",
    invocationId: b("6"),
    serviceBinding: JSON.stringify({ reference }),
    result,
  });
  await writeFile(join(client, key + ".result.json"), clientResult, {
    mode: 0o600,
  });
  await writeFile(
    join(client, key + ".json"),
    JSON.stringify({
      version: "agentpay.runtime-client-request.v1",
      requestId,
      service: reference,
    }),
    { mode: 0o600 },
  );
  await writeFile(join(state + ".results", b("6") + ".json"), runtimeResult, {
    mode: 0o600,
  });
  const view = withResultCacheView(
    async (b) => (b.action === "list" ? { total: 0, items: [] } : { bytes: 0 }),
    dir,
    { statePath: state },
  );
  const summary = await view({ action: "summary" });
  assert.equal(summary.resultRecords, 1);
  assert.equal(
    summary.resultBytes,
    Buffer.byteLength(clientResult) + Buffer.byteLength(runtimeResult),
  );
  const list = await view({ action: "list" });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].providerId, "provider:example");
  assert.equal(list.items[0].skillName, undefined);
  assert.equal((await view({ action: "list", requestId })).total, 1);
  assert.equal(
    (await view({ action: "details", id: "runtime-result:" + b("6") }))
      .providerId,
    "provider:example",
  );
  await rm(join(client, key + ".result.json"));
  await rm(join(client, key + ".json"));
  assert.equal((await view({ action: "list" })).total, 1);
  assert.equal(
    (await view({ action: "list" })).items[0].id,
    "runtime-result:" + b("6"),
  );
});
