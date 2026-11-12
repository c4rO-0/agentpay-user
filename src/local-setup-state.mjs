// SPDX-License-Identifier: MPL-2.0
// Distinguish an unfinished first setup from missing data in an existing Wallet.
// This is read-only guidance; it never creates keys or changes installation routing.
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';

export async function inspectLocalSetup(dataDir) {
  try {
    for (const path of [dataDir,join(dataDir,'wallet'),join(dataDir,'runtime')]) {
      const info=await lstat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(info && (!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid() || info.mode & 0o077))
        return {state:'attention'};
    }
    async function present(name) {
      const info=await lstat(join(dataDir,name)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(!info)return false;
      if(!info.isFile() || info.isSymbolicLink() || info.uid!==process.getuid() || info.mode & 0o077)throw Error('Unsafe saved file');
      return true;
    }
    const key=await present('wallet/session.keystore.json');
    const policy=await present('wallet/policy.json');
    const settings=await present('runtime/local-services.json');
    if(key && policy && settings)return {state:'ready'};
    // A saved connection or Order history indicates prior use. A key alone can
    // belong to an interrupted first setup and must still allow setup to resume.
    const priorUse=await present('market-connection.json') || await present('runtime/invocations.json');
    if(!policy && priorUse)return {state:'attention'};
    const prior=policy || priorUse || await present('runtime/connection.json');
    if(!key && prior)return {state:'attention'};
    if(policy && !settings)return {state:'attention'};
    const deployment=await present('user-deployment.json') || await present('anvil-onboarding.json');
    return {state:'needed',hasKey:key,next:deployment ? 'agentpay setup' : 'agentpay install --market YOUR_MARKET_URL'};
  } catch {return {state:'attention'};}
}
