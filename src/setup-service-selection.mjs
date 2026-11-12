// SPDX-License-Identifier: MPL-2.0
// Manual setup remains available when the OS has no user service manager.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { installedServiceSelection } from './service-selection.mjs';
import {installationChildOptions} from './installation-operation.mjs';
export async function activateSetup({dataDir, platform=process.platform,
  available=()=>promisify(execFile)('systemctl',['--user','show-environment'],{timeout:10000}),
  inspect=installedServiceSelection, write=console.log,
  launch=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/autostart.mjs',import.meta.url)),'activate-setup'],{
      ...installationChildOptions({stdio:['inherit','inherit','inherit'],env:{...process.env,AGENTPAY_USER_DATA_DIR:dataDir}})
    });
    child.once('error',reject);child.once('close',code=>resolve(code ?? 1));
  })}={}) {
  let managed=platform==='linux';
  if (managed) { try {await available();} catch {managed=false;} }
  if (!managed) {
    if (await inspect()) throw Error('Existing background service files were found, but the user service manager is unavailable. Restore it before switching installations.');
    write('User service manager unavailable. Continuing with manual setup; login startup is not enabled.');
    return 0;
  }
  return launch();
}
