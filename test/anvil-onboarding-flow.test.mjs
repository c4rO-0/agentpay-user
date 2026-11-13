// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { OFFICIAL_TEST_PACKAGE } from "../src/official-test-package.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashPrivateRequest } from "@c4roa0/agentpay-protocol";
import {
  runAnvilOnboarding,
  childFailureSummary,
} from "../src/anvil-onboarding.mjs";
import { buildSafePolicyPlan } from "../src/safe-policy-plan.mjs";
import {
  sameWalletPolicy,
  validateGuideTestCheckpoint,
} from "../src/anvil-onboarding-state.mjs";
const at = (n) => `0x${String(n).repeat(40)}`;
const config = {
  ownerSigner: "anvil",
  mode: "private-anvil",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8547",
  settlementUrl: "http://127.0.0.1:6572",
  runtimeUrl: "http://127.0.0.1:6590",
  marketBundleMetadataUrl: "http://127.0.0.1:6583/skills/bundles/test/metadata",
  ownerAddress: at(6),
  bundleSha256: "a".repeat(64),
  tokenDecimals: 6,
  tokenSymbol: "rUSDC",
  maxUsageUnits: 1,
  module: at(1),
  token: at(2),
  factory: at(3),
  registry: at(4),
  source: "reviewed private test",
};
function fixture() {
  const draft = {
    ...config,
    version: 1,
    delegate: at(5),
    safe: at(6),
    policyId: "0x" + "b".repeat(64),
    maxPerPayment: "1000000",
    totalBudget: "10000000",
    validAfter: Math.floor(Date.now() / 1000) - 5,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
  };
  const policy = buildSafePolicyPlan(draft, at(5)).walletPolicy;
  const skill = {
    skillId: "0x" + "c".repeat(64),
    profileHash: "0x" + "d".repeat(64),
    endpointUrl: "http://127.0.0.1:6571/services/random/agentpay/invoke",
    bundle: {
      directory: "/private/runtime/skill-bundles/example",
      sha256: OFFICIAL_TEST_PACKAGE.sha256,
      filesHash: "e".repeat(64),
      locallyModified: false,
    },
  };
  skill.reference = {
    version: "agentpay.service-reference.v1",
    skillId: skill.skillId,
    profileHash: skill.profileHash,
  };
  const state = {
    draft,
    policy,
    skill,
    initialized: true,
    module: true,
    chainPolicy: true,
    walletLive: true,
    unlocked: true,
    runtime: true,
    checkpoint: null,
    history: null,
  };
  const calls = [],
    output = [];
  function record(mode) {
    const key = "11111111-2222-4333-8444-555555555555";
    const id =
      "0x" +
      createHash("sha256")
        .update(`agentpay.user-invocation.v1:${key}`)
        .digest("hex");
    const order = "0x" + "f".repeat(64);
    state.checkpoint = {
      version: "agentpay.model-ack-smoke.v1",
      key,
      orderId: order,
      outputHash: "0x" + "1".repeat(64),
      confirmed: mode === "confirm",
      routingVersion: "agentpay.runtime-call.v1",
    };
    state.history = {
      version: "agentpay.user-invocations.v1",
      invocations: {
        [id]: {
          invocationId: id,
          orderId: order,
          requestHash: hashPrivateRequest({ min: 10, max: 99 }),
          serviceBinding: JSON.stringify({
            version: "agentpay.runtime-service.v1",
            reference: skill.reference,
            requestedMaxUsageUnits: "1",
          }),
        },
      },
    };
  }
  const operations = {
    approveOwnerOperations: async () => false,
    finishLocalSetup: async () => {
      calls.push("autostart");
    },
    saveServiceSettings: async () => {},
    saveRuntimeConnection: async () => {},
    saveAuthorizationInputs: async (_path, value) => {
      state.inputs = structuredClone(value);
    },
    checkLocalInstallation: async () => ({ ok: true }),
    networkFacts: async () => ({ decimals: 6, symbol: "rUSDC" }),
    inspectLocalUserSetup: async () => ({
      stage: state.initialized ? "initialized" : "not_initialized",
      delegate: state.initialized ? at(5) : null,
    }),
    privateJson: async (path) =>
      path.endsWith("authorization-fields.json")
        ? state.inputs || null
        : path.endsWith("authorization-inputs.json")
          ? null
          : path.endsWith("authorization-draft.json")
            ? state.draft
            : path.endsWith("model-ack-smoke.json")
              ? state.checkpoint
              : state.history,
    openWallet: async () => ({ policy: state.policy }),
    loadActiveSkill: async () => state.skill,
    walletStatus: async () => {
      if (!state.walletLive) throw Error("offline");
      return { locked: !state.unlocked };
    },
    runtimeHealth: async () => {
      if (!state.runtime) throw Error("offline");
      return { role: "user-runtime" };
    },
    chainState: async () => ({
      moduleEnabled: state.module,
      policyExists: state.chainPolicy,
      policyMatches: state.chainPolicy,
      owners: [config.ownerAddress],
      threshold: 1,
    }),
    executeAnvilOwnerCall: async (_source, _owner, call) => {
      calls.push(call.purpose);
      if (call.purpose.includes("Module")) state.module = true;
      else state.chainPolicy = true;
    },
    bindViaWallet: async (_data, policy) => {
      calls.push("bind");
      state.policy = policy;
    },
    startLocal: async () => {
      calls.push("start");
      state.walletLive = true;
    },
    runNode: async (_script, args) => {
      calls.push(args[0]);
      if (args[0] === "unlock") state.unlocked = true;
    },
    captureNode: async (script, args) => {
      calls.push(script.split("/").at(-1) + ":" + args[0]);
      if (script.endsWith("check-purchase-readiness.mjs"))
        return {
          readyToPurchase: true,
          facts: { estimatedPrepaidMaximumAtomic: "700000" },
        };
      record(args[0]);
      return { ok: true };
    },
  };
  async function run(answers, override = {}) {
    return runAnvilOnboarding({
      dataDir: "/private",
      config: { ...config, ...override },
      operations,
      write: (text) => output.push(text),
      ask: async () => {
        assert.ok(answers.length, "guide asked for an unexpected extra input");
        return answers.shift();
      },
    });
  }
  return {
    state,
    calls,
    output,
    run,
    record,
    policy,
    draft,
    skill,
    operations,
  };
}
test("check recommends test, shows actual quote, automatically acknowledges verified official-test receipt and finishes", async () => {
  const f = fixture();
  const result = await f.run(["continue", "confirm"]);
  assert.equal(result.completed, true);
  assert.equal(f.calls.at(-1), "autostart");
  assert.ok(f.output.some((s) => s.includes("* 'continue'")));
  assert.ok(f.output.some((s) => s.includes("0.7 rUSDC")));
  assert.ok(f.output.at(-1).includes("This guide has finished"));
  assert.deepEqual(
    f.calls.filter((s) => s.startsWith("random-model")),
    ["random-model-ack-smoke.mjs:invoke", "random-model-ack-smoke.mjs:confirm"],
  );
});
test("cancel before purchase creates no intent; quit has successful user cancellation semantics", async () => {
  const f = fixture();
  const r = await f.run(["continue", "q", "q"]);
  assert.equal(r.stage, "quit");
  assert.equal(f.state.checkpoint, null);
  assert.ok(!f.calls.some((s) => s.startsWith("random-model")));
});
test("interruption after delivery resumes the same Order without a new quote or payment consent", async () => {
  const f = fixture();
  const original = f.operations.captureNode;
  let interrupted = false;
  f.operations.captureNode = async (script, args) => {
    const result = await original(script, args);
    if (
      script.endsWith("random-model-ack-smoke.mjs") &&
      args[0] === "invoke" &&
      !interrupted
    ) {
      interrupted = true;
      throw Error("connection lost after delivery");
    }
    return result;
  };
  await f.run(["continue", "confirm", "q"]);
  const key = f.state.checkpoint.key;
  f.operations.captureNode = async (script, args) => {
    if (script.includes("check-purchase"))
      throw Error("must not request a new quote");
    return original(script, args);
  };
  assert.equal((await f.run(["continue"])).completed, true);
  assert.equal(f.state.checkpoint.key, key);
  assert.equal(f.state.checkpoint.confirmed, true);
});
test("completed checkpoint revalidates the result and missing history refuses replacement purchase", async () => {
  const f = fixture();
  f.record("confirm");
  assert.equal((await f.run(["continue"])).completed, true);
  assert.equal(f.calls.at(-1), "autostart");
  assert.ok(!f.calls.includes("random-model-ack-smoke.mjs:invoke"));
  f.calls.length = 0;
  f.state.history = null;
  assert.equal((await f.run([])).stage, "test_conflict");
  assert.equal(f.calls.length, 0);
});
test("partial authorization submits only missing operation then binds automatically", async () => {
  const f = fixture();
  f.state.chainPolicy = false;
  f.state.policy = null;
  await f.run(["continue", "confirm", "q", "q"]);
  assert.equal(
    f.calls.filter((s) => s === "create bounded Spending Policy").length,
    1,
  );
  assert.equal(f.calls.filter((s) => s === "bind").length, 1);
  await f.run(["continue", "q", "q"]);
  assert.equal(
    f.calls.filter((s) => s === "create bounded Spending Policy").length,
    1,
  );
});
test("binding failure resumes binding without another authorization confirmation or transaction", async () => {
  const f = fixture();
  f.state.policy = null;
  let failed = false;
  const bind = f.operations.bindViaWallet;
  f.operations.bindViaWallet = async (...args) => {
    if (!failed) {
      failed = true;
      throw Error("binding interrupted");
    }
    return bind(...args);
  };
  await f.run(["continue", "q"]);
  assert.equal(f.state.policy, null);
  await f.run(["continue", "q", "q"]);
  assert.ok(f.state.policy);
  assert.equal(
    f.calls.filter((s) => s === "create bounded Spending Policy").length,
    0,
  );
  assert.equal(f.calls.filter((s) => s === "start").length, 0);
});
test("absent locked Wallet is started, bound and unlocked before automatic readiness", async () => {
  const f = fixture();
  f.state.policy = null;
  f.state.walletLive = false;
  f.state.unlocked = false;
  await f.run(["continue", "q", "q"]);
  assert.deepEqual(f.calls.slice(0, 3), ["start", "bind", "unlock"]);
  assert.ok(f.state.unlocked);
});
test("existing Policy without a matching draft stops clearly and preserves it", async () => {
  const f = fixture();
  f.state.draft = null;
  const before = JSON.stringify(f.state.policy);
  assert.equal((await f.run([])).stage, "policy_conflict");
  assert.equal(JSON.stringify(f.state.policy), before);
  assert.equal(f.calls.length, 0);
});
test("equivalent Policy serialization and trailing RPC slash are accepted; actual field changes are rejected", () => {
  const f = fixture();
  const reverse = Object.fromEntries(Object.entries(f.policy).reverse());
  reverse.registryRpcUrl = reverse.registryRpcUrl.replace(/\/$/, "");
  assert.equal(sameWalletPolicy(reverse, f.policy), true);
  assert.equal(
    sameWalletPolicy({ ...reverse, maxAmount: "2" }, f.policy),
    false,
  );
});
test("a saved test cannot claim success for a different Skill or request", () => {
  const f = fixture();
  f.record("confirm");
  assert.throws(
    () =>
      validateGuideTestCheckpoint(f.state.checkpoint, f.state.history, {
        ...f.skill,
        profileHash: "0x" + "a".repeat(64),
      }),
    /SKILL_HISTORY_MISMATCH/,
  );
  f.state.checkpoint.key = "short";
  assert.throws(
    () =>
      validateGuideTestCheckpoint(f.state.checkpoint, f.state.history, f.skill),
    /CHECKPOINT_INVALID/,
  );
});
test("missing local prerequisites stop before any RPC", async () => {
  const f = fixture();
  f.operations.checkLocalInstallation = async () => ({
    ok: false,
    checks: [
      {
        status: "failed",
        message: "Wallet build missing",
        fix: "Build Wallet",
      },
    ],
  });
  f.operations.networkFacts = async () => {
    throw Error("must not access chain");
  };
  assert.equal((await f.run([])).stage, "preflight");
  assert.match(f.output[0], /Build Wallet/);
});
test("fresh guided path connects every action and reaches completion without operator orchestration", async () => {
  const f = fixture(),
    skill = f.skill;
  Object.assign(f.state, {
    initialized: false,
    draft: null,
    policy: null,
    skill: null,
    module: false,
    chainPolicy: false,
    walletLive: false,
    unlocked: false,
    runtime: false,
  });
  f.operations.saveNewDraft = async (_path, draft) => {
    f.state.draft = draft;
  };
  f.operations.runNode = async (script, args) => {
    f.calls.push(script.split("/").at(-1) + ":" + args[0]);
    if (script.endsWith("setup-local.mjs")) f.state.initialized = true;
    if (script.endsWith("install-skill-bundle.mjs")) f.state.skill = skill;
    if (args[0] === "unlock") f.state.unlocked = true;
  };
  f.operations.startLocal = async (script) => {
    if (script.endsWith("agentpay-wallet.mjs")) f.state.walletLive = true;
    else f.state.runtime = true;
  };
  const result = await f.run([
    "continue",
    at(6),
    "",
    "10",
    "1",
    "7",
    "confirm",
    "confirm",
  ]);
  assert.equal(
    result.completed,
    true,
    JSON.stringify({ result, output: f.output.slice(-8) }),
  );
  assert.ok(f.state.policy);
  assert.equal(f.state.checkpoint.confirmed, true);
  assert.ok(
    f.calls.includes("install-skill-bundle.mjs:--prepare-official-test"),
  );
  assert.ok(!f.calls.some((s) => s.includes("select-skill-bundle")));
});
test("an intent with no prepared order rechecks the current price and can be cancelled without replacing its key", async () => {
  const f = fixture();
  f.state.checkpoint = {
    version: "agentpay.model-ack-smoke.v1",
    key: "11111111-2222-4333-8444-555555555555",
    orderId: null,
    outputHash: null,
    confirmed: false,
    routingVersion: "agentpay.runtime-call.v1",
  };
  const key = f.state.checkpoint.key;
  await f.run(["continue", "q", "q"]);
  assert.equal(f.state.checkpoint.key, key);
  assert.ok(f.calls.some((s) => s.startsWith("check-purchase-readiness")));
  assert.ok(!f.calls.some((s) => s.startsWith("random-model")));
});

test("exit during authorization preserves inputs and reopening starts at the missing budget", async () => {
  const f = fixture();
  f.state.draft = null;
  f.state.policy = null;
  f.state.chainPolicy = false;
  await f.run(["continue", at(6), "q", "q"]);
  assert.deepEqual(Object.keys(f.state.inputs.fields), ["safe"]);
  assert.equal(f.state.draft, null);
  f.operations.saveNewDraft = async (_path, value) => {
    f.state.draft = value;
  };
  await f.run(["continue", "", "1", "0.7", "1", "q", "q"]);
  assert.equal(f.state.draft.safe, at(6));
  assert.equal(f.state.draft.delegate, at(5));
  assert.equal(f.state.draft.totalBudget, "1000000");
  assert.ok(
    f.output.some((value) =>
      value.includes("Continuing saved Safe and spending limits"),
    ),
  );
});

test("cancelling authorization preserves exact draft and retry requires consent before any write", async () => {
  const f = fixture();
  f.state.policy = null;
  f.state.chainPolicy = false;
  const originalId = f.state.draft.policyId;
  await f.run(["continue", "q", "q"]);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.draft.policyId, originalId);
  await f.run(["continue", "confirm", "q", "q"]);
  assert.equal(f.state.draft.policyId, originalId);
  assert.equal(
    f.calls.filter((s) => s === "create bounded Spending Policy").length,
    1,
  );
});
test("transaction interruption after Module enablement resumes the same Policy and skips Module", async () => {
  const f = fixture();
  f.state.policy = null;
  f.state.module = false;
  f.state.chainPolicy = false;
  const original = f.operations.executeAnvilOwnerCall;
  let failed = false;
  f.operations.executeAnvilOwnerCall = async (...args) => {
    await original(...args);
    if (!failed) {
      failed = true;
      throw Error("connection interrupted after mining");
    }
  };
  await f.run(["continue", "confirm", "q"]);
  assert.equal(f.state.module, true);
  assert.equal(f.state.chainPolicy, false);
  await f.run(["continue", "confirm", "q", "q"]);
  assert.equal(f.calls.filter((s) => s.includes("Module")).length, 1);
  assert.equal(
    f.calls.filter((s) => s === "create bounded Spending Policy").length,
    1,
  );
});

test("unreachable rehearsal RPC pauses before local or chain operations with recovery guidance", async () => {
  const f = fixture();
  f.operations.networkFacts = async () => {
    throw Object.assign(Error("connection refused"), { code: "ECONNREFUSED" });
  };
  const result = await f.run([]);
  assert.equal(result.stage, "network_unavailable");
  assert.equal(f.calls.length, 0);
  assert.match(
    f.output.join("\n"),
    /configured RPC at http:\/\/127.0.0.1:8547/,
  );
  assert.match(f.output.join("\n"), /saved settings are kept/);
});

test("child failure reports Runtime error rather than the source-code excerpt", () => {
  const stderr =
    "file:///private/user/scripts/test.mjs:53\nthrow new Error(`User Runtime HTTP ${response.status}`);\n      ^\n\nError: User Runtime HTTP 502: SKILL_INVOCATION_FAILED: fetch failed\n    at file:///private/user/scripts/test.mjs:53:40";
  assert.equal(
    childFailureSummary(stderr),
    "User Runtime HTTP 502: SKILL_INVOCATION_FAILED: fetch failed",
  );
  assert.doesNotMatch(childFailureSummary(stderr), /throw|file:\/\//);
});

test("restoration draft never falls back to owner authorization when chain verification fails", async () => {
  const f = fixture();
  f.state.draft.restoring = true;
  f.state.policy = null;
  f.state.chainPolicy = false;
  assert.equal((await f.run([])).stage, "restore_unavailable");
  assert.equal(f.calls.length, 0);
});
test("restoration saves its identity before binding; interrupted binding resumes without owner writes", async () => {
  const f = fixture();
  f.state.draft = null;
  f.state.policy = null;
  f.operations.saveNewDraft = async (_p, value) => {
    f.state.draft = value;
  };
  let attempts = 0;
  f.operations.restoreExistingPolicy = async ({ previewOnly, target }) => {
    if (previewOnly)
      return {
        policy: f.policy,
        terms: {
          totalBudget: f.draft.totalBudget,
          maxPerPayment: f.draft.maxPerPayment,
          validAfter: f.draft.validAfter,
          validUntil: f.draft.validUntil,
        },
      };
    assert.equal(f.state.draft.policyId, target.policyId);
    assert.equal(f.state.draft.restoring, true);
    if (attempts++ === 0) throw Error("interrupted binding");
    f.state.policy = f.policy;
    return {};
  };
  await f.run(["continue", at(6), f.draft.policyId, "q"]);
  assert.equal(f.state.policy, null);
  await f.run(["continue", "q", "q"]);
  assert.ok(f.state.policy);
  assert.ok(
    !f.calls.some(
      (s) =>
        s.includes("Module") || s.includes("Spending Policy") || s === "bind",
    ),
  );
});

test("Market config hash cannot authorize a substituted official test or overwrite old recovery", async () => {
  const f = fixture();
  f.state.skill.bundle.sha256 = config.bundleSha256;
  await assert.rejects(f.run([]), { code: "OFFICIAL_TEST_PACKAGE_MISMATCH" });
  assert.equal(f.calls.length, 0);
  f.record("confirm");
  const key = f.state.checkpoint.key;
  assert.equal((await f.run(["continue"])).completed, true);
  assert.equal(f.state.checkpoint.key, key);
  assert.ok(!f.calls.includes("random-model-ack-smoke.mjs:invoke"));
});

test("external signer on Anvil pauses with approval operations instead of using a test owner", async () => {
  const f = fixture();
  f.state.chainPolicy = false;
  f.state.policy = null;
  const result = await f.run(["continue", "confirm"], {
    ownerSigner: "external",
  });
  assert.equal(result.stage, "owner_approval");
  assert.equal(result.completed, false);
  assert.equal(
    f.calls.some(
      (s) => s.includes("create bounded") || s.includes("enable AgentPay"),
    ),
    false,
  );
});

test("the same owner approval and binding flow resumes on another configured chain", async () => {
  const f = fixture();
  f.state.chainPolicy = false;
  f.state.policy = null;
  f.state.draft.chainId = 31338;
  const config = {
    chainId: 31338,
    mode: "production",
    ownerSigner: "external",
  };
  const paused = await f.run(["continue", "confirm"], config);
  assert.equal(paused.stage, "owner_approval");
  assert.equal(
    f.calls.some((s) => s.includes("create bounded")),
    false,
  );
  f.state.chainPolicy = true;
  f.state.skill = null;
  const resumed = await f.run(["continue"], config);
  assert.equal(resumed.stage, "official_test_unavailable");
  assert.ok(f.calls.includes("bind"));
  assert.equal(f.state.policy.chainId, 31338);
  assert.equal(f.state.policy.policyId, f.draft.policyId);
});

test('setup keeps a slow but valid contract preflight alive beyond five seconds without signing',async t=>{
 const {createServer}=await import('node:http');
 const {Interface}=await import('ethers');
 const abi=new Interface(['function getOwners() view returns(address[])','function getThreshold() view returns(uint256)','function isModuleEnabled(address) view returns(bool)','function policies(address,bytes32) view returns(address,address,address,address,uint256,uint256,uint256,uint64,uint64,bool)']);
 const f=fixture(),methods=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;
  const m=JSON.parse(body);methods.push(m.method);let result;
  if(m.method==='eth_chainId')result='0x7a69';
  else if(m.method==='eth_getCode'){await new Promise(r=>setTimeout(r,1100));result='0x6000';}
  else if(m.method==='eth_call'){
   const call=abi.parseTransaction({data:m.params[0].data});
   const v=call.name==='getOwners'?[[config.ownerAddress]]:call.name==='getThreshold'?[1]:call.name==='isModuleEnabled'?[true]:[at(0),at(0),at(0),at(0),0,0,0,0,0,false];
   result=abi.encodeFunctionResult(call.name,v);
  }else{res.statusCode=500;res.end();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const rpcUrl=`http://127.0.0.1:${server.address().port}`;
 f.state.draft.rpcUrl=rpcUrl;
 delete f.operations.chainState;
 const start=Date.now();await f.run(['q'],{rpcUrl});
 assert.ok(Date.now()-start>5000);
 assert.doesNotMatch(f.output.join('\n'),/Chain status unavailable|took too long/);
 assert.ok(methods.filter(m=>m==='eth_getCode').length===5);
 assert.ok(methods.every(m=>['eth_chainId','eth_getCode','eth_call'].includes(m)));
 assert.equal(f.calls.length,0);
});
