// SPDX-License-Identifier: MPL-2.0
// Real local transports/private credentials, controlled Wallet and Runtime replies.
// This checks readiness admission, not actual daemon or financial acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer as httpServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {once} from 'node:events';
import {saveServiceSettings} from '../src/local-services.mjs';
import {waitForServiceReadiness} from '../src/service-readiness.mjs';

test('readiness requires both authenticated matching services; locked Wallet is sufficient',async t=>{
 const dataDir=await mkdtemp('/tmp/service-readiness-');
 t.after(()=>rm(dataDir,{recursive:true,force:true}));
 for(const dir of ['wallet','runtime'])await mkdir(join(dataDir,dir),{mode:0o700});
 const token='a'.repeat(64),admin='b'.repeat(64);
 await writeFile(join(dataDir,'runtime/caller.token'),token,{mode:0o600});
 await writeFile(join(dataDir,'wallet/admin.token'),admin,{mode:0o600});
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
 const software=(name,version)=>({name,version,interfaceVersion:1,protocolVersion:manifest.dependencies['@c4roa0/agentpay-protocol']});
 let denied=false,badVersion=false,walletCalls=0,runtimeCalls=0;
 const wallet=socketServer(socket=>{socket.once('data',data=>{
  const request=JSON.parse(data);walletCalls++;
  assert.equal(request.token,admin);assert.equal(request.method,'status');
  socket.end(JSON.stringify({ok:true,result:{locked:true,software:software('@c4roa0/agentpay-wallet',manifest.dependencies['@c4roa0/agentpay-wallet'])}}));
 });});
 wallet.listen(join(dataDir,'wallet/wallet.sock'));await once(wallet,'listening');
 t.after(()=>new Promise(resolve=>wallet.close(resolve)));
 const runtime=httpServer((req,res)=>{
  runtimeCalls++;assert.equal(req.headers.authorization,'Bearer '+token);assert.equal(req.url,'/status');
  if(denied){res.writeHead(401);res.end();return;}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({ok:true,result:{role:'user-runtime',inventory:'checking',orders:{},software:software('@c4roa0/agentpay-user',badVersion?'0.0.0':manifest.version)}}));
 });
 runtime.listen(0,'127.0.0.1');await once(runtime,'listening');
 t.after(()=>new Promise(resolve=>runtime.close(resolve)));
 await saveServiceSettings({dataDir,runtimeUrl:`http://127.0.0.1:${runtime.address().port}`,settlementUrl:'https://example.test'});
 await waitForServiceReadiness(dataDir,{timeoutMs:0});
 assert.equal(walletCalls,1);assert.equal(runtimeCalls,1);
 denied=true;
 await assert.rejects(waitForServiceReadiness(dataDir,{timeoutMs:0}),/Default Skill access stays paused/);
 denied=false;badVersion=true;
 await assert.rejects(waitForServiceReadiness(dataDir,{timeoutMs:0}),{code:'RUNNING_VERSION_UNVERIFIED'});
});
