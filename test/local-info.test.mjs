// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { showLocalInfo } from "../src/local-info.mjs";
import { runUserCli } from "../src/user-cli.mjs";
test("info lists public identity and paths without credentials, plaintext or network calls", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "info-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const d of ["wallet", "runtime"])
    await mkdir(join(dir, d), { mode: 0o700 });
  const put = (name, value) =>
    writeFile(join(dir, name), JSON.stringify(value), { mode: 0o600 });
  const addr = "0x" + "1".repeat(40),
    id = "0x" + "2".repeat(64);
  await put("wallet/session.keystore.json", {
    address: addr.slice(2),
    crypto: { secret: "DO_NOT_PRINT" },
  });
  await put("wallet/policy.json", {
    chainId: 31337,
    safe: addr,
    delegate: addr,
    module: addr,
    policyId: id,
    secret: "DO_NOT_PRINT",
  });
  await put("runtime/local-services.json", {
    runtimeUrl: "http://127.0.0.1:6590",
    settlementUrl: "https://user:DO_NOT_PRINT@example.com",
  });
  await put("market-connection.json", {
    marketOrigin: "https://market.example",
    token: "DO_NOT_PRINT",
    connection: { id: "display-id", label: "Home", privateKey: "DO_NOT_PRINT" },
  });
  let out = "";
  assert.equal(
    await showLocalInfo({
      resolveDirectory: async () => dir,
      write: (s) => (out += s + "\n"),
    }),
    0,
  );
  assert.match(out, new RegExp(id));
  assert.match(out, /Home/);
  assert.match(out, /session.keystore.json/);
  assert.match(out, /Saved settings/);
  assert.doesNotMatch(out, /DO_NOT_PRINT/);
  await chmod(join(dir, "wallet/policy.json"), 0o644);
  out = "";
  assert.equal(
    await showLocalInfo({
      resolveDirectory: async () => dir,
      write: (s) => (out += s + "\n"),
    }),
    1,
  );
  assert.match(out, /Could not safely read/);
  assert.doesNotMatch(out, new RegExp(id));
});
test("missing installation does not create files or claim authorization", async () => {
  let out = "";
  assert.equal(
    await showLocalInfo({
      resolveDirectory: async () =>
        "/tmp/agentpay-nonexistent-info-fixture/data",
      write: (s) => (out += s + "\n"),
    }),
    0,
  );
  assert.match(out, /Setup not finished/);
  assert.match(out, /agentpay install --market/);
  assert.doesNotMatch(out, /Policy ID|No readable Session Key/);
});
test("help exposes info; secret arguments are not accepted", async () => {
  let out = "";
  await runUserCli(["wallet", "help"], { write: (s) => (out += s) });
  assert.match(out, /info\s+Wallet identity and local file locations/);
  assert.equal(
    await runUserCli(["wallet", "info", "--private-key"], { write: () => {} }),
    2,
  );
});

test('unfinished setup describes only saved data and points to setup; missing existing keys remain a warning',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'new-info-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'user-deployment.json'),'{}',{mode:0o600});
 let lines=[];
 await showLocalInfo({resolveDirectory:async()=>dir,write:s=>lines.push(s)});
 assert.match(lines.join('\n'),/Setup not finished/);
 assert.match(lines.join('\n'),/agentpay setup/);
 assert.doesNotMatch(lines.join('\n'),/No readable Session Key|Files inside|market connect/);
 await mkdir(join(dir,'wallet'),{mode:0o700});
 await writeFile(join(dir,'wallet/policy.json'),'{}',{mode:0o600});
 lines=[];
 await showLocalInfo({resolveDirectory:async()=>dir,write:s=>lines.push(s)});
 assert.match(lines.join('\n'),/No readable Session Key/);
 assert.doesNotMatch(lines.join('\n'),/No Wallet has been created/);
});


test('missing Policy after prior use requests recovery; a key-only first setup can continue', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'missing-policy-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  await mkdir(join(dir,'wallet'), {mode:0o700});
  await mkdir(join(dir,'runtime'), {mode:0o700});
  await writeFile(join(dir,'wallet/session.keystore.json'), '{}', {mode:0o600});
  await writeFile(join(dir,'user-deployment.json'), '{}', {mode:0o600});
  const info = async () => {
    let output = '';
    const code = await showLocalInfo({resolveDirectory:async()=>dir,write:s=>{output += s + '\n';}});
    return {code,output};
  };
  assert.match((await info()).output, /agentpay setup/);
  for (const marker of ['runtime/invocations.json', 'market-connection.json']) {
    await writeFile(join(dir,marker), '{}', {mode:0o600});
    const result = await info();
    assert.equal(result.code, 1);
    assert.match(result.output, /Local Wallet files need attention/);
    assert.match(result.output, /Check missing files against your backup/);
    assert.doesNotMatch(result.output, /agentpay setup|Setup not finished/);
    await rm(join(dir,marker));
  }
});
