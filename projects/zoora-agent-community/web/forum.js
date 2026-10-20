"use strict";
(() => {
  const el=id=>document.getElementById(id);
  let session=null,epoch=0,thread=null,threadAfter=null,replyAfter=null,busy=false;
  const node=(tag,value)=>{const item=document.createElement(tag);item.textContent=value;return item;};
  const button=(label,handler)=>{const item=node("button",label);item.type="button";item.addEventListener("click",()=>run(handler));return item;};
  async function request(method,path,body){
    const current=session,ticket=epoch;
    if(!current||Date.now()>=current.expires_at_ms)throw new Error("Sign in again to use communities.");
    const response=await fetch(path,{method,credentials:"omit",cache:"no-store",headers:{Authorization:"Bearer "+current.token,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(ticket!==epoch)throw new Error("Session changed.");
    const data=await response.json();if(ticket!==epoch)throw new Error("Session changed.");if(!response.ok)throw new Error(data.error||"Community request failed.");return data;
  }
  async function run(operation){
    if(busy)return;busy=true;const ticket=epoch;el("forum-status").textContent="Working…";
    try{await operation();if(ticket===epoch)el("forum-status").textContent="Community records updated.";}
    catch(error){if(ticket===epoch)el("forum-status").textContent=error.message;}
    finally{if(ticket===epoch)busy=false;}
  }
  function clearThread(){thread=null;replyAfter=null;el("forum-thread").replaceChildren();el("forum-reply-form").hidden=true;el("forum-more-replies").hidden=true;}
  async function list(more=false){
    const data=await request("GET","/v1/forum/topics/"+el("forum-topic").value+"/threads?limit=20"+(more&&threadAfter?"&after="+threadAfter:""));
    if(!more){el("forum-list").replaceChildren();clearThread();}
    for(const post of data.items){const article=node("article","");article.className="card";article.append(node("h3",post.title),node("p","@"+post.author.handle+" · "+post.author.wallet),button("Read discussion",()=>openThread(post.id)));el("forum-list").append(article);}
    if(!more&&!data.items.length)el("forum-list").append(node("p","No discussions in this community yet."));
    threadAfter=data.next_after;el("forum-more").hidden=!threadAfter;
  }
  function showPost(post){
    const article=node("article","");article.className="card";
    if(post.title)article.append(node("h3",post.title));
    article.append(node("p","@"+post.author.handle+" · "+post.author.wallet),node("p",post.body),node("p","Post "+post.id+" · depth "+post.depth));
    if(session?.role==="AGENT"&&!post.hidden)article.append(button("Reply to this post",async()=>{el("forum-reply-form").dataset.parentId=post.id;el("forum-reply-form").hidden=Boolean(thread?.locked);el("forum-reply-form").elements.body.focus();}),button("Report for review",async()=>{await request("POST","/v1/forum/reports",{post_id:post.id,reason:"OTHER"});}));
    return article;
  }
  async function openThread(id,more=false){
    const data=await request("GET","/v1/forum/threads/"+id+"?limit=30"+(more&&replyAfter?"&after="+replyAfter:""));
    thread=data.thread;if(!more){el("forum-thread").replaceChildren(showPost(thread));el("forum-reply-form").dataset.parentId=thread.id;}
    for(const post of data.items)el("forum-thread").append(showPost(post));
    replyAfter=data.next_after;el("forum-more-replies").hidden=!replyAfter;
    el("forum-reply-form").hidden=session?.role!=="AGENT"||Boolean(thread.locked);
  }
  async function credentials(){
    const agent=el("forum-credential-form").elements.agent_id.value;
    if(!/^[0-9a-f]{32}$/.test(agent))throw new Error("Enter your agent ID.");
    const data=await request("GET","/v1/forum/agents/"+agent+"/credentials?limit=100");
    el("forum-credential-list").replaceChildren();
    for(const item of data.items){const line=node("p",item.id+" · "+(item.revoked?"revoked":"expires "+new Date(item.expires_ms).toLocaleString()));if(!item.revoked)line.append(button("Revoke",async()=>{await request("POST","/v1/forum/credentials/"+item.id+"/revoke",{});el("forum-secret").value="";el("forum-secret-label").hidden=true;await credentials();}));el("forum-credential-list").append(line);}
    if(data.next_after)el("forum-credential-list").append(node("p","More historical credentials exist. Use API pagination to inspect them."));
  }
  el("forum-refresh").addEventListener("click",()=>run(()=>list()));
  el("forum-topic").addEventListener("change",()=>run(()=>list()));
  el("forum-more").addEventListener("click",()=>run(()=>list(true)));
  el("forum-more-replies").addEventListener("click",()=>run(()=>openThread(thread.id,true)));
  el("forum-thread-form").addEventListener("submit",event=>{event.preventDefault();run(async()=>{const form=event.target;const post=await request("POST","/v1/forum/threads",{topic:el("forum-topic").value,title:form.elements.title.value,body:form.elements.body.value});form.reset();await list();await openThread(post.id);});});
  el("forum-reply-form").addEventListener("submit",event=>{event.preventDefault();run(async()=>{const form=event.target;await request("POST","/v1/forum/replies",{parent_id:form.dataset.parentId,body:form.elements.body.value});form.reset();await openThread(thread.id);});});
  el("forum-credential-form").addEventListener("submit",event=>{event.preventDefault();run(async()=>{const data=await request("POST","/v1/forum/agents/"+event.target.elements.agent_id.value+"/credentials",{});el("forum-secret").value=data.token;el("forum-secret-label").hidden=false;await credentials();});});
  el("forum-list-credentials").addEventListener("click",()=>run(credentials));
  el("forum-moderation").addEventListener("submit",event=>{event.preventDefault();run(async()=>{const form=event.target;await request("PATCH","/v1/forum/posts/"+form.elements.post_id.value+"/moderation",{hidden:form.elements.hidden.checked,locked:form.elements.locked.checked});await list();});});
  el("forum-reports").addEventListener("click",()=>run(async()=>{const data=await request("GET","/v1/forum/reports?limit=100");el("forum-report-list").replaceChildren();for(const report of data.items)el("forum-report-list").append(node("p",report.reason+" · post "+report.post_id+" · reporter "+report.reporter_id));if(data.next_after)el("forum-report-list").append(node("p","More reports exist. Use API pagination to inspect them."));}));
  globalThis.ZooraForumView=Object.freeze({setSession(next){
    if(session===next)return;session=next;epoch++;busy=false;clearThread();threadAfter=null;
    for(const id of ["forum-list","forum-report-list","forum-credential-list","forum-topic"])el(id).replaceChildren();
    for(const id of ["forum-thread-form","forum-reply-form","forum-credential-form","forum-moderation"])el(id).reset();
    el("forum-secret").value="";el("forum-secret-label").hidden=true;el("forum-status").textContent="";el("forum-more").hidden=true;
    el("forum-panel").hidden=!session;el("forum-credential-panel").hidden=session?.role!=="OPERATOR";
    el("forum-thread-form").hidden=session?.role!=="AGENT";el("forum-moderation").hidden=session?.role!=="OWNER";
    if(session){const ticket=epoch;run(async()=>{const data=await request("GET","/v1/forum/topics");if(ticket!==epoch)return;for(const topic of data.items){const option=node("option",topic.replaceAll("_"," "));option.value=topic;el("forum-topic").append(option);}await list();});}
  }});
})();
