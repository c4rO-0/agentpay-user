// SPDX-License-Identifier: MPL-2.0
// Legacy Setup children are outside systemd. Only stop a private PID record
// whose live process matches this installation, data directory and start time.
// No port-to-PID guessing, force kill, or Wallet/Order data deletion. Consumed
// PID files are retired so later PID reuse cannot strand the installation.
import {lstat,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const refused=()=>Object.assign(Error('The saved Setup process cannot be safely identified. Keep its records and inspect the running installation before retrying.'),{code:'GUIDE_PROCESS_REVIEW_REQUIRED'});
async function snapshot(pid, identityOnly=false) {
  try {
    const base=`/proc/${pid}`;
    const owner=await lstat(base);
    const stat=await readFile(base+'/stat','utf8');
    const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
    if(fields[0]==='Z'||fields[0]==='X')return null;
    // After SIGTERM only lifetime matters. /proc/environ can become unreadable
    // during exit before the directory disappears; it is no longer needed.
    if(identityOnly)return {start:fields[19]};
    return {uid:owner.uid,start:fields[19],args:(await readFile(base+'/cmdline','utf8')).split('\0').filter(Boolean),
      env:await readFile(base+'/environ','utf8'),group:await readFile(base+'/cgroup','utf8')};
  } catch(error) {if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}
}
async function retire(file,text) {
  // The lifecycle lock serializes product writers. Do not remove a replaced record.
  if((await readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;})).trim()===text)
    await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
}
export async function stopGuideProcesses({node,userDir,dataDir},{write=console.log,timeoutMs=10000}={}) {
  if(process.platform!=='linux')return; // Existing non-systemd startup is unchanged.
  const candidates=[];
  for(const role of ['runtime','wallet']) {
    const file=join(dataDir,'runtime',role==='wallet'?'wallet-guide.pid':'user-runtime-guide.pid');
    let info;
    try {info=await lstat(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid()||info.mode&0o077||info.size>32)throw refused();
    const text=(await readFile(file,'utf8')).trim();
    if(!/^[1-9][0-9]*$/.test(text)||!Number.isSafeInteger(Number(text))||Number(text)<=1)throw refused();
    const pid=Number(text),current=await snapshot(pid);
    if(!current){await retire(file,text);continue;}
    const entry=role==='runtime'?join(userDir,'src/index.mjs'):
      createRequire(join(userDir,'package.json')).resolve('@c4roa0/agentpay-wallet/cli');
    const expected=[node,entry,...(role==='wallet'?['serve',join(dataDir,'wallet')]:[])];
    const state=`AGENTPAY_USER_STATE_FILE=${join(dataDir,'runtime/invocations.json')}`;
    if(current.uid!==process.getuid()||JSON.stringify(current.args)!==JSON.stringify(expected)||
      (role==='runtime'&&!current.env.split('\0').includes(state))||/\/system.slice\/|agentpay-local-(?:wallet|runtime)\.service/.test(current.group))throw refused();
    candidates.push({pid,current,role,file,text});
  }
  for(const {pid,current,role,file,text} of candidates) {
    const latest=await snapshot(pid);
    if(!latest){await retire(file,text);continue;}
    if(JSON.stringify(latest)!==JSON.stringify(current))throw refused();
    write(`Stopping the verified Setup ${role} process. Saved Wallet and Order data are kept.`);
    try {process.kill(pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
    const deadline=Date.now()+timeoutMs;
    while(true) {
      const now=await snapshot(pid,true);
      if(!now||now.start!==current.start)break;
      if(Date.now()>=deadline)throw Object.assign(Error('The Setup process has not exited. No forced termination was attempted. Retry after reviewing its state.'),{code:'GUIDE_PROCESS_STOP_TIMEOUT'});
      await pause(100);
    }
    await retire(file,text);
  }
}
