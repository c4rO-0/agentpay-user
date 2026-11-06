// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as eth from "ethers";
const at = (n) => "0x" + String(n).repeat(40),
  owner = at(1),
  other = at(2),
  module = at(3),
  safeAddress = at(4);
async function page({
  threshold = 1,
  wrong = false,
  version = "1.4.1",
  pending = false,
  nonceChanged = false,
  create = false,
  sequence = false,
  initialEvent = false,
  crossModule = false,
  failJournal = false,
} = {}) {
  let revoked = false,
    executed = 0,
    approved = 0;
  const nodes = new Map();
  const document = {
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: "" });
      return nodes.get(id);
    },
  };
  const iface = new eth.Interface([
    "function revokePolicy(bytes32)",
    "function createPolicy(bytes32,address,address,address,address,uint256,uint256,uint64,uint64)",
  ]);
  const plan = {
    chainId: 31337,
    safe: safeAddress,
    module,
    calls: [
      {
        purpose: "Revoke permission",
        to: module,
        value: "0",
        operation: 0,
        data: create
          ? iface.encodeFunctionData("createPolicy", [
              "0x" + "a".repeat(64),
              owner,
              other,
              module,
              at(5),
              1,
              10,
              0,
              2000,
            ])
          : iface.encodeFunctionData("revokePolicy", ["0x" + "a".repeat(64)]),
      },
    ],
  };
  if (sequence)
    plan.calls.push({
      ...plan.calls[0],
      data: iface.encodeFunctionData("createPolicy", [
        "0x" + "c".repeat(64),
        owner,
        other,
        module,
        at(5),
        1,
        10,
        0,
        2000,
      ]),
    });
  if (crossModule) {
    plan.previousModule = at(8);
    plan.calls[0].to = at(8);
    plan.calls.splice(1, 0, {
      purpose: "Enable Module",
      to: safeAddress,
      value: "0",
      operation: 0,
      data: new eth.Interface([
        "function enableModule(address)",
      ]).encodeFunctionData("enableModule", [module]),
    });
  }
  const eventInterface = new eth.Interface([
    `event ExecutionSuccess(bytes32 ${version === "1.4.1" ? "indexed " : ""}txHash,uint256 payment)`,
  ]);
  const event = eventInterface.encodeEventLog(
    eventInterface.getEvent("ExecutionSuccess"),
    [eth.ZeroHash, 0],
  );
  const safe = {
    VERSION: async () => version,
    getOwners: async () => [owner, other],
    getThreshold: async () => BigInt(threshold),
    isModuleEnabled: async () => executed >= 2,
    nonce: async () => 0n,
    getTransactionHash: async () => eth.ZeroHash,
    approvedHashes: async (a) => (a === other ? 0n : BigInt(approved)),
    approveHash: async () => {
      approved++;
      return { wait: async () => {} };
    },
    execTransaction: async (...args) => {
      executed++;
      assert.equal(args[0], plan.calls[sequence ? executed - 1 : 0].to);
      assert.equal(args[2], plan.calls[sequence ? executed - 1 : 0].data);
      assert.equal(eth.getBytes(args[9]).length, 65 * threshold);
      revoked = true;
      return {
        hash: "0x" + "b".repeat(64),
        wait: async () => ({
          status: 1,
          logs: [{ ...event, address: safeAddress }],
        }),
      };
    },
    interface: { parseLog: () => ({ name: "ExecutionSuccess" }) },
  };
  class Provider {
    getBlock() {
      return { timestamp: 1000 };
    }
    getTransactionReceipt() {
      return pending
        ? null
        : { status: 1, logs: [{ ...event, address: safeAddress }] };
    }
    getNetwork() {
      return { chainId: 31337 };
    }
    getSigner() {
      return { getAddress: async () => (wrong ? at(9) : owner) };
    }
  }
  const handlers = {};
  const context = {
    ethers: {
      ...eth,
      BrowserProvider: Provider,
      Contract: function (address) {
        return address === safeAddress
          ? safe
          : {
              policies: async (_safe, id) =>
                sequence && id === "0x" + "c".repeat(64)
                  ? executed < (crossModule ? 3 : 2)
                    ? { delegate: eth.ZeroAddress }
                    : {
                        delegate: owner,
                        token: other,
                        factory: module,
                        registry: at(5),
                        maxPerPayment: 1n,
                        totalBudget: 10n,
                        validAfter: 0n,
                        validUntil: 2000n,
                        revoked: false,
                      }
                  : { delegate: create ? eth.ZeroAddress : owner, revoked },
              decimals: async () => 6,
              symbol: async () => "TEST",
            };
      },
    },
    window: {
      agentpayOwnerPlan: plan,
      agentpayOwnerJournal: pending
        ? {
            kind: "execute",
            transactionHash: "0x" + "b".repeat(64),
            safeHash: eth.ZeroHash,
          }
        : null,
      agentpayJournalServer: pending || failJournal,
      ethereum: { on() {} },
    },
    ethereum: {
      request: async () => {
        if (initialEvent) handlers.accountsChanged?.([owner]);
        return [owner];
      },
      on(name, fn) {
        handlers[name] = fn;
      },
    },
    document,
    fetch: async () => ({ ok: !failJournal }),
    localStorage: { getItem: () => (nonceChanged ? "9" : null), setItem() {} },
    Date,
    console,
  };
  vm.runInNewContext(
    await readFile(
      new URL("../web/owner-approval.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  return {
    nodes,
    get executed() {
      return executed;
    },
  };
}
test("single owner executes only the fixed operation then verifies completion", async () => {
  const p = await page();
  await p.nodes.get("connect").onclick();
  assert.equal(p.nodes.get("execute").disabled, false);
  await p.nodes.get("execute").onclick();
  assert.equal(p.executed, 1);
  assert.match(p.nodes.get("status").textContent, /verified on-chain/);
});
test("missing multisig approvals and non-owner wallets cannot execute", async () => {
  const p = await page({ threshold: 2 });
  await p.nodes.get("connect").onclick();
  assert.equal(p.nodes.get("execute").disabled, true);
  const q = await page({ wrong: true });
  await q.nodes.get("connect").onclick();
  assert.equal(q.nodes.get("execute").disabled, true);
  assert.match(q.nodes.get("status").textContent, /not a Safe owner/);
  assert.equal(q.executed, 0);
});

test("Safe 1.3.0 real event encoding verifies execution", async () => {
  const p = await page({ version: "1.3.0" });
  await p.nodes.get("connect").onclick();
  await p.nodes.get("execute").onclick();
  assert.equal(p.executed, 1);
  assert.match(p.nodes.get("status").textContent, /verified on-chain/);
});
test("saved pending transaction blocks replacement execution", async () => {
  const p = await page({ pending: true });
  await p.nodes.get("connect").onclick();
  assert.equal(p.nodes.get("execute").disabled, true);
  assert.match(p.nodes.get("status").textContent, /still pending/);
  assert.equal(p.executed, 0);
});

test("expiry uses chain time even when computer clock is far ahead", async () => {
  const p = await page({ create: true });
  await p.nodes.get("connect").onclick();
  assert.equal(p.nodes.get("execute").disabled, false);
});
test("nonce change requests review instead of silently executing", async () => {
  const p = await page({ nonceChanged: true });
  await p.nodes.get("connect").onclick();
  assert.equal(p.nodes.get("execute").disabled, true);
  assert.match(p.nodes.get("status").textContent, /Check approvals again/);
});

test("first connect tolerates initial account notification and guides both operations without reconnect", async () => {
  const p = await page({ sequence: true, initialEvent: true });
  await p.nodes.get("connect").onclick();
  assert.match(p.nodes.get("status").textContent, /Step 1\/2/);
  assert.equal(p.nodes.get("approve").hidden, true);
  await p.nodes.get("execute").onclick();
  assert.equal(p.executed, 1);
  assert.match(p.nodes.get("status").textContent, /Step 2\/2/);
  assert.equal(p.nodes.get("execute").textContent, "Create new permission");
  await p.nodes.get("execute").onclick();
  assert.equal(p.executed, 2);
  assert.match(p.nodes.get("status").textContent, /All operations verified/);
});

test("cross-Module renewal shows the matching summary at every step", async () => {
  const p = await page({ sequence: true, crossModule: true });
  await p.nodes.get("connect").onclick();
  assert.match(p.nodes.get("summary").textContent, new RegExp(at(8)));
  assert.match(p.nodes.get("summary").textContent, /Revoke Policy/);
  await p.nodes.get("execute").onclick();
  assert.equal(p.nodes.get("execute").textContent, "Enable AgentPay Module");
  assert.match(p.nodes.get("summary").textContent, /Enable AgentPay Module/);
  assert.doesNotMatch(p.nodes.get("summary").textContent, /Revoke Policy/);
  await p.nodes.get("execute").onclick();
  assert.equal(p.nodes.get("execute").textContent, "Create new permission");
  assert.match(p.nodes.get("summary").textContent, /Total budget/);
  await p.nodes.get("execute").onclick();
  assert.equal(p.executed, 3);
  assert.match(p.nodes.get("status").textContent, /All operations verified/);
});

test("failed intent persistence prevents submitting the owner transaction", async () => {
  const p = await page({ failJournal: true });
  await p.nodes.get("connect").onclick();
  await p.nodes.get("execute").onclick();
  assert.equal(p.executed, 0);
  assert.match(p.nodes.get("status").textContent, /Could not save/);
});
