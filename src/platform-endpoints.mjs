import {withInstallationOperation,runInstallationCommand} from './installation-operation.mjs';
// SPDX-License-Identifier: MPL-2.0
// Deliberate transport changes only. Never replace a Policy, request, or result.
import {open,mkdir,lstat,rename,unlink,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {installedUserDir} from './local-data-directory.mjs';
import {deploymentFilePath,installationDirectory} from './installation-paths.mjs';
import {readPrivateJson,deploymentChanges} from './deployment-status.mjs';
import {validatePublicDeployment} from './prepare-onboarding.mjs';
import {readServiceSettings,checkServiceDirectory,listenerPresent} from './local-services.mjs';
import {isManagedUnit} from './autostart-files.mjs';
import {fetchJsonWithTimeout} from './transport.mjs';
import {settlementProfileBlocker} from './readiness-profile.mjs';
import {readRuntimeStatus} from './runtime-status.mjs';
import {readSettlementAddresses} from './settlement-address-history.mjs';

const execute=runInstallationCommand;
const normalize=value=>new URL(value).href.replace(/\/+$/,'');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const pendingPath=dir=>join(dir,'runtime/endpoint-update.pending.json');
const aliasesPath=dir=>join(dir,'runtime/settlement-addresses.json');

async function durableJson(path,value){
 const temp=path+'.'+randomUUID()+'.tmp';let file;
 try{
  file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify(value)+'\n');await file.sync();await file.close();file=null;
  await rename(temp,path);
  const directory=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await directory.sync();}finally{await directory.close();}
 }finally{await file?.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}


async function runtimeControl(action,{dataDir,settings}){
 if(process.platform!=='linux')throw Error('Automatic address updates currently require managed Linux services. Keep your saved settings.');
 const unit='agentpay-local-runtime.service',path=join(homedir(),'.config/systemd/user',unit);
 const stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o022)||!isManagedUnit(await readFile(path,'utf8'),unit,dataDir))
  throw Error('Runtime is not managed by this User installation. Run agentpay repair before updating addresses.');
 const ctl=async args=>(await execute('systemctl',['--user',...args],{timeout:45000,maxBuffer:16384})).stdout.trim();
 if(await ctl(['show',unit,'--property=FragmentPath','--value'])!==path||await ctl(['show',unit,'--property=DropInPaths','--value']))
  throw Error('Runtime service settings need review before updating addresses.');
 await ctl([action,unit]);
 if(action==='stop'){
  const url=new URL(settings.runtimeUrl);
  if(await listenerPresent({host:url.hostname,port:Number(url.port)}))throw Error('Runtime is still running. No connection settings were changed.');
 }else{
  for(let i=0;i<30;i++){
   try{await readRuntimeStatus(dataDir);return;}catch{await new Promise(r=>setTimeout(r,500));}
  }
  throw Error('Runtime did not become ready. Retry agentpay market connect with the same Market address.');
 }
}

export async function preparePlatformEndpoints({dataDir,origin,scope,userDir=installedUserDir,fetchJson=fetchJsonWithTimeout,changingOrigin=false}){
 await checkServiceDirectory(dataDir);
 const pending=await readPrivateJson(pendingPath(dataDir));
 // Ordinary reconnect/renewal keeps its existing behavior. Only a deliberately
 // changed origin or an interrupted update owns transport changes.
 if(!changingOrigin&&!pending)return {changed:false,apply:async()=>{}};
 const setup=await readPrivateJson(await deploymentFilePath(dataDir,userDir,'anvil-onboarding.json'));
 // A source-to-npm installation may have no copied onboarding draft. The
 // bound Policy and live service settings remain the authoritative local state.
 // Never synthesize a draft or replace its RPC/test configuration from Market.
 const policy=await readPrivateJson(join(dataDir,'wallet/policy.json'));
 if(!policy)throw Error('Saved spending permission is missing (wallet/policy.json). Check your data folder with agentpay wallet info and restore its backup before retrying. Do not create a replacement Policy to fix this.');
 if(!policy||policy.policyId?.toLowerCase()!==scope.policyId?.toLowerCase()||policy.safe?.toLowerCase()!==scope.safe?.toLowerCase()||`eip155:${policy.chainId}`!==scope.network||policy.module?.toLowerCase()!==scope.module?.toLowerCase())
  throw Error('Wallet authorization changed. Run agentpay market connect again.');
 const connectionBefore=await readPrivateJson(join(dataDir,'market-connection.json'));
 if(pending&&(pending.version!==1||pending.origin!==origin||pending.policyId!==policy.policyId))
  throw Error('Finish the pending address update with the same Policy. Retry: agentpay market connect --market '+pending.origin);
 const {response,result}=await fetchJson(origin+'/market/web/onboarding/user-config',{method:'GET'},15000);
 if(!response.ok)throw Error('Market deployment settings are unavailable. Check the website address and your connection, then retry.');
 const proposed=validatePublicDeployment(result);
 let settings;
 try{settings=await readServiceSettings(dataDir);}catch(e){
  if(e.code==='ENOENT')throw Error('Runtime settings are missing (runtime/local-services.json). Run agentpay repair, then retry this command.');
  throw Error('Runtime settings could not be read safely. Check the selected data folder with agentpay wallet info before retrying.');
 }
 const urls={settlementUrl:proposed.settlementUrl,marketBundleMetadataUrl:proposed.marketBundleMetadataUrl};
 const changed=!!setup&&Object.keys(urls).some(key=>(setup[key]===undefined?null:normalize(setup[key]))!==(urls[key]===undefined?null:normalize(urls[key])))||normalize(settings.settlementUrl)!==normalize(urls.settlementUrl)||!!pending;
 // RPC is participant-owned: a different local tunnel must never be overwritten.
 // A Market connection alone is not authority to rotate contracts or test packages.
 const publicPath=await deploymentFilePath(dataDir,userDir,'user-deployment.json');
 const previousPublic=await readPrivateJson(publicPath);
 if(!changed&&!changingOrigin)return {changed:false,apply:async()=>{}};
 if(deploymentChanges(policy,proposed).length||(setup&&(deploymentChanges(setup,proposed).length||setup.mode!==proposed.mode||setup.tokenDecimals!==proposed.tokenDecimals||setup.tokenSymbol!==proposed.tokenSymbol)))
  throw Error('This Market uses different network or contract settings. Address update stopped; your current Policy and Orders are kept.');

 // Query an unknown service to inspect deployment identity without depending on
 // a particular Provider being online, or granting it an Order.
 const query=new URL(normalize(urls.settlementUrl)+'/agentpay/purchase-readiness');
 query.searchParams.set('skillId','0x'+'0'.repeat(64));query.searchParams.set('profileHash','0x'+'0'.repeat(64));
 const readiness=await fetchJson(query.href,{method:'GET'},15000);
 if(!readiness.response.ok||!readiness.result?.ok||settlementProfileBlocker(policy,readiness.result.result?.settlementProfile))
  throw Error('The new Settlement address does not match this Wallet deployment. Current addresses are kept.');
 if(urls.marketBundleMetadataUrl){
 const metadata=await fetchJson(urls.marketBundleMetadataUrl,{method:'GET'},15000);
 if(!metadata.response.ok||!metadata.result?.ok||!/^[a-f0-9]{64}$/.test(metadata.result.result?.sha256||''))
  throw Error('The new package address could not be checked. Current addresses are kept.');
 }
 if(!changed)return {changed:false,apply:async()=>{}};
 return {changed:true,urls,async apply(options={}){return withInstallationOperation(()=>applyAddresses(options));}};
 async function applyAddresses({write=console.log,manage=runtimeControl,stateDir=installationDirectory(),saveConnection=async()=>{}}={}){
  await mkdir(stateDir,{recursive:true,mode:0o700});
  const stat=await lstat(stateDir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))throw Error('Unsafe installation state directory.');
  let updating=false;
  try{
   if(!same(await readPrivateJson(join(dataDir,'market-connection.json')),connectionBefore)||!same(await readPrivateJson(join(dataDir,'wallet/policy.json')),policy)||!same(await readServiceSettings(dataDir),settings)||!same(await readPrivateJson(publicPath),previousPublic)||!same(await readPrivateJson(await deploymentFilePath(dataDir,userDir,'anvil-onboarding.json')),setup))
    throw Error('Local settings changed during connection. Retry market connect; no addresses were changed.');
   const aliases=await readSettlementAddresses(dataDir);
   const entry={from:normalize(settings.settlementUrl),to:normalize(urls.settlementUrl),policyId:policy.policyId};
   if(entry.from!==entry.to&&!aliases.entries.some(e=>same(e,entry))){
    if(aliases.entries.length>=256)throw Error('Settlement address history needs review.');
    aliases.entries.push(entry);
   }
   write('Updating platform addresses. Runtime will pause briefly; Wallet stays unlocked.');
   // A durable marker makes interruptions retryable even after settings are written.
   // Write the alias before the new active address; never mutate cancellation IDs.
   await durableJson(pendingPath(dataDir),{version:1,origin,policyId:policy.policyId});
   updating=true;
   await saveConnection();
   await manage('stop',{dataDir,settings});
   await durableJson(aliasesPath(dataDir),aliases);
   if(previousPublic)await durableJson(join(dataDir,'user-deployment.json'),{...previousPublic,...urls});
   if(setup)await durableJson(join(dataDir,'anvil-onboarding.json'),{...setup,...urls});
   await durableJson(join(dataDir,'runtime/local-services.json'),{...settings,settlementUrl:normalize(urls.settlementUrl)});
   await manage('start',{dataDir,settings:{...settings,settlementUrl:normalize(urls.settlementUrl)}});
   await unlink(pendingPath(dataDir));
   write('Platform addresses updated. Your Wallet, permission and Order records were kept.');
  }catch(e){throw Error('Address update did not finish.\n'+e.message+'\n'+(updating?'Some connection settings may already be saved. Wallet keys, Policies and Orders were kept.':'No connection addresses were changed.')+'\nNext: agentpay market connect --market '+origin);}
 }
}
