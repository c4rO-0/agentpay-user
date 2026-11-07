// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { renderStatusPanel, showStatusPanel } from "../src/status-panel.mjs";
const running = { ActiveState: "active", UnitFileState: "enabled" };
const model = {
  wallet: { locked: true, bound: true },
  walletService: running,
  runtimeService: running,
  runtime: {
    inventory: "complete",
    wallet: "unavailable",
    orders: { total: 1, settled: 0, waiting: 1, review: 0, legacy: 1 },
    issues: [],
  },
};
test("live locked Wallet takes precedence over an older unavailable Runtime observation", () => {
  const p = renderStatusPanel(model);
  assert.match(p.text, /Waiting for unlock/);
  assert.match(p.text, /> Next\n  agentpay wallet unlock/);
  assert.doesNotMatch(
    p.text,
    /Wallet is unavailable|Wallet status unavailable|\x1b/,
  );
  assert.equal(p.code, 1);
});
test("history blocker outranks unlock prompt and failed Runtime gives a start action", () => {
  const bad = renderStatusPanel({
    ...model,
    runtime: { ...model.runtime, inventory: "blocked" },
  });
  assert.match(bad.text, /History needs attention/);
  assert.doesNotMatch(bad.text, /agentpay wallet unlock/);
  const stopped = renderStatusPanel({
    ...model,
    runtime: null,
    runtimeService: { ActiveState: "failed" },
  });
  assert.match(stopped.text, /Runtime is not running/);
  assert.match(stopped.text, /agentpay service start/);
});
test("colors are optional and are never needed to interpret status", async () => {
  const colored = renderStatusPanel(model, { color: true }),
    plain = renderStatusPanel(model);
  assert.match(colored.text, /\x1b\[/);
  assert.equal(colored.text.replace(/\x1b\[[0-9;]*m/g, ""), plain.text);
  let output;
  await showStatusPanel((s) => (output = s), {
    collect: async () => model,
    color: false,
  });
  assert.equal(output, plain.text);
});

test("all status scenarios retain readable width, aligned service columns and identical colored text", async () => {
  const { statusPanelCases } = await import(
    "./fixtures/status-panel-cases.mjs"
  );
  for (const [name, model] of statusPanelCases)
    for (const columns of [40, 48, 60, 80, 120]) {
      const plain = renderStatusPanel(model, { columns }),
        colored = renderStatusPanel(model, { columns, color: true });
      assert.equal(
        colored.text.replace(/\x1b\[[0-9;]*m/g, ""),
        plain.text,
        name,
      );
      for (const line of plain.text.split("\n"))
        assert.ok(
          line.length <= Math.min(columns, 72),
          `${name}: ${columns}: ${line}`,
        );
      const rows = plain.text
        .split("> Services\n")[1]
        ?.split("\n> Policy")[0]
        .split("\n")
        .filter((line) =>
          /^  \[(OK|WAIT|!)\].*(Wallet|Runtime|History)/.test(line),
        );
      for (const line of rows || [])
        assert.match(line.slice(10), /^(Wallet|Runtime|History)/, name);
    }
});

test("login startup distinguishes missing units, disabled units and failed queries", async () => {
  const { loginStartupLabel } = await import("../src/status-panel.mjs");
  assert.equal(
    loginStartupLabel({
      LoadState: "not-found",
      ActiveState: "inactive",
      UnitFileState: "",
    }),
    "Not configured for this user",
  );
  assert.equal(loginStartupLabel(null), "Could not check");
  assert.equal(
    loginStartupLabel({ LoadState: "error", UnitFileState: "enabled" }),
    "Could not check",
  );
  assert.equal(
    loginStartupLabel({ LoadState: "loaded", UnitFileState: "disabled" }),
    "Disabled",
  );
  assert.equal(
    loginStartupLabel({
      LoadState: "loaded",
      UnitFileState: "enabled-runtime",
    }),
    "Enabled until reboot",
  );
  assert.equal(
    loginStartupLabel({ LoadState: "masked", UnitFileState: "masked" }),
    "Blocked",
  );
});

test("terminal missing results end the check instead of asking users to poll or pay again", () => {
  const p = renderStatusPanel({
    ...model,
    wallet: { locked: false, bound: true },
    runtime: {
      ...model.runtime,
      wallet: "available",
      orders: { total: 1, settled: 1, waiting: 0, review: 0, missingResult: 1 },
      issues: [
        { orderId: "0x" + "a".repeat(64), code: "SETTLED_RESULT_UNAVAILABLE" },
      ],
    },
  });
  assert.match(p.text, /Payment complete; local result unavailable/);
  assert.match(p.text, /\[WAIT\] 1 local result needs recovery/);
  assert.match(p.text, /agentpay orders/);
  assert.doesNotMatch(p.text, /0xaaaaaaaaaa|retrieve/);
  assert.doesNotMatch(p.text, /agentpay status/);
});

test("temporary errors, conflicts and pending work get different safe next steps", () => {
  const state = (
    code,
    orders = { total: 1, settled: 0, waiting: 0, review: 1 },
  ) => ({
    ...model,
    wallet: { locked: false, bound: true },
    runtime: {
      ...model.runtime,
      wallet: "available",
      orders,
      issues: [{ orderId: "0x" + "a".repeat(64), code }],
    },
  });
  const retry = renderStatusPanel(state("ORDER_CHECK_UNAVAILABLE")).text;
  assert.match(retry, /retries automatically/);
  assert.match(retry, /agentpay orders/);
  assert.doesNotMatch(retry, /Contact AgentPay support/);
  for (const code of [
    "ORDER_NOT_FOUND",
    "ORDER_IDENTITY_MISMATCH",
    "ORDER_ID_UNRESOLVED",
    "ORDER_STATE_CONFLICT",
    "RECOVERY_RESULT_INVALID",
    "SETTLEMENT_RESPONSE_INVALID",
    "UNKNOWN",
  ]) {
    const p = renderStatusPanel(state(code)).text;
    assert.match(p, /agentpay orders/);
    assert.doesNotMatch(p, /0xaaaaaaaaaa|run order /);
    assert.doesNotMatch(p, /agentpay status/);
  }
  const truncated = renderStatusPanel(
    state("ORDER_CHECK_UNAVAILABLE", {
      total: 21,
      settled: 0,
      waiting: 0,
      review: 21,
    }),
  ).text;
  assert.match(truncated, /need review/);
  const pendingState = state("", {
    total: 1,
    settled: 0,
    waiting: 1,
    review: 0,
  });
  pendingState.runtime.issues = [];
  const pending = renderStatusPanel(pendingState).text.replace(/\s+/g, " ");
  assert.match(pending, /original Agent conversation/);
  assert.match(pending, /original identifier/);
});

test("expired unpaid Orders end waiting and do not tell the user to retrieve a result", () => {
  const p = renderStatusPanel({
    ...model,
    wallet: { locked: false, bound: true },
    runtime: {
      ...model.runtime,
      wallet: "available",
      orders: {
        total: 1,
        settled: 0,
        expired: 1,
        waiting: 0,
        review: 0,
        missingResult: 0,
      },
    },
  });
  assert.match(p.text, /Unpaid Orders expired/);
  assert.match(p.text, /No service result is expected/);
  assert.match(p.text, /1 expired unpaid/);
  assert.doesNotMatch(p.text, /retrieve|contact the Provider/);
});

test("review count has a visible warning badge and bold yellow text with a plain fallback", () => {
  const m = {
    ...model,
    runtime: {
      ...model.runtime,
      orders: { total: 2, settled: 0, waiting: 0, review: 2 },
    },
  };
  const plain = renderStatusPanel(m).text,
    colored = renderStatusPanel(m, { color: true }).text;
  assert.match(plain, /\[WAIT\] 2 need review/);
  assert.ok(colored.includes("\x1b[1;33m2 need review\x1b[0m"));
  assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ""), plain);
});

test("expired spending permission is prominent even when Wallet is locked or Runtime unavailable", () => {
  const authorization = { policyId: "0x" + "a".repeat(64), validUntil: 1000 };
  for (const runtime of [model.runtime, null]) {
    const p = renderStatusPanel(
      { ...model, authorization, runtime },
      { nowSeconds: 1000, color: true },
    );
    assert.match(p.text, /Spending permission expired/);
    assert.match(p.text, /New payments are blocked/);
    assert.match(p.text, /agentpay policy renew/);
    assert.equal(p.code, 1);
  }
  const valid = renderStatusPanel(
    { ...model, authorization },
    { nowSeconds: 999 },
  );
  assert.doesNotMatch(valid.text, /Spending permission expired/);
  const mismatch = renderStatusPanel(
    {
      ...model,
      authorization,
      wallet: { ...model.wallet, policyId: "0x" + "b".repeat(64) },
    },
    { nowSeconds: 1001 },
  );
  assert.doesNotMatch(mismatch.text, /Spending permission expired/);
});

test("Policy section is always visible and distinguishes saved validity, revocation, pending and unknown states", () => {
  const p = { policyId: "0x" + "a".repeat(64), validUntil: 2000 };
  const render = (extra = {}, authorization = p) =>
    renderStatusPanel(
      {
        ...model,
        wallet: { ...model.wallet, policyId: p.policyId, ...extra },
        authorization,
      },
      { nowSeconds: 1000 },
    );
  const valid = render();
  assert.match(valid.text, /> Policy\n  \[OK\] Within saved validity period/);
  assert.match(valid.text, /Valid until:/);
  const revoked = render({}, { ...p, revoked: true });
  assert.match(revoked.text, /Revoked \(last verified\)/);
  assert.match(revoked.text, /agentpay policy renew/);
  assert.match(
    render({ policyRenewalPending: true }).text,
    /Renewal incomplete/,
  );
  assert.match(
    render({ policyMigrationPending: true }).text,
    /Migration incomplete/,
  );
  assert.match(render({ bound: false }, null).text, /Not configured/);
  assert.match(render({}, null).text, /Could not confirm/);
  assert.match(
    render({ policyId: "0x" + "b".repeat(64) }).text,
    /Could not confirm/,
  );
});

test("Market renewal warning is visible alongside higher priority problems", () => {
  const ready = {
    ...model,
    wallet: { locked: false, bound: true },
    runtime: {
      ...model.runtime,
      wallet: "available",
      orders: { total: 0, settled: 0, waiting: 0, review: 0 },
    },
    market: { state: "pending" },
  };
  const panel = renderStatusPanel(ready);
  assert.equal(panel.code, 1);
  assert.match(panel.text, /Market connection needs updating/);
  assert.match(panel.text, /> Next\n  agentpay market connect/);
  assert.match(panel.text, /\[OK\] Enabled for both services/);
  const locked = renderStatusPanel({
    ...ready,
    wallet: { locked: true, bound: true },
  });
  assert.match(locked.text, /Waiting for unlock/);
  assert.match(locked.text, /Current Policy not connected/);
  assert.match(locked.text, /Continue: agentpay market connect/);
  assert.equal(
    renderStatusPanel({ ...ready, market: { state: "none" } }).code,
    0,
  );
  assert.match(
    renderStatusPanel({ ...ready, market: { state: "saved" } }).text,
    /connection saved locally/,
  );
});

test("Market local receipt must match full Wallet identity and current Policy", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readMarketStatus } = await import("../src/status-panel.mjs");
  const dir = await mkdtemp(join(tmpdir(), "market-status-"));
  try {
    await mkdir(join(dir, "wallet"));
    assert.deepEqual(await readMarketStatus(dir), { state: "none" });
    const p = {
      chainId: 31337,
      module: "module",
      safe: "safe",
      delegate: "delegate",
      policyId: "new",
    };
    await writeFile(join(dir, "wallet/policy.json"), JSON.stringify(p), {
      mode: 0o600,
    });
    const c = {
      network: "eip155:31337",
      module: p.module,
      safe: p.safe,
      delegate: p.delegate,
      policyId: "old",
    };
    const save = () =>
      writeFile(
        join(dir, "market-connection.json"),
        JSON.stringify({ marketOrigin: "http://127.0.0.1", connection: c }),
        { mode: 0o600 },
      );
    await save();
    assert.deepEqual(await readMarketStatus(dir), { state: "pending" });
    c.policyId = "new";
    await save();
    assert.deepEqual(await readMarketStatus(dir), { state: "saved" });
    c.delegate = "other";
    await save();
    assert.deepEqual(await readMarketStatus(dir), { state: "pending" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deployment change outranks missing results and unknown compatibility is explicit", () => {
  const base = {
    ...model,
    wallet: { locked: false, bound: true },
    runtime: {
      ...model.runtime,
      wallet: "available",
      orders: { total: 1, settled: 1, waiting: 0, review: 0, missingResult: 1 },
    },
  };
  const changed = renderStatusPanel({
    ...base,
    deployment: { state: "changed", changed: ["factory"] },
  });
  assert.match(changed.text, /Spending permission needs updating/);
  assert.match(changed.text, /agentpay policy renew/);
  assert.match(changed.text, /local result needs recovery/);
  const unknown = renderStatusPanel({
    ...base,
    deployment: { state: "unknown" },
  });
  assert.match(unknown.text, /Payment availability could not be confirmed/);
  assert.match(unknown.text, /Platform compatibility not confirmed/);
});
