// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInstall, marketSettingsUrl } from '../src/install-user.mjs';
import { installationDirectory } from '../src/installation-paths.mjs';
import { installedUser, isolateState } from './helpers/installed-user.mjs';
const config={mode:'private-anvil',chainId:31337,source:'controlled test',rpcUrl:'http://127.0.0.1:8547',settlementUrl:'http://127.0.0.1:6572',marketBundleMetadataUrl:'http://127.0.0.1:6583/skills/bundles/test/metadata',module:'0x'+'1'.repeat(40),token:'0x'+'2'.repeat(40),factory:'0x'+'3'.repeat(40),registry:'0x'+'4'.repeat(40),tokenDecimals:6,tokenSymbol:'rUSDC',bundleSha256:'a'.repeat(64),maxUsageUnits:1};
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'user-install-')); isolateState(t,root);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const userDir=await installedUser(root),dataDir=join(root,'private'),calls=[];
 return {root,userDir,dataDir,calls,options:{userDir,dataDir,market:'http://localhost:6470',write:()=>{},run:async(cmd,args)=>calls.push([cmd,...args]),fetchImpl:async()=>new Response(JSON.stringify(config))}};
}
test('source install retries failed dependencies, keeps private data and saves configuration outside program files',async t=>{
 const f=await fixture(t); let fail=true;
 f.options.run=async(cmd,args)=>{f.calls.push([cmd,...args]);if(fail)throw Error('controlled installation interruption');};
 await assert.rejects(runInstall(f.options),/interruption/);fail=false;
 await runInstall(f.options);
 await mkdir(join(f.dataDir,'wallet'),{mode:0o700});
 const key=join(f.dataDir,'wallet/session.keystore.json');await writeFile(key,'retained encrypted key',{mode:0o600});
 const before=f.calls.length;await runInstall(f.options);assert.equal(f.calls.length,before);
 assert.deepEqual(f.calls,[['npm','ci'],['npm','ci']]);
 assert.equal(await readFile(key,'utf8'),'retained encrypted key');
 assert.deepEqual(JSON.parse(await readFile(join(f.dataDir,'user-deployment.json'))),config);
 assert.equal((await stat(join(f.dataDir,'user-deployment.json'))).mode&0o777,0o600);
 f.options.fetchImpl=async()=>{throw Error('network failure');};
 await assert.rejects(runInstall(f.options),/Cannot download/);
 assert.deepEqual(JSON.parse(await readFile(join(f.dataDir,'user-deployment.json'))),config);
});
test('installed package preparation requires no compiler or package-manager write and never fetches deployment',async t=>{
 const f=await fixture(t);await rm(join(f.userDir,'package-lock.json'));
 await runInstall({...f.options,prepareOnly:true,fetchImpl:async()=>{throw Error('unexpected network');}});
 assert.deepEqual(f.calls,[]);
 assert.equal(JSON.parse(await readFile(join(installationDirectory(),'state.json'))).dataDir,f.dataDir);
});
test('installer lock covers the service handoff and is released after failure',async t=>{
 const f=await fixture(t);const lock=join(installationDirectory(),'install.lock');
 await assert.rejects(runInstall({...f.options,prepareOnly:true,beforePrepare:async()=>{
   await stat(lock);
   await assert.rejects(runInstall({...f.options,prepareOnly:true}),/Another installation/);
 },afterPrepare:async()=>{await stat(lock);throw Error('restart failed');}}),/restart failed/);
 await assert.rejects(stat(lock),{code:'ENOENT'});
});
test('unsafe private data stops before installation commands',async t=>{
 const f=await fixture(t);
 await assert.rejects(runInstall({...f.options,dataDir:join(f.userDir,'secrets')}),/outside/);
 assert.deepEqual(f.calls,[]);
});
test('Market settings use an explicit public HTTPS or loopback origin',()=>{
 assert.equal(marketSettingsUrl('https://example.test'), 'https://example.test/market/web/onboarding/user-config');
 for(const url of ['http://example.test','https://user:pass@example.test','https://example.test/path'])assert.throws(()=>marketSettingsUrl(url));
});
