#!/usr/bin/env node
// Reference business adapter. User owns transport, payment, snapshots and recovery.
// Keep --invoke <min> <max> stable for installed harness instructions.
// To build another service, edit its manifest and business validation/hooks;
// do not copy payment or request-recovery logic into this file.
function validateRandomRequest(request) {
 if (!request || Array.isArray(request) || Object.keys(request).sort().join(',') !== 'max,min' ||
     !Number.isSafeInteger(request.min) || !Number.isSafeInteger(request.max) ||
     request.min < 0 || request.max > 1e9 || request.min > request.max) {
  throw Error('INVALID_RANDOM_INPUT');
 }
 return request;
}
// Random uses JSON only. No files are uploaded or downloaded by this adapter.
// User saves the validated input and verified JSON output in its managed cache.
function inputFiles() { return []; }
function prepareRequest({request}) { return validateRandomRequest(request); }
function outputFiles() { return []; }
import {constants} from 'node:fs';
import {open,readFile} from 'node:fs/promises';
import {join,isAbsolute,dirname} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
try {
 const dataDir=process.env.AGENTPAY_USER_DATA_DIR||join(homedir(),'.local/share/agentpay/user');
 const file=join(dataDir,'runtime','connection.json');
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 let connection;
 try{
  const stat=await handle.stat();
  if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)||stat.size>16384)throw Error();
  connection=JSON.parse(await handle.readFile('utf8'));
 }finally{await handle.close();}
 if(connection.version!=='agentpay.runtime-connection.v1'||!isAbsolute(connection.clientModule||'')||!connection.clientModule.endsWith('/runtime-client.mjs'))throw Error();
 const {runSkill,skillClientCapabilities}=await import(pathToFileURL(join(dirname(connection.clientModule),'skill-client.mjs')).href);
 if (!['input-snapshots-v1','output-files-v1','original-request-v1'].every(cap => skillClientCapabilities?.includes(cap))) throw Error('CLIENT_UPDATE_REQUIRED');
 const manifest=JSON.parse(await readFile(new URL('../agentpay.json',import.meta.url),'utf8'));
 const args=process.argv.slice(2),[mode,min,max,...flags]=args;
 if(mode==='--invoke'&&(args.length<3||!/^\d+$/.test(min)||!/^\d+$/.test(max)))throw Error('INVALID_RANDOM_INPUT');
 // Reject invalid ranges before selecting any request or contacting Runtime.
 const request=mode==='--invoke'?validateRandomRequest({min:Number(min),max:Number(max)}):undefined;
 process.exitCode=await runSkill({
  service:manifest.services.main,
  args:mode==='--invoke'?[mode,JSON.stringify(request),...flags]:args,
  validateRequest:validateRandomRequest,
  inputFiles, prepareRequest, outputFiles
 });
}catch(error){
 const messages={
  INVALID_RANDOM_INPUT:'Use --invoke <min> <max> with whole numbers: 0 <= min <= max <= 1000000000. No purchase was started.',
  CLIENT_UPDATE_REQUIRED:'Update AgentPay User before using this Skill. Its shared client must support input snapshots, output files and original-request recovery.',
  LOCAL_SETUP_REQUIRED:'Run AgentPay setup to prepare the local Runtime client. Use AGENTPAY_USER_DATA_DIR for a non-default data directory.'
 };
 const code=Object.hasOwn(messages,error?.message)?error.message:'LOCAL_SETUP_REQUIRED';
 console.log(JSON.stringify({ok:false,error:{code,message:messages[code]}}));
 process.exitCode=1;
}
