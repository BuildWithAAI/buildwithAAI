'use strict';
(() => {
  const el = id => document.getElementById(id);
  const node = (tag, value) => { const n = document.createElement(tag); if(value !== undefined) n.textContent = String(value); return n; };
  const text = (id, value) => { el(id).textContent = String(value); };
  const amount = value => { if(typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid amount'); return BigInt(value); };
  const format = value => BigInt(value).toLocaleString('en-US');
  let data, page = 0;
  const size = 20;
  function profiles() {
    const query = el('agent-search').value.trim().toLowerCase(), state = el('agent-state').value;
    const rows = data.agents.filter(p => (!state || p.active === (state === 'active')) && (!query || [p.registration.handle, ...p.registration.capabilities, ...p.handle_history.map(h => h.handle)].join(' ').toLowerCase().includes(query)));
    const body = el('agents'); body.replaceChildren();
    for(const p of rows) {
      const r = p.registration, row = node('tr'), first = node('td','@' + r.handle); first.append(node('small',p.active ? 'Active fixture' : 'Inactive fixture')); row.append(first,node('td',r.operator_id),node('td',r.wallet_label),node('td',r.capabilities.join(', ')));
      const cell = node('td'), details = node('details'); details.append(node('summary',p.handle_history.length + ' recorded handles'));
      for(const h of p.handle_history) details.append(node('p','@' + h.handle + ' · tick ' + h.simulation_tick)); cell.append(details); row.append(cell); body.append(row);
    }
    text('directory-count',rows.length + ' of ' + data.agents.length); el('agents-empty').hidden = rows.length > 0;
  }
  function orders() {
    const agreements = data.direct.agreements, pages = Math.max(1,Math.ceil(agreements.length / size)); page = Math.min(page,pages - 1);
    const body = el('orders'); body.replaceChildren();
    for(const a of agreements.slice(page * size,(page + 1) * size)) {
      const row = node('tr'), first = node('td','#' + a.terms.agreement_id); first.append(node('small',a.terms.title));
      const status = node('td',a.status); if(a.delivery_overdue) status.append(node('small','Delivery overdue')); if(a.recipient_declined_refund) status.append(node('small','Recipient declined return'));
      row.append(first,node('td',a.terms.client + ' / ' + a.terms.provider),status,node('td',format(a.payments_received) + ' / ' + format(a.voluntary_refunds_received)),node('td',a.refund_request_remaining === null ? 'No request' : format(a.refund_request_remaining))); body.append(row);
    }
    text('orders-page','Page ' + (page + 1) + ' / ' + pages); el('orders-previous').disabled = page === 0; el('orders-next').disabled = page + 1 >= pages;
  }
  try {
    data = JSON.parse(el('community-data').textContent);
    if(data.schema_version !== 1 || data.classification !== 'SYNTHETIC' || data.verification !== 'REPLAY_VERIFIED_AT_EXPORT' || data.agents.length > 5000 || data.orders.length > 5000 || data.posts.length > 10000) throw new Error('Unsupported export');
    const m = data.metrics, d = data.direct.metrics;
    if(amount(d.payments_recorded) !== amount(d.net_transferred) + amount(d.voluntary_refunds_recorded) || Object.values(data.direct.wallet_boundary).some(Boolean)) throw new Error('Invalid direct boundary');
    for(const a of data.direct.agreements) { amount(a.payments_received); amount(a.voluntary_refunds_received); }
    text('agents-count',format(m.registered_agents)); text('orders-count',format(m.accepted_orders)); text('deliveries-count',format(m.acknowledged_deliveries)); text('refusals-count',format(m.provider_capacity_rejections));
    text('scenario',data.seed === null ? 'Manual synthetic transcript' : 'Seed ' + data.seed + ' · ' + data.scenario); profiles(); orders();
    text('projects-count',m.projects + ' projects · ' + m.offers + ' offers');
    for(const p of data.projects) {
      const details = node('details'); details.append(node('summary',p.title)); details.append(node('p',p.summary),node('p','Owner ' + p.owner + ' · contributors ' + p.contributors.join(', ') + ' · ' + p.artifacts.length + ' artifact digests'));
      for(const o of data.offers.filter(o => o.project_id === p.project_id)) details.append(node('p',o.title + ' · provider ' + o.provider + ' · ' + format(o.amount) + ' synthetic units · ' + (o.active ? 'Available offer' : 'Withdrawn offer')));
      el('projects').append(details);
    }
    const totals = el('totals'); for(const [label, value] of [['Payments recorded',d.payments_recorded],['Voluntary returns',d.voluntary_refunds_recorded],['Net transferred',d.net_transferred],['Unresolved requests',d.unresolved_refund_requests]]) totals.append(node('dt',label),node('dd',format(value)));
    text('posts-count',data.posts.length + ' posts · ' + m.post_rate_rejections + ' rate refusals');
    for(const p of [...data.posts].sort((a,b) => a.simulation_tick - b.simulation_tick || a.post_id - b.post_id).slice(0,100)) {
      const item = node('article'); item.append(node('h3','Agent ' + p.author + ' · tick ' + p.simulation_tick),node('p',p.body),node('small','Post #' + p.post_id + (p.reply_to === null ? '' : ' · reply to #' + p.reply_to))); el('posts').append(item);
    }
    if(data.posts.length > 100) el('posts').append(node('p','Showing the first 100 posts. The source JSON contains the complete history.'));
    text('source-hash',data.source_fingerprint); text('community-hash',data.community_fingerprint); text('source',data.provenance.source); text('flags',data.provenance.quality_flags.join(' · '));
    el('agent-search').addEventListener('input',profiles); el('agent-state').addEventListener('change',profiles);
    el('orders-previous').addEventListener('click',() => { if(page > 0) page--; orders(); }); el('orders-next').addEventListener('click',() => { if((page + 1) * size < data.direct.agreements.length) page++; orders(); });
    el('loading').hidden = true; el('content').hidden = false; document.body.dataset.ready = 'true';
  } catch(error) {
    text('error','This export cannot be displayed. Regenerate it from JSON that passes Rust replay verification.'); el('error').hidden = false; el('loading').hidden = true; el('content').hidden = true; document.body.dataset.ready = 'error';
  }
})();
