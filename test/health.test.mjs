// SPDX-License-Identifier: MPL-2.0
// Real local HTTP transport, controlled chain responses: no actual chain/payment acceptance.
import test from "node:test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Interface } from "ethers";
import { runHealth } from "../src/health.mjs";
import { runPolicyTerminalGuide } from "../src/policy-terminal-guide.mjs";
import { failureGuidance } from "../src/setup-diagnostics.mjs";
const address = (n) => "0x" + String(n).repeat(40);
const abi = new Interface([
  "function getOwners() view returns(address[])",
  "function getThreshold() view returns(uint256)",
  "function isModuleEnabled(address) view returns(bool)",
  "function policies(address,bytes32) view returns(address,address,address,address,uint256,uint256,uint256,uint64,uint64,bool)",
]);
test("health checks contracts over HTTP, reports a failed read safely and never writes local settings or submits transactions", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "health-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "runtime"), { mode: 0o700 });
  const requests = [];
  let broken = false;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const b of req) body += b;
    const m = JSON.parse(body);
    requests.push(m.method);
    let result;
    if (m.method === "eth_chainId") result = "0x7a69";
    else if (m.method === "eth_getCode") result = "0x6000";
    else if (m.method === "eth_call") {
      const call = abi.parseTransaction({ data: m.params[0].data });
      if (broken && call.name === "getOwners") {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: m.id,
            error: {
              code: -32000,
              message:
                "DO_NOT_SHARE private upstream https://secret@example.com",
            },
          }),
        );
        return;
      }
      const values =
        call.name === "getOwners"
          ? [[address(6)]]
          : call.name === "getThreshold"
            ? [1]
            : call.name === "isModuleEnabled"
              ? [true]
              : [
                  address(0),
                  address(0),
                  address(0),
                  address(0),
                  0,
                  0,
                  0,
                  0,
                  0,
                  false,
                ];
      result = abi.encodeFunctionResult(call.name, values);
    } else {
      res.statusCode = 500;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const config = {
    chainId: 31337,
    rpcUrl: `http://127.0.0.1:${server.address().port}`,
    safe: address(1),
    module: address(2),
    token: address(3),
    factory: address(4),
    registry: address(5),
    ownerAddress: address(6),
  };
  const file = join(dir, "anvil-onboarding.json");
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  const before = await readFile(file, "utf8");
  for (const failure of [false, true]) {
    broken = failure;
    const lines = [];
    assert.equal(
      await runHealth({
        resolveDirectory: async () => dir,
        write: (s) => lines.push(s),
      }),
      failure ? 1 : 0,
    ); // Unfinished setup is reported separately from failed checks.
    const out = lines.join("\n");
    assert.match(out, /\[OK\] Chain RPC/);
    assert.match(out, /Policy contract read/);
    if (failure) assert.match(out, /\[!\] Safe ownership/);
    else assert.match(out, /\[OK\] Safe ownership/);
    assert.doesNotMatch(
      out,
      /DO_NOT_SHARE|secret@example|health-.*\/|127\.0\.0\.1/,
    );
  }
  assert.equal(await readFile(file, "utf8"), before);
  assert.deepEqual((await readdir(dir)).sort(), [
    "anvil-onboarding.json",
    "runtime",
  ]);
  assert.deepEqual(await readdir(join(dir, "runtime")), []);
  assert.ok(
    requests.every((m) =>
      ["eth_chainId", "eth_getCode", "eth_call"].includes(m),
    ),
  );
});

test("setup failures identify retry or repair and retain the saved authorization fields", async () => {
  const deployment = {
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8547",
    module: address(1),
    token: address(2),
    factory: address(3),
    registry: address(4),
    tokenDecimals: 6,
    source: "test",
  };
  for (const [code, reason] of [
    ["CHAIN_CHECK_TIMEOUT", /took too long/],
    ["FACTORY_CODE_MISSING", /No factory contract/],
    ["CHAIN_ID_MISMATCH", /different network/],
    ["CALL_EXCEPTION", /expected data/],
  ]) {
    let saved;
    const answers = [address(6), "10", "1", "30"];
    const result = await runPolicyTerminalGuide({
      deployment,
      delegate: address(5),
      collectOnly: true,
      ask: async () => answers.shift(),
      write: () => {},
      saveInputs: async (x) => {
        saved = x;
      },
      inspect: async () => {
        throw Object.assign(Error("private RPC token=DO_NOT_SHARE"), { code });
      },
    });
    assert.equal(result.readyToSign, false);
    assert.match(result.chainError, reason);
    assert.match(
      result.chainError,
      /No transaction was submitted by this check/,
    );
    assert.doesNotMatch(result.chainError, /DO_NOT_SHARE/);
    assert.equal(saved.fields.budget, "10");
    assert.equal(saved.fields.days, "30");
  }
  assert.equal(failureGuidance(Error("secret")).code, "CHECK_FAILED");
});

test("HTTP 200 proxy pages do not pass platform health checks", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "health-proxy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let valid = false;
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (!valid) {
      res.end("<html>DO_NOT_SHARE proxy failure</html>");
      return;
    }
    res.end(
      JSON.stringify(
        req.url.includes("/agentpay/purchase-readiness?")
          ? { ok: true, result: { blockers: ["UNKNOWN_SERVICE"], settlementProfile: { chainId: 31337, assetAddress: address(2), factoryAddress: address(3), registryAddress: address(4) } } }
          : {
              chainId: 31337,
              module: address(1),
              token: address(2),
              factory: address(3),
              registry: address(4),
              rpcUrl: "http://unused",
              settlementUrl: "http://unused",
            },
      ),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await writeFile(
    join(dir, "user-deployment.json"),
    JSON.stringify({ settlementUrl: origin + "/settlement" }),
    { mode: 0o600 },
  );
  await writeFile(
    join(dir, "market-connection.json"),
    JSON.stringify({ marketOrigin: origin, token: "DO_NOT_SHARE" }),
    { mode: 0o600 },
  );
  for (const success of [false, true]) {
    valid = success;
    const out = [];
    await runHealth({
      resolveDirectory: async () => dir,
      write: (s) => out.push(s),
    });
    assert.match(
      out.join("\n"),
      success
        ? /\[OK\] Settlement HTTP/
        : /\[!\] Settlement HTTP.*INVALID_HEALTH_RESPONSE/,
    );
    assert.match(
      out.join("\n"),
      success
        ? /\[OK\] Market HTTP/
        : /\[!\] Market HTTP.*INVALID_HEALTH_RESPONSE/,
    );
    assert.doesNotMatch(out.join("\n"), /DO_NOT_SHARE|proxy failure/);
    assert.match(out.join("\n"), /setup is unfinished/);
    assert.doesNotMatch(out.join("\n"), /LOCAL_SERVICE_UNAVAILABLE/);
  }
  assert.deepEqual(paths, [
    "/settlement/agentpay/purchase-readiness?skillId=0x" + "0".repeat(64) + "&profileHash=0x" + "0".repeat(64),
    "/market/web/onboarding/user-config",
    "/settlement/agentpay/purchase-readiness?skillId=0x" + "0".repeat(64) + "&profileHash=0x" + "0".repeat(64),
    "/market/web/onboarding/user-config",
  ]);
});

test("health stops chain probing after a stalled read times out", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "health-stall-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const methods = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const m = JSON.parse(text);
    methods.push(m.method);
    if (m.method === "eth_chainId")
      res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: "0x7a69" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  await writeFile(
    join(dir, "user-deployment.json"),
    JSON.stringify({
      rpcUrl: `http://127.0.0.1:${server.address().port}`,
      chainId: 31337,
      safe: address(1),
      module: address(2),
      token: address(3),
      factory: address(4),
      registry: address(5),
    }),
    { mode: 0o600 },
  );
  // Keep the server alive until the child exits: closing it first would hide
  // dangling in-flight HTTP sockets after the diagnostic timeout.
  const source = `import {runHealth} from ${JSON.stringify(new URL("../src/health.mjs", import.meta.url).href)}; process.exitCode=await runHealth({resolveDirectory:async()=>${JSON.stringify(dir)}});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "",
    forced = false;
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (out += b));
  const timer = setTimeout(() => {
    forced = true;
    child.kill();
  }, 45000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(
    forced,
    false,
    "diagnostic must exit without closing the RPC server",
  );
  assert.equal(code, 1, out);
  assert.match(out, /Remaining chain checks skipped after timeout/);
  assert.equal(methods.filter((m) => m === "eth_getCode").length, 1);
  assert.ok(!methods.includes("eth_call"));
});

test("health reads the Wallet binding RPC when Setup projections are absent", async (t) => {
 const dir=await mkdtemp(join(tmpdir(),"health-binding-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,"wallet"),{mode:0o700});
 await mkdir(join(dir,"runtime"),{mode:0o700});
 const calls=[];
 const server=createServer(async(req,res)=>{
  let raw="";for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);calls.push(body.method);
  res.end(JSON.stringify({jsonrpc:"2.0",id:body.id,result:"0x7a69"}));
 });
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 t.after(()=>new Promise(r=>server.close(r)));
 const binding={chainId:31337,registryRpcUrl:`http://127.0.0.1:${server.address().port}`};
 const file=join(dir,"wallet/policy.json");
 await writeFile(file,JSON.stringify(binding),{mode:0o600});
 await writeFile(join(dir,"runtime/local-services.json"),"{}",{mode:0o600});
 const lines=[];
 await runHealth({resolveDirectory:async()=>dir,write:line=>lines.push(line)});
 assert.ok(calls.includes("eth_chainId"));
 assert.match(lines.join("\n"),/\[OK\] Chain RPC/);
 assert.doesNotMatch(lines.join("\n"),/Chain RPC not configured/);
 assert.deepEqual(JSON.parse(await readFile(file,"utf8")),binding);
});
