// SPDX-License-Identifier: MPL-2.0
// A local routing index, not payment authority. Preserve old records in place;
// only service/input hashes and originating data folders enter this index.
import {constants} from 'node:fs';
import {mkdir,open,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {hashPrivateRequest} from '@c4roa0/agentpay-protocol';
import {installationDirectory} from './installation-paths.mjs';
import {atomicWritePrivate} from './private-journal-files.mjs';
import {withInstallationOperation} from './installation-operation.mjs';
import {hashInvocationKey} from './invocation-store.mjs';
import {parseServiceReference} from './service-reference.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const scopeKey = (service,requestHash) => digest(JSON.stringify([service.skillId,service.profileHash,requestHash]));
const codeError = (code,message) => Object.assign(Error(message),{code});
const requestIdPattern = /^[A-Za-z0-9._:-]{16,128}$/;
const review = () => codeError('REQUEST_HISTORY_REVIEW_REQUIRED','Original request history could not be identified safely. Keep the old data folder and inspect agentpay orders list; no replacement purchase was started.');
const canonical = path => realpath(path).catch(error=>{if(error.code==='ENOENT')return resolve(path);throw error;});
async function privateDirectory(path) {
  try {
    const info=await lstat(path);
    if(!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid() || info.mode & 0o077)throw review();
    return true;
  }catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function json(path,max=2*1048576) {
  let file;
  try {
    file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const info=await file.stat();
    if(!info.isFile() || info.uid!==process.getuid() || info.mode & 0o077 || info.size>max)throw review();
    const value=JSON.parse(await file.readFile('utf8'));
    if(value===null)throw review();
    return value;
  }catch(error){if(error.code==='ENOENT')return null;throw review();}
  finally{await file?.close();}
}
async function indexDirectory() {
  const directory=join(installationDirectory(),'request-owners');
  await mkdir(directory,{recursive:true,mode:0o700});await privateDirectory(directory);
  return directory;
}
function validOwner(saved) {
  if(saved && (saved.version!==1 || typeof saved.dataDir!=='string' || !isAbsolute(saved.dataDir) ||
    (saved.requestIds!==undefined && (!Array.isArray(saved.requestIds) || saved.requestIds.some(id=>!requestIdPattern.test(id)))) ||
    (saved.conflicts!==undefined && (!Array.isArray(saved.conflicts) || saved.conflicts.some(path=>typeof path!=='string' || !isAbsolute(path))))))throw review();
}
async function recordHistory(directory,key,dataDir,requestIds=[]) {
  const path=join(directory,key+'.json'),saved=await json(path,32768);validOwner(saved);
  // Explicit force is a deliberate later purchase, not a migration decision.
  if(saved?.deliberate && saved.dataDir!==dataDir)return;
  if(saved?.dataDir===dataDir) {
    const ids=[...new Set([...(saved.requestIds || []),...requestIds])];
    if(ids.length)await atomicWritePrivate(path,JSON.stringify({...saved,requestIds:ids})+'\n');
    return;
  }
  const conflicts=saved ? [...new Set([...(saved.conflicts || []),saved.dataDir,dataDir])] : undefined;
  await atomicWritePrivate(path,JSON.stringify(saved ? {...saved,conflicts} : {version:1,dataDir,...(requestIds.length?{requestIds}: {})})+'\n');
}

// Called with services stopped during a confirmed switch. Scan only these known
// private stores, once per switch, never arbitrary folders or remote services.
export async function importHistoricalRequests(dataDir) {
  return withInstallationOperation(async()=>{
    dataDir=await canonical(dataDir);
    try { return await scanHistoricalRequests(dataDir); }
    catch {
      // Incomplete old history must not prevent Runtime startup. Retain a
      // conservative routing barrier; never turn unreadable records into new calls.
      const directory=await indexDirectory();
      await recordHistory(directory,'unclassified',dataDir);
      return {indexed:0,unclassified:true,reviewRequired:true};
    }
  });
}
async function scanHistoricalRequests(dataDir) {
    if(!await privateDirectory(dataDir))return;
    const runtime=join(dataDir,'runtime');if(!await privateDirectory(runtime))return;
    const directory=await indexDirectory(),keys=new Map(),clientRequests=new Map();
    let bytes=0,count=0;
    for(const kind of ['client-requests','client-pending']) {
      const parent=join(runtime,kind);if(!await privateDirectory(parent))continue;
      const names=await readdir(parent);
      if(names.length>20000 || (kind==='client-pending' && names.some(name=>name.endsWith('.lock'))))throw review();
      for(const name of names) {
        if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
        const path=join(parent,name),info=await lstat(path);bytes+=info.size;
        if(++count>20000 || bytes>64*1048576)throw review();
        const saved=await json(path);if(!saved)throw review();
        let service,input,ids;
        if(kind==='client-requests') {
          if(saved.version!=='agentpay.runtime-client-request.v1' || !requestIdPattern.test(saved.requestId || ''))throw review();
          service=parseServiceReference(saved.service);input=saved.input?.request;ids=[saved.requestId];
          clientRequests.set(hashInvocationKey(saved.requestId),{requestHash:hashPrivateRequest(saved.preparedRequest===undefined ? input : saved.preparedRequest),serviceKey:scopeKey(service,hashPrivateRequest(saved.preparedRequest===undefined ? input : saved.preparedRequest))});
        }else {
          if(!['agentpay.runtime-client-pending.v1','agentpay.runtime-client-pending.v2'].includes(saved.version) || !saved.binding?.service)throw review();
          // Pending records intentionally omit the business adapter. The full
          // checkpoint remains the authority for resume; only scope IDs are used here.
          service=saved.binding.service;input=saved.binding.input;
          if(!Array.isArray(saved.pending))throw review();
          ids=[...saved.pending,...(saved.currentId ? [saved.currentId]:[])];
          if(ids.some(id=>!requestIdPattern.test(id)))throw review();
          if(!/^0x[a-fA-F0-9]{64}$/.test(service.skillId || '') || !/^0x[a-fA-F0-9]{64}$/.test(service.profileHash || ''))throw review();
        }
        const key=scopeKey(service,hashPrivateRequest(input));
        keys.set(key,[...new Set([...(keys.get(key) || []),...ids])]);
      }
    }
    const history=await json(join(runtime,'invocations.json'),32*1048576);
    let unclassified=false;
    if(history) {
      if(history.version!=='agentpay.user-invocations.v1' || !history.invocations || typeof history.invocations!=='object' || Array.isArray(history.invocations))throw review();
      for(const [id,entry] of Object.entries(history.invocations)) {
        if(!/^0x[a-f0-9]{64}$/.test(entry?.requestHash || '') || entry.invocationId!==id)throw review();
        // Runtime-only records cannot prove the caller's original input (a Skill
        // may prepare/upload files first). Do not guess a cross-installation match.
        const client=clientRequests.get(id);
        let linked=false;
        if(client && client.requestHash===entry.requestHash) {
          try {
            const binding=JSON.parse(entry.serviceBinding);
            linked=binding.version==='agentpay.runtime-service.v1' &&
              scopeKey(parseServiceReference(binding.reference),entry.requestHash)===client.serviceKey;
          }catch { /* Old or incomplete service identity stays unclassified. */ }
        }
        if(!linked)unclassified=true;
      }
    }
    for(const [key,ids] of keys)await recordHistory(directory,key,dataDir,ids);
    if(unclassified)await recordHistory(directory,'unclassified',dataDir);
    return {indexed:keys.size,unclassified};
}

// Keep ownership selection and local request creation in one maintenance section.
// Network/payment calls run after it, always against the pinned original connection.
export async function withDefaultRequest({service,input,dataDir,force=false},operation) {
  return withInstallationOperation(async()=>{
    dataDir=await canonical(dataDir);
    const directory=await indexDirectory();
    const path=join(directory,scopeKey(service,hashPrivateRequest(input.request))+'.json');
    const saved=await json(path,32768);validOwner(saved);
    const unknown=await json(join(directory,'unclassified.json'),32768);validOwner(unknown);
    if(!force && !(saved?.deliberate && saved.dataDir===dataDir) && (unknown?.conflicts || (unknown && unknown.dataDir!==dataDir)))
      throw codeError('REQUEST_HISTORY_REVIEW_REQUIRED','Another installation has older requests whose original input cannot be identified. Review them in the original installation. Use --force only if you deliberately want a new purchase.');
    if(!force && saved?.conflicts)
      throw codeError('ORIGINAL_REQUEST_AMBIGUOUS','Several local installations contain this request. Return to the intended installation and use --resume with its saved request ID. No new purchase was started.');
    if(!force && saved && saved.dataDir!==dataDir)
      throw codeError('ORIGINAL_INSTALLATION_REQUIRED','This input was used by another local Wallet. Return to that installation to recover it. Use --force only for a deliberate new purchase.');
    const next = !saved || force ? {version:1,dataDir,...(force?{deliberate:true}:{})} : saved;
    if(!saved || force)await atomicWritePrivate(path,JSON.stringify(next)+'\n');
    const result = await operation(!force ? next.requestIds : undefined);
    if(result?.requestId) {
      if(!requestIdPattern.test(result.requestId))throw review();
      await atomicWritePrivate(path,JSON.stringify({...next,requestIds:[...new Set([...(next.requestIds || []),result.requestId])]})+'\n');
    }
    return result;
  });
}
export async function claimDefaultRequest(options) {
  return withDefaultRequest(options,async()=>{});
}
