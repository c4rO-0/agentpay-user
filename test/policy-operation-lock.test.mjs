// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, symlink, link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {acquirePolicyOperation} from '../src/policy-operation-lock.mjs';
const moduleUrl = new URL('../src/policy-operation-lock.mjs', import.meta.url).href;

test('live process excludes competitors; forced exit releases ownership without deleting records or lock', {timeout:15000}, async t => {
  const dir = await mkdtemp(join(tmpdir(),'policy-process-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const child = spawn(process.execPath, ['--input-type=module','-e', `
    import {acquirePolicyOperation} from ${JSON.stringify(moduleUrl)};
    import {spawn} from 'node:child_process';
    const release = await acquirePolicyOperation(process.argv[1]);
    process.on("exit", () => { void release; });
    const helper = spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'ignore'});
    helper.unref();
    process.send({state:'locked', helper:helper.pid});
    setInterval(()=>{},1000);
  `, dir], {stdio:['ignore','pipe','pipe','ipc']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const [message] = await once(child,'message');
  assert.equal(message.state, 'locked');
  t.after(()=>{try { process.kill(message.helper, 'SIGKILL'); } catch (e) { if(e.code!=='ESRCH')throw e; }});
  await writeFile(join(dir,'runtime','policy-renewal-guide.json'), '{"policyId":"original"}', {mode:0o600});
  await assert.rejects(acquirePolicyOperation(dir), {code:'POLICY_OPERATION_BUSY'});
  const closed = once(child,'close');
  child.kill('SIGKILL'); await closed;
  // A surviving browser/service-like child must not retain the authorization lock.
  process.kill(message.helper, 0);
  const release = await acquirePolicyOperation(dir);
  try {
    assert.equal(await readFile(join(dir,'runtime','policy-renewal-guide.json'),'utf8'), '{"policyId":"original"}');
    await assert.rejects(acquirePolicyOperation(dir), {code:'POLICY_OPERATION_BUSY'});
  } finally { await release(); }
  const again = await acquirePolicyOperation(dir); await again();
});

test('linked lock files are rejected without touching their targets', {skip:process.platform==='win32'}, async t => {
  const dir = await mkdtemp(join(tmpdir(),'policy-links-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const release = await acquirePolicyOperation(dir); await release();
  const path=join(dir,'runtime','policy-operation.lock'), target=join(dir,'target');
  await writeFile(target,'unchanged',{mode:0o600});
  for (const create of [symlink,link]) {
    await rm(path); await create(target,path);
    await assert.rejects(acquirePolicyOperation(dir));
    assert.equal(await readFile(target,'utf8'),'unchanged');
  }
});

// Exercise public advanced script entries while a normal authorization owns the
// directory. Refusal must happen before config/Wallet reads or chain submission.
test('advanced authorization and migration entries respect active authorization', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-advanced-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const release = await acquirePolicyOperation(dir);
  try {
    for (const [script, command, argument] of [
      ['authorize-existing-safe.mjs', 'authorize', 'missing.json'],
      ['authorize-existing-safe.mjs', 'bind', 'missing.json'],
      ['migrate-safe-policy.mjs', 'prepare', 'missing.json'],
      ['migrate-safe-policy.mjs', 'refresh', null],
      ['migrate-safe-policy.mjs', 'authorize-test', 'unused-owner'],
      ['migrate-safe-policy.mjs', 'complete', 'unused-id'],
      ['migrate-safe-policy.mjs', 'cancel', 'unused-id'],
    ]) {
      const child = spawn(process.execPath, [new URL('../scripts/' + script, import.meta.url).pathname, command, dir, ...(argument ? [argument] : [])]);
      let output = '';
      child.stderr.on('data', chunk => { output += chunk; });
      const [code] = await once(child, 'close');
      assert.notEqual(code, 0);
      assert.match(output, /POLICY_OPERATION_BUSY/);
      assert.doesNotMatch(output, /ENOENT/);
    }
  } finally { await release(); }
});
