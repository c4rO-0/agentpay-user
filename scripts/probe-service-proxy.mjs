// SPDX-License-Identifier: MPL-2.0
// Runs in a fresh Node process: both fetch and ethers' native HTTP transport
// select their proxy at process startup. Never emit a URL or transport error.
import {join} from 'node:path';
import {FetchRequest} from 'ethers';
import {readPrivateJson} from '../src/deployment-status.mjs';
const dir = process.argv[2];
let target = 'settings';
try {
  const settings = await readPrivateJson(join(dir,'runtime/local-services.json'));
  const setup = await readPrivateJson(join(dir,'anvil-onboarding.json')) ?? await readPrivateJson(join(dir,'user-deployment.json'));
  const policy = await readPrivateJson(join(dir,'wallet/policy.json'));
  const rpc = policy?.registryRpcUrl || setup?.rpcUrl;
  const settlement = settings?.settlementUrl || setup?.settlementUrl;
  const expectedChain = policy?.chainId ?? setup?.chainId;
  if (!settlement || !rpc || !expectedChain) throw Error();
  target = 'Settlement';
  const endpoint = settlement.replace(/\/$/,'') + '/agentpay/purchase-readiness?skillId=0x'+'0'.repeat(64)+'&profileHash=0x'+'0'.repeat(64);
  const response = await fetch(endpoint,{signal:AbortSignal.timeout(12000),redirect:'error'});
  if (!response.ok || (await response.json())?.ok !== true) throw Error(String(response.status));
  target = 'chain RPC';
  const request = new FetchRequest(rpc);
  request.timeout = 12000;
  request.body = {jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]};
  const reply = await request.send();
  if (reply.statusCode !== 200 || !/^0x[0-9a-f]+$/i.test(reply.bodyJson?.result)) throw Error(String(reply.statusCode));
  if (BigInt(reply.bodyJson.result) !== BigInt(expectedChain)) {
    console.log('Chain RPC returned a different network. Check the saved RPC address and installation network.');
    process.exitCode = 1;
  } else {
    const local = address => ['localhost','127.0.0.1','[::1]'].includes(new URL(address).hostname);
    console.log(local(settlement) && local(rpc)
      ? 'Local endpoints are reachable. External proxy connectivity was not tested.'
      : 'Settlement and chain RPC checks passed.');
  }
} catch (error) {
  const auth = /407|proxy authentication/i.test([error.message,error.cause?.message,error.cause?.code].join(' '));
  console.log(target === 'settings' ? 'Complete local setup to test the saved Settlement and chain RPC addresses.' :
    auth ? 'Proxy authentication failed. Check the username and password.' :
    'Could not reach '+target+' with the proposed settings. Check the proxy address, credentials and network.');
  process.exitCode=1;
}
