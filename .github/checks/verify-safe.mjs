// Runs only against a disposable local development chain started by the workflow.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import * as ethers from "ethers";
import { ownerAssets } from "../../src/owner-approval-server.mjs";
import { checkSetupSafe } from "../../src/check-setup-safe.mjs";
import manifest from "../../package.json" with {type: "json"};
const supported = manifest.agentpaySafeVersions;

const [version, safeArtifacts, protocolArtifacts] = process.argv.slice(2);
assert.match(version, /^\d+\.\d+\.\d+$/);
const zero = ethers.ZeroAddress;
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
provider.pollingInterval = 50;
const chain = {chainId: 31337, rpcUrl:"http://127.0.0.1:8545"};
assert.equal((await provider.getNetwork()).chainId, 31337n);
const signer = await provider.getSigner(0);
const [owner, other, delegate] = await provider.send("eth_accounts", []);

async function deploy(name, ...args) {
  const dir = name.startsWith("Safe") ? safeArtifacts : protocolArtifacts;
  const path = join(dir, name === "SafeProxy" ? "proxies" : "", name + ".sol", name + ".json");
  const {abi, bytecode} = JSON.parse(readFileSync(path));
  const contract = await new ethers.ContractFactory(abi, bytecode.object || bytecode, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function openPage(account, source, calls, receiptLayout) {
  const assets = await ownerAssets({source, calls});
  const nodes = {}, storage = new Map();
  const ethereum = {request: ({method, params}) =>
    ["eth_accounts", "eth_requestAccounts"].includes(method)
      ? [account] : provider.send(method, params || [])};
  const context = vm.createContext({ethers, ethereum, window:{ethereum},
    document:{getElementById: id => nodes[id] ??= {}},
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value)}});
  vm.runInContext(assets.get("plan.js").toString(), context);
  vm.runInContext(assets.get("owner-approval.js").toString(), context);
  // Unknown releases stay blocked in production. Exercise a candidate mapping
  // only in this test page after checking both events against the official ABI.
  if (!Object.hasOwn(supported, version)) {
    await nodes.connect.onclick();
    assert.equal(nodes.execute.disabled, true);
    assert.ok(nodes.status.textContent.includes(version));
    context.window.agentpaySafeVersions[version] = receiptLayout;
  }
  await nodes.connect.onclick();
  return nodes;
}

try {
  const module = await deploy("AgentPaySpendingModule");
  const token = await deploy("MockERC20", "Test Dollar", "USD", 6);
  const factory = await deploy("AgentPayEscrowFactory");
  const registry = await deploy("SkillRegistry", owner);
  for (const [type, threshold] of [["Safe", 1], ["SafeL2", 2]]) {
    const singleton = await deploy(type);
    const proxy = await deploy("SafeProxy", singleton.target);
    const safe = new ethers.Contract(proxy.target, singleton.interface, signer);
    await (await safe.setup(threshold === 1 ? [owner] : [owner, other], threshold, zero, "0x", zero, zero, 0, zero)).wait();
    assert.equal(await safe.VERSION(), version);
    const versionCheck = await checkSetupSafe(chain, proxy.target, owner);
    if (Object.hasOwn(supported, version)) {
      assert.equal(versionCheck.version, version);
      assert.match((await checkSetupSafe(chain, proxy.target, delegate)).problem, /owner address/);
      assert.match((await checkSetupSafe(chain, owner, owner)).problem, /No Safe contract/);
    } else {
      assert.ok(versionCheck.problem.includes(version));
    }
    const indexed = safe.interface.getEvent("ExecutionSuccess").inputs[0].indexed;
    assert.equal(safe.interface.getEvent("ExecutionFailure").inputs[0].indexed, indexed);
    const layout = indexed ? "indexed" : "unindexed";
    if (Object.hasOwn(supported, version)) assert.equal(supported[version], layout);
    const source = {...chain, safe:proxy.target, module:module.target};
    const policy = ethers.id(type);
    const now = (await provider.getBlock("latest")).timestamp;
    const call = (contract, name, args) => ({purpose:name, to:contract.target, value:"0", operation:0,
      data:contract.interface.encodeFunctionData(name, args)});
    const enable = call(safe, "enableModule", [module.target]);
    const create = call(module, "createPolicy", [policy, delegate, token.target, factory.target, registry.target, 1000000, 5000000, now, now+86400]);
    const revoke = call(module, "revokePolicy", [policy]);
    let nonce = 0n;
    for (const calls of [[enable, create], [revoke]]) {
      const executor = await openPage(owner, source, calls, layout);
      const cosigner = threshold === 2 ? await openPage(other, source, calls, layout) : null;
      for (const operation of calls) {
        if (cosigner) {
          assert.equal(executor.execute.disabled, true);
          await cosigner.refresh.onclick();
          await cosigner.approve.onclick();
          await executor.refresh.onclick();
        }
        assert.equal(executor.execute.disabled, false, executor.status.textContent);
        await executor.execute.onclick();
        assert.equal(await safe.nonce(), ++nonce, executor.status.textContent);
        assert.equal(await safe.isModuleEnabled(module.target), true);
        if (operation !== enable) {
          const state = await module.policies(proxy.target, policy);
          assert.equal(state.maxPerPayment, 1000000n);
          assert.equal(state.totalBudget, 5000000n);
          assert.equal(state.delegate.toLowerCase(), delegate.toLowerCase());
          assert.equal(state.revoked, operation === revoke);
        }
      }
      assert.match(executor.status.textContent, /All operations verified/);
    }
    console.log(`${type} ${version}: threshold ${threshold}; enable, create and revoke verified (${layout} receipts).`);
  }
} finally {
  provider.destroy();
}
