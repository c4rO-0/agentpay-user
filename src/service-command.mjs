// SPDX-License-Identifier: MPL-2.0
// Preserve the child's reviewed cause across installer/repair subprocesses.
import {join} from 'node:path';
import {appendFile} from 'node:fs/promises';
import {runInstallationCommand} from './installation-operation.mjs';
import {childCause,diagnostic} from './command-diagnostics.mjs';
export async function runServiceCommand(action,{userDir,dataDir,logPath}) {
  try {
    await runInstallationCommand(process.execPath,[join(userDir,'scripts/autostart.mjs'),action],{
      env:{...process.env,AGENTPAY_USER_DATA_DIR:dataDir,AGENTPAY_DIAGNOSTIC_CHANNEL:"1"},timeout:90000,
    });
    if(logPath)await appendFile(logPath,`Service ${action}: completed.\n`,{mode:0o600});
  } catch(error) {
    const cause=childCause(error.stderr)||error;
    const failure=Object.assign(Error('Background service operation failed'),{code:'SERVICE_OPERATION_FAILED',exitCode:error.exitCode,cause});
    if(logPath)await appendFile(logPath,JSON.stringify({operation:`service ${action}`,causes:diagnostic(failure)})+'\n',{mode:0o600}).catch(()=>{});
    throw failure;
  }
}
