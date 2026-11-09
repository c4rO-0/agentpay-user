// SPDX-License-Identifier: MPL-2.0
// Local aliases acknowledge an explicitly confirmed address change, not extra
// authority. Cancellation IDs and Policy scopes remain unchanged.
import {join} from 'node:path';
import {readPrivateFile} from './runtime-client.mjs';
const normalize=value=>{
 const u=new URL(value);
 if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('Invalid saved Settlement address.');
 return u.href.replace(/\/+$/,'');
};
export async function readSettlementAddresses(dataDir){
 let saved;
 try{saved=JSON.parse(await readPrivateFile(join(dataDir,'runtime/settlement-addresses.json'),65536));}
 catch(e){if(e.code==='ENOENT')return {version:1,entries:[]};throw e;}
 if(saved?.version!==1||!Array.isArray(saved.entries)||saved.entries.length>256)throw Error('Invalid saved Settlement address history.');
 for(const e of saved.entries){
  if(!e||Object.keys(e).sort().join(',')!=='from,policyId,to'||!/^0x[a-fA-F0-9]{64}$/.test(e.policyId)||normalize(e.from)!==e.from||normalize(e.to)!==e.to)throw Error('Invalid saved Settlement address history.');
 }
 return saved;
}
export async function sameSettlementAddress(dataDir,from,to,policyId){
 if(normalize(from)===normalize(to))return true;
 const saved=await readSettlementAddresses(dataDir),seen=new Set([normalize(from)]);
 for(let i=0;i<saved.entries.length;i++)for(const entry of saved.entries){
  if(entry.policyId.toLowerCase()===policyId.toLowerCase()&&seen.has(entry.from))seen.add(entry.to);
 }
 return seen.has(normalize(to));
}
