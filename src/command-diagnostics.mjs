// SPDX-License-Identifier: MPL-2.0
// Shared human-facing failures. Never persist arbitrary exception messages,
// subprocess output, URLs, payloads or stacks: those can contain private data.
import {failureGuidance} from './setup-diagnostics.mjs';
import {installationDirectory} from './installation-paths.mjs';
import {mkdir, lstat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
const definitions = {
  GUIDE_PROCESS_REVIEW_REQUIRED: ['A saved Setup process could not be safely identified.', 'Keep its PID record and data. Contact support to identify the process; do not kill a process just because it uses the port.'],
  GUIDE_PROCESS_STOP_TIMEOUT: ['The verified Setup process did not stop in time.', 'No forced termination was used. Inspect service logs and retry the same service operation after it exits.'],
  RUNNING_VERSION_UNVERIFIED: ['Running software differs from the installed packages.', 'The old process may still be running. Review the service details below before retrying repair.'],
  SERVICE_OPERATION_FAILED: ['A background service operation did not complete.', 'Review the service state and cause below before retrying; do not repeat setup or the paid test.'],
  SERVICE_READINESS_FAILED: ['Wallet and Runtime did not become ready.', 'Review the service details below before retrying agentpay service start.'],
  COMMAND_FAILED: ['A required helper command exited unsuccessfully.', 'Review the cause and exit status below; keep the original operation records.'],
  COMMAND_TIMEOUT: ['A required helper command timed out.', 'Its changes may be incomplete. Check the current state before retrying the same command.'],
  COMMAND_OUTPUT_LIMIT: ['A helper exceeded the diagnostic output limit.', 'Check the current operation state before retrying. Do not create a replacement purchase.'],
  ENOSPC: ['The local disk is full.', 'Free disk space without deleting Wallet keys or Order records, then retry.'],
  EROFS: ['The required local storage is read-only.', 'Check storage access before retrying the same command.'],
  EADDRINUSE: ['The Wallet socket or Runtime port is already in use.', 'An existing process must be identified before service startup can continue. Keep both installations and their data.'],
};
const version = v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : 'unreported';
export function diagnostic(error) {
  const chain=[], seen=new Set();
  for(let e=error;e && typeof e==='object' && !seen.has(e) && chain.length<8;e=e.cause) {
    seen.add(e);
    const guidance=definitions[e.code]
      ? {code:e.code,reason:definitions[e.code][0],next:definitions[e.code][1]}
      : failureGuidance(e);
    const row={...guidance};
    // Keep concrete transport/filesystem causes even when guidance groups them.
    if (['ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN','ENETUNREACH',
      'EHOSTUNREACH','ETIMEDOUT','ENOENT','EACCES','EPERM'].includes(e.code)
      && e.code!==row.code) row.sourceCode=e.code;
    if(Number.isInteger(e.exitCode)) row.exitCode=e.exitCode;
    if(e.component==='Wallet'||e.component==='Runtime') {
      row.component=e.component; row.running=version(e.running); row.expected=version(e.expected);
    }
    // Code locations, without source lines, absolute paths or error messages.
    row.frames=String(e.stack||'').split('\n').slice(1,8).flatMap(line=>{
      const m=line.match(/[/\\]([A-Za-z0-9_.-]+\.(?:mjs|js|ts)):(\d+):(\d+)/);
      return m ? [`${m[1]}:${m[2]}:${m[3]}`] : [];
    });
    chain.push(row);
  }
  return chain.length ? chain : [failureGuidance({})];
}
export function childDiagnostic(error) {
  return JSON.stringify({agentpayCommandFailure:diagnostic(error).map(({code,sourceCode,exitCode,component,running,expected})=>({code:sourceCode||code,exitCode,component,running,expected}))});
}
export function childCause(stderr) {
  for(const line of String(stderr||'').split('\n').reverse()) {
    try {
      const rows=JSON.parse(line)?.agentpayCommandFailure;
      if(!Array.isArray(rows)||rows.length>8)continue;
      let cause;
      for(const row of [...rows].reverse()) {
        if(!row || typeof row.code!=='string')continue;
        cause=Object.assign(Error('Child operation failed'),{
          code:row.code,exitCode:Number.isInteger(row.exitCode)?row.exitCode:undefined,
          component:['Wallet','Runtime'].includes(row.component)?row.component:undefined,
          running:version(row.running),expected:version(row.expected),cause,
        });
      }
      return cause;
    } catch { /* Never print unstructured child output. */ }
  }
  for(const code of ['ENOSPC','EACCES','EPERM','EROFS','ECONNREFUSED','ENOTFOUND','ETIMEDOUT'])
    if(new RegExp('\\b'+code+'\\b').test(String(stderr||'')))return Object.assign(Error('Child operation failed'),{code});
}
async function serviceEvidence() {
  const rows=[];
  for(const role of ['wallet','runtime']) {
    const unit=`agentpay-local-${role}.service`;
    try {
      const {stdout}=await exec('systemctl',['--user','show',unit,'--property=ActiveState,SubState,Result,ExecMainStatus'],{timeout:5000,maxBuffer:16384});
      const values=stdout.trim().split('\n').filter(s=>/^(ActiveState|SubState|Result|ExecMainStatus)=[a-z0-9-]+$/.test(s));
      rows.push(`${role}: ${values.join(' · ')||'state unavailable'}`);
      const journal=await exec('journalctl',['--user','-u',unit,'-n','20','--no-pager','-o','cat'],{timeout:5000,maxBuffer:32768});
      const text=journal.stdout;
      if(/A process already uses this Wallet socket or Runtime port|EADDRINUSE/.test(text))rows.push(`${role}: a process already occupies its socket or port (recent service log).`);
      if(/Another AgentPay Runtime is running/.test(text))rows.push(`${role}: another Runtime holds the single-instance lock (recent service log).`);
      if(/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/.test(text))rows.push(`${role}: a required program module is missing (recent service log).`);
      if(/EACCES|EPERM/.test(text))rows.push(`${role}: access denied (recent service log).`);
    } catch { rows.push(`${role}: service diagnostic unavailable; use agentpay service logs ${role}.`); }
  }
  return rows;
}
export async function reportCommandFailure(error, {
  operation='Command', write=console.error, services=false, logPath,
  effect='The operation did not complete. Some changes may already have applied; check its current state before retrying.',
}={}) {
  if(error?.commandFailureReported)return;
  const causes=diagnostic(error);
  write(`\n[!] ${operation} failed`);
  for(const c of causes) {
    write(`  ${c.reason}\n  Code: ${c.code}${c.exitCode===undefined?'':` · exit ${c.exitCode}`}`);
    if(c.sourceCode)write(`  Cause: ${c.sourceCode}`);
    if(c.component)write(`  ${c.component}: running ${c.running} · installed ${c.expected}`);
  }
  write(`  ${effect}`);
  const evidence=services && process.platform==='linux' ? await serviceEvidence() : [];
  for(const line of evidence)write('  '+line);
  write('  Next: '+causes.at(-1).next);
  try {
    const root=installationDirectory();
    await mkdir(root,{recursive:true,mode:0o700});
    const st=await lstat(root);
    if(!st.isDirectory()||st.isSymbolicLink()||(typeof process.getuid==='function' && st.uid!==process.getuid())||st.mode&0o077)throw Error();
    const path=join(root,`diagnostic-${Date.now()}-${randomUUID()}.json`);
    await writeFile(path,JSON.stringify({version:1,at:new Date().toISOString(),operation,causes,evidence},null,2)+'\n',{flag:'wx',mode:0o600});
    write('  Diagnostic report: '+path);
  } catch { write('  The diagnostic report could not be saved. Copy the error codes and service details above.'); }
  if(logPath)write('  Operation log: '+logPath);
  if(error && typeof error==='object' && Object.isExtensible(error))error.commandFailureReported=true;
}
