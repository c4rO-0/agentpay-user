// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateFromNpm} from '../src/npm-update.mjs';
import {isolateState} from './helpers/installed-user.mjs';
const name='@c4roa0/agentpay-user';
async function fixture(t, local = false) {
 const root=await mkdtemp(join(tmpdir(),'npm-update-')); t.after(()=>rm(root,{recursive:true,force:true}));
 isolateState(t,root);
 const npmRoot=join(root,'prefix/lib/node_modules'), project=join(root,'project'), userDir=join(local ? join(project,'node_modules') : npmRoot,name),dataDir=join(root,'data');
 await mkdir(userDir,{recursive:true});await mkdir(join(dataDir,'runtime'),{recursive:true,mode:0o700});
 const manifest=version=>({name,version,dependencies:{'@c4roa0/agentpay-wallet':'0.3.0','@c4roa0/agentpay-protocol':'0.14.3'}});
 await writeFile(join(userDir,'package.json'),JSON.stringify(manifest('0.3.0')));
 if(local) await writeFile(join(project,'package.json'),JSON.stringify({private:true,dependencies:{[name]:'0.3.0'}}));
 await writeFile(join(dataDir,'runtime/local-services.json'),'{}',{mode:0o600});
 await writeFile(join(dataDir,'keep'),'private fixture',{mode:0o600});
 const calls=[],messages=[];
 const options={userDir,dataDir,write:s=>messages.push(s),ask:async()=> 'confirm',
 npm:async args=>{
  if(args[0]==='root')return npmRoot;
  if(args[0]==='prefix')return join(root,'prefix');
  if(args[0]==='view')return JSON.stringify(manifest('0.3.1'));
  if(args.includes('--dry-run')){calls.push('requirements');return '';}
  assert(args.includes(name+'@0.3.1'));assert(args.includes('--engine-strict'));
  calls.push('install');await writeFile(join(userDir,'package.json'),JSON.stringify(manifest('0.3.1')));return '';
 },service:async action=>{calls.push(action);return '';},
 repair:async()=>{calls.push('new repair');return 'Official test Skill verified.';},
 officialTest:async()=>{calls.push('current official test');}};
 return {root,npmRoot,project,userDir,dataDir,calls,messages,options};
}
test('confirmed update pins the target, repairs after installation and preserves private state',async t=>{
 const f=await fixture(t);assert.equal(await updateFromNpm(f.options),0);
 assert.deepEqual(f.calls,['requirements','stop','install','new repair']);
 assert.equal(await readFile(join(f.dataDir,'keep'),'utf8'),'private fixture');
 assert(f.messages.some(s=>s.includes('No paid test')));
});
test('cancel makes no service/install changes; -f skips only confirmation',async t=>{
 const f=await fixture(t);assert.equal(await updateFromNpm({...f.options,ask:async()=> 'q'}),0);assert.deepEqual(f.calls,[]);
 assert.equal(await updateFromNpm({...f.options,force:true,ask:async()=>{throw Error('unexpected prompt');}}),0);
 assert.equal(f.calls.at(-1),'new repair');
});
test('update preview reads installed Wallet and distinguishes changed, unchanged and missing versions',async t=>{
 const f=await fixture(t,true);
 const directory=join(f.project,'node_modules/@c4roa0/agentpay-wallet');
 await mkdir(directory,{recursive:true});
 for(const version of ['0.2.9','0.3.0',null]){
  if(version)await writeFile(join(directory,'package.json'),JSON.stringify({name:'@c4roa0/agentpay-wallet',version}));
  else await rm(join(directory,'package.json'));
  f.messages.length=0;
  assert.equal(await updateFromNpm({...f.options,ask:async()=> 'q'}),0);
  assert(f.messages.includes('User    0.3.0 → 0.3.1'));
  const expected=version==='0.3.0'?'0.3.0 (unchanged)':`${version||'not confirmed'} → 0.3.0`;
  assert(f.messages.includes(`Wallet  ${expected}`));
  assert.deepEqual(f.calls,[]);
 }
});
test('failed install keeps data and the retry path; a later repair failure is not called success',async t=>{
 const f=await fixture(t);const npm=f.options.npm;
 assert.equal(await updateFromNpm({...f.options,npm:async args=>{
  if(args[0]==='install'&&!args.includes('--dry-run'))throw Error('network');return npm(args);
 }}),1);
 assert.equal(await readFile(join(f.dataDir,'keep'),'utf8'),'private fixture');
 assert.deepEqual(f.calls,['requirements','stop']);
 assert(f.messages.some(s=>s.includes('agentpay repair')));
 assert.equal(await updateFromNpm({...f.options,repair:async()=>{throw Error('not ready');}}),1);
 assert(!f.messages.some(s=>s.includes('No paid test')));
});
test('source/npm-link installation is never overwritten',async t=>{
 const f=await fixture(t),source=join(f.root,'source');
 await mkdir(source);await writeFile(join(source,'package.json'),await readFile(join(f.userDir,'package.json')));
 await rm(f.userDir,{recursive:true});await symlink(source,f.userDir);
 assert.equal(await updateFromNpm({...f.options,userDir:source}),1);assert.deepEqual(f.calls,[]);
 assert(f.messages.some(s=>s.includes('source checkout')));
});
test('current version checks the pinned official package without restarting; an existing install lock stops update',async t=>{
 const f=await fixture(t);const npm=f.options.npm;
 assert.equal(await updateFromNpm({...f.options,npm:async args=>args[0]==='view'?JSON.stringify({name,version:'0.3.0',dependencies:{'@c4roa0/agentpay-wallet':'0.3.0','@c4roa0/agentpay-protocol':'0.14.3'}}):npm(args)}),0);
 assert.deepEqual(f.calls,['current official test']);f.calls.length=0;
 const dir=join(process.env.XDG_STATE_HOME,'agentpay/user');await mkdir(dir,{recursive:true,mode:0o700});
 await writeFile(join(dir,'install.lock'),'busy',{mode:0o600});
 assert.equal(await updateFromNpm(f.options),1);assert.deepEqual(f.calls,[]);
 assert.equal(await readFile(join(dir,'install.lock'),'utf8'),'busy');
});

test('a package changed during confirmation is not downgraded or stopped',async t=>{
 const f=await fixture(t);
 const ask=async()=>{
  const file=join(f.userDir,'package.json'),pkg=JSON.parse(await readFile(file));
  pkg.version='0.3.2';await writeFile(file,JSON.stringify(pkg));return 'confirm';
 };
 assert.equal(await updateFromNpm({...f.options,ask}),1);assert.deepEqual(f.calls,[]);
});

// Local/project installs use the same update/recovery flow. The npm transport is
// controlled here; services and publication are not exercised by these fixtures.
test('project update targets its owning folder, preserves private state and never installs globally',async t=>{
 const f=await fixture(t,true),npm=f.options.npm;
 const run=async(args,options)=>{
  if(args[0]==='install'){
   assert(args.includes('--global=false')); assert(!args.includes('--global'));
   if(!args.includes('--dry-run')){
    assert.equal(args[args.indexOf('--prefix')+1],f.project);
    assert.equal(options.cwd,f.project); assert(args.includes('--save-exact'));
   }else assert.notEqual(args[args.indexOf('--prefix')+1],f.project);
  }
  return npm(args,options);
 };
 assert.equal(await updateFromNpm({...f.options,npm:run}),0);
 assert.deepEqual(f.calls,['requirements','stop','install','new repair']);
 assert.equal(await readFile(join(f.dataDir,'keep'),'utf8'),'private fixture');
 assert(f.messages.some(s=>s===`Installation folder: ${f.project}`));
});
test('project cancel and failed install preserve services or recovery data respectively',async t=>{
 const f=await fixture(t,true),npm=f.options.npm;
 assert.equal(await updateFromNpm({...f.options,ask:async()=> 'q'}),0);
 assert.deepEqual(f.calls,[]);
 assert.equal(await updateFromNpm({...f.options,force:true,npm:async(args,opts)=>{
  if(args[0]==='install'&&!args.includes('--dry-run'))throw Error('offline');
  return npm(args,opts);
 }}),1);
 assert.deepEqual(f.calls,['requirements','stop']);
 assert.equal(await readFile(join(f.dataDir,'keep'),'utf8'),'private fixture');
});
test('transitive, custom-source and changed project dependencies stop before services or installation',async t=>{
 const f=await fixture(t,true),file=join(f.project,'package.json');
 for(const dependencies of [{},{[name]:'file:../checkout'},{[name]:'github:owner/repo'}]){
  await writeFile(file,JSON.stringify({dependencies}));
  assert.equal(await updateFromNpm(f.options),1);assert.deepEqual(f.calls,[]);
 }
 await writeFile(file,JSON.stringify({dependencies:{[name]:'0.3.0'}}));
 assert.equal(await updateFromNpm({...f.options,ask:async()=>{
  await writeFile(file,JSON.stringify({dependencies:{[name]:'0.3.2'}}));return 'confirm';
 }}),1);assert.deepEqual(f.calls,[]);
});
