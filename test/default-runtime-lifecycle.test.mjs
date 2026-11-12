// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isolateState} from './helpers/installed-user.mjs';
import {claimDefaultRequest} from '../src/default-request-owner.mjs';
import {publishRuntimeReady} from '../src/runtime-selection-ready.mjs';
import {installationDirectory} from '../src/installation-paths.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'default-runtime-'));isolateState(t,root);t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('another installation cannot replace an existing default purchase intent without explicit force',async t=>{
 await fixture(t);const input={request:{text:'same input'}},service={skillId:'service',profileHash:'profile'};
 await claimDefaultRequest({service,input,dataDir:'/original'});
 await assert.rejects(claimDefaultRequest({service,input,dataDir:'/other'}),/another local Wallet/);
 await claimDefaultRequest({service,input,dataDir:'/original'});
 await claimDefaultRequest({service,input,dataDir:'/other',force:true});
});
test('login bind revives the selected stopped Runtime but cannot take over a transition',async t=>{
 await fixture(t);const state=installationDirectory();await mkdir(state,{recursive:true,mode:0o700});const path=join(state,'active-services.json');
 for(const phase of ['stopped','preparing']){
  await writeFile(path,JSON.stringify({version:1,phase,target:{dataDir:'/chosen',userDir:new URL('../',import.meta.url).pathname.replace(/\/$/,'')}}),{mode:0o600});
  await publishRuntimeReady('/other',{verifyReady:async()=>{}});assert.equal(JSON.parse(await readFile(path)).phase,phase);
  await publishRuntimeReady('/chosen',{verifyReady:async()=>{}});assert.equal(JSON.parse(await readFile(path)).phase,phase==='stopped'?'selected':'preparing');
 }
});

test('unclassified Runtime-only history prevents automatic purchases in another installation',async t=>{
 const root=await fixture(t),dataDir=join(root,'old');
 await mkdir(join(dataDir,'runtime'),{recursive:true,mode:0o700});
 const {importHistoricalRequests}=await import('../src/default-request-owner.mjs');
 const history={version:'agentpay.user-invocations.v1',invocations:{['0x'+'a'.repeat(64)]:{invocationId:'0x'+'a'.repeat(64),requestHash:'0x'+'b'.repeat(64)}}};
 const path=join(dataDir,'runtime/invocations.json'),original=JSON.stringify(history);
 await writeFile(path,original,{mode:0o600});
 assert.equal((await importHistoricalRequests(dataDir)).unclassified,true);
 await assert.rejects(claimDefaultRequest({service:{skillId:'service',profileHash:'profile'},input:{request:{text:'unknown'}},dataDir:join(root,'new')}),{code:'REQUEST_HISTORY_REVIEW_REQUIRED'});
 assert.equal(await readFile(path,'utf8'),original);
});

test('login startup cannot publish when Wallet is unavailable or another program owns the data',async t=>{
 await fixture(t);const state=installationDirectory();await mkdir(state,{recursive:true,mode:0o700});
 const path=join(state,'active-services.json');
 const original=JSON.stringify({version:1,phase:'stopped',target:{dataDir:'/chosen',userDir:new URL('../',import.meta.url).pathname.replace(/\/$/,'')}});
 await writeFile(path,original,{mode:0o600});
 await assert.rejects(publishRuntimeReady('/chosen',{verifyReady:async()=>{throw Error('Wallet unavailable');}}),/Wallet unavailable/);
 assert.equal(await readFile(path,'utf8'),original);
 const other=JSON.stringify({version:1,phase:'stopped',target:{dataDir:'/chosen',userDir:'/other-program'}});
 await writeFile(path,other,{mode:0o600});
 await publishRuntimeReady('/chosen',{verifyReady:async()=>{throw Error('must not probe');}});
 assert.equal(await readFile(path,'utf8'),other);
});
