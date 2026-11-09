// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {preparePlatformEndpoints} from '../src/platform-endpoints.mjs';
import {sameSettlementAddress} from '../src/settlement-address-history.mjs';
import {cancelOrder} from '../src/order-cancellation.mjs';
const address=n=>'0x'+String(n).repeat(40),policyId='0x'+'a'.repeat(64);
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'platform-addresses-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const dataDir=join(dir,'data'),userDir=join(dir,'user'),stateDir=join(dir,'state');
 for(const p of [dataDir,join(dataDir,'runtime'),join(dataDir,'wallet'),userDir])await mkdir(p,{mode:0o700});
 const save=async(path,value)=>writeFile(join(dataDir,path),JSON.stringify(value),{mode:0o600});
 const before={mode:'private-anvil',chainId:31337,source:'test',rpcUrl:'http://127.0.0.1:8547',settlementUrl:'http://127.0.0.1:6572',marketBundleMetadataUrl:'http://127.0.0.1:6583/skills/bundles/test/metadata',module:address(1),token:address(2),factory:address(3),registry:address(4),tokenDecimals:6,tokenSymbol:'TEST',bundleSha256:'a'.repeat(64),maxUsageUnits:1};
 const proposed={...before,settlementUrl:'https://market.test/settlement',marketBundleMetadataUrl:'https://market.test/skills/bundles/test/metadata'};
 const policy={...before,policyId,safe:address(5),delegate:address(6)};
 const scope={network:'eip155:31337',module:policy.module,safe:policy.safe,delegate:policy.delegate,policyId};
 const settings={version:1,runtimeUrl:'http://127.0.0.1:6490',settlementUrl:before.settlementUrl,startupChoice:'disabled'};
 await save('wallet/policy.json',policy);await save('wallet/session.keystore.json',{privateFixture:true});
 await save('anvil-onboarding.json',{...before,safe:policy.safe,runtimeUrl:settings.runtimeUrl});await save('user-deployment.json',before);await save('runtime/local-services.json',settings);
 await save('runtime/invocations.json',{privateRequestFixture:true});await save('runtime/cache-test.json',{privateResultFixture:true});
 const calls=[];
 const fetchJson=async(url,opts)=>{
  assert.equal(opts.method,'GET');assert.equal(opts.headers,undefined);calls.push(url);
  let result;
  if(url.endsWith('/user-config'))result=proposed;
  else if(url.includes('/purchase-readiness?'))result={ok:true,result:{commercialReady:false,blockers:['NEW_ORDERS_PAUSED'],settlementProfile:{chainId:31337,network:'eip155:31337',assetAddress:before.token,factoryAddress:before.factory,registryAddress:before.registry}}};
  else if(url.endsWith('/metadata'))result={ok:true,result:{sha256:'a'.repeat(64)}};
  else throw Error('Unexpected URL '+url);
  return {response:{ok:true},result};
 };
 const options={dataDir,userDir,origin:'https://market.test',scope,fetchJson,changingOrigin:true};
 return {dataDir,stateDir,save,before,proposed,policy,settings,options,calls,read:async p=>JSON.parse(await readFile(join(dataDir,p),'utf8'))};
}
test('confirmed address update retains identity/history and retries the same cancellation at the new address',async t=>{
 const f=await fixture(t),files=['wallet/policy.json','wallet/session.keystore.json','runtime/invocations.json','runtime/cache-test.json'];
 const original=await Promise.all(files.map(p=>readFile(join(f.dataDir,p),'utf8')));
 const cancellations=[],orderId='0x'+'b'.repeat(64);
 const walletCall=async(method,params)=>{if(method==='status')return {bound:true,policyId};assert.equal(method,'cancelSettlementOrder');cancellations.push(params);throw Error('Response lost');};
 await assert.rejects(cancelOrder({dataDir:f.dataDir,orderId,settlementUrl:f.before.settlementUrl},{walletCall}),/Response lost/);
 const plan=await preparePlatformEndpoints(f.options);assert.equal(plan.changed,true);
 assert.deepEqual(await f.read('runtime/local-services.json'),f.settings,'planning does not mutate settings');
 const lifecycle=[];
 await plan.apply({stateDir:f.stateDir,write:()=>{},manage:async action=>lifecycle.push(action)});
 assert.deepEqual(lifecycle,['stop','start']);
 assert.equal((await f.read('runtime/local-services.json')).settlementUrl,f.proposed.settlementUrl);
 assert.equal((await f.read('runtime/local-services.json')).startupChoice,'disabled');
 assert.equal((await f.read('anvil-onboarding.json')).rpcUrl,f.before.rpcUrl);
 assert.deepEqual(await Promise.all(files.map(p=>readFile(join(f.dataDir,p),'utf8'))),original);
 await assert.rejects(cancelOrder({dataDir:f.dataDir,orderId,settlementUrl:f.proposed.settlementUrl},{walletCall}),/Response lost/);
 assert.equal(cancellations[0].cancellationId,cancellations[1].cancellationId);
 assert.equal(cancellations[1].settlementUrl,f.proposed.settlementUrl);
 assert.equal(await sameSettlementAddress(f.dataDir,f.before.settlementUrl,f.proposed.settlementUrl,'0x'+'c'.repeat(64)),false);
 assert.equal((await preparePlatformEndpoints({...f.options,changingOrigin:false})).changed,false);
});
test('contract mismatch, unavailable destination and concurrent local changes never stop Runtime or replace settings',async t=>{
 const f=await fixture(t);f.proposed.factory=address(7);
 await assert.rejects(preparePlatformEndpoints(f.options),/different network or contract/);f.proposed.factory=f.before.factory;
 await assert.rejects(preparePlatformEndpoints({...f.options,fetchJson:async()=>{throw Error('offline');}}),/offline/);
 const plan=await preparePlatformEndpoints(f.options);await f.save('wallet/policy.json',{...f.policy,policyId:'0x'+'d'.repeat(64)});
 await assert.rejects(plan.apply({stateDir:f.stateDir,write:()=>{},manage:async()=>assert.fail('must not stop')}),/Local settings changed/);
 assert.deepEqual(await f.read('runtime/local-services.json'),f.settings);
});
test('failed restart retains a retry marker and completes on the same command without changing identity',async t=>{
 const f=await fixture(t),plan=await preparePlatformEndpoints(f.options);
 await assert.rejects(plan.apply({stateDir:f.stateDir,write:()=>{},manage:async action=>{if(action==='start')throw Error('startup failed');}}),/Address update did not finish/);
 assert.equal((await f.read('runtime/endpoint-update.pending.json')).origin,'https://market.test');
 await assert.rejects(preparePlatformEndpoints({...f.options,origin:'https://other.test'}),/pending address update/);
 const resume=await preparePlatformEndpoints({...f.options,changingOrigin:false});assert.equal(resume.changed,true);
 await resume.apply({stateDir:f.stateDir,write:()=>{},manage:async()=>{}});
 await assert.rejects(f.read('runtime/endpoint-update.pending.json'),{code:'ENOENT'});
 assert.equal((await f.read('wallet/policy.json')).policyId,policyId);
});
