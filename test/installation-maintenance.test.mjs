// SPDX-License-Identifier: MPL-2.0
// Real child processes and disposable files; no systemd, registry or private data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {withInstallationOperation,runInstallationCommand} from '../src/installation-operation.mjs';
import {isolateState} from './helpers/installed-user.mjs';
const moduleUrl = new URL('../src/installation-operation.mjs',import.meta.url).href;
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'installation-writer-'));
  isolateState(t,root);t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}
function launch(source) {
  return spawn(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:['ignore','pipe','pipe']});
}
async function waitFile(path) {
  for(let i=0;i<200;i++) {try{return await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}await delay(20);}
  throw Error('Timed out waiting for the fixture writer.');
}
async function attempt() {
  const child=launch(`import {withInstallationOperation} from ${JSON.stringify(moduleUrl)};
    try {await withInstallationOperation(async()=>{});} catch(e) {process.stderr.write(e.message);process.exitCode=7;}`);
  let error='';child.stderr.on('data',chunk=>error+=chunk);
  const [code]=await once(child,'close');return {code,error};
}
test('killed caller retains exclusion until its writer child exits; retry recovers without deleting a lock',async t=>{
  const root=await fixture(t),ready=join(root,'ready'),finish=join(root,'finish'),done=join(root,'done');
  const childCode=`import {writeFile,access} from 'node:fs/promises';
    import {setTimeout as delay} from 'node:timers/promises';
    await writeFile(${JSON.stringify(ready)},String(process.pid));
    for(let i=0;i<1000;i++){try{await access(${JSON.stringify(finish)});break;}catch{} await delay(20);}
    await writeFile(${JSON.stringify(done)},'complete');`;
  const parent=launch(`import {withInstallationOperation,runInstallationCommand} from ${JSON.stringify(moduleUrl)};
    await withInstallationOperation(()=>runInstallationCommand(process.execPath,['--input-type=module','-e',${JSON.stringify(childCode)}]));`);
  t.after(async()=>{parent.kill('SIGKILL');await writeFile(finish,'finish').catch(()=>{});});
  await waitFile(ready);
  assert.equal((await attempt()).code,7);
  const closed=once(parent,'close');parent.kill('SIGKILL');
  // An orphan writer can retain stdout pipe descriptors; wait for parent exit,
  // not pipe closure, before checking that it still excludes other operations.
  if(parent.exitCode===null && parent.signalCode===null)await once(parent,'exit');
  const blocked=await attempt();assert.equal(blocked.code,7);assert.match(blocked.error,/Another AgentPay/);
  await writeFile(finish,'finish');await waitFile(done);await closed;
  assert.equal((await attempt()).code,0);
});
test('administration child can inherit the operation, while independent callers remain excluded',async t=>{
  await fixture(t);
  await withInstallationOperation(async()=>{
    const result=await runInstallationCommand(process.execPath,['--input-type=module','-e',
      `import {withInstallationOperation} from ${JSON.stringify(moduleUrl)};
       await withInstallationOperation(async()=>process.stdout.write('handoff complete'));`]);
    assert.equal(result.stdout,'handoff complete');
    assert.equal((await attempt()).code,7);
  });
  assert.equal((await attempt()).code,0);
});
test('timed-out writer exits before another operation can proceed',async t=>{
  await fixture(t);
  await assert.rejects(withInstallationOperation(()=>runInstallationCommand(process.execPath,
    ['-e','setInterval(()=>{},1000)'],{timeout:100})),/timed out/);
  assert.equal((await attempt()).code,0);
});

test('interrupted marker publication does not permanently block retry',async t=>{
 const root=await fixture(t);
 const {mkdir,link}=await import('node:fs/promises');
 const {installationLockMarker}=await import('../src/installation-operation.mjs');
 const state=join(root,'state/agentpay/user');await mkdir(state,{recursive:true,mode:0o700});
 const temporary=join(state,'interrupted-marker');
 await writeFile(temporary,installationLockMarker,{mode:0o600});
 await link(temporary,join(state,'install.lock'));
 assert.equal((await attempt()).code,0);
 assert.equal(await readFile(temporary,'utf8'),installationLockMarker);
});

test('saved state location survives missing or different XDG settings and shares Runtime exclusion',async t=>{
 const root=await fixture(t);
 const {installationDirectory,stateLocationFile}=await import('../src/installation-paths.mjs');
 const {acquireRuntimeOwner}=await import('../src/runtime-owner.mjs');
 const owner=await acquireRuntimeOwner();t.after(()=>owner.close());
 const directory=installationDirectory();
 assert.equal(JSON.parse(await readFile(stateLocationFile(),'utf8')).directory,directory);
 for(const xdg of [null,join(root,'different-state')]){
  const source=`${xdg===null?'delete process.env.XDG_STATE_HOME;':`process.env.XDG_STATE_HOME=${JSON.stringify(xdg)};`}
   const {installationDirectory}=await import(${JSON.stringify(new URL('../src/installation-paths.mjs',import.meta.url).href)});
   console.log(installationDirectory());
   const {acquireRuntimeOwner}=await import(${JSON.stringify(new URL('../src/runtime-owner.mjs',import.meta.url).href)});
   try {const h=await acquireRuntimeOwner();await h.close();process.exitCode=8;}catch(e){console.error(e.message);process.exitCode=7;}`;
  const child=launch(source);let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
  const [code]=await once(child,'close');assert.equal(code,7);assert.equal(out.trim(),directory);assert.match(err,/Another AgentPay Runtime/);
 }
});

test('concurrent first-use state selection cannot establish two coordination directories',async t=>{
 const root=await fixture(t);
 const url=new URL('../src/installation-paths.mjs',import.meta.url).href;
 const outcomes=await Promise.all(['first','second'].map(async name=>{
  const child=launch(`process.env.XDG_STATE_HOME=${JSON.stringify(join(root,name))};
   const {ensureInstallationDirectory}=await import(${JSON.stringify(url)});
   try{console.log(await ensureInstallationDirectory());}catch(e){console.error(e.message);process.exitCode=7;}`);
  let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
  const [code]=await once(child,'close');return {code,out:out.trim(),err};
 }));
 const {installationDirectory}=await import('../src/installation-paths.mjs');
 assert.ok(outcomes.some(result=>result.code===0));
 for(const result of outcomes){
  if(result.code===0)assert.equal(result.out,installationDirectory());
  else {assert.equal(result.code,7);assert.match(result.err,/Another command selected/);}
 }
});
