// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { renewPolicy } from "../src/renew-policy.mjs";
const at = (n) => "0x" + String(n).repeat(40),
  id = (n) => "0x" + String(n).repeat(64);
function fixture() {
  const current = {
    version: "agentpay.safe-module.v1",
    chainId: 31337,
    module: at(1),
    safe: at(2),
    delegate: at(3),
    factory: at(4),
    registry: at(5),
    token: at(6),
    registryRpcUrl: "http://127.0.0.1:8547",
    policyId: id(1),
    validUntil: 1,
    maxAmount: "1000000",
  };
  let record = null,
    exists = false,
    submits = 0,
    binds = 0;
  const lines = [];
  const config = {
    chainId: 31337,
    rpcUrl: current.registryRpcUrl,
    module: current.module,
    safe: current.safe,
    factory: current.factory,
    registry: current.registry,
    token: current.token,
    policyId: id(2),
    totalBudget: "10000000",
    maxPerPayment: "1000000",
    validAfter: Math.floor(Date.now() / 1000) - 1,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
  };
  const opts = {
    readDeployment: async () => null,
    dataDir: "/private",
    ownerSigner: "anvil",
    write: (s) => lines.push(s),
    ask: async () => "confirm",
    readState: async (path) =>
      path.endsWith("policy.json")
        ? current
        : path.endsWith("policy-renewal-guide.json")
          ? record
          : null,
    saveState: async (path, v) => {
      if (path.endsWith("policy-renewal-guide.json")) record = v;
    },
    rpcFactory: () => ({
      getNetwork: async () => ({ chainId: 31337 }),
      destroy: () => {},
    }),
    tokenInfo: async () => ({ decimals: 6, symbol: "rUSDC" }),
    readPreviousTerms: async () => ({
      ...current,
      maxPerPayment: "1000000",
      totalBudget: "10000000",
      validAfter: 0,
      validUntil: 180 * 86400,
    }),
    guide: async () => ({ policyConfig: config }),
    inspect: async () => ({
      policyExists: exists,
      policyMatches: exists,
      moduleEnabled: true,
      threshold: 1,
      owners: [at(7)],
    }),
    revoke: async () => true,
    submit: async () => {
      exists = true;
      submits++;
    },
    call: async (_dir, method, args) => {
      if (method === "status") return { locked: false };
      if (method === "getAddress") return { address: current.delegate };
      if (method === "renewPolicy") {
        assert.equal(args.expectedPolicyId, id(1));
        assert.equal(args.target.policyId, id(2));
        binds++;
        return { completed: true };
      }
      throw Error("unexpected");
    },
  };
  return {
    opts,
    lines,
    current,
    get record() {
      return record;
    },
    get submits() {
      return submits;
    },
    get binds() {
      return binds;
    },
  };
}
test("renew asks before chain writes and resumes saved binding after transaction success", async () => {
  const f = fixture();
  f.opts.ask = async () => "q";
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(f.submits, 0);
  assert.equal(f.binds, 0);
  assert.ok(f.record);
  f.opts.ask = async () => "confirm";
  const call = f.opts.call;
  let interrupted = true;
  f.opts.call = async (...args) => {
    if (args[1] === "renewPolicy" && interrupted) {
      interrupted = false;
      throw Error("disconnected");
    }
    return call(...args);
  };
  assert.equal(await renewPolicy(f.opts), 1);
  assert.equal(f.submits, 1);
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(f.submits, 1);
  assert.equal(f.binds, 1);
});
test("active permission can be replaced; mismatched Safe cannot", async () => {
  const f = fixture();
  f.current.validUntil = Math.floor(Date.now() / 1000) + 100;
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(f.submits, 1);
  const g = fixture();
  const guide = g.opts.guide;
  g.opts.guide = async () => ({
    policyConfig: { ...(await guide()).policyConfig, safe: at(9) },
  });
  assert.equal(await renewPolicy(g.opts), 1);
  assert.equal(g.submits, 0);
  assert.equal(g.binds, 0);
});

test("back at renewal confirmation returns to draft without submitting; submitted draft cannot be edited", async () => {
  const f = fixture();
  const answers = ["back", "confirm"];
  f.opts.ask = async () => {
    assert.ok(answers.length);
    return answers.shift();
  };
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(f.submits, 1);
  assert.equal(f.binds, 1);
  const g = fixture();
  const call = g.opts.call;
  g.opts.call = async (...args) => {
    if (args[1] === "renewPolicy") throw Error("interrupted binding");
    return call(...args);
  };
  assert.equal(await renewPolicy(g.opts), 1);
  assert.equal(g.submits, 1);
  const again = ["back", "q"];
  g.opts.ask = async () => again.shift();
  assert.equal(await renewPolicy(g.opts), 0);
  assert.equal(g.submits, 1);
  assert.match(g.lines.join(" "), /cannot be edited/);
});

test("active replacement stops after revocation failure; standalone revoke requires confirmation", async () => {
  const f = fixture();
  f.current.validUntil = Math.floor(Date.now() / 1000) + 100;
  f.opts.revoke = async () => {
    throw Error("revocation failed");
  };
  assert.equal(await renewPolicy(f.opts), 1);
  assert.equal(f.submits, 0);
  assert.equal(f.binds, 0);
  const { revokePolicy } = await import("../src/renew-policy.mjs");
  let revoked = 0,
    saved = 0;
  const options = {
    dataDir: "/private",
    ownerSigner: "anvil",
    readState: async () => f.current,
    write: () => {},
    ask: async () => "q",
    saveState: async () => {
      saved++;
    },
    rpcFactory: f.opts.rpcFactory,
    revoke: async () => {
      revoked++;
      return true;
    },
  };
  assert.equal(await revokePolicy(options), 0);
  assert.equal(revoked, 0);
  assert.equal(saved, 0);
  assert.equal(
    await revokePolicy({ ...options, ask: async () => "confirm" }),
    0,
  );
  assert.equal(revoked, 1);
  assert.equal(saved, 1);
});

test("renewal takes defaults from the existing on-chain permission, not an example", async () => {
  const f = fixture(),
    guide = f.opts.guide;
  let defaults;
  f.opts.guide = async (options) => {
    defaults = options.defaults;
    return guide(options);
  };
  f.opts.ask = async () => "q";
  assert.equal(await renewPolicy(f.opts), 0);
  assert.deepEqual(defaults, {
    budget: "10.0",
    perPayment: "1.0",
    days: "180",
  });
  assert.equal(f.submits, 0);
});

test("completed renewal continues saved Market connection only after binding", async () => {
  const f = fixture(),
    read = f.opts.readState;
  let connections = 0;
  f.opts.readState = async (p) =>
    p.endsWith("market-connection.json")
      ? { marketOrigin: "http://127.0.0.1:8080" }
      : read(p);
  f.opts.connect = async (args, options) => {
    connections++;
    assert.equal(f.binds, 1);
    assert.deepEqual(args, ["--market", "http://127.0.0.1:8080"]);
    assert.equal(options.dataDir, "/private");
    assert.equal(options.ask, undefined);
    return 0;
  };
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(connections, 1);
  const g = fixture();
  g.opts.connect = async () => {
    throw Error("must not connect");
  };
  assert.equal(await renewPolicy(g.opts), 0);
  assert.ok(!g.lines.some((s) => s.includes("could not finish")));
});

test("Market failure never turns completed renewal into failed renewal", async () => {
  const f = fixture(),
    read = f.opts.readState;
  f.opts.readState = async (p) =>
    p.endsWith("market-connection.json")
      ? { marketOrigin: "http://127.0.0.1:8080" }
      : read(p);
  f.opts.connect = async () => {
    throw Error("network unavailable");
  };
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(f.binds, 1);
  assert.match(f.lines.join("\n"), /Retry: .\/run market connect/);
  assert.doesNotMatch(f.lines.join("\n"), /Retry: .\/run policy renew/);
});

test("paused renewal and failed binding do not enter Market connection", async () => {
  for (const failBinding of [false, true]) {
    const f = fixture(),
      read = f.opts.readState,
      call = f.opts.call;
    let connections = 0;
    f.opts.readState = async (p) =>
      p.endsWith("market-connection.json")
        ? { marketOrigin: "http://127.0.0.1:8080" }
        : read(p);
    f.opts.connect = async () => {
      connections++;
      return 0;
    };
    if (failBinding)
      f.opts.call = async (...args) => {
        if (args[1] === "renewPolicy") throw Error("binding interrupted");
        return call(...args);
      };
    else f.opts.ask = async () => "q";
    assert.equal(await renewPolicy(f.opts), failBinding ? 1 : 0);
    assert.equal(connections, 0);
  }
});

test("external cancellation before submission keeps the draft editable", async () => {
  const f = fixture();
  f.opts.ownerSigner = "external";
  f.opts.approve = async () => false;
  assert.equal(await renewPolicy(f.opts), 0);
  assert.notEqual(f.record.submitted, true);
  const answers = ["back", "q"];
  f.opts.ask = async () => answers.shift();
  assert.equal(await renewPolicy(f.opts), 0);
  assert.doesNotMatch(f.lines.join(" "), /cannot be edited/);
});
test("expired absent submitted external Policy can return to draft", async () => {
  const f = fixture();
  f.opts.ownerSigner = "external";
  f.opts.approve = async (options) => {
    await options.onSubmitted();
    return false;
  };
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(f.record.submitted, true);
  f.opts.rpcFactory = () => ({
    getNetwork: async () => ({ chainId: 31337 }),
    getBlock: async () => ({ timestamp: f.record.config.validUntil + 1 }),
    destroy() {},
  });
  const answers = ["back", "q"];
  f.opts.ask = async () => answers.shift();
  assert.equal(await renewPolicy(f.opts), 0);
  assert.doesNotMatch(f.lines.join(" "), /cannot be edited/);
});

test("deployment update uses remaining budget and independently completed binding", async () => {
  const f = fixture(),
    factory = at(8),
    module = at(9);
  let defaults,
    synced = false;
  f.opts.rpcFactory = () => ({
    getNetwork: async () => ({ chainId: 31337 }),
    getBlock: async () => ({ timestamp: 1000 }),
    destroy() {},
  });
  f.opts.readDeployment = async () => ({
    config: { ...f.current, factory, module },
  });
  f.opts.readPreviousTerms = async () => ({
    ...f.current,
    maxPerPayment: 1000000n,
    totalBudget: 10000000n,
    spent: 4000000n,
    validAfter: 0,
    validUntil: 180 * 86400,
  });
  const guide = f.opts.guide;
  f.opts.guide = async (options) => {
    defaults = options.defaults;
    const result = await guide();
    return { policyConfig: { ...result.policyConfig, factory, module } };
  };
  const call = f.opts.call;
  f.opts.call = async (...args) => {
    if (args[1] === "renewPolicy") assert.equal(args[2].target.module, module);
    return call(...args);
  };
  f.opts.syncDeployment = async () => {
    assert.equal(f.binds, 1);
    synced = true;
  };
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(defaults.budget, "6.0");
  assert.equal(f.submits, 1);
  assert.ok(synced);
});
test("deployment mismatch cancellation makes no owner call or local binding change", async () => {
  const f = fixture();
  f.opts.rpcFactory = () => ({
    getNetwork: async () => ({ chainId: 31337 }),
    getBlock: async () => ({ timestamp: 1000 }),
    destroy() {},
  });
  f.opts.readDeployment = async () => ({
    config: { ...f.current, factory: at(8) },
  });
  f.opts.ask = async () => "q";
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(f.submits, 0);
  assert.equal(f.binds, 0);
});

test("external plan remains identical after Module enablement and restart", async () => {
  const f = fixture();
  f.opts.ownerSigner = "external";
  let enabled = false,
    first;
  f.opts.readDeployment = async () => ({
    config: { ...f.current, module: at(9) },
  });
  f.opts.rpcFactory = () => ({
    getNetwork: async () => ({ chainId: 31337 }),
    getBlock: async () => ({ timestamp: 1000 }),
    destroy() {},
  });
  const guide = f.opts.guide;
  f.opts.guide = async (o) => ({
    policyConfig: { ...(await guide(o)).policyConfig, module: at(9) },
  });
  f.opts.inspect = async () => ({
    policyExists: false,
    policyMatches: false,
    moduleEnabled: enabled,
  });
  f.opts.approve = async (o) => {
    if (!first) first = JSON.stringify({ source: o.source, calls: o.calls });
    else
      assert.equal(JSON.stringify({ source: o.source, calls: o.calls }), first);
    assert.equal(o.calls.length, 3);
    return false;
  };
  assert.equal(await renewPolicy(f.opts), 0);
  enabled = true;
  assert.equal(await renewPolicy(f.opts), 0);
});
test("old revocation leaves draft editable but new authorization intent locks it", async () => {
  for (const callIndex of [0, 2]) {
    const f = fixture();
    f.opts.ownerSigner = "external";
    f.opts.approve = async (o) => {
      await o.onSubmitted({ kind: "intent", callIndex });
      return false;
    };
    assert.equal(await renewPolicy(f.opts), 0);
    assert.equal(f.record.submitted === true, callIndex === 2);
    f.opts.rpcFactory = () => ({
      getNetwork: async () => ({ chainId: 31337 }),
      getBlock: async () => ({ timestamp: 1000 }),
      destroy() {},
    });
    const answers = ["back", "q"];
    f.opts.ask = async () => {
      assert.ok(answers.length);
      return answers.shift();
    };
    assert.equal(await renewPolicy(f.opts), 0);
    assert.equal(
      f.lines.some((s) => s.includes("cannot be edited")),
      callIndex === 2,
    );
  }
});

test("ordinary renewal offers whole-day defaults for a non-integral prior duration", async () => {
  const f = fixture(),
    prior = f.opts.readPreviousTerms,
    guide = f.opts.guide;
  let defaults;
  f.opts.readPreviousTerms = async () => ({
    ...(await prior()),
    validAfter: 37,
  });
  f.opts.guide = async (o) => {
    defaults = o.defaults;
    return guide(o);
  };
  f.opts.ask = async () => "q";
  assert.equal(await renewPolicy(f.opts), 0);
  assert.equal(defaults.days, "180");
  assert.equal(defaults.daysRounded, true);
  assert.equal(f.submits, 0);
});
