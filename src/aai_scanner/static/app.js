"use strict";
let token = "", current = null, busy = false;
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const clear = node => node.replaceChildren();
const short = value => value ? value.slice(0, 7) + "…" + value.slice(-6) : "Unavailable";
const timestamp = value => value ? new Date(value).toLocaleString() : "Unavailable";
const usd = value => value === null || value === undefined ? "Unavailable" : new Intl.NumberFormat("en-US", {style:"currency", currency:"USD", maximumSignificantDigits:8}).format(Number(value));
const numeric = value => value === null || value === undefined ? "Unavailable" : new Intl.NumberFormat("en-US", {maximumSignificantDigits:9}).format(Number(value));
const badge = (text, available) => el("span", text, "badge " + (available ? "good" : "gap"));
function row(parent, title, value) { const item = el("div", undefined, "kv"); item.append(el("span", title), el("span", value)); parent.append(item); }
function cellRow(parent, values) { const tr = el("tr"); for (const value of values) { const td = el("td"); td.append(value instanceof Node ? value : el("span", value)); tr.append(td); } parent.append(tr); }
function emptyRow(parent, text, columns) { const tr = el("tr"), td = el("td", text, "muted"); td.colSpan = columns; tr.append(td); parent.append(tr); }
function addressLink(address, type="account") { const a = el("a", short(address), "mono"); a.href = "https://solscan.io/" + type + "/" + encodeURIComponent(address); a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = address; return a; }
function displayError(message) { $("error").textContent = message; $("error").hidden = !message; }
async function api(path, method="GET", body) {
  const options = {method, headers:{"Authorization":"Bearer " + token}, cache:"no-store"};
  if (body !== undefined) { options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) $("access-dialog").showModal();
    throw new Error(result.error || "Request failed");
  }
  return result;
}
function loading(value) { busy = value; $("loading").hidden = !value; document.querySelectorAll("button[type=submit],#refresh").forEach(button => button.disabled = value); }
function page(name) {
  document.querySelectorAll(".page").forEach(section => section.hidden = section.id !== "page-" + name);
  document.querySelectorAll(".nav").forEach(button => { button.classList.toggle("active", button.dataset.page === name); if (button.dataset.page === name) $("breadcrumb").textContent = button.querySelector("span:last-child").textContent; });
  if (name === "watchlist") loadWatches().catch(error => displayError(error.message));
  if (name === "status") loadStatus().catch(error => displayError(error.message));
}
function metric(title, value, detail, exact) {
  const card = el("article", undefined, "metric");
  const amount = el("div", value, "metric-value"); if (exact !== null && exact !== undefined) amount.title = String(exact);
  card.append(el("div", title, "metric-label"), amount, el("div", detail, "metric-detail"));
  $("metrics").append(card);
}
function findings(target, report) {
  clear(target);
  if (!report.risk_findings.length) target.append(el("p", "No listed findings. This does not establish token safety.", "muted"));
  for (const finding of report.risk_findings) {
    const item = el("div", undefined, "finding");
    item.append(el("div", finding.code.replaceAll("_", " "), "finding-label"), el("p", finding.message));
    target.append(item);
  }
}
function receipts(target, sources) {
  clear(target);
  for (const source of sources.filter(Boolean)) {
    const section = el("div", undefined, "receipt");
    section.append(el("h3", source.provider + " · " + source.method));
    section.append(badge(source.status, source.status === "AVAILABLE"));
    row(section, "Retrieved", timestamp(source.available_at));
    row(section, "Source", source.endpoint_host);
    row(section, "Slot / commitment", String(source.slot ?? "Not provided") + " / " + (source.commitment || "Not provided"));
    if (source.reason) section.append(el("p", source.reason, "footnote"));
    const details = el("details"); details.append(el("summary", "Inspect evidence receipt"), el("pre", JSON.stringify(source, null, 2))); section.append(details);
    target.append(section);
  }
}
function freshness() {
  if (!current) return;
  const source = current.market.source;
  const age = source ? Math.max(0, Math.floor((Date.now() - Date.parse(source.available_at)) / 1000)) : null;
  $("freshness").textContent = (current.cached ? "Cached observation · " : "") + (source ? "Market retrieved " + timestamp(source.available_at) + " · " + age + "s ago" : "Market source unavailable") + (age !== null && age > 120 ? " · STALE retrieval" : "") + " · Upstream tick time unknown";
}
async function render(report) {
  current = report;
  $("watch").textContent = "☆ Save watch";
  const m = report.market, chain = report.mint_info;
  $("empty").hidden = true; $("report").hidden = false;
  $("token-name").textContent = m.name || m.symbol || "Unknown token";
  $("token-address").textContent = report.mint;
  $("report-badge").textContent = report.status;
  $("report-badge").className = "badge " + (report.status === "AVAILABLE" ? "good" : "gap");
  freshness();
  clear($("metrics"));
  metric("Token price · USD", usd(m.price_usd.value), "DEX Screener · selected pool", m.price_usd.value);
  metric("Token price · SOL", numeric(m.price_sol.value), "Derived from independent USD snapshots", m.price_sol.value);
  metric("Reported market cap", usd(m.market_cap_usd.value), "Provider-reported · distinct from FDV", m.market_cap_usd.value);
  metric("Selected-pool liquidity", usd(m.liquidity_usd.value), "Reported liquidity · lock status unverified", m.liquidity_usd.value);
  metric("24h selected-pool volume", usd(m.volume_24h_usd.value), "Returned venue · not all token trading", m.volume_24h_usd.value);
  metric("Mint supply", numeric(chain.supply), chain.token_program || "On-chain data unavailable", chain.supply);
  clear($("chain-state"));
  row($("chain-state"), "Mint evidence", chain.status);
  row($("chain-state"), "Token program", chain.token_program || "Unverified");
  row($("chain-state"), "Decimals", String(chain.decimals ?? "Unavailable"));
  row($("chain-state"), "Mint authority", chain.status !== "AVAILABLE" ? "Unverified" : chain.mint_authority ? "Active · " + short(chain.mint_authority) : "Absent");
  row($("chain-state"), "Freeze authority", chain.status !== "AVAILABLE" ? "Unverified" : chain.freeze_authority ? "Active · " + short(chain.freeze_authority) : "Absent");
  row($("chain-state"), "Finalized snapshot slot", String(chain.slot ?? "Unavailable"));
  row($("chain-state"), "Exact base-unit supply", chain.supply_raw ?? "Unavailable");
  findings($("findings"), report); findings($("risk-findings"), report);
  clear($("pools"));
  for (const pool of m.pools) {
    const title = el("div", pool.venue); title.append(el("small", short(pool.pair)));
    cellRow($("pools"), [title, usd(pool.price_usd), usd(pool.liquidity_usd), usd(pool.volume_24h_usd)]);
  }
  if (!m.pools.length) emptyRow($("pools"), "No supported base-token pools returned.", 4);
  clear($("holders"));
  for (const account of report.holders.accounts) cellRow($("holders"), [addressLink(account.address), numeric(account.balance.value), account.supply_share_pct.value === null ? "Unavailable" : numeric(account.supply_share_pct.value) + "%"]);
  if (!report.holders.accounts.length) emptyRow($("holders"), "Largest-token-account data unavailable.", 3);
  $("holder-note").textContent = (report.holders.quality_flags || []).join(" · ").replaceAll("_", " ") + ". These accounts are not unique holders.";
  renderActivity($("activity"), report.activity.records);
  $("activity-note").textContent = report.activity.coverage || report.activity.reason || "Activity unavailable.";
  receipts($("receipts"), [report.network_evidence, chain.evidence, m.source, m.sol_reference_source, report.holders.source, report.activity.source]);
  try {
    const history = await api("/api/history?mint=" + encodeURIComponent(report.mint));
    clear($("history"));
    for (const observation of history.observations.slice().reverse()) cellRow($("history"), [timestamp(observation.available_at), usd(observation.price_usd.value), numeric(observation.price_sol.value), observation.status]);
    if (!history.observations.length) emptyRow($("history"), "No saved observations yet.", 4);
  } catch (error) { displayError(error.message); }
}
function renderActivity(target, records) {
  clear(target);
  for (const record of records) cellRow(target, [addressLink(record.signature, "tx"), String(record.slot), timestamp(record.block_time), record.result]);
  if (!records.length) emptyRow(target, "No activity returned in this address window.", 4);
}
async function scan(mint, refresh=false) {
  if (busy) return;
  displayError(""); loading(true); page("overview");
  try {
    const result = await api("/api/scan", "POST", {mint, refresh});
    history.replaceState(null, "", "/report?mint=" + encodeURIComponent(mint));
    await render(result);
  } catch (error) { displayError(error.message); }
  finally { loading(false); }
}
async function loadWatches() {
  const result = await api("/api/watchlist"); clear($("watchlist"));
  if (!result.watches.length) $("watchlist").append(el("div", "No saved watches. Scan a token, then choose Save watch.", "card muted"));
  for (const watch of result.watches) {
    const card = el("article", undefined, "card watch-card");
    card.append(el("div", "SAVED MINT", "eyebrow"), el("p", watch.mint, "mono address"));
    const actions = el("div", undefined, "actions"), open = el("button", "Open report ↗", "secondary"), remove = el("button", "Remove", "secondary");
    open.addEventListener("click", () => { $("mint").value = watch.mint; scan(watch.mint); });
    remove.addEventListener("click", async () => { try { await api("/api/watchlist", "DELETE", {mint:watch.mint}); await loadWatches(); } catch (error) { displayError(error.message); } });
    actions.append(open, remove); card.append(actions); $("watchlist").append(card);
  }
}
async function loadStatus() {
  const result = await api("/api/status"); clear($("system-status"));
  const card = el("article", undefined, "card");
  row(card, "Process", result.status);
  row(card, "Started", timestamp(result.started_at));
  row(card, "Saved watches / observations", result.storage.watches + " / " + result.storage.observations);
  row(card, "Signing & execution", result.execution);
  row(card, "Payments", result.payments);
  card.append(el("p", result.provider_status_note, "footnote"));
  $("system-status").append(card);
  const sources = el("article", undefined, "card"); sources.append(el("h3", "Last observed provider results"));
  if (!Object.keys(result.provider_sources).length) sources.append(el("p", "UNVERIFIED — no scans have completed in this process.", "footnote"));
  receipts(sources, Object.values(result.provider_sources)); $("system-status").append(sources);
}
document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => page(button.dataset.page)));
$("scan-form").addEventListener("submit", event => { event.preventDefault(); scan($("mint").value.trim()); });
$("refresh").addEventListener("click", () => current && scan(current.mint, true));
$("watch").addEventListener("click", async () => { if (!current) return; try { await api("/api/watchlist", "POST", {mint:current.mint}); $("watch").textContent = "✓ Watch saved"; } catch (error) { displayError(error.message); } });
$("status-refresh").addEventListener("click", () => loadStatus().catch(error => displayError(error.message)));
$("wallet-form").addEventListener("submit", async event => {
  event.preventDefault(); if (busy) return; loading(true); displayError("");
  try {
    const result = await api("/api/wallet", "POST", {address:$("wallet-address").value.trim()});
    const card = $("wallet-result"); clear(card); card.hidden = false;
    card.append(el("div", "SOL BALANCE", "eyebrow"), el("h2", numeric(result.balance_sol.value) + (result.balance_sol.value === null ? "" : " SOL")), el("p", result.wallet, "mono address"));
    row(card, "Collected", timestamp(result.available_at));
    row(card, "USD balance · derived snapshot", usd(result.balance_usd.value));
    row(card, "Realized / unrealized P/L", "Unavailable");
    row(card, "Deposits / withdrawals / fees", "Unavailable");
    const wrap = el("div", undefined, "table-scroll"), table = el("table"), head = el("thead"), tr = el("tr"), body = el("tbody");
    ["Signature", "Slot", "Block time", "Result"].forEach(title => tr.append(el("th", title))); head.append(tr); table.append(head, body); renderActivity(body, result.activity.records); wrap.append(table); card.append(wrap);
  } catch (error) { displayError(error.message); }
  finally { loading(false); }
});
async function initialMint() {
  const mint = new URL(location.href).searchParams.get("mint");
  if (mint) { $("mint").value = mint; await scan(mint); }
}
$("access-form").addEventListener("submit", async event => {
  event.preventDefault();
  const supplied = $("access-token").value;
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(supplied)) { $("access-error").textContent = "Use an application access token, not a passphrase."; return; }
  token = supplied;
  try { await api("/api/status"); $("access-token").value = ""; $("access-dialog").close(); await initialMint(); }
  catch { token = ""; $("access-error").textContent = "Access token was not accepted."; }
});
async function start() {
  try {
    const result = await api("/api/health");
    $("connection").textContent = "API available"; $("connection").className = "badge good";
    if (result.access_required) $("access-dialog").showModal(); else await initialMint();
  } catch { $("connection").textContent = "API unavailable"; $("connection").className = "badge gap"; displayError("The scanner API is unavailable."); }
}
setInterval(freshness, 10000);
start();
