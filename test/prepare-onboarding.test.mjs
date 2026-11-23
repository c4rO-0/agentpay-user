// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  stat,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareOnboarding,
  validatePublicDeployment,
} from "../src/prepare-onboarding.mjs";
const config = {
  mode: "private-anvil",
  chainId: 31337,
  source: "test Market",
  rpcUrl: "http://127.0.0.1:8547",
  settlementUrl: "http://127.0.0.1:6572",
  marketBundleMetadataUrl: "http://127.0.0.1:6583/skills/bundles/test/metadata",
  module: "0x" + "1".repeat(40),
  token: "0x" + "2".repeat(40),
  factory: "0x" + "3".repeat(40),
  registry: "0x" + "4".repeat(40),
  tokenDecimals: 6,
  tokenSymbol: "rUSDC",
  bundleSha256: "a".repeat(64),
  maxUsageUnits: 1,
};
test("preparation saves locally, never overwrites existing files or symlinks, cancels cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "user-settings-"));
  try {
    const inputPath = join(dir, "public.json"),
      outputPath = join(dir, "local.json");
    await writeFile(inputPath, JSON.stringify(config));
    const answers = [
      "0x" + "5".repeat(40),
      "0x" + "6".repeat(40),
      "anvil",
      "",
      "confirm",
    ];
    const result = await prepareOnboarding({
      inputPath,
      outputPath,
      ask: async () => answers.shift(),
      write: () => {},
    });
    assert.equal(result.runtimeUrl, "http://127.0.0.1:6490");
    assert.equal(result.safe, "0x" + "5".repeat(40));
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    // Real existing reader validates the generated contract, without chain calls.
    const { validateConfig } = await import("../src/anvil-onboarding.mjs");
    validateConfig(result);
    await assert.rejects(
      prepareOnboarding({
        inputPath,
        outputPath,
        ask: () => {
          throw Error("must not prompt");
        },
        write: () => {},
      }),
      { code: "EEXIST" },
    );
    const link = join(dir, "link.json");
    await symlink(outputPath, link);
    await assert.rejects(
      prepareOnboarding({
        inputPath,
        outputPath: link,
        ask: () => {},
        write: () => {},
      }),
      { code: "EEXIST" },
    );
    const cancelled = join(dir, "cancelled.json");
    await assert.rejects(
      prepareOnboarding({
        inputPath,
        outputPath: cancelled,
        ask: async () => "q",
        write: () => {},
      }),
      /Cancelled/,
    );
    await assert.rejects(stat(cancelled), { code: "ENOENT" });
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), result);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("rejects secrets, user state, wrong networks and unsafe URLs", () => {
  for (const patch of [
    { safe: "0x" + "5".repeat(40) },
    { privateKey: "secret" },
    { chainId: 0 },
    { rpcUrl: "http://example.com" },
    { rpcUrl: "http://user:pass@127.0.0.1" },
    { maxUsageUnits: 2 },
  ])
    assert.throws(() => validatePublicDeployment({ ...config, ...patch }));
});

test("public network configuration accepts supported EVM identities without selecting a signer", () => {
  for (const chainId of [31337, 31338, 84532, 8453]) {
    const value = validatePublicDeployment({
      ...config,
      mode: "production",
      chainId,
      rpcUrl: "https://rpc.example",
      settlementUrl: "https://platform.example/settlement",
      marketBundleMetadataUrl:
        "https://platform.example/market/skills/bundles/test/metadata",
      tokenDecimals: 36,
    });
    assert.equal(value.chainId, chainId);
    assert.equal(value.ownerSigner, undefined);
  }
  for (const change of [
    { chainId: "8453" },
    { chainId: Number.MAX_SAFE_INTEGER + 1 },
    { ownerSigner: "anvil" },
    { tokenDecimals: 37 },
  ])
    assert.throws(() => validatePublicDeployment({ ...config, ...change }));
});

test('default owner wallet and invalid confirmation preserve the entered settings',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'confirm-settings-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const inputPath=join(dir,'deployment.json'),outputPath=join(dir,'setup.json');
 await writeFile(inputPath,JSON.stringify(config));
 const answers=['0x'+'5'.repeat(40),'0x'+'6'.repeat(40),'','','','yes','confirm'];
 const output=[];
 const result=await prepareOnboarding({inputPath,outputPath,inspectSafe:async()=>({version:"1.5.0"}),ask:async()=>{assert.ok(answers.length);return answers.shift();},write:s=>output.push(s)});
 assert.equal(result.ownerSigner,'external');
 assert.equal(result.safe,'0x'+'5'.repeat(40));
 assert.match(output.join('\n'),/recommended/);
 assert.equal(output.filter(s=>s.includes('Your entries are kept')).length,2);
 assert.deepEqual(JSON.parse(await readFile(outputPath,'utf8')),result);
});

test("generic deployment accepts no official package but rejects a partial mapping and invalid finality",()=>{
 const {marketBundleMetadataUrl,bundleSha256,maxUsageUnits,...generic}=config;
 assert.equal(validatePublicDeployment({...generic,chainId:12345}).marketBundleMetadataUrl,undefined);
 assert.throws(()=>validatePublicDeployment({...generic,bundleSha256:"a".repeat(64)}));
 assert.throws(()=>validatePublicDeployment({...generic,finality:{confirmations:0,fundingScanOverlapBlocks:12,unpaidConfirmationBlocks:12}}));
});

test("external setup retries the same Safe and lets the owner correct an address before saving", async t => {
  const dir = await mkdtemp(join(tmpdir(), "safe-preflight-"));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const inputPath = join(dir, "public.json"), outputPath = join(dir, "local.json");
  await writeFile(inputPath, JSON.stringify(config));
  const safe = "0x" + "5".repeat(40), wrong = "0x" + "6".repeat(40), owner = "0x" + "7".repeat(40);
  const answers = [safe, wrong, "", "retry", "back", safe, owner, "", "confirm"];
  const inspected = [];
  const result = await prepareOnboarding({
    inputPath, outputPath, ask: async () => { assert.ok(answers.length); return answers.shift(); }, write: () => {},
    inspectSafe: async (_, address, signer) => {
      await assert.rejects(stat(outputPath), {code:"ENOENT"});
      inspected.push([address, signer]);
      if (inspected.length === 1) return {problem:"RPC unavailable"};
      return signer === owner ? {version:"1.5.0"} : {problem:"Wrong owner"};
    },
  });
  assert.deepEqual(inspected, [[safe, wrong], [safe, wrong], [safe, owner]]);
  assert.equal(result.ownerAddress, owner);
});

test("an unsupported Safe gets an update recommendation only for a published compatible User", async () => {
  const {unsupportedSafeMessage} = await import("../src/check-setup-safe.mjs");
  const latest = {name:"@c4roa0/agentpay-user", version:"99.0.0", agentpaySafeVersions:{"1.6.0":"indexed"}};
  const registry = async () => new Response(JSON.stringify(latest));
  assert.match(await unsupportedSafeMessage("1.6.0", registry), /Update User and resume/);
  assert.match(await unsupportedSafeMessage("2.0.0", registry), /No compatible update/);
  assert.match(await unsupportedSafeMessage("1.6.0", async () => {throw Error();}), /Could not confirm an update/);
});
