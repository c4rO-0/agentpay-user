#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// Verify the archive consumers receive, without a sibling repository or local Wallet build.
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const source=fileURLToPath(new URL('..',import.meta.url));
const output=resolve(process.argv[2] || 'artifacts/npm');
await mkdir(output,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'agentpay-user-package-'));
const env={...process.env,HOME:join(root,'home'),XDG_STATE_HOME:join(root,'state'),PATH:dirname(process.execPath)+':'+process.env.PATH};
for(const name of Object.keys(env)) if(name.startsWith('AGENTPAY_') || ['NODE_OPTIONS','NODE_PATH'].includes(name)) delete env[name];
const run=(file,args,cwd)=>execFileSync(file,args,{cwd,env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
try {
 await mkdir(env.HOME,{mode:0o700});
 const packed=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',output],source))[0];
 const paths=packed.files.map(x=>x.path);
 for(const name of ['LICENSE','NOTICE.md','SECURITY.md','scripts/agentpay-cli.mjs','scripts/update.mjs','src/index.mjs','web/owner-approval.html','web/owner-approval.js','web/policy-preview.html','web/policy-preview.js'])
  if(!paths.includes(name))throw Error('Missing package file: '+name);
 if(paths.some(x=>x.startsWith('test/') || x.startsWith('node_modules/') || /(?:^|\/)\.env(?:\.|$)|\.keystore\.json$|\.token$|\.log$/.test(x)))throw Error('Unexpected private/test material in archive');
 const archive=join(output,packed.filename),consumer=join(root,'consumer');
 await mkdir(consumer);
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund',archive],consumer);
 const installed=join(consumer,'node_modules/@c4roa0/agentpay-user');
 const help=run(join(consumer,'node_modules/.bin/agentpay'),['help'],consumer);
 if(!help.includes('update [-f]') || !help.includes('policy help'))throw Error('Installed command unavailable');
 await mkdir(join(installed,'test'));
 for(const file of ['local-services-process.test.mjs','owner-approval-server.test.mjs']) await copyFile(join(source,'test',file),join(installed,'test',file));
 console.log(run(process.execPath,['--test','test/local-services-process.test.mjs','test/owner-approval-server.test.mjs'],installed));
 console.log('Verified archive: '+archive);
 console.log('SHA256: '+createHash('sha256').update(await readFile(archive)).digest('hex'));
} finally {await rm(root,{recursive:true,force:true});}
