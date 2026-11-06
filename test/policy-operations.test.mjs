// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Interface, JsonRpcProvider } from "ethers";
import { revokeOnChain } from "../src/policy-operations.mjs";
const at = (n) => "0x" + String(n).repeat(40),
  id = (n) => "0x" + String(n).repeat(64);
test("revocation submits only the fixed Safe call, verifies its result and retries without duplication", async (t) => {
  const abi = new Interface([
    "function policies(address,bytes32) view returns(address delegate,address token,address factory,address registry,uint256 maxPerPayment,uint256 totalBudget,uint256 spent,uint64 validAfter,uint64 validUntil,bool revoked)",
    "function revokePolicy(bytes32)",
  ]);
  const safe = new Interface([
    "function getOwners() view returns(address[])",
    "function getThreshold() view returns(uint256)",
  ]);
  let revoked = false,
    delegate = at(3),
    submits = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const q = JSON.parse(raw);
    let result;
    if (q.method === "eth_chainId") result = "0x7a69";
    else if (q.method === "eth_call") {
      const data = q.params[0].data;
      if (data.startsWith(safe.getFunction("getOwners").selector))
        result = safe.encodeFunctionResult("getOwners", [[at(7)]]);
      else if (data.startsWith(safe.getFunction("getThreshold").selector))
        result = safe.encodeFunctionResult("getThreshold", [1]);
      else
        result = abi.encodeFunctionResult("policies", [
          delegate,
          at(4),
          at(5),
          at(6),
          10,
          100,
          20,
          1,
          2000000000,
          revoked,
        ]);
    } else {
      res.writeHead(400);
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const rpc = new JsonRpcProvider(
    `http://127.0.0.1:${server.address().port}`,
    undefined,
    { batchMaxCount: 1 },
  );
  t.after(async () => {
    rpc.destroy();
    await new Promise((r) => server.close(r));
  });
  const policy = {
    registryRpcUrl: `http://127.0.0.1:${server.address().port}`,
    chainId: 31337,
    module: at(1),
    safe: at(2),
    delegate: at(3),
    policyId: id(1),
  };
  const options = {
    ownerSigner: "anvil",
    rpc,
    policy,
    write: () => {},
    submit: async (plan, owner, call) => {
      submits++;
      assert.equal(owner.toLowerCase(), at(7));
      assert.equal(call.to, policy.module);
      assert.equal(
        abi.decodeFunctionData("revokePolicy", call.data)[0],
        policy.policyId,
      );
      revoked = true;
    },
  };
  assert.equal(
    await revokeOnChain({
      ...options,
      ownerSigner: "external",
      approve: async () => false,
    }),
    false,
  );
  assert.equal(submits, 0, "external signer on Anvil never uses test account");
  assert.equal(await revokeOnChain(options), true);
  assert.equal(submits, 1);
  assert.equal(await revokeOnChain(options), true);
  assert.equal(submits, 1);
  delegate = at(9);
  await assert.rejects(revokeOnChain(options), /delegate/);
  assert.equal(submits, 1);
});
