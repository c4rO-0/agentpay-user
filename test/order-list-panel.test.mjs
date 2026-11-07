// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { renderOrderList } from "../src/order-list-panel.mjs";
import { recordFingerprint, observationKey } from "../src/order-review.mjs";
const entries = [1, 2, 3].map((n) => ({
  invocationId: "0x" + String(n).repeat(64),
  orderId: n === 1 ? null : "0x" + String(n + 3).repeat(64),
  createdAtMs: 1793440000000,
}));
const observations = Object.fromEntries(
  entries.map((e, i) => [
    e.invocationId,
    {
      fingerprint: recordFingerprint(e),
      financialState: i ? "terminal" : "unknown",
      vaultState: i ? "Released" : null,
      resultState: "verified",
      errorCode: i ? null : "ORIGINAL_POLICY_UNKNOWN",
    },
  ]),
);
const e = entries[2],
  notes = {
    [e.invocationId]: {
      archived: true,
      fingerprint: recordFingerprint(e),
      observation: observationKey(observations[e.invocationId]),
    },
  };
test("order cards distinguish warning, completed and archived with readable narrow layouts", () => {
  for (const columns of [48, 60, 80]) {
    const plain = renderOrderList(entries, observations, notes, { columns }),
      colored = renderOrderList(entries, observations, notes, {
        columns,
        color: true,
      });
    assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ""), plain);
    assert.match(plain, /\[WAIT\] Not confirmed/);
    assert.match(plain, /\[OK\] Paid out/);
    assert.match(plain, /\[ARCHIVED\] Paid out/);
    assert.match(plain, /Archive after review/);
    assert.match(plain, /Restore reminder/);
    for (const line of plain.split("\n"))
      assert.ok(line.length <= Math.min(columns, 72), line);
  }
});
test("empty list has a clear completion and no action commands", () => {
  const out = renderOrderList([], {}, {});
  assert.match(out, /No saved Orders/);
  assert.doesNotMatch(out, /agentpay order/);
});

test("paid-out record separates local result warning from saved online check time", () => {
  const entry = entries[1],
    o = {
      fingerprint: recordFingerprint(entry),
      financialState: "terminal",
      vaultState: "Released",
      resultState: "missing",
      checkedAtMs: 1793440000000,
    };
  const out = renderOrderList([entry], { [entry.invocationId]: o }, {});
  assert.match(out, /Paid out · Local result unavailable/);
  assert.match(out, /Last check:/);
  const stale = renderOrderList(
    [entry],
    { [entry.invocationId]: { ...o, fingerprint: "stale" } },
    {},
  );
  assert.doesNotMatch(stale, /Last check:|Paid out/);
});
