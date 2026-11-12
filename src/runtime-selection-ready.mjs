// SPDX-License-Identifier: MPL-2.0
import {readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {installationDirectory} from './installation-paths.mjs';
import {assertPrivateFile,atomicWritePrivate} from './private-journal-files.mjs';
import {fileURLToPath} from 'node:url';
import {waitForServiceReadiness} from './service-readiness.mjs';
import {withClientRequestLock} from './client-request-lock.mjs';
// Called after bind. Login startup may revive a stopped selection, but must never
// overwrite an unfinished switch or select a different data directory.
export async function publishRuntimeReady(dataDir, {verifyReady = waitForServiceReadiness} = {}) {
 const state=installationDirectory(),path=join(state,'active-services.json');
 const userDir=await realpath(fileURLToPath(new URL('..',import.meta.url)));
 for (let attempt=0;attempt<60;attempt++) {
 try {return await withClientRequestLock(join(state,'service-selection.lock'),async()=>{
  let selected;
  try {await assertPrivateFile(path);selected=JSON.parse(await readFile(path,'utf8'));}
  catch(e){if(e.code==='ENOENT')return;throw e;}
  if(selected.version!==1 || selected.target?.dataDir!==dataDir || selected.target?.userDir!==userDir || !['stopped','selected'].includes(selected.phase))return;
  // Recheck after acquiring the transition lock; an earlier probe could become
  // stale while a concurrent stop/switch runs. Login also verifies both services.
  await verifyReady(dataDir);
  await atomicWritePrivate(path,JSON.stringify({...selected,phase:'selected'})+'\n');
 });} catch(error) {
  if(error.code!=='REQUEST_BUSY' || attempt===59)throw error;
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 }
}
