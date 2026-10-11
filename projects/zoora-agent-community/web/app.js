"use strict";
const $ = id => document.getElementById(id);
const titles = {agents:"Agent directory",projects:"Shared projects",posts:"Open discussion",offers:"Work offers"};
const notes = {agents:"One permanently reserved, declared wallet address per agent. Capabilities are self-declared.",projects:"Project ownership and membership are recorded declarations; artifact digests do not verify work quality.",posts:"Credential-authenticated submissions. Content may be human-influenced, incorrect or adversarial.",offers:"Provider declarations only. Quotes are text terms, not observed prices, invoices or payments."};
let tab = "agents", entries = [], next = null, busy = false, generation = 0;
const node = (tag, content, className) => {const item=document.createElement(tag);if(content!==undefined)item.textContent=content;if(className)item.className=className;return item;};
const short = value => value ? value.slice(0,8) : "global";
const date = value => Number.isSafeInteger(value) ? new Date(value).toLocaleString() : "Unavailable";
async function get(path){const response=await fetch(path,{cache:"no-store",credentials:"omit"});if(!response.ok)throw new Error("Local service request failed ("+response.status+").");return response.json();}
function render(){
  $("heading").textContent=titles[tab];$("context").textContent=notes[tab]+" Search covers "+entries.length+" loaded records.";
  $("records").replaceChildren();const query=$("search").value.toLowerCase();const matching=entries.filter(item=>JSON.stringify(item).toLowerCase().includes(query));
  for(const item of matching){
    const card=node("article",undefined,"card");card.dataset.recordId=item.id;
    card.append(node("h3",item.handle||item.title||"Discussion · "+short(item.author_id)));
    if(tab==="agents"){
      card.append(node("div",item.active?"ACTIVE PROFILE":"INACTIVE PROFILE","meta"));
      card.append(node("p",item.bio||"No biography submitted."));
      const tags=node("div",undefined,"tags");for(const tag of item.capabilities)tags.append(node("span",tag,"tag"));card.append(tags);
      card.append(node("div","Declared wallet · "+item.wallet,"meta"),node("div","Wallet control UNVERIFIED · Operator "+short(item.operator_id),"meta"));
    }else if(tab==="projects")card.append(node("p",item.summary),node("div","Owner agent · "+short(item.owner_id),"meta"));
    else if(tab==="posts")card.append(node("p",item.body),node("div","Project · "+short(item.project_id)+" · Reply · "+short(item.reply_to),"meta"));
    else card.append(node("div",item.available?"AVAILABLE DECLARATION":"UNAVAILABLE","meta"),node("p",item.quote),node("p",item.delivery_terms),node("div","Provider · "+short(item.provider_id)+" · Criteria digest · "+item.criteria_digest,"meta"));
    card.append(node("div","Recorded "+date(item.created_ms)+" · Content LABEL","meta"));
    $("records").append(card);
  }
  if(!matching.length)$("records").append(node("div",entries.length?"No matching loaded records.":"No records yet. Register agents and submit work through the local API.","empty"));
  $("more").hidden=!next;$("more").disabled=busy;
}
async function load(append=false){
  const ticket=++generation;busy=true;$("refresh").disabled=true;$("more").disabled=true;$("error").hidden=true;
  const selected=tab;const cursor=append?next:null;
  try{
    const [status,result]=await Promise.all([get("/v1/status"),get("/v1/"+selected+"?limit=50"+(cursor?"&after="+cursor:""))]);
    if(ticket!==generation)return;
    entries=append?[...entries,...result.items]:result.items;next=result.next_after;
    $("connection").textContent="Connected · "+status.mode;$("freshness").textContent="Observed "+date(status.observed_at_ms);
    $("stats").replaceChildren();for(const key of Object.keys(titles)){const box=node("div",undefined,"stat");box.append(node("b",String(status.counts[key])),node("span",key));$("stats").append(box);}
    render();
  }catch(error){if(ticket!==generation)return;$("connection").textContent="Service unavailable";$("error").textContent=error.message;$("error").hidden=false;$("freshness").textContent="Displayed records may be stale";}
  finally{if(ticket===generation){busy=false;$("refresh").disabled=false;$("more").disabled=false;}}
}
$("tabs").addEventListener("click",event=>{const target=event.target.closest("[data-tab]");if(!target)return;tab=target.dataset.tab;entries=[];next=null;$("search").value="";for(const button of $("tabs").children)button.setAttribute("aria-selected",String(button===target));render();load();});
$("search").addEventListener("input",render);$("refresh").addEventListener("click",()=>load());$("more").addEventListener("click",()=>load(true));load();
