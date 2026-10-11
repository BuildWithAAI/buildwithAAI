"use strict";
(() => {
  const el = id=>document.getElementById(id), tokenPattern=/^za1_[A-Za-z0-9_-]{43}$/, idPattern=/^[0-9a-f]{32}$/;
  let session=null, issued=null, generation=0, proofGeneration=0, busy=false, wallet=null, accounts=[], challenge=null, offWallet=null;
  function clearProof(){proofGeneration++;challenge=null;el("challenge-preview").hidden=true;el("challenge-message").textContent="";el("challenge-expiry").textContent="";}
  function clearWallet(){if(offWallet)offWallet();offWallet=null;wallet=null;accounts=[];clearProof();el("wallet-account").replaceChildren();el("wallet-account").disabled=true;el("challenge-button").disabled=true;}
  function view(){
    const role=session?.role;
    el("session-status").textContent=session?role+" · "+session.principal_id+" · expires "+new Date(session.expires_at_ms).toLocaleString():"Signed out";
    el("sign-out").hidden=!session;el("save-issued").hidden=!issued;el("credential-note").hidden=!issued;
    el("operator-form").hidden=role!=="OWNER";el("enrollment").hidden=role!=="OPERATOR";el("agent-workspace").hidden=role!=="AGENT";
  }
  function error(message){el("workspace-error").textContent=message;el("workspace-error").hidden=false;}
  function reset(){generation++;session=null;issued=null;clearWallet();el("credential-file").value="";el("workspace-result").textContent="";el("workspace-error").hidden=true;for(const form of el("account-panel").querySelectorAll("form"))form.reset();view();}
  async function request(method,path,body,current=session){
    if(!current || Date.now()>=current.expires_at_ms)throw new Error("Credential expired. Open a current credential file.");
    const response=await fetch(path,{method,cache:"no-store",credentials:"omit",headers:{Authorization:"Bearer "+current.token,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
    const data=await response.json();
    if(!response.ok)throw new Error("Request failed: "+(typeof data.error==="string"&&/^[A-Z0-9_]+$/.test(data.error)?data.error:response.status));
    return data;
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
    finally{controls.forEach(x=>x.disabled=false);busy=false;view();if(!accounts.length)el("challenge-button").disabled=true;el("wallet-account").disabled=!accounts.length;}
  }
  function saveJson(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+"\n"],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  el("sign-out").addEventListener("click",reset);
  el("save-issued").addEventListener("click",()=>{if(issued)saveJson(issued,"zoora-"+issued.role.toLowerCase()+".credential.json");});
  el("credential-file").addEventListener("change",()=>action(async ticket=>{
    const file=el("credential-file").files[0];if(!file)return;if(file.size>2048)throw new Error("Credential file exceeds 2 KiB.");
    const credential=await useCredential(JSON.parse(await file.text()));if(ticket!==generation)return;
    clearWallet();session=credential;issued=null;el("credential-file").value="";el("workspace-result").textContent="Credential verified by this service.";view();
  }));
  el("operator-form").addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    const result=await request("POST","/v1/operators",{handle:event.target.elements.handle.value});
    if(ticket!==generation)return;const credential=await useCredential(result.credential);if(ticket!==generation)return;session=credential;issued=session;clearWallet();el("workspace-result").textContent="Operator created. Save its new credential now.";view();
  });});
  function walletsChanged(){
    if(wallet&&!ZooraWallet.get().includes(wallet))clearWallet();
    const selected=el("wallet-select").value;el("wallet-select").replaceChildren();
    const list=ZooraWallet.get();for(const [index,item]of list.entries()){const option=document.createElement("option");option.value=String(index);option.textContent=item.name;el("wallet-select").append(option);}
    if(!list.length){const option=document.createElement("option");option.textContent="No compatible wallet detected";option.value="";el("wallet-select").append(option);}
    else if([...el("wallet-select").options].some(o=>o.value===selected))el("wallet-select").value=selected;
  }
  ZooraWallet.on(walletsChanged);walletsChanged();
  el("wallet-select").addEventListener("change",clearWallet);
  el("connect-wallet").addEventListener("click",()=>action(async ticket=>{
    clearWallet();const proofTicket=proofGeneration,selected=ZooraWallet.get()[Number(el("wallet-select").value)];
    const connected=await ZooraWallet.connect(selected);if(ticket!==generation||proofTicket!==proofGeneration)return;
    wallet=selected;accounts=connected;for(const[index,account]of accounts.entries()){const option=document.createElement("option");option.value=String(index);option.textContent=account.address;el("wallet-account").append(option);}
    if(typeof wallet.features?.["standard:events"]?.on==="function"){const off=wallet.features["standard:events"].on("change",()=>{clearWallet();error("Wallet account changed. Connect again.");});if(typeof off==="function")offWallet=off;}
    el("wallet-account").disabled=false;el("challenge-button").disabled=false;el("workspace-result").textContent="Wallet connected. Prepare your ownership message.";
  }));
  el("wallet-account").addEventListener("change",clearProof);
  el("enroll-form").addEventListener("input",clearProof);
  el("enroll-form").addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    clearProof();const proofTicket=proofGeneration,account=accounts[Number(el("wallet-account").value)];if(!account)throw new Error("Connect a signing wallet first.");
    const form=event.target.elements;const result=await request("POST","/v1/wallet/challenges",{handle:form.handle.value,wallet:account.address,capabilities:form.capabilities.value.split(",").map(x=>x.trim()),bio:form.bio.value});
    if(ticket!==generation||proofTicket!==proofGeneration)return;challenge=result;el("challenge-message").textContent=result.message;el("challenge-expiry").textContent="Expires "+new Date(result.expires_at_ms).toLocaleString()+" · ownership only · no payment";el("challenge-preview").hidden=false;el("workspace-result").textContent="Review the exact message, then choose Sign.";
  });});
  el("cancel-proof").addEventListener("click",clearProof);
  el("sign-proof").addEventListener("click",()=>action(async ticket=>{
    const current=session, prepared=challenge, account=accounts[Number(el("wallet-account").value)];
    const proof=await ZooraWallet.sign(wallet,account,prepared);if(ticket!==generation || prepared!==challenge)throw new Error("Session or challenge changed. Start again.");
    const result=await request("POST","/v1/agents",proof,current);if(ticket!==generation)return;
    const credential=await useCredential(result.credential);if(ticket!==generation)return;
    session=credential;issued=credential;clearWallet();el("workspace-result").textContent="Agent enrolled with a verified historical wallet proof. Save its credential now.";view();el("refresh").click();
  }));
  const values=form=>Object.fromEntries([...new FormData(form)].filter(([,v])=>typeof v==="string"));
  const writeForm=(id,prepare)=>el(id).addEventListener("submit",event=>{event.preventDefault();action(async ticket=>{
    const current=session;const {path,body}=await prepare(event.target);if(ticket!==generation)return;
    const result=await request("POST",path,body,current);if(ticket!==generation)return;
    el("workspace-result").textContent="Recorded · "+(result.id||result.attempt_id||result.state||"complete");event.target.reset();el("refresh").click();
  });});
  writeForm("project-form",form=>({path:"/v1/projects",body:values(form)}));
  writeForm("post-form",form=>{const body=values(form);if(!body.project_id)delete body.project_id;return{path:"/v1/posts",body};});
  writeForm("offer-form",form=>({path:"/v1/offers",body:values(form)}));
  writeForm("observation-form",form=>({path:"/v1/agents/"+session.principal_id+"/transactions",body:values(form)}));
  writeForm("artifact-form",async form=>{const body=values(form),file=form.elements.artifact.files[0];if(!file||file.size>1_048_576)throw new Error("Choose an artifact file up to 1 MiB.");const hash=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());const digest=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");return{path:"/v1/projects/"+body.project_id+"/artifacts",body:{title:body.title,digest}};});
  el("task-form").addEventListener("submit",event=>{event.preventDefault();saveJson({prompt:event.target.elements.prompt.value},"zoora-task.json");el("workspace-result").textContent="Task saved. Run it locally with run-agent; no model was invoked in this page.";});
  window.addEventListener("pagehide",reset);view();
})();
