// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInvocationStore } from "../src/invocation-store.mjs";
import { runOrderSupport } from "../src/order-support.mjs";
import {
  localReviewDetails,
  localOrderSummary,
  localOrderReviews,
  assertNotArchived,
  reviewApplies,
  recordFingerprint,
  findLocalOrder,
} from "../src/order-review.mjs";
const id = (n) => "0x" + n.toString(16).padStart(64, "0");
test("offline details, missing-ID list, confirmed archive and undo preserve history and redact secrets", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "order-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "runtime"), { mode: 0o700 });
  const path = join(dir, "runtime/invocations.json"),
    store = createInvocationStore(path);
  const e = await store.begin({
    invocationKey: "local-review-request",
    requestHash: id(1),
  });
  const entry = await store.update(e.invocationId, e.requestHash, {
    paymentPayload: { signature: "DO_NOT_PRINT", privateInput: "DO_NOT_PRINT" },
  });
  const original = await readFile(path, "utf8");
  let output = [];
  const run = (args, answers = []) =>
    runOrderSupport(args, {
      dataDir: dir,
      write: (v) => output.push(v),
      ask: async () => answers.shift(),
    });
  assert.equal(await run([]), 0);
  assert.match(output.join("\n"), /Local Orders/);
  assert.match(output.join("\n"), new RegExp(entry.invocationId.slice(0, 12)));
  output = [];
  assert.equal(await run([entry.invocationId.slice(0, 12)]), 0);
  assert.match(output.join("\n"), /Order ID: Not saved/);
  assert.doesNotMatch(output.join("\n"), /DO_NOT_PRINT/);
  await run(
    [entry.invocationId, "archive"],
    ["No original scope; unresolved.", "cancel"],
  );
  assert.equal(
    (await localOrderReviews(path).load()).records[entry.invocationId],
    undefined,
  );
  assert.equal(
    await run(
      [entry.invocationId, "archive"],
      ["No original scope; unresolved.", "confirm"],
    ),
    0,
  );
  assert.equal(await readFile(path, "utf8"), original);
  await assert.rejects(assertNotArchived(path, entry), {
    code: "LOCAL_ORDER_ARCHIVED",
  });
  const r = (await localOrderReviews(path).load()).records[entry.invocationId];
  assert.equal(reviewApplies(r, entry, null), true);
  assert.equal(reviewApplies(r, entry, { errorCode: "NEW_ISSUE" }), false);
  assert.equal(await run([entry.invocationId, "unarchive"]), 0);
  await assertNotArchived(path, entry);
  assert.equal(
    (await localOrderReviews(path).load()).records[entry.invocationId].events
      .length,
    2,
  );
  assert.equal(await readFile(path, "utf8"), original);
  // Ambiguous abbreviated IDs cannot select a different record silently.
  assert.throws(
    () =>
      findLocalOrder(
        { a: { invocationId: id(2) }, b: { invocationId: id(3) } },
        "0x0000000000",
      ),
    /multiple/,
  );
});
test("unsafe annotation symlinks are rejected rather than overwritten", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "order-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "invocations.json"),
    other = join(dir, "other");
  await writeFile(other, "private");
  await symlink(other, path + ".reviews.json");
  await assert.rejects(localOrderReviews(path).load(), {
    code: "LOCAL_REVIEW_INVALID",
  });
  assert.equal(await readFile(other, "utf8"), "private");
});

test("list summaries distinguish unknown, paid, archived and changed observations", () => {
  const e = { invocationId: id(8) },
    o = {
      fingerprint: recordFingerprint(e),
      errorCode: "ORIGINAL_POLICY_UNKNOWN",
      financialState: "unknown",
    };
  const unknown = localOrderSummary(e, o, null);
  assert.equal(unknown.state, "Not confirmed");
  assert.equal(unknown.marker, "WAIT");
  assert.match(unknown.warning, /payment remains unconfirmed/);
  const paid = {
    fingerprint: recordFingerprint(e),
    vaultState: "Released",
    financialState: "terminal",
    resultState: "missing",
  };
  assert.equal(localOrderSummary(e, paid, null).state, "Paid out");
  assert.match(localOrderSummary(e, paid, null).warning, /do not pay again/);
  assert.equal(
    localOrderSummary(e, { ...paid, resultState: "verified" }, null).marker,
    "OK",
  );
  assert.equal(
    localOrderSummary(e, { ...o, fingerprint: "outdated" }, null).state,
    "Not checked",
  );
});

test("details lead with uncertainty and safe actions, with identifiers separated from explanations", () => {
  const e = {
    invocationId: id(9),
    orderRequestId: id(10),
    orderId: null,
    createdAtMs: 1793440000000,
    paymentSubmitted: false,
  };
  const o = {
    fingerprint: recordFingerprint(e),
    errorCode: "ORIGINAL_POLICY_UNKNOWN",
    financialState: "unknown",
    checkedAtMs: 1793440000000,
  };
  const plain = localReviewDetails(e, o, null, { selector: "0x0000000000" });
  assert.match(plain, /Cannot confirm whether an Order was created/);
  assert.ok(plain.indexOf("> What to do") < plain.indexOf("> Reference IDs"));
  assert.match(plain, /No local record/);
  assert.match(plain, /do not prove/);
  assert.match(plain, /agentpay orders archive 0x0000000000/);
  assert.doesNotMatch(
    plain,
    /Financial state:|Preparation request:|Check:| status/,
  );
  const color = localReviewDetails(e, o, null, {
    selector: "0x0000000000",
    color: true,
  });
  assert.equal(color.replace(/\x1b\[[0-9;]*m/g, ""), plain);
  const stale = localReviewDetails(e, { ...o, fingerprint: "stale" }, null);
  assert.doesNotMatch(stale, /Cannot confirm whether an Order was created/);
});
