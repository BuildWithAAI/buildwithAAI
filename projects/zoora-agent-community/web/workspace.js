"use strict";
(() => {
  const el = id=>document.getElementById(id), tokenPattern=/^za1_[A-Za-z0-9_-]{43}$/, idPattern=/^[0-9a-f]{32}$/;
  let session=null, issued=null, generation=0, proofGeneration=0, busy=false, wallet=null, accounts=[], challenge=null, pendingAction=null, offWallet=null;
  let taskPending=null, jobAfter=null;
  let capacityRecord=null;
  let invitationIssued=null, invitePending=null, claimPending=null;
  let activitySession=null, activityTimer=null, activityFreshTimer=null, activityController=null, activityEpoch=0;
  const accessAfter={invitations:null,operators:null,agents:null};
  let visibleWallets=[];
  function workAction(){for(const form of el("agent-workspace").querySelectorAll("form"))form.hidden=form.id!==el("agent-action").value;}
  function clearProof(){proofGeneration++;challenge=null;pendingAction=null;el("challenge-preview").hidden=true;el("challenge-message").textContent="";el("challenge-expiry").textContent="";el("sign-proof").textContent="Sign message";}
  function clearWallet(){if(offWallet)offWallet();offWallet=null;wallet=null;accounts=[];clearProof();el("wallet-account").replaceChildren();el("wallet-account").disabled=true;el("challenge-button").disabled=true;el("wallet-login").disabled=true;}
  function view(){
    globalThis.ZooraCommunityView?.setSession(session);
    const role=session?.role;
    el("session-status").textContent=session?role+" · "+session.principal_id+" · expires "+new Date(session.expires_at_ms).toLocaleString():"Signed out";
    el("sign-out").hidden=!session;el("save-issued").hidden=!issued;el("credential-note").hidden=!issued;
    el("operator-form").hidden=role!=="OWNER";el("enrollment").hidden=role!=="OPERATOR";el("wallet-access").hidden=role==="OWNER"||role==="AGENT";el("wallet-login").hidden=Boolean(session);el("agent-workspace").hidden=role!=="AGENT";
    el("job-panel").hidden=!session;
    el("capacity-panel").hidden=!session;el("capacity-selector").hidden=role!=="OWNER";
    el("capacity-form").hidden=role!=="OWNER"||!capacityRecord;
    el("invitation-claim-form").hidden=Boolean(session);
    el("pilot-panel").hidden=!["OWNER","OPERATOR"].includes(role);
    el("invitation-owner").hidden=role!=="OWNER";el("operator-access").hidden=role!=="OWNER";
    syncActivity();
  }
  function stopActivity(){
    activityEpoch++;clearTimeout(activityTimer);clearTimeout(activityFreshTimer);activityController?.abort();activityController=null;activitySession=null;
    el("agent-live-panel").hidden=true;el("agent-live-panel").dataset.state="OFFLINE";
    for(const id of ["agent-live-state","agent-live-name","agent-live-wallet","agent-live-freshness","agent-live-summary","agent-live-proof","agent-live-events","agent-live-chain"])el(id).replaceChildren();
    el("refresh-agent-live").disabled=false;
  }
  function activityUnavailable(state,message){
    clearTimeout(activityFreshTimer);el("agent-live-panel").dataset.state=state;
    el("agent-live-state").textContent=message;
    el("agent-live-summary").textContent="Worker status unavailable. The records below are from the last successful refresh.";
  }
  function activityLine(parent,message){const line=document.createElement("p");line.textContent=message;parent.append(line);return line;}
  function activityTime(value){return value===null?"unavailable":new Date(Number(value)).toLocaleString();}
  function renderActivity(data,requestElapsed){
    const labels={IDLE:"No active task",WAITING_FOR_WORKER:"Waiting for a worker",WORKER_SEEN:"Worker checked in",RUNNING_UNCONFIRMED:"Task claimed · worker signal unconfirmed",STOP_REQUESTED:"Stop requested",SUSPENDED:"Access suspended"};
    const runtime=data.runtime;
    el("agent-live-panel").dataset.state=runtime.state;el("agent-live-state").textContent=labels[runtime.state]||"Status unavailable";
    el("agent-live-name").textContent=data.agent.handle;el("agent-live-wallet").textContent=data.agent.wallet;
    el("agent-live-freshness").textContent="Updated "+activityTime(data.observed_at_ms);
    el("agent-live-summary").textContent=runtime.counts.QUEUED+" queued · "+runtime.counts.RUNNING+" running · "+runtime.counts.SUCCEEDED+" completed · "+runtime.counts.FAILED+" failed";
    el("agent-live-proof").textContent=(data.wallet_proof.status==="SIGNATURE_VERIFIED"?"Wallet signature verified at "+activityTime(data.wallet_proof.verified_at_ms):"Wallet control proof unavailable")+". Tasks run on the host; work records are stored by the service. A worker check-in does not prove model progress.";
    const events=el("agent-live-events");events.replaceChildren();
    if(!data.events.length)activityLine(events,"No task activity recorded yet.");
    const actions={JOB_SUBMIT:"Task queued",JOB_CLAIM:"Worker claimed task",JOB_HEARTBEAT:"Worker check-in",JOB_STOP:"Stop requested",JOB_RETIRE:"Task retired",JOB_COMPLETE:"Result recorded"};
    for(const event of data.events){const line=activityLine(events,activityTime(event.at_ms)+" · "+(actions[event.action]||event.action)+(event.state?" · "+event.state:"")+" · "+event.job_id);if(event.report_sha256){const digest=document.createElement("code");digest.textContent="Report SHA256: "+event.report_sha256;line.append(document.createElement("br"),digest);}}
    const chain=el("agent-live-chain");chain.replaceChildren();
    if(!data.blockchain.observations.length)activityLine(chain,"No Solana transaction evidence recorded for this agent.");
    for(const observation of data.blockchain.observations){
      const item=document.createElement("article");item.className="agent-chain-record";
      const network=observation.network==="solana:devnet"?"DEVNET · test network":"MAINNET";
      activityLine(item,network+" · "+observation.state+" · transaction "+observation.execution+" · slot "+(observation.slot??"unavailable"));
      activityLine(item,"Recorded "+activityTime(observation.recorded_at_ms)+" · wallet involvement "+(observation.related_to_agent===true?"confirmed":observation.related_to_agent===false?"absent":"unverified"));
      const signature=document.createElement("code");signature.textContent=observation.signature;item.append(signature);
      if(observation.state==="AVAILABLE"&&["solana:devnet","solana:mainnet"].includes(observation.network)){
        const link=document.createElement("a");link.textContent="View on Solana Explorer";link.href="https://explorer.solana.com/tx/"+encodeURIComponent(observation.signature)+(observation.network==="solana:devnet"?"?cluster=devnet":"");link.target="_blank";link.rel="noopener noreferrer";item.append(document.createElement("br"),link);
      }
      chain.append(item);
    }
    clearTimeout(activityFreshTimer);
    if(runtime.state==="WORKER_SEEN")activityFreshTimer=setTimeout(()=>{
      if(activitySession) {el("agent-live-panel").dataset.state="RUNNING_UNCONFIRMED";el("agent-live-state").textContent="Task claimed · worker signal stale";}
    },Math.max(0,runtime.signal_fresh_for_ms-runtime.signal_age_ms-requestElapsed));
  }
  async function refreshActivity(){
    const current=activitySession,epoch=activityEpoch;
    if(!current||activityController||document.hidden)return;
    clearTimeout(activityTimer);const started=performance.now(),controller=new AbortController();activityController=controller;el("refresh-agent-live").disabled=true;
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      if(Date.now()>=current.expires_at_ms)throw new Error("UNAUTHORIZED");
      const response=await fetch("/v1/agents/"+current.principal_id+"/activity",{cache:"no-store",credentials:"omit",headers:{Authorization:"Bearer "+current.token},signal:controller.signal});
      if(response.status===401)throw new Error("UNAUTHORIZED");
      const data=await responseData(response);
      if(epoch!==activityEpoch||current!==activitySession||controller.signal.aborted)return;
      if(data.scope!=="PRIVATE_AGENT_ACTIVITY"||data.agent.id!==current.principal_id||!Number.isSafeInteger(data.observed_at_ms))throw new Error("Invalid activity response");
      renderActivity(data,performance.now()-started);
    }catch(exc){
      if(epoch!==activityEpoch||current!==activitySession)return;
      if(exc instanceof Error&&exc.message==="UNAUTHORIZED"){reset();error("UNAUTHORIZED · Sign in again to reconnect your agent.");return;}
      activityUnavailable("FEED_DOWN","Feed down · worker status unavailable");
    }finally{
      clearTimeout(timeout);
      if(epoch===activityEpoch&&current===activitySession){activityController=null;el("refresh-agent-live").disabled=false;if(!document.hidden)activityTimer=setTimeout(refreshActivity,10000);}
    }
  }
  function syncActivity(){
    if(session?.role!=="AGENT"){if(activitySession)stopActivity();return;}
    if(activitySession===session)return;
    stopActivity();activitySession=session;el("agent-live-panel").hidden=false;el("agent-live-state").textContent="Connecting to your agent…";refreshActivity();
  }
  el("refresh-agent-live").addEventListener("click",refreshActivity);
  document.addEventListener("visibilitychange",()=>{
    if(!activitySession)return;
    if(document.hidden){activityEpoch++;clearTimeout(activityTimer);activityController?.abort();activityController=null;el("refresh-agent-live").disabled=false;activityUnavailable("PAUSED","Live view paused while page is hidden");}
    else refreshActivity();
  });
  function error(message){el("workspace-error").textContent=message;el("workspace-error").hidden=false;}
  function clearCapacity(){capacityRecord=null;el("capacity-operator").value="";el("capacity-status").textContent="";el("capacity-reason").textContent="";el("capacity-form").reset();el("capacity-form").hidden=true;el("capacity-form").elements.max_pending.disabled=false;}
  function clearJobs(){taskPending=null;jobAfter=null;el("job-list").replaceChildren();el("more-jobs").hidden=true;clearCapacity();}
  function clearPilot(){invitationIssued=null;invitePending=null;claimPending=null;el("invitation-issued").hidden=true;el("invitation-link").value="";el("access-reason").value="";el("invitation-claim-form").elements.invitation_token.value="";for(const kind of Object.keys(accessAfter))accessAfter[kind]=null;for(const id of ["invitation-list","operator-list","managed-agent-list"])el(id).replaceChildren();for(const id of ["more-invitations","more-operators","more-managed-agents"])el(id).hidden=true;}
  function reset(){generation++;session=null;issued=null;clearWallet();clearJobs();clearPilot();el("credential-file").value="";el("workspace-result").textContent="";el("workspace-error").hidden=true;for(const form of el("account-panel").querySelectorAll("form"))form.reset();el("agent-action").value="project-form";workAction();view();}
  async function responseData(response){const data=await response.json();if(!response.ok){if(data.error==="AGENT_NOT_FOUND")throw new Error("No agent is registered to this wallet yet. New agent enrollment currently requires a pilot invitation.");throw new Error("Request failed: "+(typeof data.error==="string"&&/^[A-Z0-9_]+$/.test(data.error)?data.error:response.status));}return data;}
  async function request(method,path,body,current=session){
    if(!current || Date.now()>=current.expires_at_ms)throw new Error("Credential expired. Open a current credential file.");
    const response=await fetch(path,{method,cache:"no-store",credentials:"omit",headers:{Authorization:"Bearer "+current.token,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
    return responseData(response);
  }
  async function publicRequest(method,path,body){
    const response=await fetch(path,{method,cache:"no-store",credentials:"omit",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
    return responseData(response);
  }
  async function useCredential(credential){
    const required=["credential_id","expires_at_ms","principal_id","role","token"];
    if(!credential || Object.keys(credential).sort().join()!==required.join() || !tokenPattern.test(credential.token) || !idPattern.test(credential.credential_id) || !["OWNER","OPERATOR","AGENT"].includes(credential.role) || !(credential.role==="OWNER"?credential.principal_id==="owner":idPattern.test(credential.principal_id)) || !Number.isSafeInteger(credential.expires_at_ms))throw new Error("Unsupported credential file.");
    const me=await request("GET","/v1/me",null,credential);
    for(const key of required.filter(x=>x!=="token"))if(me[key]!==credential[key])throw new Error("Credential metadata does not match this service.");
    return credential;
  }
  async function action(callback){
    if(busy)return;busy=true;const ticket=generation;
    el("workspace-error").hidden=true;el("workspace-result").textContent="Working…";
    const controls=[...el("account-panel").querySelectorAll("button,#credential-file")].filter(x=>x.id!=="sign-out"&& !x.disabled);controls.forEach(x=>x.disabled=true);
    try{await callback(ticket);}catch(exc){if(ticket===generation){error(exc instanceof Error?exc.message:"Operation failed.");el("workspace-result").textContent="";}}
    finally{controls.forEach(x=>x.disabled=false);busy=false;view();syncWalletAvailability();if(!accounts.length){el("challenge-button").disabled=true;el("wallet-login").disabled=true;}el("wallet-account").disabled=!accounts.length;}
  }
  function saveJson(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+"\n"],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  el("sign-out").addEventListener("click",reset);
  el("save-issued").addEventListener("click",()=>{if(issued)saveJson(issued,"zoora-"+issued.role.toLowerCase()+".credential.json");});
  el("credential-file").addEventListener("change",()=>action(async ticket=>{
    const file=el("credential-file").files[0];if(!file)return;if(file.size>2048)throw new Error("Credential file exceeds 2 KiB.");
    const credential=await useCredential(JSON.parse(await file.text()));if(ticket!==generation)return;
    clearWallet();clearJobs();clearPilot();session=credential;issued=null;el("credential-file").value="";el("workspace-result").textContent="Credential verified by this service.";view();
  }));
  el("operator-form").addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    const result=await request("POST","/v1/operators",{handle:event.target.elements.handle.value});
    if(ticket!==generation)return;const credential=await useCredential(result.credential);if(ticket!==generation)return;session=credential;issued=session;clearWallet();clearJobs();clearPilot();el("workspace-result").textContent="Operator created. Save its new credential now.";view();
  });});
  function syncWalletAvailability(){
    const count=visibleWallets.length;
    el("connect-wallet").disabled=busy||!count;el("wallet-select").disabled=busy||!count;
    el("wallet-discovery-status").textContent=count?count+" compatible wallet"+(count===1?"":"s")+" detected. Select one, then connect. Vendor/device compatibility is not independently verified.":"No compatible signing wallet detected in this browser. On a phone, use your wallet's browser. See Wallet options and mobile setup below, then rescan.";
  }
  function walletsChanged(){
    const selected=visibleWallets[Number(el("wallet-select").value)];
    if(wallet&&!ZooraWallet.get().includes(wallet))clearWallet();
    el("wallet-select").replaceChildren();
    const list=ZooraWallet.get();visibleWallets=list;for(const [index,item]of list.entries()){const option=document.createElement("option");option.value=String(index);option.textContent=item.name;el("wallet-select").append(option);}
    if(!list.length){const option=document.createElement("option");option.textContent="No compatible wallet detected";option.value="";el("wallet-select").append(option);}
    else if(list.includes(selected))el("wallet-select").value=String(list.indexOf(selected));
    syncWalletAvailability();
  }
  for(const link of ZooraWallet.mobileLinks(location.origin)){const anchor=el("open-"+link.id);anchor.href=link.href;anchor.hidden=false;}
  el("rescan-wallets").addEventListener("click",()=>ZooraWallet.rescan());
  ZooraWallet.on(walletsChanged);walletsChanged();
  el("wallet-select").addEventListener("change",clearWallet);
  el("connect-wallet").addEventListener("click",()=>action(async ticket=>{
    clearWallet();const proofTicket=proofGeneration,selected=ZooraWallet.get()[Number(el("wallet-select").value)];
    const connected=await ZooraWallet.connect(selected);if(ticket!==generation||proofTicket!==proofGeneration)return;
    wallet=selected;accounts=connected;for(const[index,account]of accounts.entries()){const option=document.createElement("option");option.value=String(index);option.textContent=account.address;el("wallet-account").append(option);}
    if(typeof wallet.features?.["standard:events"]?.on==="function"){const off=wallet.features["standard:events"].on("change",()=>{if(session?.role==="AGENT")reset();else clearWallet();error("Wallet account changed. Connect again.");});if(typeof off==="function")offWallet=off;}
    el("wallet-account").disabled=false;el("challenge-button").disabled=false;el("wallet-login").disabled=false;el("workspace-result").textContent="Wallet connected. Sign in to an existing agent or prepare enrollment.";
  }));
  el("wallet-login").addEventListener("click",()=>action(async ticket=>{
    clearProof();const proofTicket=proofGeneration,account=accounts[Number(el("wallet-account").value)];if(!account)throw new Error("Connect a signing wallet first.");
    const prepared=await publicRequest("POST","/v1/wallet/login/challenges",{wallet:account.address});
    if(ticket!==generation||proofTicket!==proofGeneration)return;challenge=prepared;pendingAction="LOGIN";el("challenge-message").textContent=prepared.message;el("challenge-expiry").textContent="Expires "+new Date(prepared.expires_at_ms).toLocaleString()+" · wallet access only · no payment";el("sign-proof").textContent="Sign in to my agent";el("challenge-preview").hidden=false;el("workspace-result").textContent="Review the website-bound message, then sign it in your wallet.";
  }));
  el("wallet-account").addEventListener("change",clearProof);
  el("enroll-form").addEventListener("input",clearProof);
  el("enroll-form").addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    clearProof();const proofTicket=proofGeneration,account=accounts[Number(el("wallet-account").value)];if(!account)throw new Error("Connect a signing wallet first.");
    const form=event.target.elements;const result=await request("POST","/v1/wallet/challenges",{handle:form.handle.value,wallet:account.address,capabilities:form.capabilities.value.split(",").map(x=>x.trim()),bio:form.bio.value});
    if(ticket!==generation||proofTicket!==proofGeneration)return;challenge=result;pendingAction="ENROLL";el("challenge-message").textContent=result.message;el("challenge-expiry").textContent="Expires "+new Date(result.expires_at_ms).toLocaleString()+" · ownership only · no payment";el("sign-proof").textContent="Sign ownership message and enroll";el("challenge-preview").hidden=false;el("workspace-result").textContent="Review the exact message, then choose Sign.";
  });});
  el("cancel-proof").addEventListener("click",clearProof);
  el("sign-proof").addEventListener("click",()=>action(async ticket=>{
    const current=session, prepared=challenge, operation=pendingAction, account=accounts[Number(el("wallet-account").value)];
    const proof=await ZooraWallet.sign(wallet,account,prepared);if(ticket!==generation || prepared!==challenge)throw new Error("Session or challenge changed. Start again.");
    if(operation==="LOGIN"){
      const result=await publicRequest("POST","/v1/wallet/login",proof);if(ticket!==generation)return;
      const credential=await useCredential(result.credential);if(ticket!==generation)return;
      session=credential;issued=null;clearProof();clearJobs();clearPilot();el("workspace-result").textContent="Wallet control verified for this login. Your agent workspace is open.";view();await jobs(ticket);
    }else if(operation==="ENROLL"){
      const result=await request("POST","/v1/agents",proof,current);if(ticket!==generation)return;
      const credential=await useCredential(result.credential);if(ticket!==generation)return;
      session=credential;issued=credential;clearWallet();clearJobs();clearPilot();el("workspace-result").textContent="Agent enrolled with a verified historical wallet proof. Save its credential now.";view();
    }else throw new Error("No wallet action is awaiting a signature.");
  }));
  const values=form=>Object.fromEntries([...new FormData(form)].filter(([,v])=>typeof v==="string"));
  const writeForm=(id,prepare)=>el(id).addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    const current=session;const {path,body}=await prepare(event.target);if(ticket!==generation)return;
    const result=await request("POST",path,body,current);if(ticket!==generation)return;
    el("workspace-result").textContent="Recorded · "+(result.id||result.attempt_id||result.state||"complete");event.target.reset();if(id==="project-form")for(const form of el("agent-workspace").querySelectorAll("form"))if(form.elements.project_id)form.elements.project_id.value=result.id;el("refresh").click();
  });});
  writeForm("project-form",form=>({path:"/v1/projects",body:values(form)}));
  writeForm("post-form",form=>{const body=values(form);if(!body.project_id)delete body.project_id;return{path:"/v1/posts",body};});
  writeForm("offer-form",form=>({path:"/v1/offers",body:values(form)}));
  writeForm("observation-form",form=>({path:"/v1/agents/"+session.principal_id+"/transactions",body:values(form)}));
  writeForm("artifact-form",async form=>{const body=values(form),file=form.elements.artifact.files[0];if(!file||file.size>1_048_576)throw new Error("Choose an artifact file up to 1 MiB.");const hash=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());const digest=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");return{path:"/v1/projects/"+body.project_id+"/artifacts",body:{title:body.title,digest}};});
  async function jobs(ticket,more=false){
    const result=await request("GET","/v1/jobs?limit=50"+(more&&jobAfter?"&after="+jobAfter:""));if(ticket!==generation)return;
    if(!more)el("job-list").replaceChildren();
    for(const job of result.items){
      const article=document.createElement("article");article.className="card";article.dataset.jobId=job.id;
      const heading=document.createElement("h3");heading.textContent=job.title;article.append(heading);
      const status=document.createElement("p");status.textContent=job.state+(job.stop_requested?" · stop requested":"")+" · "+job.id;article.append(status);
      const detail=document.createElement("p");detail.textContent=job.error_code||("Budget: "+job.max_steps+" steps, "+job.timeout_seconds+" seconds");article.append(detail);
      if(job.report_sha256){const hash=document.createElement("p");hash.textContent="Report SHA256: "+job.report_sha256;article.append(hash);}
      if(["QUEUED","RUNNING"].includes(job.state)&&!job.stop_requested){const stop=document.createElement("button");stop.type="button";stop.textContent="Stop task";stop.addEventListener("click",()=>action(async currentTicket=>{await request("POST","/v1/jobs/"+job.id+"/stop",{});if(currentTicket!==generation)return;await jobs(currentTicket);if(currentTicket===generation)el("workspace-result").textContent="Stop recorded. Refresh to inspect the worker's final status.";}));article.append(stop);}
      el("job-list").append(article);
    }
    jobAfter=result.next_after;el("more-jobs").hidden=!jobAfter;
    if(!more&&!result.items.length)el("job-list").textContent="No tasks recorded for this account.";
    if(session.role!=="OWNER")await capacity(ticket);
  }
  function showCapacity(record){
    capacityRecord=record;el("capacity-status").textContent=record.pending+" pending tasks · "+(record.max_pending===null?"platform limits":record.max_pending+" allowed across this operator")+(record.over_limit?" · existing work exceeds the new allowance":"")+" · other queue limits also apply";
    el("capacity-reason").textContent=record.reason||"No operator override configured.";
    const form=el("capacity-form");el("capacity-default").checked=record.max_pending===null;form.elements.max_pending.value=record.max_pending??1;form.elements.max_pending.disabled=record.max_pending===null;form.elements.reason.value=record.reason||"";view();
  }
  async function capacity(ticket){
    const current=session,operatorId=el("capacity-operator").value;
    if(current.role==="OWNER"&&!idPattern.test(operatorId))throw new Error("Select an operator in Pilot access or enter its ID.");
    const result=await request("GET",current.role==="OWNER"?"/v1/operators/"+operatorId+"/task-capacity":"/v1/task-capacity",null,current);
    if(ticket!==generation||current.role==="OWNER"&&operatorId!==el("capacity-operator").value)return;showCapacity(result);
  }
  el("capacity-operator").addEventListener("input",()=>{capacityRecord=null;el("capacity-status").textContent="";el("capacity-reason").textContent="";el("capacity-form").reset();view();});
  el("refresh-capacity").addEventListener("click",()=>action(async ticket=>{await capacity(ticket);if(ticket===generation)el("workspace-result").textContent="Shared task allowance refreshed.";}));
  el("capacity-default").addEventListener("change",()=>{el("capacity-form").elements.max_pending.disabled=el("capacity-default").checked;});
  el("capacity-form").addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    const selected=capacityRecord,form=event.target;if(!selected||session.role!=="OWNER"||selected.operator_id!==el("capacity-operator").value)throw new Error("Refresh this operator's allowance first.");
    const body={expected_revision:selected.revision,max_pending:el("capacity-default").checked?null:Number(form.elements.max_pending.value),reason:form.elements.reason.value};
    const result=await request("PATCH","/v1/operators/"+selected.operator_id+"/task-capacity",body);if(ticket!==generation||selected.operator_id!==el("capacity-operator").value)return;
    showCapacity(result.capacity);el("workspace-result").textContent="Shared task allowance saved. Existing tasks were preserved.";
  });});
  el("refresh-jobs").addEventListener("click",()=>action(async ticket=>{await jobs(ticket);if(ticket===generation)el("workspace-result").textContent="Private task status refreshed.";}));
  el("more-jobs").addEventListener("click",()=>action(async ticket=>{await jobs(ticket,true);if(ticket===generation)el("workspace-result").textContent="More private tasks loaded.";}));
  el("task-form").addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    const form=event.target,body=values(form);body.max_steps=Number(body.max_steps);body.timeout_seconds=Number(body.timeout_seconds);if(!body.project_id)delete body.project_id;
    const signature=JSON.stringify(body);if(!taskPending||taskPending.signature!==signature)taskPending={signature,request_id:crypto.randomUUID().replaceAll("-","")};
    const result=await request("POST","/v1/jobs",{...body,request_id:taskPending.request_id});if(ticket!==generation)return;
    form.reset();taskPending=null;el("workspace-result").textContent="Task recorded · "+result.job.id+" · "+result.job.state;await jobs(ticket);
  });});
  el("export-task").addEventListener("click",()=>{saveJson({prompt:el("task-form").elements.prompt.value},"zoora-task.json");el("workspace-result").textContent="Prompt exported for the local runner.";});
  function randomNonce(){return "icn1_"+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
  el("invitation-claim-form").addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    if(session)throw new Error("Sign out before accepting an invitation.");
    const body=values(event.target),signature=JSON.stringify(body);if(!claimPending||claimPending.signature!==signature)claimPending={signature,nonce:randomNonce()};
    const response=await fetch("/v1/invitations/claim",{method:"POST",cache:"no-store",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,claim_nonce:claimPending.nonce})});
    const result=await responseData(response);if(ticket!==generation)return;const credential=await useCredential(result.credential);if(ticket!==generation)return;
    clearWallet();clearJobs();clearPilot();session=credential;issued=credential;event.target.reset();el("workspace-result").textContent="Invitation accepted. Save your operator credential now.";view();
  });});
  el("new-invitation").addEventListener("click",()=>{invitePending=null;el("invitation-form").reset();});
  el("save-invitation").addEventListener("click",()=>{if(invitationIssued)saveJson(invitationIssued,"zoora-invitation.json");});
  el("invitation-form").addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    const form=event.target,body={label:form.elements.label.value,ttl_seconds:Number(form.elements.ttl_minutes.value)*60},signature=JSON.stringify(body);
    if(!invitePending||invitePending.signature!==signature){invitePending={signature,request_id:crypto.randomUUID().replaceAll("-","")};invitationIssued=null;el("invitation-issued").hidden=true;el("invitation-link").value="";}
    const result=await request("POST","/v1/invitations",{...body,request_id:invitePending.request_id});if(ticket!==generation)return;
    if(result.secret){invitationIssued=result.secret;el("invitation-link").value=location.origin+"/#invite="+result.secret.token;el("invitation-issued").hidden=false;form.reset();invitePending=null;el("workspace-result").textContent="Invitation created. Save or share its secret privately.";}
    else el("workspace-result").textContent="The invitation already exists, but its secret is unavailable. Revoke the lost link, clear the request and create a new invitation.";
    await accessList("invitations",ticket);
  });});
  const accessConfig={invitations:{route:"/v1/invitations",list:"invitation-list",more:"more-invitations"},operators:{route:"/v1/operators",list:"operator-list",more:"more-operators"},agents:{route:"/v1/managed-agents",list:"managed-agent-list",more:"more-managed-agents"}};
  function accessButton(article,label,callback){const button=document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",()=>action(callback));article.append(button);}
  async function accessList(kind,ticket,more=false){
    const config=accessConfig[kind],current=session;
    const data=await request("GET",config.route+"?limit=50"+(more&&accessAfter[kind]?"&after="+accessAfter[kind]:""));if(ticket!==generation)return;
    if(!more)el(config.list).replaceChildren();
    for(const record of data.items){
      const article=document.createElement("article");article.className="card";article.dataset.accessId=record.id;
      const heading=document.createElement("h4");heading.textContent=record.label||record.handle;article.append(heading);
      const detail=document.createElement("p");detail.textContent=record.id+" · "+(kind==="invitations"?record.state:(record.suspended?"SUSPENDED":record.active?"ACTIVE":"INACTIVE"));article.append(detail);
      if(kind==="invitations"){
        if(record.state!=="REVOKED")accessButton(article,"Revoke link",async newTicket=>{await request("POST","/v1/invitations/"+record.id+"/revoke",{},current);if(newTicket!==generation)return;if(invitationIssued?.invitation_id===record.id){invitationIssued=null;el("invitation-link").value="";el("invitation-issued").hidden=true;}await accessList(kind,newTicket);if(newTicket===generation)el("workspace-result").textContent="Invitation link revoked.";});
      }else{
        if(kind==="operators")accessButton(article,"Task allowance",async newTicket=>{el("capacity-operator").value=record.id;capacityRecord=null;view();await capacity(newTicket);if(newTicket===generation)el("workspace-result").textContent="Operator task allowance loaded.";});
        if(record.reason){const reason=document.createElement("p");reason.textContent=record.reason;article.append(reason);}
        const table=kind==="agents"?"agents":"operators",operation=record.suspended||!record.active?"resume":"suspend";
        if(!(record.suspended&&record.suspension_controller==="OWNER"&&current.role!=="OWNER"))accessButton(article,operation==="resume"?"Resume access":"Suspend access",async newTicket=>{const reason=el("access-reason").value;if(!reason.trim())throw new Error("Enter a reason before changing access.");await request("POST","/v1/"+table+"/"+record.id+"/"+operation,{reason},current);if(newTicket!==generation)return;await refreshAccess(newTicket);if(newTicket===generation){el("refresh").click();el("workspace-result").textContent="Access change recorded. Resuming keeps old credentials revoked.";}});
        if(record.active&&!record.suspended&&(kind==="operators"||current.role==="OPERATOR"))accessButton(article,"Provision new credential",async newTicket=>{const result=await request("POST","/v1/"+table+"/"+record.id+"/credentials",{},current);if(newTicket!==generation)return;const credential=await useCredential(result.credential);if(newTicket!==generation)return;issued=credential;el("workspace-result").textContent="New credential issued; previous credentials for this account were revoked. Save the download privately.";view();});
      }
      el(config.list).append(article);
    }
    accessAfter[kind]=data.next_after;el(config.more).hidden=!data.next_after;if(!more&&!data.items.length)el(config.list).textContent="No records for this account.";
  }
  async function refreshAccess(ticket){const current=session;if(current?.role==="OWNER"){await accessList("invitations",ticket);if(ticket!==generation)return;await accessList("operators",ticket);}if(ticket!==generation)return;await accessList("agents",ticket);}
  el("refresh-access").addEventListener("click",()=>action(async ticket=>{await refreshAccess(ticket);if(ticket===generation)el("workspace-result").textContent="Pilot access refreshed.";}));
  for(const[kind,config]of Object.entries(accessConfig))el(config.more).addEventListener("click",()=>action(async ticket=>{await accessList(kind,ticket,true);if(ticket===generation)el("workspace-result").textContent="More access records loaded.";}));
  function incomingInvitation(){
    if(!location.hash.startsWith("#invite="))return;const inviteMatch=location.hash.match(/^#invite=(zi1_[A-Za-z0-9_-]{43})$/);history.replaceState(null,"",location.pathname+location.search);
    if(session){error("Sign out and reopen your invitation link to accept it.");return;}
    generation++;claimPending=null;el("invitation-claim-form").elements.invitation_token.value=inviteMatch?inviteMatch[1]:"";el("account-panel").open=true;
    if(!inviteMatch)error("Unsupported invitation link.");
  }
  window.addEventListener("hashchange",incomingInvitation);incomingInvitation();
  el("agent-action").addEventListener("change",workAction);window.addEventListener("pagehide",reset);workAction();view();
})();
