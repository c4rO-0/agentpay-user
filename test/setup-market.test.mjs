import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setupMarket, refreshSetupTest} from "../src/setup-market.mjs";
import {officialTestPackageForNetwork} from "../src/official-test-package.mjs";

test("current receipt skips sign-in; a cancelled connection can be skipped and setup resumed", async t => {
  const dataDir = await mkdtemp(join(tmpdir(),"setup-market-"));
  t.after(() => rm(dataDir,{recursive:true,force:true}));
  const answers = ["connect","skip"];
  let attempts = 0;
  const options = {dataDir, ask:async()=>answers.shift(), write:()=>{},
    connect:async()=>{attempts++; return 0;}, status:async()=>({state:"none"})};
  assert.equal((await setupMarket(options)).paused, undefined);
  assert.equal(attempts, 1);
  await setupMarket({...options,status:async()=>({state:"saved"}),ask:assert.fail});
  assert.equal(attempts, 1);
});

test("an existing Base installation discovers only the pinned test and retains original settings", async () => {
  const addr = "0x" + "1".repeat(40);
  const config = {chainId:8453, mode:"production", module:addr, token:addr, factory:addr, registry:addr,
    rpcUrl:"https://my-rpc.example", settlementUrl:"https://market.example/settlement", source:"test", tokenDecimals:6, tokenSymbol:"USDC"};
  const published = {...config, rpcUrl:"https://different.example", marketBundleMetadataUrl:"https://market.example/market/skills/bundles/test/metadata",
    maxUsageUnits:1,bundleSha256:officialTestPackageForNetwork(8453).sha256};
  const live = async()=>({response:{ok:true},result:published});
  const result = await refreshSetupTest(config, "https://market.example", null, live);
  assert.deepEqual(result,{...published,rpcUrl:config.rpcUrl});
  await assert.rejects(refreshSetupTest(config,null,{...published,bundleSha256:"b".repeat(64)}),{code:"OFFICIAL_TEST_PACKAGE_MISMATCH"});
  await assert.rejects(refreshSetupTest(config,null,{...published,chainId:31337}),/deployment differs/i);
});
