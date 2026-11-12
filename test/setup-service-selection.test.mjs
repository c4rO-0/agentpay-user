// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {activateSetup} from '../src/setup-service-selection.mjs';
test('manual setup remains available without systemd, but cannot bypass existing managed files',async()=>{
 const options={platform:'linux',available:async()=>{throw Error('no bus');},write:()=>{},launch:()=>{throw Error('must not launch');}};
 assert.equal(await activateSetup({...options,inspect:async()=>null}),0);
 await assert.rejects(activateSetup({...options,inspect:async()=>({dataDir:'/old'})}),/unavailable/);
});
