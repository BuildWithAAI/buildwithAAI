"use strict";
(() => {
  const el = id => document.getElementById(id);
  const node = (tag, value) => { const n = document.createElement(tag); n.textContent = value; return n; };
  const money = v => new Intl.NumberFormat(undefined, {style:"currency",currency:"USD",maximumFractionDigits:2}).format(v / 1e6) + " demo";
  let session = null, epoch = 0, busy = false, market = null, history = [], timer = null;
  const retries = new Map();
  const episode = () => el("market-episode").value;
  const path = suffix => "/v1/practice/episodes/" + episode() + suffix;
  async function request(method, route, body) {
    const ticket = epoch, current = session;
    if (!current || Date.now() >= current.expires_at_ms) throw new Error("Sign in again to use the practice market.");
    const response = await fetch(route, {method, credentials:"omit", cache:"no-store", signal:AbortSignal.timeout(10000),
      headers:{Authorization:"Bearer " + current.token, ...(body ? {"Content-Type":"application/json"} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})});
    const result = await response.json();
    if (ticket !== epoch) throw new Error("Session changed.");
    if (!response.ok) { const error = new Error(result.error || "Practice request failed."); error.status = response.status; throw error; }
    return result;
  }
  async function write(key, route, body) {
    let saved = retries.get(key);
    if (!saved) { saved = {route, body:{request_id:crypto.randomUUID().replaceAll("-", ""), ...body}}; retries.set(key, saved); }
    try { const data = await request("POST", saved.route, saved.body); retries.delete(key); return data; }
    catch (error) { if (error.status && error.status < 500) retries.delete(key); throw error; }
  }
  async function run(fn) {
    if (busy) return;
    busy = true; const ticket = epoch;
    el("market-status").textContent = "Updating the practice market…";
    try { await fn(); if (ticket === epoch) el("market-status").textContent = "Practice market updated. All balances are demo credits."; }
    catch (error) { if (ticket === epoch) el("market-status").textContent = error.message + (retries.size ? " Retry the same action to reconcile its saved request." : ""); }
    finally { if (ticket === epoch) busy = false; }
  }
  function chart() {
    const coin = el("market-coin").value, canvas = el("market-chart"), ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const points = history.flatMap(frame => { const c = frame.coins.find(v => v.id === coin); return c ? [{tick:frame.tick, value:c.market_cap_micro}] : []; });
    if (!points.length) { el("market-chart-note").textContent = "No observed prices yet."; return; }
    const low = Math.min(...points.map(p=>p.value)), high = Math.max(...points.map(p=>p.value));
    ctx.strokeStyle = "#72d9ba"; ctx.lineWidth = 3; ctx.beginPath();
    for (let i=0;i<points.length;i++) { const x=30+i/Math.max(1,points.length-1)*900, y=245-(points[i].value-low)/Math.max(1,high-low)*210; if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y); }
    ctx.stroke(); ctx.fillStyle="#b4c7cf"; ctx.font="16px sans-serif"; ctx.fillText(money(high),30,22);
    el("market-chart-note").textContent = "Observed ticks " + points[0].tick + "–" + points.at(-1).tick + ". Latest market cap: " + money(points.at(-1).value) + ". Spot valuation; actual exits depend on pool liquidity.";
  }
  async function account() {
    const key = el("market-agent").value;
    el("market-account").replaceChildren();
    if (!/^[a-f0-9]{32}$/.test(key) || !episode()) return;
    const data = await request("GET", path("/accounts/"+key));
    const box=el("market-account");
    box.append(node("h3", "Learner portfolio"), node("p", "Cash: "+money(data.cash_micro)+" · Estimated liquidation equity: "+money(data.liquidation_equity_micro)),
      node("p", "Net P&L: "+money(data.net_pnl_micro)+" · Cash benchmark: "+money(data.cash_benchmark_micro)),
      node("p", "Fees: "+money(data.fees_micro)+" · Gas: "+money(data.gas_micro)+" · Maximum drawdown: "+(data.max_drawdown_ppm/10000).toFixed(2)+"%"),
      node("p", data.buy_halted ? "New buys halted by drawdown policy. Reducing positions is allowed." : "Buy risk limits active."),
      node("p", "Model execution and learning are not attested. Declared pipeline: "+data.model_pipeline_sha256));
    if(data.pending)box.append(node("p","Pending "+data.pending.side+" order "+data.pending.request_id+"; waiting for the next owner-controlled tick."));
    for (const p of data.positions) if(p.tokens)box.append(node("p",p.coin_id.slice(0,6).toUpperCase()+": "+p.tokens.toLocaleString()+" tokens · Estimated net exit: "+money(p.net_exit_micro)));
    const table=node("table",""), head=node("tr","");for(const h of ["Side","State","Tick","Output","Reason"])head.append(node("th",h));table.append(head);
    for(const r of [...data.recent_receipts].reverse()){const row=node("tr","");for(const value of [r.side,r.state,r.fill_tick,r.side==="BUY"?r.output+" tokens":money(r.output),r.reason||"Filled"])row.append(node("td",value));table.append(row);}box.append(table);
  }
  async function refresh() {
    if(!episode()){market=null;history=[];el("market-coins").replaceChildren();el("market-clock").textContent="No episode yet. The service owner can create one.";return;}
    const current=episode();const [data,frames]=await Promise.all([request("GET",path("")),request("GET",path("/history"))]);
    if(current!==episode())return;
    market=data.market;history=frames.items;
    el("market-clock").textContent="Tick "+market.tick+" · "+market.virtual_elapsed_seconds+" simulated seconds · "+market.status+" · Private genesis commitment "+data.commitment;
    el("market-step").disabled=market.status!=="OPEN";const selected=el("market-coin").value;el("market-coin").replaceChildren();el("market-coins").replaceChildren();
    for(const c of market.coins){const option=node("option",c.name+" / "+c.symbol);option.value=c.id;el("market-coin").append(option);const card=node("article","");card.append(node("h3",c.symbol),node("p",c.stage+" · "+c.venue),node("p",money(c.market_cap_micro)),node("p","Quote liquidity: "+money(c.quote_liquidity_micro)),node("p","Volume: "+money(c.volume_micro)),node("p","Top 10 concentration: "+(c.top10_bps/100).toFixed(2)+"% · Synthetic signal"));card.children[2].className="market-number";el("market-coins").append(card);}
    if(market.coins.some(c=>c.id===selected))el("market-coin").value=selected;
    chart();if(el("market-agent").value)await account();
  }
  async function list(preferred) {
    const data=await request("GET","/v1/practice/episodes?limit=100"), selected=preferred||episode();el("market-episode").replaceChildren();
    for(const e of data.items){const option=node("option",e.id.slice(0,8)+" · tick "+e.tick+" · "+e.status);option.value=e.id;el("market-episode").append(option);}
    if(data.items.some(e=>e.id===selected))el("market-episode").value=selected;
    await refresh();
  }
  el("market-refresh").addEventListener("click",()=>run(()=>list()));
  el("market-create").addEventListener("click",()=>run(async()=>{const data=await write("create","/v1/practice/episodes",{});await list(data.id);}));
  el("market-step").addEventListener("click",()=>run(async()=>{if(!market)throw new Error("Create or select an episode first.");await write("step",path("/step"),{expected_tick:market.tick});await refresh();}));
  el("market-episode").addEventListener("change",()=>run(async()=>{if(retries.size)throw new Error("Reconcile the saved action before changing episodes.");await refresh();}));
  el("market-coin").addEventListener("change",chart);
  el("market-account-form").addEventListener("submit",e=>{e.preventDefault();run(account);});
  el("market-enroll").addEventListener("submit",e=>{e.preventDefault();run(async()=>{const form=e.target;await write("enroll",path("/accounts"),{agent_id:form.elements.agent_id.value,model_pipeline_sha256:form.elements.pipeline.value});el("market-agent").value=form.elements.agent_id.value;await account();});});
  el("market-order").addEventListener("submit",e=>{e.preventDefault();run(async()=>{
    const form=e.target, c=market?.coins.find(v=>v.id===el("market-coin").value);if(!c)throw new Error("Select an observed coin.");
    const side=form.elements.side.value, raw=form.elements.amount.value;
    if(!/^[0-9]+(?:\.[0-9]{1,6})?$/.test(raw))throw new Error("Enter a positive amount, with at most six decimals.");
    if(side==="SELL"&&raw.includes("."))throw new Error("Sell whole synthetic tokens.");
    const [whole,decimals=""]=raw.split("."), amount=side==="BUY"?BigInt(whole)*1000000n+BigInt(decimals.padEnd(6,"0")):BigInt(whole);
    if(amount<=0n||amount>9000000000000000n)throw new Error("Amount is outside simulator limits.");
    const costFee=v=>(v*BigInt(market.policy.fee_ppm)+999999n)/1000000n;
    const vb=BigInt(c.effective_base_tokens),vq=BigInt(c.effective_quote_micro);
    const gross=vq*amount/(vb+amount);const output=side==="BUY"?vb*(amount-costFee(amount))/(vq+amount-costFee(amount)):gross-costFee(gross);
    if(c.stage==="MIGRATING"||c.stage==="HALTED"||output<=0n)throw new Error("No executable practice quote.");
    const minimum=output*95n/100n;
    await write("order",path("/orders"),{coin_id:c.id,side,amount:Number(amount),min_output:Number(minimum>0n?minimum:1n),observation_tick:market.tick});await account();
  });});
  el("market-watch").addEventListener("change",()=>{clearInterval(timer);timer=null;if(el("market-watch").checked)timer=setInterval(()=>{if(!busy&&session)run(refresh);},5000);});
  globalThis.ZooraMarketView=Object.freeze({setSession(next){
    if(session===next)return;session=next;epoch++;busy=false;retries.clear();market=null;history=[];clearInterval(timer);timer=null;
    el("market-watch").checked=false;el("market-workspace").hidden=!session;el("market-owner").hidden=session?.role!=="OWNER";el("market-enroll").hidden=session?.role!=="OPERATOR";el("market-order").hidden=session?.role!=="AGENT";
    for(const id of ["market-coins","market-account","market-episode","market-coin"])el(id).replaceChildren();
    el("market-agent").value=session?.role==="AGENT"?session.principal_id:"";el("market-agent").readOnly=session?.role==="AGENT";
    el("market-clock").textContent="";el("market-chart-note").textContent="";el("market-chart").getContext("2d").clearRect(0,0,960,280);
    el("market-status").textContent=session?"Loading practice episodes…":"Sign in above to watch a private practice market.";
    if(session)run(()=>list());
  }});
})();
