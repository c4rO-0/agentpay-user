// SPDX-License-Identifier: MPL-2.0
// Real CLI subprocess failure and private report files; fake service helpers do
// not start, stop, or inspect any deployed service or spend funds.
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runServiceCommand} from '../src/service-command.mjs';
import {reportCommandFailure} from '../src/command-diagnostics.mjs';
import {runUserCli} from '../src/user-cli.mjs';
import {isolateState} from './helpers/installed-user.mjs';
import {installationDirectory} from '../src/installation-paths.mjs';
test('service child cause and versions reach the terminal and private report without private output',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'command-diagnostic-'));isolateState(t,dir);
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'scripts'));
 const module=new URL('../src/command-diagnostics.mjs',import.meta.url).href;
 await writeFile(join(dir,'scripts/autostart.mjs'),`import {childDiagnostic} from ${JSON.stringify(module)};
 console.error('DO_NOT_SHARE https://secret:password@example.com/private payload');
 const e=Object.assign(Error('DO_NOT_SHARE'),{code:'RUNNING_VERSION_UNVERIFIED',component:'Runtime',running:'0.3.15',expected:'0.3.16'});
 console.error(childDiagnostic(e));process.exitCode=1;`);
 const log=join(dir,'repair.log'),lines=[];
 let failure;
 try { await runServiceCommand('start',{userDir:dir,dataDir:dir,logPath:log}); } catch(error) { failure=error; }
 assert.ok(failure);
 await reportCommandFailure(failure,{operation:'Repair · starting',write:s=>lines.push(s),logPath:log});
 assert.match(lines.join('\n'),/RUNNING_VERSION_UNVERIFIED/);
 assert.match(lines.join('\n'),/running 0.3.15 · installed 0.3.16/);
 assert.doesNotMatch(lines.join('\n'),/DO_NOT_SHARE|password|private payload/);
 const files=(await readdir(installationDirectory())).filter(n=>n.startsWith('diagnostic-'));
 assert.equal(files.length,1);
 const path=join(installationDirectory(),files[0]);
 const contents=await readFile(path,'utf8');
 assert.match(contents,/RUNNING_VERSION_UNVERIFIED/);
 assert.doesNotMatch(contents+await readFile(log,'utf8'),/DO_NOT_SHARE|password|private payload/);
 assert.equal((await stat(path)).mode&0o777,0o600);
});
test('every in-process public command has a failure fallback with actionable filesystem cause',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'command-fallback-'));isolateState(t,dir);
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const output=[];
 const result=await runUserCli(['status'],{write:s=>output.push(s),status:async()=>{throw Object.assign(Error('private input DO_NOT_SHARE'),{code:'ENOSPC'});}});
 assert.equal(result,1);
 assert.match(output.join('\n'),/disk is full/);
 assert.match(output.join('\n'),/ENOSPC/);
 assert.doesNotMatch(output.join('\n'),/DO_NOT_SHARE/);
});

test('service failure includes automatically collected state and known journal causes',async t=>{
 if(process.platform!=='linux')return t.skip('systemd diagnostics apply on Linux');
 const dir=await mkdtemp(join(tmpdir(),'service-diagnostic-'));isolateState(t,dir);
 const oldPath=process.env.PATH;
 t.after(async()=>{process.env.PATH=oldPath;await rm(dir,{recursive:true,force:true});});
 const bin=join(dir,'bin');await mkdir(bin);
 // Controlled command fixtures: no deployed unit is accessed or changed.
 await writeFile(join(bin,'systemctl'),"#!/bin/sh\nprintf 'ActiveState=failed\\nSubState=failed\\nResult=exit-code\\nExecMainStatus=1\\n'\n",{mode:0o700});
 await writeFile(join(bin,'journalctl'),"#!/bin/sh\nprintf 'EADDRINUSE DO_NOT_SHARE_PRIVATE_LOG\\n'\n",{mode:0o700});
 process.env.PATH=bin+':'+oldPath;
 const lines=[];
 await reportCommandFailure(Object.assign(Error('failed'),{code:'SERVICE_OPERATION_FAILED'}),{operation:'Repair',services:true,write:s=>lines.push(s)});
 assert.match(lines.join('\n'),/ActiveState=failed/);
 assert.match(lines.join('\n'),/ExecMainStatus=1/);
 assert.match(lines.join('\n'),/already occupies its socket or port/);
 assert.doesNotMatch(lines.join('\n'),/DO_NOT_SHARE_PRIVATE_LOG/);
});

test('public child entry prints safe unexpected failure and exits unsuccessfully',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'entry-diagnostic-'));isolateState(t,dir);
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const script=join(dir,'fixture.mjs');
 await writeFile(script,"throw Object.assign(Error('DO_NOT_SHARE_PRIVATE_INPUT'),{code:'ENOSPC'});");
 let failure;
 try {await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/command-entry.mjs',import.meta.url)),script],{env:process.env});}catch(error){failure=error;}
 assert.equal(failure?.code,1);
 assert.match(failure.stderr,/disk is full/);
 assert.match(failure.stderr,/Diagnostic report:/);
 assert.doesNotMatch(failure.stderr,/DO_NOT_SHARE_PRIVATE_INPUT/);
});
