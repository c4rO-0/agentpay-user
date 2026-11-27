// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {proxyEnvironment} from '../src/service-proxy.mjs';
import {installedUserDir} from '../src/local-data-directory.mjs';

test('Settlement fetch and native RPC both use the authenticated proxy and bypass it for localhost',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'agentpay-proxy-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const observed=[];
  const handler=(req,res)=>{
    observed.push(req.url);
    res.end(JSON.stringify(req.method==='POST'?{jsonrpc:'2.0',id:1,result:'0x2105'}:{ok:true}));
  };
  const target=http.createServer(handler);
  const listen=async server=>{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    t.after(()=>{server.closeAllConnections?.();server.close();});
    return server.address().port;
  };
  const port=await listen(target);
  const cert=join(dir,'cert.pem'),key=join(dir,'key.pem');
  await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
    '-subj','/CN=external.invalid','-addext','subjectAltName=DNS:external.invalid','-keyout',key,'-out',cert]);
  const tlsPort=await listen(https.createServer({key:await readFile(key),cert:await readFile(cert)},handler));
  const headers=[];
  const required="Basic "+Buffer.from("proxyuser:p@ss:word").toString("base64");
  const proxy=http.createServer((req,res)=>{
    headers.push(req.headers['proxy-authorization']);
    if (headers.at(-1)!==required) {res.writeHead(407).end();return;}
    const remote=http.request({host:'127.0.0.1',port,path:new URL(req.url).pathname,method:req.method},r=>r.pipe(res));
    req.pipe(remote);
  });
  proxy.on('connect',(req,socket,head)=>{
    headers.push(req.headers['proxy-authorization']);
    if (headers.at(-1)!==required) {socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');return;}
    const remote=net.connect(req.url.endsWith(':443')?tlsPort:port,'127.0.0.1',()=>{
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      remote.write(head);socket.pipe(remote).pipe(socket);
    });
    socket.on('close',()=>remote.destroy());
    remote.on('error',()=>socket.destroy());
  });
  const proxyPort=await listen(proxy);
  await mkdir(join(dir,'runtime'));
  const setup=async origin=>{
    await writeFile(join(dir,'runtime/local-services.json'),JSON.stringify({settlementUrl:origin}),{mode:0o600});
    await writeFile(join(dir,'anvil-onboarding.json'),JSON.stringify({chainId:8453,rpcUrl:origin+'/rpc'}),{mode:0o600});
  };
  const config={enabled:true,address:'http://127.0.0.1:'+proxyPort,username:'proxyuser',password:'p@ss:word'};
  const probe=env=>promisify(execFile)(process.execPath,[join(installedUserDir,'scripts/probe-service-proxy.mjs'),dir],{env:{...env,NODE_EXTRA_CA_CERTS:cert},timeout:12000});
  await setup('https://external.invalid');
  await probe(proxyEnvironment(config));
  assert.equal(headers.length,2);
  assert.deepEqual(headers,Array(2).fill('Basic '+Buffer.from('proxyuser:p@ss:word').toString('base64')));
  await setup('http://127.0.0.1:'+port);
  await probe(proxyEnvironment(config));
  await probe(proxyEnvironment({...config,enabled:false}));
  assert.equal(headers.length,2);
  assert.equal(observed.length,6);
  await setup('https://external.invalid');
  await assert.rejects(probe(proxyEnvironment({...config,password:'wrong-secret'})), error => {
    assert.doesNotMatch(String(error.stdout)+String(error.stderr),/wrong-secret|proxyuser/);
    return error.code === 1;
  });
  assert.equal(observed.length,6);
});

test('one installation can edit, toggle and forget credentials without displaying them',async t=>{
  const {proxyCommand}=await import('../src/proxy-command.mjs');
  const {stat}=await import('node:fs/promises');
  const home=await mkdtemp(join(tmpdir(),'proxy-cli-'));
  const dir=join(home,'instance');
  t.after(()=>rm(home,{recursive:true,force:true}));
  for (const [key,value] of Object.entries({HOME:home,XDG_STATE_HOME:home,AGENTPAY_USER_DATA_DIR:dir})) {
    const previous=process.env[key];process.env[key]=value;
    t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
  }
  const lines=[];
  const run=async (action,inputs=[])=>proxyCommand(action?[action]:[],{
    write:text=>lines.push(text),
    ask:async (message,options)=>{
      assert.ok(inputs.length,'unexpected prompt');
      if (message.startsWith('Proxy password')) assert.equal(options?.hidden,true);
      return inputs.shift();
    }
  });
  assert.equal(await run('configure',['http://127.0.0.1:7890','testuser','test-secret']),0);
  assert.equal((await stat(join(dir,'runtime/proxy.json'))).mode & 0o777,0o600);
  const endpoint=http.createServer((req,res)=>res.end(JSON.stringify(req.method==='POST'?{result:'0x2105'}:{ok:true})));
  endpoint.listen(0,'127.0.0.1');await once(endpoint,'listening');
  t.after(()=>endpoint.close());
  const origin='http://127.0.0.1:'+endpoint.address().port;
  await writeFile(join(dir,'anvil-onboarding.json'),JSON.stringify({chainId:8453,rpcUrl:origin,settlementUrl:origin}),{mode:0o600});
  assert.equal(await run('on'),0);
  assert.ok(lines.some(line=>line.includes('External proxy connectivity was not tested')));
  assert.equal(await run('on'),0);
  assert.equal(await run('off'),0);
  assert.equal(await run('off'),0);
  assert.equal(await run(),0);
  assert.match(lines.at(-2),/Proxy off.*authentication configured/);
  await writeFile(join(dir,'anvil-onboarding.json'),JSON.stringify({chainId:1,rpcUrl:origin,settlementUrl:origin}),{mode:0o600});
  assert.equal(await run('on'),1);
  assert.ok(lines.some(line=>line.includes('different network')));
  await writeFile(join(dir,'runtime/proxy.json'),'{damaged-test-secret');
  assert.equal(await run('clear',['q']),0);
  await assert.rejects(run('on'),{code:'PROXY_CONFIG_INVALID'});
  assert.equal(await run('clear',['confirm']),0);
  assert.equal(await run(),0);
  assert.match(lines.at(-2),/no saved address/);
  // A stale edit cannot overwrite a concurrent CLI's selection.
  const prompts=['http://127.0.0.1:8081',''];
  const staleEdit=await proxyCommand(['configure'],{write:line=>lines.push(line),ask:async()=>{
    if(prompts.length===2) {
      await promisify(execFile)(process.execPath,['--input-type=module','-e',`
        import {proxyCommand} from './src/proxy-command.mjs';
        const inputs=['http://127.0.0.1:8082',''];
        process.exitCode=await proxyCommand(['configure'],{ask:async()=>inputs.shift()});
      `],{cwd:installedUserDir,env:process.env,timeout:5000});
    }
    return prompts.shift();
  }});
  assert.equal(staleEdit,1);
  await run();
  assert.match(lines.at(-2),/127\.0\.0\.1:8082/);
  assert.doesNotMatch(lines.join('\n'),/test-secret|testuser/);
});

test('a failed proxy cannot fall back to a reachable origin for fetch, ethers or file downloads',async t=>{
  let hits=0,connections=0;
  const origin=http.createServer((_req,res)=>{hits++;res.end('{}');});
  origin.on('connection',()=>connections++);
  origin.listen(0,'127.0.0.2');await once(origin,'listening');
  t.after(()=>origin.close());
  const port=origin.address().port;
  const proxy=http.createServer();
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  const address='http://127.0.0.1:'+proxy.address().port;
  await new Promise(resolve=>proxy.close(resolve));
  const env=proxyEnvironment({enabled:true,address,username:'',password:''});
  const code=`
    import assert from 'node:assert/strict';
    import {FetchRequest} from 'ethers';
    import {downloadFile} from './src/file-download.mjs';
    const url='http://127.0.0.2:${port}';
    for (const endpoint of [url,url.replace('http:','https:')]) {
      await assert.rejects(fetch(endpoint,{signal:AbortSignal.timeout(3000)}));
      const rpc=new FetchRequest(endpoint);rpc.timeout=3000;
      await assert.rejects(rpc.send());
    }
    let lookups=0;
    await assert.rejects(downloadFile('https://file.invalid/item',{
      resolveHost:()=>{lookups++;throw Error()},maxBytes:10,write:()=>{}
    }),{code:'FILE_PROXY_REQUIRED'});
    assert.equal(lookups,0);
  `;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{cwd:installedUserDir,env,timeout:10000});
  const home=await mkdtemp(join(tmpdir(),'agentpay-health-proxy-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const dir=join(home,'data');
  await mkdir(join(dir,'runtime'),{mode:0o700,recursive:true});
  await writeFile(join(dir,'runtime/proxy.json'),JSON.stringify({version:1,enabled:true,address,username:'',password:'',
    revision:'00000000-0000-0000-0000-000000000001'}),{mode:0o600});
  await writeFile(join(dir,'anvil-onboarding.json'),JSON.stringify({chainId:8453,
    rpcUrl:'http://127.0.0.2:'+port,settlementUrl:'http://127.0.0.2:'+port}),{mode:0o600});
  await assert.rejects(promisify(execFile)(process.execPath,[join(installedUserDir,'scripts/agentpay-cli.mjs'),'health'],{
    env:{...process.env,HOME:home,XDG_STATE_HOME:home,AGENTPAY_USER_DATA_DIR:dir,no_proxy:'*',NO_PROXY:'*'},
    timeout:45000
  }),error=>error.code===1 && /Checking Chain RPC/.test(error.stdout) && /Checking Settlement HTTP/.test(error.stdout));
  assert.equal(connections,0);
  assert.equal(hits,0);
  await fetch('http://127.0.0.2:'+port);
  assert.equal(hits,1);
});

test('switching proxy restarts the managed pair once and preserves both processes on repeated on',async t=>{
  const {spawn}=await import('node:child_process');
  const {randomUUID}=await import('node:crypto');
  const {autostartFiles}=await import('../src/autostart-files.mjs');
  const {initializeCapabilities,Phase0Wallet}=await import('@c4roa0/agentpay-wallet/local');
  const {initializeCallerCredential}=await import('../src/caller-auth.mjs');
  const {saveServiceSettings}=await import('../src/local-services.mjs');
  const {proxyCommand}=await import('../src/proxy-command.mjs');
  const {waitForServiceReadiness}=await import('../src/service-readiness.mjs');
  const home=await mkdtemp(join(tmpdir(),'managed-proxy-'));
  const dir=join(home,'data');
  t.after(()=>rm(home,{recursive:true,force:true}));
  for(const [key,value] of Object.entries({HOME:home,XDG_STATE_HOME:home,AGENTPAY_USER_DATA_DIR:dir})){
    const previous=process.env[key];process.env[key]=value;
    t.after(()=>{if(previous===undefined) delete process.env[key];else process.env[key]=previous;});
  }
  for(const name of ['wallet','runtime']) await mkdir(join(dir,name),{recursive:true,mode:0o700});
  await Phase0Wallet.initialize(join(dir,'wallet'),'disposable fixture password');
  await initializeCapabilities(join(dir,'wallet'));
  await initializeCallerCredential(join(dir,'runtime/caller.token'));
  const server=http.createServer((req,res)=>res.end(JSON.stringify(req.method==='POST'?{result:'0x2105'}:{ok:true})));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const origin='http://127.0.0.1:'+server.address().port;
  const reserve=net.createServer();
  reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
  const runtimeUrl='http://127.0.0.1:'+reserve.address().port;
  await new Promise(resolve=>reserve.close(resolve));
  await saveServiceSettings({dataDir:dir,runtimeUrl,settlementUrl:origin});
  await writeFile(join(dir,'anvil-onboarding.json'),JSON.stringify({chainId:8453,rpcUrl:origin}),{mode:0o600});
  const units=join(home,'.config/systemd/user');
  await mkdir(units,{recursive:true});
  for(const [name,body] of Object.entries(autostartFiles({node:process.execPath,userDir:installedUserDir,dataDir:dir})))
    await writeFile(join(units,name),body,{mode:0o600});
  // Simulate only systemd job dispatch. Both product wrappers, IPC and
  // readiness probes run as real processes against this installation.
  const processes=new Map();
  async function stop(){
    await Promise.all([...processes.values()].map(async ({child,exited})=>{child.kill();await exited;}));
    processes.clear();
  }
  t.after(stop);
  const ctl=async (action,...args)=>{
    if(action==='show'){
      const record=processes.get(args[0]);
      return {stdout:'ActiveState='+(record?'active':'inactive')+'\nInvocationID='+(record?.id||'')+'\n'};
    }
    if(action==='stop')return stop();
    assert.equal(action,'start');
    for(const unit of args){
      const role=unit.includes('wallet')?'wallet':'runtime';
      const id=randomUUID().replaceAll('-','');
      const child=spawn(process.execPath,[join(installedUserDir,'scripts/local-service.mjs'),role,dir],{
        env:{...process.env,INVOCATION_ID:id},stdio:'ignore'
      });
      processes.set(unit,{child,id,exited:once(child,'exit')});
    }
  };
  await ctl('start','agentpay-local-wallet.service','agentpay-local-runtime.service');
  await waitForServiceReadiness(dir);
  const ids=()=>[...processes.values()].map(v=>v.child.pid);
  const initial=ids();
  const answers=['http://127.0.0.1:7890','','confirm'];
  const options={ctl,write:()=>{},ask:async()=>{assert.ok(answers.length);return answers.shift();}};
  assert.equal(await proxyCommand(['on'],options),0);
  const applied=ids();assert.equal(applied.length,2);
  assert.ok(applied.every(pid=>!initial.includes(pid)));
  assert.equal(await proxyCommand(['on'],options),0);
  assert.deepEqual(ids(),applied);
  assert.deepEqual(answers,[]);
});
