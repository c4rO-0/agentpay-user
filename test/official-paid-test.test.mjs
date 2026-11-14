// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { runOfficialPaidTest } from "../src/official-paid-test.mjs";
import { OFFICIAL_TEST_PACKAGE } from "../src/official-test-package.mjs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const b32 = "0x" + "a".repeat(64);
function fixture() {
  let record = null,
    calls = 0,
    asked = 0,
    acks = 0,
    answer = "confirm";
  const lines = [],
    archived = [],
    orders = new Map();
  const ref = {
    skillId: "0x" + "b".repeat(64),
    profileHash: "0x" + "c".repeat(64),
    profile: { network: "eip155:31337", providerId: "provider:test" },
  };
  const base = {
    dataDir: "/tmp/official-test-fixture",
    write: (value) => lines.push(value),
    ask: async () => {
      asked++;
      return answer;
    },
    lock: async (_path, fn) => fn(),
    archive: async (_dir, value) => {
      archived.push(value);
    },
    read: async (path) =>
      path.endsWith(`official-paid-test-${OFFICIAL_TEST_PACKAGE.version}.json`)
        ? record
        : {
            chainId: 31337,
            token: "0x" + "1".repeat(40),
            maxAmount: "1000000",
          },
    saveRecord: async (_path, value) => {
      record = value;
    },
    ack: async () => {
      acks++;
    },
    inspect: async () => ({
      sha256: OFFICIAL_TEST_PACKAGE.sha256,
      locallyModified: false,
      service: { reference: ref },
    }),
    connect: async () => ({ runtimeUrl: "http://127.0.0.1:6490/" }),
    tokenInfo: async () => ({ decimals: 6, symbol: "rUSDC" }),
    offer: async () => ({
      commercialReady: true,
      blockers: [],
      quote: {
        asset: "0x" + "1".repeat(40),
        network: "eip155:31337",
        providerId: "provider:test",
        skillId: ref.skillId,
        profileHash: ref.profileHash,
        baseAmountAtomic: "600000",
        unitPriceAtomic: "100000",
        maxUsageUnits: "1",
      },
      orderDeadlinePolicy: { serviceWindowSeconds: 600 },
    }),
    execute: async (_node, args) => {
      calls++;
      assert.equal(args.includes("--request-id"), true);
      assert.equal(args[args.indexOf("--request-id") + 1], record.requestId);
      if (!orders.has(record.requestId))
        orders.set(
          record.requestId,
          "0x" + (orders.size + 1).toString(16).padStart(64, "0"),
        );
      return {
        stdout: JSON.stringify({
          ok: true,
          result: {
            orderId: orders.get(record.requestId),
            outputHash: "0x" + "d".repeat(64),
            output: { kind: "random", value: 42 },
            deliveryEvidenceVerified: true,
          },
        }),
      };
    },
  };
  return {
    base,
    lines,
    archived,
    get record() {
      return record;
    },
    get calls() {
      return calls;
    },
    get asked() {
      return asked;
    },
    get acks() {
      return acks;
    },
    set answer(v) {
      answer = v;
    },
    set execute(v) {
      base.execute = v;
    },
  };
}
test("completed test is retained; a new paid check requires a new quote and consent", async () => {
  const f = fixture();
  assert.equal(await runOfficialPaidTest(f.base), 0);
  const first = f.record;
  f.answer = "q";
  assert.equal(await runOfficialPaidTest(f.base), 0);
  assert.equal(f.record.requestId, first.requestId);
  assert.equal(f.archived.length, 0);
  assert.equal(f.calls, 2);
  f.answer = "confirm";
  assert.equal(await runOfficialPaidTest(f.base), 0);
  assert.notEqual(f.record.requestId, first.requestId);
  assert.notEqual(f.record.result.orderId, first.result.orderId);
  assert.equal(f.archived.length, 1);
  assert.deepEqual(f.archived[0], first);
  assert.equal(f.asked, 3);
  assert.equal(f.acks, 2);
});
test("declining price starts no test and saves no request", async () => {
  const f = fixture();
  f.answer = "q";
  assert.equal(await runOfficialPaidTest(f.base), 0);
  assert.equal(f.calls, 0);
  assert.equal(f.record, null);
});
test("a failed first delivery retains the same request for recovery", async () => {
  const f = fixture();
  f.execute = async () => {
    throw Error("network lost after submission");
  };
  assert.equal(await runOfficialPaidTest(f.base), 1);
  assert.ok(f.record.requestId);
  assert.equal(f.asked, 1);
  const id = f.record.requestId;
  f.execute = async (_node, args) => {
    assert.equal(args[args.indexOf("--request-id") + 1], id);
    return {
      stdout: JSON.stringify({
        ok: true,
        result: {
          orderId: b32,
          outputHash: "0x" + "d".repeat(64),
          output: { kind: "random", value: 42 },
          deliveryEvidenceVerified: true,
        },
      }),
    };
  };
  assert.equal(await runOfficialPaidTest(f.base), 0);
  assert.equal(f.record.requestId, id);
  assert.equal(f.asked, 1);
  assert.equal(f.acks, 1);
});
test("changed quote asks again while keeping the original request ID", async () => {
  const f = fixture();
  let rejected = false;
  f.execute = async (_node, args) => {
    if (!rejected) {
      rejected = true;
      throw Object.assign(Error("quote changed"), {
        stdout: JSON.stringify({
          ok: false,
          error: { code: "QUOTE_TERMS_CHANGED" },
        }),
      });
    }
    assert.equal(args[args.indexOf("--request-id") + 1], f.record.requestId);
    return {
      stdout: JSON.stringify({
        ok: true,
        result: {
          orderId: b32,
          outputHash: "0x" + "d".repeat(64),
          output: { kind: "random", value: 42 },
          deliveryEvidenceVerified: true,
        },
      }),
    };
  };
  assert.equal(await runOfficialPaidTest(f.base), 1);
  const id = f.record.requestId;
  assert.equal(f.record.needsRequote, true);
  assert.equal(await runOfficialPaidTest(f.base), 0);
  assert.equal(f.record.requestId, id);
  assert.equal(f.asked, 2);
  assert.equal(f.acks, 1);
});
test("real private record store archives the completed test before a fresh one", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "official-test-store-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(join(dataDir, "runtime"), { mode: 0o700 });
  await mkdir(join(dataDir, "wallet"), { mode: 0o700 });
  await writeFile(
    join(dataDir, "wallet/policy.json"),
    JSON.stringify({
      chainId: 31337,
      token: "0x" + "1".repeat(40),
      maxAmount: "1000000",
    }),
    { mode: 0o600 },
  );
  const f = fixture(),
    base = {
      ...f.base,
      dataDir,
      read: undefined,
      saveRecord: undefined,
      archive: undefined,
      lock: undefined,
    };
  // Omit the injected file functions so the actual durable archive/lock paths run.
  delete base.read;
  delete base.saveRecord;
  delete base.archive;
  delete base.lock;
  base.execute = async (_node, args) => {
    const id = args[args.indexOf("--request-id") + 1];
    return {
      stdout: JSON.stringify({
        ok: true,
        result: {
          orderId: "0x" + id.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
          outputHash: "0x" + "d".repeat(64),
          output: { kind: "random", value: 42 },
          deliveryEvidenceVerified: true,
        },
      }),
    };
  };
  assert.equal(await runOfficialPaidTest(base), 0);
  const recordFile = join(
    dataDir,
    "runtime",
    `official-paid-test-${OFFICIAL_TEST_PACKAGE.version}.json`,
  );
  const first = JSON.parse(await readFile(recordFile, "utf8"));
  assert.equal(await runOfficialPaidTest(base), 0);
  const second = JSON.parse(await readFile(recordFile, "utf8"));
  assert.notEqual(first.requestId, second.requestId);
  const files = await readdir(join(dataDir, "runtime/official-tests"));
  assert.deepEqual(files, [first.requestId + ".json"]);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(dataDir, "runtime/official-tests", files[0]), "utf8"),
    ),
    first,
  );
});

test("payment prompts are concise and progress precedes each wait", async () => {
  const f = fixture(),
    execute = f.base.execute,
    save = f.base.saveRecord,
    ack = f.base.ack;
  let executions = 0;
  f.base.ask = async (prompt) => {
    assert.match(prompt, /confirm.*pay and test/);
    assert.match(f.lines.join("\n"), /Maximum cost: 0.7 rUSDC/);
    assert.match(f.lines.join("\n"), /Service time limit: 10 minutes/);
    return "confirm";
  };
  f.base.saveRecord = async (...args) => {
    if (!f.record) assert.equal(f.lines.at(-1), "Preparing your test…");
    return save(...args);
  };
  f.base.execute = async (...args) => {
    assert.equal(
      f.lines.at(-1),
      executions++ === 0
        ? "Waiting for the test result…"
        : "Result received. Checking the saved result…",
    );
    return execute(...args);
  };
  f.base.ack = async (...args) => {
    assert.equal(f.lines.at(-1), "Confirming receipt…");
    assert.doesNotMatch(f.lines.join("\n"), /Test complete/);
    return ack(...args);
  };
  assert.equal(await runOfficialPaidTest(f.base), 0);
  assert.match(f.lines.at(-1), /Test complete.*\nOrder ID:/);
  assert.doesNotMatch(f.lines.join("\n"), /settlement schedule|payout may/);
});
test("cancelled and failed tests do not display completion", async () => {
  const f = fixture();
  f.answer = "q";
  assert.equal(await runOfficialPaidTest(f.base), 0);
  assert.doesNotMatch(
    f.lines.join("\n"),
    /Preparing your test|Waiting for the test result|Test complete/,
  );
  const g = fixture();
  g.base.ack = async () => {
    throw Error("receipt unavailable");
  };
  assert.equal(await runOfficialPaidTest(g.base), 1);
  assert.match(g.lines.join("\n"), /Confirming receipt/);
  assert.doesNotMatch(g.lines.join("\n"), /Test complete/);
  assert.equal(g.record.acknowledged, undefined);
});

test("an unsupported official test network never signs, quotes, executes or replaces saved requests", async()=>{
 const opts={dataDir:"/not-used",read:async()=>({chainId:12345}),write:()=>{},offer:async()=>assert.fail("must not quote"),execute:async()=>assert.fail("must not execute"),saveRecord:async()=>assert.fail("must not replace a record"),inspect:async()=>assert.fail("must not inspect another network's package")};
 assert.equal(await runOfficialPaidTest(opts),0);
});
