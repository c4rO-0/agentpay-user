// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,access,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLocalInstallation } from '../src/install-preflight.mjs';
import { installedUser } from './helpers/installed-user.mjs';
test('preflight checks the installed package without a sibling Wallet, and refuses unsafe private storage',async t=>{
 const root=await mkdtemp(join(tmpdir(),'user-preflight-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const userDir=await installedUser(root), dataDir=join(root,'data');
 const check=extra=>checkLocalInstallation({userDir,dataDir,...extra});
 assert.equal((await check()).ok,true);
 await assert.rejects(access(dataDir),{code:'ENOENT'});
 assert.equal((await check({nodeVersion:'20.0.0'})).ok,false);
 assert.equal((await check({dataDir:join(userDir,'private')})).ok,false);
 await mkdir(dataDir,{mode:0o755});await chmod(dataDir,0o755);
 assert.equal((await check()).ok,false);await chmod(dataDir,0o700);
 const pkg=JSON.parse(await readFile(join(userDir,'package.json'),'utf8'));
 pkg.dependencies['@c4roa0/agentpay-wallet']='9.9.9';
 await writeFile(join(userDir,'package.json'),JSON.stringify(pkg));
 assert.equal((await check()).checks.find(c=>c.code==='WALLET_PACKAGE').status,'failed');
});
