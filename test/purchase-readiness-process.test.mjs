// SPDX-License-Identifier: MPL-2.0
// A real read-only command against a deliberately stalled RPC. The server stays
// open until the child exits; closing it early would hide a leaked HTTP request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Phase0Wallet} from '@c4roa0/agentpay-wallet/local';
const exec = promisify(execFile);
test('purchase readiness exits after RPC timeout without sending a transaction', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'purchase-readiness-'));
  t.after(() => rm(dir, {recursive:true,force:true}));
  await mkdir(join(dir, 'wallet'), {mode:0o700});
  await Phase0Wallet.initialize(join(dir, 'wallet'), 'disposable test password');
  const methods=[];
  const server=createServer(async(req,res)=>{
    if(req.method==='GET') {
      res.end(JSON.stringify({ok:true,result:{role:'user-runtime',capabilities:['agentpay.runtime-call.v1']}}));
      return;
    }
    let body=''; for await (const b of req) body+=b;
    methods.push(JSON.parse(body).method);
    // Intentionally no headers or response for this RPC read.
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const address=n=>'0x'+String(n).repeat(40);
  const config={chainId:31337,rpcUrl:origin,safe:address(1),module:address(2),token:address(3),factory:address(4),registry:address(5),policyId:'0x'+'a'.repeat(64),maxPerPayment:'1',totalBudget:'10',validAfter:1,validUntil:Math.floor(Date.now()/1000)+86400};
  const path=join(dir,'config.json');await writeFile(path,JSON.stringify(config),{mode:0o600});
  const {stdout}=await exec(process.execPath,[resolve('scripts/check-purchase-readiness.mjs'),dir,path,origin,origin,'1'],{timeout:40000});
  const result=JSON.parse(stdout);
  assert.equal(result.readyToPurchase,false);
  assert.ok(result.blockers.includes('CHAIN_POLICY_UNAVAILABLE'));
  assert.ok(result.diagnostics.some(d=>d.check==='CHAIN_POLICY_UNAVAILABLE' && d.code==='CHAIN_CHECK_TIMEOUT')); 
  assert.ok(methods.length>0);
  assert.ok(methods.every(m=>m==='eth_chainId'));
});
