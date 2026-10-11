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
  const until=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw new Error('UI did not reach expected state: '+expression);};
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
  assert.equal(await evaluate('document.getElementById("records").textContent.includes("SIGNATURE VERIFIED")'),true);
  assert.equal(await evaluate('document.getElementById("records").textContent.includes("<img src=x") && globalThis.injected===undefined && document.querySelector("img")===null'),true);
  await evaluate('document.querySelector("#records .card button").click()');await until('document.querySelector("#records .evidence")?.textContent.includes("ZOORA_AE007_RAW_ED25519_V1")');
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
  await evaluate('document.querySelector("[data-tab=transactions]").click()');await until('document.querySelector("#records .empty")?.textContent.includes("No transaction observations") && document.getElementById("refresh").disabled===false && document.getElementById("error").hidden===true');
  // Explicit SYNTHETIC response tests exact u64 rendering and untrusted text only;
  // it is not persisted, not live RPC evidence, and is never a production default.
  await evaluate(`globalThis.originalFetch=fetch;globalThis.synthetic={id:"fixture",agent_id:"test",created_ms:0,report:{classification:"SYNTHETIC",state:"AVAILABLE",execution:"FAILED",network:"solana:devnet",slot:"18446744073709551615",signature:"test signature",native_balance_change_lamports:"-5000",fee_lamports:"5000",pnl:"UNAVAILABLE",related_to_agent:false,native_transfer_instruction_count:1,native_transfer_instructions:[{scope:"OUTER",lamports:"18446744073709551615",settlement:"NOT_SETTLED"}],source:"AUTOMATED_TEST_FIXTURE",commitment:"finalized",observed_at_ms:null,available_at_ms:0,quality_flags:["<img src=x onerror=globalThis.injected=1>","NO_PAYMENT_ATTRIBUTION"],missingness:["block_time"]}};globalThis.fetch=(url,options)=>String(url).startsWith("/v1/transactions")?Promise.resolve(new Response(JSON.stringify({items:[synthetic],next_after:null}),{status:200,headers:{"Content-Type":"application/json"}})):originalFetch(url,options);document.getElementById("refresh").click()`);
  await until('document.querySelector("#records .card")!==null');
  assert.equal(await evaluate('document.getElementById("records").textContent.includes("18446744073709551615")'),true);
  assert.equal(await evaluate('document.getElementById("records").textContent.includes("SYNTHETIC · AVAILABLE · Execution FAILED")'),true);
  assert.equal(await evaluate('document.getElementById("records").textContent.includes("NOT_SETTLED") && document.getElementById("records").textContent.includes("P/L UNAVAILABLE")'),true);
  assert.equal(await evaluate('globalThis.injected===undefined && document.querySelector("img")===null'),true);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
  await evaluate('globalThis.fetch=originalFetch;document.getElementById("refresh").click()');await until('document.querySelector("#records .empty")!==null');
  const csp=await(await fetch(origin+'/')).headers.get('content-security-policy');assert.ok(csp.includes("connect-src 'self'"));assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.equal(exceptions.length,0);assert.equal(requests.filter(url=>/^https?:/.test(url)&&!url.startsWith(origin+'/')).length,0);
  const evidence={source_head_sha:process.env.SOURCE_HEAD_SHA,activity:'AUTOMATED_TEST_FIXTURE',chrome:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),node:process.version,
    checks:['served API records render','local status and real counts','cursor pagination without duplicates','search and empty state','inactive profile','historical wallet proof marked signature verified','hostile biography stays text','project navigation','hostile discussion stays text','inactive provider offer unavailable','mobile no page overflow','loading failure marks records stale','refresh recovers','same-origin CSP and frame protection','public wallet proof inspection','transaction empty state','exact u64 slot and units','synthetic render test explicitly labeled','failed instructions not settled and P/L unavailable','transaction hostile flags stay text','mobile transaction no overflow','transaction refresh returns to stored empty records'],uncaught_exceptions:0,external_page_requests:0};
  await writeFile(path.join(output,'browser.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{if(socket)socket.close();await stop(child);await stop(service);await rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
