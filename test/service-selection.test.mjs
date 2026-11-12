// SPDX-License-Identifier: MPL-2.0
// Real private storage and native locks; systemctl is a controlled external fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {autostartFiles} from '../src/autostart-files.mjs';
import {withServiceSelection} from '../src/service-selection.mjs';
import {saveServiceSettings} from '../src/local-services.mjs';
import {isolateState} from './helpers/installed-user.mjs';
import {acquireRuntimeOwner} from '../src/runtime-owner.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'service-switch-')); isolateState(t,root);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const unitDir=join(root,'units'),dataDir=join(root,'old-data'); await mkdir(unitDir);
 await mkdir(dataDir,{mode:0o700}); await mkdir(join(dataDir,"runtime"),{mode:0o700}); await mkdir(join(dataDir,"wallet"),{mode:0o700});
 await saveServiceSettings({dataDir,runtimeUrl:'http://127.0.0.1:49179',settlementUrl:'https://platform.example/settlement'});
 const old={node:process.execPath,userDir:join(root,'old'),dataDir};
 for(const [name,body] of Object.entries(autostartFiles(old)))await writeFile(join(unitDir,name),body,{mode:0o600});
 return {root,unitDir,old,verifyReady:async()=>{},target:{...old,userDir:join(root,'new'),dataDir:join(root,'new-data')}};
}
test('cancelled switch never invokes service management or replaces startup files',async t=>{
 const f=await fixture(t);const before=await readFile(join(f.unitDir,'agentpay-local-runtime.service'),'utf8');
 const result=await withServiceSelection({...f,action:'start',write:()=>{},ask:async()=> 'q',ctl:()=>{throw Error('unexpected');},operation:()=>{throw Error('unexpected');}});
 assert.equal(result.cancelled,true);assert.equal(await readFile(join(f.unitDir,'agentpay-local-runtime.service'),'utf8'),before);
});
test('confirmed switch verifies all stopped states before allowing replacement',async t=>{
 const f=await fixture(t),calls=[];
 await withServiceSelection({...f,action:'start',write:()=>{},ask:async()=> 'confirm',ctl:async (...args)=>{calls.push(args[0]);return {stdout:'inactive\n'};},operation:async ({switched})=>{assert.equal(switched,true);calls.push('replace');}});
 assert.deepEqual(calls,['show','show','stop','show','show','show','replace']);
});
test('failed or incomplete stop never starts the selected installation',async t=>{
 const f=await fixture(t);
 await assert.rejects(withServiceSelection({...f,action:'start',write:()=>{},ask:async()=> 'confirm',ctl:async()=>({stdout:'deactivating\n'}),operation:()=>{throw Error('must not start');}}),/not stopped/);
 await assert.rejects(withServiceSelection({...f,action:'disable',write:()=>{},operation:()=>{throw Error('must not change');}}),/switch is unfinished/);
});
test('Runtime ownership excludes another Runtime and becomes available after close',async t=>{
 await fixture(t);const first=await acquireRuntimeOwner();
 try {await assert.rejects(acquireRuntimeOwner(),/Another AgentPay Runtime/);} finally {await first.close();}
 const next=await acquireRuntimeOwner();await next.close();
});

test('a separate process cannot claim Runtime ownership until the holder exits',async t=>{
  const f=await fixture(t);
  const {spawn}=await import('node:child_process');
  const {once}=await import('node:events');
  const moduleUrl=new URL('../src/runtime-owner.mjs',import.meta.url).href;
  const entry=`const {acquireRuntimeOwner}=await import(${JSON.stringify(moduleUrl)}); const lock=await acquireRuntimeOwner(); console.log('ready'); setInterval(()=>{void lock},1000);`;
  const start=()=>spawn(process.execPath,['--input-type=module','-e',entry],{env:process.env,stdio:['ignore','pipe','pipe']});
  const first=start();t.after(()=>first.kill('SIGKILL'));
  await once(first.stdout,'data');
  const contender=start();let error=''; contender.stderr.on('data',chunk=>{error+=chunk});
  const [code]=await once(contender,'exit');assert.notEqual(code,0);assert.match(error,/Another AgentPay Runtime/);
  const ended=once(first,'exit');first.kill('SIGKILL');await ended;
  const next=start();t.after(()=>next.kill('SIGKILL'));await once(next.stdout,'data');
  const finished=once(next,'exit');next.kill('SIGTERM');await finished;
});

test('public noninteractive start refuses switching without touching existing units',async t=>{
 const f=await fixture(t);
 const home=join(f.root,'home'), unitDir=join(home,'.config/systemd/user');
 await mkdir(unitDir,{recursive:true,mode:0o700});
 for(const [name,body] of Object.entries(autostartFiles(f.old)))await writeFile(join(unitDir,name),body,{mode:0o600});
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const script=new URL('../scripts/autostart.mjs',import.meta.url);
 await assert.rejects(promisify(execFile)(process.execPath,[script.pathname,'start'],{
   env:{...process.env,HOME:home,AGENTPAY_USER_DATA_DIR:f.target.dataDir}
 }),error=>error.code===2 && /Switch cancelled/.test(error.stdout));
 assert.equal(await readFile(join(unitDir,'agentpay-local-runtime.service'),'utf8'),autostartFiles(f.old)['agentpay-local-runtime.service']);
});

test('interrupted unit replacement can retry only the recorded target',async t=>{
 const f=await fixture(t);
 const state=(await import('../src/installation-paths.mjs')).installationDirectory();
 await mkdir(state,{recursive:true,mode:0o700});
 await writeFile(join(state,'active-services.json'),JSON.stringify({version:1,phase:'preparing',previous:f.old,target:f.target}),{mode:0o600});
 await writeFile(join(f.unitDir,'agentpay-local-wallet.service'),autostartFiles(f.target)['agentpay-local-wallet.service']);
 let resumed=false;
 await withServiceSelection({...f,target:{...f.target,node:'/new-node/bin/node'},action:'start',ask:async()=> 'confirm',write:()=>{},ctl:async()=>({stdout:'inactive\n'}),operation:async()=>{resumed=true;}});
 assert.equal(resumed,true);
});

test('disabling login startup updates the shared preference used by later setup',async t=>{
 const f=await fixture(t);
 await withServiceSelection({...f,target:f.old,action:'disable',write:()=>{},operation:async()=>{}});
 const state=(await import('../src/installation-paths.mjs')).installationDirectory();
 const saved=JSON.parse(await readFile(join(state,'active-services.json'),'utf8'));
 assert.equal(saved.startupChoice,'disabled');
});

test('trailing program-directory separators do not turn maintenance into a switch',async t=>{
 const root=await mkdtemp(join(tmpdir(),'selection-canonical-'));isolateState(t,root);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const userDir=join(root,'user'),dataDir=join(root,'data'),unitDir=join(root,'units');
 for(const path of [userDir,dataDir,unitDir])await mkdir(path,{mode:0o700});
 const target={userDir,dataDir,node:process.execPath};
 for(const [name,body] of Object.entries(autostartFiles(target)))await writeFile(join(unitDir,name),body,{mode:0o600});
 let ran=false;
 await withServiceSelection({target:{...target,userDir:userDir+'/'},action:'stop',unitDir,
  ask:async()=>{throw Error('Same installation must not ask to switch');},ctl:async()=>{throw Error('Unexpected switch stop');},
  operation:async()=>{ran=true;}});
 assert.equal(ran,true);
});

test('unreadable legacy history does not strand a confirmed switch or permit automatic replacement',async t=>{
 const f=await fixture(t);await writeFile(join(f.old.dataDir,'runtime/invocations.json'),'invalid old document',{mode:0o600});
 let started=false;
 await withServiceSelection({...f,action:'start',ask:async()=> 'confirm',write:()=>{},
  ctl:async()=>({stdout:'inactive\n'}),operation:async()=>{started=true;}});
 assert.equal(started,true);
 const {claimDefaultRequest}=await import('../src/default-request-owner.mjs');
 await assert.rejects(claimDefaultRequest({dataDir:f.target.dataDir,service:{skillId:'service',profileHash:'profile'},input:{request:{text:'do not replace'}}}),{code:'REQUEST_HISTORY_REVIEW_REQUIRED'});
 assert.equal(await readFile(join(f.old.dataDir,'runtime/invocations.json'),'utf8'),'invalid old document');
});

test('confirmed shared-data switch relocates only the client and retries after interrupted unit work',async t=>{
 const f=await fixture(t);
 const target={...f.old,userDir:new URL('../',import.meta.url).pathname.replace(/\/$/,'')};
 const connectionPath=join(f.old.dataDir,'runtime/connection.json');
 const connection={version:'agentpay.runtime-connection.v1',runtimeUrl:'http://127.0.0.1:49179/',callerTokenFile:join(f.old.dataDir,'runtime/caller.token'),clientModule:join(f.old.userDir,'src/runtime-client.mjs')};
 await writeFile(connectionPath,JSON.stringify(connection),{mode:0o600});
 const protectedPath=join(f.old.dataDir,'wallet/policy.json');
 await writeFile(protectedPath,'original authorization',{mode:0o600});
 const options={target,verifyReady:f.verifyReady,unitDir:f.unitDir,action:'start',write:()=>{},ctl:async()=>({stdout:'inactive\n'})};
 await withServiceSelection({...options,ask:async()=> 'q',operation:()=>{throw Error('must not start');}});
 assert.deepEqual(JSON.parse(await readFile(connectionPath,'utf8')),connection);
 await assert.rejects(withServiceSelection({...options,ask:async()=> 'confirm',operation:()=>{throw Error('interrupted unit preparation');}}),/interrupted unit preparation/);
 const relocated={...connection,clientModule:new URL('../src/runtime-client.mjs',import.meta.url).pathname};
 assert.deepEqual(JSON.parse(await readFile(connectionPath,'utf8')),relocated);
 const {ensureLocalServices}=await import('../src/prepare-local-services.mjs');
 let started=false;
 await withServiceSelection({...options,ask:async()=> 'confirm',operation:async()=>{
  await ensureLocalServices({dataDir:target.dataDir,write:()=>{}});started=true;
 }});
 assert.equal(started,true);
 assert.equal(await readFile(protectedPath,'utf8'),'original authorization');
 assert.deepEqual(JSON.parse(await readFile(connectionPath,'utf8')),relocated);
});

test('shared-data switch refuses an unrelated saved client path',async t=>{
 const f=await fixture(t);
 const target={...f.old,userDir:new URL('../',import.meta.url).pathname.replace(/\/$/,'')};
 const path=join(f.old.dataDir,'runtime/connection.json');
 const original=JSON.stringify({version:'agentpay.runtime-connection.v1',runtimeUrl:'http://127.0.0.1:49179/',callerTokenFile:join(f.old.dataDir,'runtime/caller.token'),clientModule:join(f.root,'unrelated/src/runtime-client.mjs')});
 await writeFile(path,original,{mode:0o600});
 await assert.rejects(withServiceSelection({target,unitDir:f.unitDir,action:'start',ask:async()=> 'confirm',write:()=>{},ctl:async()=>({stdout:'inactive\n'}),operation:()=>{throw Error('must not start');}}),/conflicts with local service settings/);
 assert.equal(await readFile(path,'utf8'),original);
});

test('startup preferences and preparation preserve availability; removal closes it',async t=>{
 const f=await fixture(t),state=(await import('../src/installation-paths.mjs')).installationDirectory();
 await mkdir(state,{recursive:true,mode:0o700});
 const path=join(state,'active-services.json');
 for(const phase of ['stopped','selected'])for(const action of ['enable','disable','prepare','prepare-repair','activate-setup','remove']){
  await writeFile(path,JSON.stringify({version:1,phase,target:f.old}),{mode:0o600});
  await withServiceSelection({...f,target:f.old,action,write:()=>{},operation:async()=>{}});
  assert.equal(JSON.parse(await readFile(path,'utf8')).phase,action==='remove'?'stopped':phase);
 }
});

test('default remains closed until readiness succeeds; failed readiness permits repair and retry',async t=>{
 const f=await fixture(t),state=(await import('../src/installation-paths.mjs')).installationDirectory();
 const path=join(state,'active-services.json');
 const {maintenanceServiceScope}=await import('../src/service-selection.mjs');
 const start={...f,target:f.old,action:'start',write:()=>{},operation:async()=>{}};
 await assert.rejects(withServiceSelection({...start,verifyReady:async()=>{
  assert.notEqual(JSON.parse(await readFile(path,'utf8')).phase,'selected');
  throw Error('not ready');
 }}),/not ready/);
 assert.equal(JSON.parse(await readFile(path,'utf8')).phase,'stopped');
 assert.equal((await maintenanceServiceScope({...f.old,unitDir:f.unitDir})).active,true);
 await withServiceSelection({...start,verifyReady:async()=>{
  assert.notEqual(JSON.parse(await readFile(path,'utf8')).phase,'selected');
 }});
 assert.equal(JSON.parse(await readFile(path,'utf8')).phase,'selected');
});

test('public stop retries after manager failure; failed public start permits repair',async t=>{
 const f=await fixture(t);
 const {execFile}=await import('node:child_process');
 const {promisify}=await import('node:util');
 const {chmod}=await import('node:fs/promises');
 const unitDir=join(process.env.HOME,'.config/systemd/user'),bin=join(f.root,'bin');
 await mkdir(unitDir,{recursive:true,mode:0o700});await mkdir(bin,{mode:0o700});
 const target={node:process.execPath,userDir:new URL('../',import.meta.url).pathname.replace(/\/$/,''),dataDir:f.old.dataDir};
 for(const [name,body]of Object.entries(autostartFiles(target)))await writeFile(join(unitDir,name),body,{mode:0o600});
 const systemctl=join(bin,'systemctl');
 await writeFile(systemctl,'#!/bin/sh\nif [ "$2" = "$FAIL_SERVICE" ]; then exit 1; fi\nexit 0\n');await chmod(systemctl,0o700);
 const run=(action,failure)=>promisify(execFile)(process.execPath,[new URL('../scripts/autostart.mjs',import.meta.url).pathname,action],{
  env:{...process.env,PATH:bin+':'+process.env.PATH,AGENTPAY_USER_DATA_DIR:target.dataDir,FAIL_SERVICE:failure || ''}
 });
 await assert.rejects(run('stop','stop'));
 await run('stop');
 await assert.rejects(run('start','start'));
 const {maintenanceServiceScope}=await import('../src/service-selection.mjs');
 assert.equal((await maintenanceServiceScope({...target,unitDir})).active,true);
 await run('stop');
});

test('older incomplete journal with exact target units permits stop and maintenance',async t=>{
 const f=await fixture(t),state=(await import('../src/installation-paths.mjs')).installationDirectory();
 await mkdir(state,{recursive:true,mode:0o700});const path=join(state,'active-services.json');
 await writeFile(path,JSON.stringify({version:1,phase:'preparing',previous:f.old,target:f.old}),{mode:0o600});
 const {maintenanceServiceScope}=await import('../src/service-selection.mjs');
 assert.equal((await maintenanceServiceScope({...f.old,unitDir:f.unitDir})).active,true);
 let stopped=false;
 await withServiceSelection({...f,target:f.old,action:'stop',write:()=>{},operation:async()=>{stopped=true;}});
 assert.equal(stopped,true);assert.equal(JSON.parse(await readFile(path,'utf8')).phase,'stopped');
});
