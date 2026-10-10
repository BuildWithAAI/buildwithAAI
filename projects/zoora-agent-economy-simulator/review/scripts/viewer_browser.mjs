// Real Chrome integration via documented DevTools Protocol; no third-party JS dependencies.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const output=path.resolve('target/validation-evidence');
const folder=await mkdtemp(path.join(tmpdir(),'zoora-browser-'));
const chrome=process.env.CHROME_BIN || 'google-chrome';
const child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+folder,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;
try {
 const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Chrome start timed out')),20000);let log='';child.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);reject(new Error('Chrome exited '+code));});});
 const url=new URL(endpoint);const targets=await (await fetch('http://'+url.host+'/json')).json();socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map(),exceptions=[],requests=[];
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params);else if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timed out: '+method));},15000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 async function open(file){await send('Page.navigate',{url:pathToFileURL(file).href});for(let n=0;n<100;n++){if(await evaluate('document.body?.dataset.ready'))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Viewer never initialized');}
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
 await open(path.join(output,'experiments.html'));assert.equal(await evaluate('document.body.dataset.ready'),'true');assert.equal(await evaluate('document.querySelectorAll("#report-select option").length'),10);
 assert.equal(await evaluate('document.querySelectorAll("#cases tr").length'),20);const first=await evaluate('document.querySelector("#cases tr").textContent');
 await evaluate('document.getElementById("next").click()');assert.notEqual(await evaluate('document.querySelector("#cases tr").textContent'),first);
 await evaluate('document.getElementById("search").value="this-will-match-no-case";document.getElementById("search").dispatchEvent(new Event("input"))');assert.equal(await evaluate('document.getElementById("empty").hidden'),false);
 await evaluate('document.getElementById("report-select").value="1";document.getElementById("report-select").dispatchEvent(new Event("change"))');assert.equal(await evaluate('document.querySelectorAll("#distribution meter").length'),8);
 await evaluate('document.getElementById("status").value="Completed";document.getElementById("status").dispatchEvent(new Event("change"))');assert.equal(await evaluate('[...document.querySelectorAll("#cases .state")].every(s=>s.textContent==="Completed")'),true);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
 await writeFile(path.join(output,'viewer-mobile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 await open(path.join(output,'direct.html'));assert.equal(await evaluate('document.body.dataset.ready'),'true');assert.equal(await evaluate('document.getElementById("ledger-title").textContent'),'Direct payment transcript');assert.equal(await evaluate('document.querySelectorAll("#cases tr").length'),5);
 assert.equal(await evaluate('document.getElementById("proof").textContent.includes("voluntary returns")'),true);
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});await writeFile(path.join(output,'viewer-direct.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 const original=await readFile(path.join(output,'direct.html'),'utf8');const match=original.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/);const data=JSON.parse(match[1]);
 const build=value=>original.replace(match[0],'<script id="report-data" type="application/json">'+JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('&','\\u0026')+'</script>');
 data.reports[0].cases[0].title='</script><img src=x onerror="globalThis.injected=1">';const hostile=path.join(folder,'hostile.html');await writeFile(hostile,build(data));await open(hostile);
 assert.equal(await evaluate('document.body.dataset.ready'),'true');assert.equal(await evaluate('globalThis.injected===undefined && document.querySelector("img")===null'),true);
 assert.equal(await evaluate('document.getElementById("cases").textContent.includes("<img src=x")'),true);
 assert.equal(await evaluate('fetch("https://example.invalid/").then(()=>false).catch(()=>true)'),true);
 data.reports[0].ledger.funded='999';const invalid=path.join(folder,'invalid.html');await writeFile(invalid,build(data));await open(invalid);assert.equal(await evaluate('document.body.dataset.ready'),'error');assert.equal(await evaluate('document.getElementById("content").hidden'),true);
 assert.equal(exceptions.length,0);assert.equal(requests.filter(url=>/^https?:/.test(url)).length,0);
 const evidence={source_head_sha:process.env.SOURCE_HEAD_SHA,chrome:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),node:process.version,
  tests:['actual exported HTML renders','report selection','pagination','search empty state','status filtering','mobile no page overflow','direct-mode labels','hostile title stays text','CSP blocks connections','invalid ledger error state'],uncaught_exceptions:0,external_page_requests:0};
 await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
} finally {if(socket)socket.close();child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},2000).unref();}});await rm(folder,{recursive:true,force:true});}
