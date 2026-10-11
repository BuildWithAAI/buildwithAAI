// Actual Chrome exercises the served observer UI. No browser session or customer credentials.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve('evidence-output');await mkdir(output,{recursive:true});
const folder=await mkdtemp(path.join(tmpdir(),'zoora-service-browser-'));
const python=process.env.PYTHON_BIN||'python';const chrome=process.env.CHROME_BIN||'google-chrome';
let socket,child,service;
async function stop(process){if(!process||process.exitCode!==null||process.signalCode!==null)return;process.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{process.kill('SIGKILL');resolve();},2000);process.once('exit',()=>{clearTimeout(timer);resolve();});timer.unref();});}
async function ready(process,stream,pattern){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Start timed out')),20000);let log='';process[stream].on('data',chunk=>{log+=chunk;const match=log.match(pattern);if(match){clearTimeout(timer);resolve(match[1]);}});process.on('error',reject);process.on('exit',()=>{clearTimeout(timer);reject(new Error('Test process exited before ready'));});});}
try{
  service=spawn(python,['scripts/browser_fixture.py',folder],{stdio:['ignore','pipe','pipe']});
  const origin=await ready(service,'stdout',/"url":"(http:\/\/127\.0\.0\.1:\d+)"/);
  child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+path.join(folder,'chrome'),'about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await ready(child,'stderr',/DevTools listening on (ws:\/\/[^\s]+)/);
  const url=new URL(endpoint),targets=await(await fetch('http://'+url.host+'/json')).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map(),exceptions=[],requests=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params);else if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timed out: '+method));},15000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw new Error('UI did not reach expected state');};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:origin+'/'});await until('document.querySelectorAll("#records .card").length===50');
  assert.equal(await evaluate('document.getElementById("connection").textContent.includes("LOCAL_ONLY")'),true);
  assert.equal(await evaluate('document.querySelector("#stats b").textContent'),'51');
  await evaluate('document.getElementById("more").click()');await until('document.querySelectorAll("#records .card").length===51');
  assert.equal(await evaluate('new Set([...document.querySelectorAll("#records .card")].map(x=>x.dataset.recordId)).size'),51);
  await evaluate('document.getElementById("search").value="browser_agent_0";document.getElementById("search").dispatchEvent(new Event("input"))');
  assert.equal(await evaluate('document.querySelectorAll("#records .card").length'),1);
  assert.equal(await evaluate('document.getElementById("records").textContent.includes("INACTIVE PROFILE")'),true);
  assert.equal(await evaluate('document.getElementById("records").textContent.includes("Wallet control UNVERIFIED")'),true);
  assert.equal(await evaluate('document.getElementById("records").textContent.includes("<img src=x") && globalThis.injected===undefined && document.querySelector("img")===null'),true);
  await evaluate('document.getElementById("search").value="no-such-record";document.getElementById("search").dispatchEvent(new Event("input"))');assert.equal(await evaluate('document.querySelector("#records .empty").textContent'),'No matching loaded records.');
  await evaluate('document.querySelector("[data-tab=projects]").click()');await until('document.getElementById("records").textContent.includes("Browser test project")');
  await writeFile(path.join(output,'workspace-desktop.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await evaluate('document.querySelector("[data-tab=posts]").click()');await until('document.getElementById("records").textContent.includes("<img src=x")');assert.equal(await evaluate('globalThis.injected===undefined && document.querySelector("img")===null'),true);
  await evaluate('document.querySelector("[data-tab=offers]").click()');await until('document.getElementById("records").textContent.includes("UNAVAILABLE")');
  assert.equal(await evaluate('document.getElementById("records").textContent.includes("No actual payment")'),true);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
  await writeFile(path.join(output,'workspace-mobile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await send('Network.setBlockedURLs',{urls:[origin+'/v1/*']});await evaluate('document.getElementById("refresh").click()');await until('document.getElementById("error").hidden===false');assert.equal(await evaluate('document.getElementById("freshness").textContent.includes("stale")'),true);
  await send('Network.setBlockedURLs',{urls:[]});await evaluate('document.getElementById("refresh").click()');await until('document.getElementById("error").hidden===true && document.getElementById("connection").textContent.includes("Connected")');
  const csp=await(await fetch(origin+'/')).headers.get('content-security-policy');assert.ok(csp.includes("connect-src 'self'"));assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.equal(exceptions.length,0);assert.equal(requests.filter(url=>/^https?:/.test(url)&&!url.startsWith(origin+'/')).length,0);
  const evidence={source_head_sha:process.env.SOURCE_HEAD_SHA,activity:'AUTOMATED_TEST_FIXTURE',chrome:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),node:process.version,
    checks:['served API records render','local status and real counts','cursor pagination without duplicates','search and empty state','inactive profile','wallet control marked unverified','hostile biography stays text','project navigation','hostile discussion stays text','inactive provider offer unavailable','mobile no page overflow','loading failure marks records stale','refresh recovers','same-origin CSP and frame protection'],uncaught_exceptions:0,external_page_requests:0};
  await writeFile(path.join(output,'browser.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{if(socket)socket.close();await stop(child);await stop(service);await rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
