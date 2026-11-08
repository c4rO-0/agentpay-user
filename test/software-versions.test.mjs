// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRunningSoftware,requireRunningSoftware} from '../src/software-versions.mjs';
test('only the exact expected package and interface pair is confirmed; old/missing versions keep diagnostic access',()=>{
 const expected={userVersion:'0.3.1',walletVersion:'0.3.1',protocolVersion:'0.14.3'};
 const descriptor=name=>({software:{name,version:'0.3.1',interfaceVersion:1,protocolVersion:'0.14.3'}});
 const w=descriptor('@c4roa0/agentpay-wallet'),r=descriptor('@c4roa0/agentpay-user');
 assert(requireRunningSoftware(w,r,expected).every(x=>x.state==='matched'));
 for(const change of [{version:'0.3.0'},{interfaceVersion:2},{protocolVersion:'0.14.2'},{name:'other'}])
  assert.throws(()=>requireRunningSoftware({software:{...w.software,...change}},r,expected),{code:'RUNNING_VERSION_UNVERIFIED'});
 assert.equal(assessRunningSoftware({},r,expected)[0].state,'unreported');
 assert.throws(()=>requireRunningSoftware({},r,expected),{code:'RUNNING_VERSION_UNVERIFIED'});
});
