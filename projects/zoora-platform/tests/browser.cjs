"use strict";
// Actual browser interactions against disposable test state; no real wallet/model credentials.
const {chromium}=require("playwright");
const {spawn}=require("node:child_process");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"../../..");
const state=fs.mkdtempSync(path.join(os.tmpdir(),"zoora-platform-browser-"));
fs.chmodSync(state,0o700);
const child=spawn(process.env.PYTHON||"python",["-B","-m","zoora_platform","--data",state,"--port","8765"],{cwd:root,env:{...process.env,ZOORA_PUBLIC_ORIGIN:"",ZOORA_PRIVATE_PILOT:"0",PYTHONPATH:[root,path.join(root,"projects/zoora-agent-community"),path.join(root,"projects/zoora-platform")].join(path.delimiter)},stdio:["ignore","pipe","pipe"]});
let browser;
(async()=>{
 try{
  for(let i=0;i<120;i++){try{if((await fetch("http://127.0.0.1:8765/healthz")).ok)break;}catch{}if(i===119)throw new Error("test server unavailable");await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1040}});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("http://127.0.0.1:8765");
  await page.getByRole("heading",{name:"Economy control room"}).waitFor();
  await page.locator("#worker").filter({hasText:"online"}).waitFor();
  assert.equal(await page.locator(".layer").count(),12);
  await page.locator("#kind option[value='agent.work'][disabled]").waitFor({state:"attached"});
  assert.equal(await page.locator("#kind option[value='agent.work']").isDisabled(),true,"unconfigured provider must be unavailable");
  await page.getByRole("button",{name:"Sign in",exact:true}).first().click();
  const owner=JSON.parse(fs.readFileSync(path.join(state,"owner.credential.json"),"utf8")).token;
  await page.locator("#credential").fill(owner);
  await page.locator("#auth-form").getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByRole("button",{name:"Sign out",exact:true}).waitFor();
  await page.locator("#kind").selectOption("community.snapshot");
  await page.getByRole("button",{name:"Queue work"}).click();
  await page.locator("#jobs .state").filter({hasText:"SUCCEEDED"}).first().waitFor({timeout:15000});
  await page.locator("#jobs button").filter({hasText:"View"}).first().click();
  await page.locator("#artifact-content").filter({hasText:"SERVER_EXECUTED_REGISTERED_ADAPTER"}).waitFor();
  assert.ok((await page.locator("#artifact-content").innerText()).includes("instance_id"));
  await page.locator("#close-artifact").click();
  await page.locator("#schedule-enabled").check();
  await page.locator("#schedule-interval").fill("60");
  await page.locator("#schedule-runs").fill("2");
  await page.getByRole("button",{name:"Queue work"}).click();
  await page.locator("#schedules .job").first().waitFor({state:"attached"});
  await page.locator("#work details summary").click();
  await page.getByRole("button",{name:"Cancel schedule"}).first().click();
  await page.locator("#schedules").filter({hasText:"CANCELLED"}).waitFor();
  fs.mkdirSync("platform-ui-results",{recursive:true});
  await page.screenshot({path:"platform-ui-results/desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.locator("#overview").scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"mobile page must fit the viewport");
  await page.screenshot({path:"platform-ui-results/mobile.png",fullPage:true});
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  assert.equal(await page.locator("#schedules").innerText(),"");
  assert.equal(await page.locator("#artifact-content").innerText(),"");
  assert.deepEqual(errors,[]);
  fs.writeFileSync("platform-ui-results/results.json",JSON.stringify({checks:12,result:"passed",scope:"DISPOSABLE_LOCAL_HTTP_NO_REAL_WALLET_OR_PROVIDER"}));
 }finally{
  if(browser)await browser.close();child.kill("SIGTERM");
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
