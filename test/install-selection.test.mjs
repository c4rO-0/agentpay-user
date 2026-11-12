// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isolateState } from './helpers/installed-user.mjs';
import { selectInstallationData } from '../src/install-selection.mjs';
import { rememberInstallationBinding } from '../src/installation-binding.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'install-choice-'));
  isolateState(t,root);
  t.after(() => rm(root,{recursive:true,force:true}));
  const userDir = join(root,'program'), data = join(root,'data');
  await mkdir(userDir); await mkdir(data,{mode:0o700});
  await writeFile(join(data,'private-sentinel'),'original',{mode:0o600});
  return {root,userDir,data,env:{AGENTPAY_USER_DATA_DIR:data},write:()=>{}};
}
test('storage selection cancellation preserves existing bytes and creates no binding', async t => {
  const f = await fixture(t);
  assert.equal(await selectInstallationData({...f,ask:async()=> 'q'}),null);
  assert.equal(await readFile(join(f.data,'private-sentinel'),'utf8'),'original');
  assert.equal((await readdir(f.root)).length,2);
});
test('reuse retains original location without authorizing setup or service takeover', async t => {
  const f = await fixture(t);
  const selected = await selectInstallationData({...f,ask:async()=> 'reuse'});
  assert.equal(selected.dataDir,f.data);
  assert.equal(selected.requiresActivation,true);
  assert.equal(await readFile(join(f.data,'private-sentinel'),'utf8'),'original');
});
test('separate choice creates empty private storage and does not copy the Wallet', async t => {
  const f = await fixture(t);
  const selected = await selectInstallationData({...f,ask:async()=> 'new'});
  assert.notEqual(selected.dataDir,f.data);
  assert.deepEqual(await readdir(selected.dataDir),[]);
  assert.equal(selected.requiresActivation,true);
  assert.equal(await readFile(join(f.data,'private-sentinel'),'utf8'),'original');
});
test('bound installation keeps its own choice and rejects an environment retarget', async t => {
  const f = await fixture(t);
  await rememberInstallationBinding(f.userDir,f.data);
  assert.equal((await selectInstallationData({...f,ask:()=>{throw Error('must not ask');}})).dataDir,f.data);
  await assert.rejects(selectInstallationData({...f,env:{AGENTPAY_USER_DATA_DIR:f.root}}),/conflicting/);
});
