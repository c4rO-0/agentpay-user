// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
"use strict";
const {
  BrowserProvider,
  Contract,
  Interface,
  zeroPadValue,
  ZeroAddress,
  ZeroHash,
  concat,
  keccak256,
  toUtf8Bytes,
} = ethers;
const plan = Object.freeze(window.agentpayOwnerPlan);
const abi = [
  "function VERSION() view returns(string)",
  "function getOwners() view returns(address[])",
  "function getThreshold() view returns(uint256)",
  "function nonce() view returns(uint256)",
  "function approvedHashes(address,bytes32) view returns(uint256)",
  "function approveHash(bytes32)",
  "function isModuleEnabled(address) view returns(bool)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)",
  "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns(bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)",
];
const moduleAbi = [
  "function policies(address,bytes32) view returns(address delegate,address token,address factory,address registry,uint256 maxPerPayment,uint256 totalBudget,uint256 spent,uint64 validAfter,uint64 validUntil,bool revoked)",
  "function createPolicy(bytes32,address,address,address,address,uint256,uint256,uint64,uint64)",
  "function revokePolicy(bytes32)",
];
const iface = new Interface(moduleAbi),
  enable = new Interface(["function enableModule(address)"]);
let provider,
  safe,
  account,
  active,
  busy = false,
  connecting = false,
  contextChanged = false;
const eventInterfaces = {
  "1.3.0": new Interface([
    "event ExecutionSuccess(bytes32 txHash,uint256 payment)",
    "event ExecutionFailure(bytes32 txHash,uint256 payment)",
  ]),
  "1.4.1": new Interface([
    "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
    "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)",
  ]),
};
const storageKey = keccak256(toUtf8Bytes(JSON.stringify(plan)));
let pending = window.agentpayJournalServer
  ? window.agentpayOwnerJournal
  : JSON.parse(localStorage.getItem(storageKey) || "null");
async function savePending(value) {
  localStorage.setItem(storageKey, JSON.stringify(value));
  pending = value;
  if (window.agentpayJournalServer) {
    const r = await fetch("journal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!r.ok)
      throw Error(
        "Could not save transaction recovery information. Keep this page open and retain the transaction hash: " +
          (value?.transactionHash || ""),
      );
  }
}
function executionEvents(receipt, version, hash) {
  return receipt.logs
    .filter((l) => l.address?.toLowerCase() === plan.safe.toLowerCase())
    .map((l) => {
      try {
        return eventInterfaces[version].parseLog(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.args.txHash === hash);
}
const el = (id) => document.getElementById(id),
  say = (text) => (el("status").textContent = text);
el("summary").textContent =
  `Network: eip155:${plan.chainId}\nSafe: ${plan.safe}\n${plan.calls.map((c) => c.purpose).join("\n")}`;
el("details").textContent = JSON.stringify(plan, null, 2);
function lock() {
  for (const id of ["approve", "execute"]) el(id).disabled = true;
  active = null;
}
async function checked() {
  lock();
  if (Number((await provider.getNetwork()).chainId) !== plan.chainId)
    throw Error(
      "Switch your owner wallet to the network shown above, then reconnect.",
    );
  const version = await safe.VERSION();
  if (!["1.3.0", "1.4.1"].includes(version))
    throw Error("This Safe version has not been validated by this guide.");
  const owners = await safe.getOwners(),
    threshold = Number(await safe.getThreshold());
  if (!owners.some((a) => a.toLowerCase() === account.toLowerCase()))
    throw Error("The connected account is not a Safe owner.");
  if (pending?.kind === "intent") {
    await savePending(null);
  }
  if (pending) {
    const receipt = await provider.getTransactionReceipt(
      pending.transactionHash,
    );
    if (!receipt)
      throw Error(
        "Your previous transaction is still pending. Check again before submitting another operation.",
      );
    if (pending.kind === "execute" && receipt.status === 1) {
      const events = executionEvents(receipt, version, pending.safeHash);
      if (
        !events.some((e) => e.name === "ExecutionSuccess") ||
        events.some((e) => e.name === "ExecutionFailure")
      )
        throw Error(
          "Previous Safe execution could not be verified. Keep its transaction hash: " +
            pending.transactionHash,
        );
    }
    await savePending(null);
  }
  for (const [index, call] of plan.calls.entries()) {
    let done = false;
    if (call.to.toLowerCase() === plan.safe.toLowerCase()) {
      const args = enable.decodeFunctionData("enableModule", call.data);
      if (args[0].toLowerCase() !== plan.module.toLowerCase())
        throw Error("Module mismatch.");
      done = await safe.isModuleEnabled(plan.module);
    } else {
      if (
        call.to.toLowerCase() !== plan.module.toLowerCase() &&
        call.to.toLowerCase() !== plan.previousModule?.toLowerCase()
      )
        throw Error("Unsupported target.");
      const parsed = iface.parseTransaction({ data: call.data });
      if (
        call.to.toLowerCase() !== plan.module.toLowerCase() &&
        parsed.name !== "revokePolicy"
      )
        throw Error("Unsupported previous Module operation.");
      const p = await new Contract(call.to, moduleAbi, provider).policies(
        plan.safe,
        parsed.args[0],
      );
      if (parsed.name === "revokePolicy") {
        if (p.delegate === ZeroAddress) throw Error("Policy not found.");
        done = p.revoked;
      } else if (parsed.name === "createPolicy") {
        const a = parsed.args;
        if (
          p.delegate === ZeroAddress &&
          BigInt(a[8]) <= BigInt((await provider.getBlock("latest")).timestamp)
        )
          throw Error(
            "The authorization draft has expired. Return to the terminal and use back to change it.",
          );
        if (p.delegate !== ZeroAddress) {
          if (
            p.revoked ||
            [p.delegate, p.token, p.factory, p.registry].some(
              (v, i) => v.toLowerCase() !== a[i + 1].toLowerCase(),
            ) ||
            p.maxPerPayment !== a[5] ||
            p.totalBudget !== a[6] ||
            p.validAfter !== a[7] ||
            p.validUntil !== a[8]
          )
            throw Error("Existing Policy differs from this plan.");
          done = true;
        }
      } else throw Error("Unsupported operation.");
    }
    if (done) continue;
    const nonce = await safe.nonce();
    const key = keccak256(
      toUtf8Bytes(
        JSON.stringify({ chainId: plan.chainId, safe: plan.safe, call }),
      ),
    );
    const saved = localStorage.getItem(key);
    if (saved !== null && saved !== String(nonce)) {
      localStorage.setItem(key, String(nonce));
      throw Error(
        "Another Safe transaction changed the nonce. Check approvals again to review this operation at the new nonce; earlier approvals do not carry over.",
      );
    }
    localStorage.setItem(key, String(nonce));
    const hash = await safe.getTransactionHash(
      call.to,
      0,
      call.data,
      0,
      0,
      0,
      0,
      ZeroAddress,
      ZeroAddress,
      nonce,
    );
    const approved = [];
    for (const owner of owners)
      if (
        owner.toLowerCase() === account.toLowerCase() ||
        (await safe.approvedHashes(owner, hash)) !== 0n
      )
        approved.push(owner);
    if (call.to.toLowerCase() === plan.safe.toLowerCase()) {
      el("summary").textContent =
        `Network: eip155:${plan.chainId}\nSafe: ${plan.safe}\nEnable AgentPay Module: ${plan.module}\nSpending remains limited by your Policy.`;
    } else {
      const parsed = iface.parseTransaction({ data: call.data });
      if (parsed.name === "createPolicy") {
        const a = parsed.args,
          token = new Contract(
            a[2],
            [
              "function decimals() view returns(uint8)",
              "function symbol() view returns(string)",
            ],
            provider,
          );
        const decimals = Number(await token.decimals());
        if (decimals > 36) throw Error("Unsupported token precision.");
        el("summary").textContent =
          `Network: eip155:${plan.chainId}\nSafe: ${plan.safe}\nWallet execution address: ${a[1]}\nTotal budget: ${ethers.formatUnits(a[6], decimals)} ${await token.symbol()}\nPer purchase: ${ethers.formatUnits(a[5], decimals)}\nExpires: ${new Date(Number(a[8]) * 1000).toLocaleString()}`;
      } else
        el("summary").textContent =
          `Network: eip155:${plan.chainId}\nSafe: ${plan.safe}\nModule: ${call.to}\nRevoke Policy: ${parsed.args[0]}\nNew payments stop. Existing Orders keep their rules.`;
    }
    if (contextChanged) throw Error("Wallet changed. Connect again.");
    active = { call, index, nonce, hash, threshold, approved, version };
    const name =
      call.to.toLowerCase() === plan.safe.toLowerCase()
        ? "Enable AgentPay Module"
        : iface.parseTransaction({ data: call.data }).name === "revokePolicy"
          ? "Revoke old permission"
          : "Create new permission";
    el("execute").textContent = name;
    el("approve").hidden = threshold === 1;
    el("multisig").hidden = threshold === 1;
    el("connect").textContent = "Wallet connected";
    el("approve").disabled = (await safe.approvedHashes(account, hash)) !== 0n;
    el("execute").disabled = approved.length < threshold;
    say(
      `Step ${index + 1}/${plan.calls.length} · ${name}\n${threshold === 1 ? "Click “" + name + "”, then confirm in MetaMask." : approved.length + " of " + threshold + " owners available. Other owners can approve this step."}`,
    );
    return;
  }
  say(
    "All operations verified on-chain. Return to the terminal and enter 'check' to finish.",
  );
}
async function action(work) {
  if (busy) return;
  busy = true;
  lock();
  try {
    await work();
  } catch (e) {
    say(
      e.code === 4001
        ? "Wallet request cancelled. You can try again."
        : String(
            e.shortMessage || e.message || "Operation could not complete.",
          ),
    );
  } finally {
    busy = false;
    connecting = false;
    if (provider) el("refresh").disabled = false;
  }
}
el("connect").onclick = () =>
  action(async () => {
    if (!window.ethereum)
      throw Error(
        "Open this page in a browser with an owner wallet extension.",
      );
    connecting = true;
    contextChanged = false;
    say("Connecting to MetaMask…");
    await ethereum.request({ method: "eth_requestAccounts" });
    provider = new BrowserProvider(ethereum);
    const signer = await provider.getSigner();
    account = await signer.getAddress();
    safe = new Contract(plan.safe, abi, signer);
    connecting = false;
    await checked();
  });
el("refresh").onclick = () => action(checked);
el("approve").onclick = () => {
  const selected = active;
  return action(async () => {
    await checked();
    if (!active || active.hash !== selected?.hash)
      throw Error("Operation changed. Review it again.");
    say("Approve the operation hash in your wallet.");
    const hash = active.hash,
      callIndex = active.index;
    await savePending({ kind: "intent", callIndex });
    if (contextChanged) throw Error("Wallet changed. Connect again.");
    const tx = await safe.approveHash(hash);
    await savePending({ kind: "approve", callIndex, transactionHash: tx.hash });
    say("Approval submitted. Waiting for confirmation…");
    await tx.wait();
    await checked();
  });
};
el("execute").onclick = () => {
  const selected = active;
  return action(async () => {
    await checked();
    if (
      !active ||
      active.hash !== selected?.hash ||
      active.approved.length < active.threshold
    )
      throw Error("Check the current approvals first.");
    const signatures = concat(
      active.approved
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .slice(0, active.threshold)
        .map((a) => concat([zeroPadValue(a, 32), ZeroHash, "0x01"])),
    );
    const c = active.call,
      hash = active.hash,
      version = active.version,
      callIndex = active.index;
    say("Open MetaMask and confirm: " + el("execute").textContent + ".");
    await savePending({ kind: "intent", callIndex });
    if (contextChanged) throw Error("Wallet changed. Connect again.");
    const tx = await safe.execTransaction(
      c.to,
      0,
      c.data,
      0,
      0,
      0,
      0,
      ZeroAddress,
      ZeroAddress,
      signatures,
    );
    await savePending({
      kind: "execute",
      callIndex,
      transactionHash: tx.hash,
      safeHash: hash,
    });
    say("Submitted. Waiting for on-chain execution…");
    const receipt = await tx.wait();
    const events = executionEvents(receipt, version, hash);
    if (
      receipt.status !== 1 ||
      events.some((e) => e?.name === "ExecutionFailure") ||
      !events.some((e) => e?.name === "ExecutionSuccess")
    )
      throw Error(
        "Safe execution did not succeed. Return to the terminal to check before retrying.",
      );
    await savePending(null);
    await checked();
  });
};
if (window.ethereum?.on) {
  ethereum.on("accountsChanged", (accounts) => {
    if (connecting || accounts?.[0]?.toLowerCase() === account?.toLowerCase())
      return;
    contextChanged = true;
    lock();
    say("Wallet account changed. Connect again.");
  });
  ethereum.on("chainChanged", (chain) => {
    if (connecting || Number(chain) === plan.chainId) return;
    contextChanged = true;
    lock();
    say("Wallet network changed. Connect again.");
  });
}
