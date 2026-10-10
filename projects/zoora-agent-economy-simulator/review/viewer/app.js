'use strict';
(() => {
  const el = id => document.getElementById(id);
  const text = (id, value) => { el(id).textContent = String(value); };
  const node = (tag, value, className) => { const n = document.createElement(tag); if (value !== undefined) n.textContent = String(value); if (className) n.className = className; return n; };
  const safeAmount = amount => { if (!/^(0|[1-9][0-9]*)$/.test(amount)) throw new Error('Invalid ledger amount'); return BigInt(amount); };
  const format = value => BigInt(value).toLocaleString('en-US');
  let data, index = 0, page = 0;
  const size = 20;
  const statusNames = ['Open','Accepted','Submitted','Disputed','Provisional','Appealed','Completed','Refunded','Cancelled','Failed','Expired','SettlementBlocked','AwaitingPayment','PartiallyPaid','Paid','Delivered','Accepted','RefundRequested','PartiallyRefunded'];
  function selected() { return data.reports[index]; }
  function rows() {
    const query = el('search').value.trim().toLowerCase(); const status = el('status').value;
    return selected().cases.filter(c => (!status || c.status === status) && (!query || [c.id,c.title,c.client,c.worker,c.primary,c.primary_operator,c.appeal].join(' ').toLowerCase().includes(query)));
  }
  function renderCases() {
    const filtered = rows(), pages = Math.max(1, Math.ceil(filtered.length / size)); page = Math.min(page, pages - 1);
    const body = el('cases'); body.replaceChildren();
    for (const c of filtered.slice(page * size, (page + 1) * size)) {
      const tr = node('tr'); const title = node('td', '#' + c.id); title.append(node('small', c.title)); tr.append(title);
      const state = node('td'); state.append(node('span', c.status, 'state ' + c.status)); if(c.overdue) state.append(node('small','Delivery overdue')); tr.append(state);
      tr.append(node('td', c.client + ' / ' + c.worker)); const reviewer = node('td', selected().ledger.mode === 'DIRECT_USER_WALLET' ? format(c.paid) + ' / ' + format(c.returned) : c.primary + ' / ' + c.appeal); reviewer.append(node('small', selected().ledger.mode === 'DIRECT_USER_WALLET' ? (c.refund_remaining === '—' ? 'No refund requested' : 'Requested return remaining: ' + format(c.refund_remaining)) : 'Primary operator ' + c.primary_operator)); tr.append(reviewer);
      tr.append(node('td', format(c.reward))); const evidence = node('td'); const details = node('details'); details.append(node('summary', 'View digests'));
      for (const [label, value] of [['Criteria',c.criteria_digest],['Artifact',c.artifact_digest],['Primary verdict',c.primary_verdict],['Appeal verdict',c.appeal_verdict]]) details.append(node('p', label + ': ' + value));
      evidence.append(details); tr.append(evidence); body.append(tr);
    }
    text('case-summary', filtered.length + ' of ' + selected().cases.length + ' cases'); text('page', 'Page ' + (page + 1) + ' / ' + pages);
    el('previous').disabled = page === 0; el('next').disabled = page + 1 >= pages; el('empty').hidden = filtered.length > 0;
  }
  function render() {
    const report = selected(), direct = report.ledger.mode === 'DIRECT_USER_WALLET'; page = 0; el('search').value = ''; el('status').value = '';
    text('tasks-label', direct ? 'Agreements' : 'Tasks funded'); text('tasks-hint',direct ? 'Direct payment workflow' : 'Admitted to research escrow'); text('ledger-title',direct ? 'Direct payment transcript' : 'Research escrow reconciliation');
    text('decisions-label',direct ? 'Payments recorded' : 'Reviewer decisions'); text('decisions-hint',direct ? 'Synthetic units / direct transfer' : 'Primary + appellate');
    text('share-label',direct ? 'Voluntary returns' : 'Largest operator share'); text('share-hint',direct ? 'Separate return receipts received' : 'Declared operator / all decisions');
    text('capacity-label',direct ? 'Unresolved requests' : 'Capacity refusals'); text('capacity-hint',direct ? 'Awaiting voluntary repayment' : 'Rejected before primary funding');
    text('assignment-heading',direct ? 'Paid / returned' : 'Review assignment'); text('distribution-title',direct ? 'Wallet control & requests' : 'Review distribution'); text('distribution-hint',direct ? 'Coordination only' : 'Declared operators');
    text('description', report.description); text('task-count', format(report.cases.length)); text('decision-count', format(direct ? report.ledger.funded : report.decisions));
    text('share',direct ? format(report.ledger.refunded) : report.largest_operator_share_bps === null ? 'Unavailable' : (report.largest_operator_share_bps / 100).toFixed(2) + '%'); text('capacity', format(direct ? report.direct_summary.unresolved_requests : report.capacity_rejections));
    text('model', data.source_model); text('fingerprint', data.source_fingerprint); text('report-fingerprint', report.source_fingerprint); text('policy', report.policy);
    const statuses = [...new Set(report.cases.map(c => c.status))].sort(); el('status').replaceChildren(node('option', 'All statuses')); el('status').firstChild.value = '';
    for (const status of statuses) { const o = node('option',status); o.value = status; el('status').append(o); }
    const distribution = el('distribution'); distribution.replaceChildren();
    for (const d of report.distribution) { const row = node('div',undefined,'operator'); row.append(node('span','Operator ' + d.operator)); const meter = node('meter'); meter.min = 0; meter.max = report.decisions || 1; meter.value = d.decisions; meter.setAttribute('aria-label','Operator ' + d.operator + ': ' + d.decisions + ' decisions'); row.append(meter,node('span',d.decisions + ' / ' + report.decisions)); distribution.append(row); }
    if (direct) {
      for(const statement of ['Agents use external user-controlled wallets.', 'Zoora holds no wallet balances or signing keys.', 'No wallet freezes, payment reversals or forced refunds.', report.direct_summary.requests + ' requests recorded; ' + report.direct_summary.declined + ' recipient refusals.', report.direct_summary.overdue + ' delivery deadlines missed in this transcript.']) distribution.append(node('p',statement));
    } else if (!report.distribution.length) distribution.append(node('p','No reviewer decisions recorded.'));
    const ledger = el('ledger'); ledger.replaceChildren();
    for (const [label,key] of (direct ? [['Payments recorded','funded'],['Net transferred','paid'],['Voluntary returns recorded','refunded']] : [['Escrow funded','funded'],['Worker payments','paid'],['Fees collected','fees'],['Client refunds','refunded'],['Conserved supply','supply']])) ledger.append(node('dt',label),node('dd',format(report.ledger[key])));
    text('proof',direct ? 'Recorded payments = net transfers + voluntary returns. Wallet balances and fees are not modeled.' : 'Reconciled: funded = payments + fees + refunds'); renderCases();
  }
  try {
    data = JSON.parse(el('report-data').textContent);
    if (data.schema_version !== 1 || data.classification !== 'SYNTHETIC' || data.verification !== 'REPLAY_VERIFIED_AT_EXPORT' || !Array.isArray(data.reports) || !data.reports.length || data.reports.length > 10) throw new Error('Unsupported export');
    for (const r of data.reports) {
      if (!Array.isArray(r.cases) || r.cases.length > 5000 || !Array.isArray(r.distribution) || r.cases.some(c => !statusNames.includes(c.status))) throw new Error('Invalid report dimensions');
      if (safeAmount(r.ledger.funded) !== safeAmount(r.ledger.paid) + (r.ledger.fees === null ? 0n : safeAmount(r.ledger.fees)) + safeAmount(r.ledger.refunded)) throw new Error('Escrow totals do not reconcile');
      if(r.ledger.supply !== null) safeAmount(r.ledger.supply); r.cases.forEach(c => { safeAmount(c.reward); if(r.ledger.mode === 'DIRECT_USER_WALLET'){safeAmount(c.paid);safeAmount(c.returned);if(c.refund_remaining !== '—')safeAmount(c.refund_remaining);} });
    }
    data.reports.forEach((r,i) => { const option = node('option',r.label); option.value = String(i); el('report-select').append(option); });
    el('report-select').addEventListener('change', () => { index = Number(el('report-select').value); render(); });
    for (const id of ['search','status']) el(id).addEventListener(id === 'search' ? 'input' : 'change', () => { page = 0; renderCases(); });
    el('previous').addEventListener('click', () => { if(page > 0) page--; renderCases(); }); el('next').addEventListener('click', () => { if((page + 1) * size < rows().length) page++; renderCases(); });
    render(); el('content').hidden = false; el('loading').hidden = true; document.body.dataset.ready = 'true';
  } catch (error) {
    text('error','This export cannot be displayed. Regenerate it from a report that passes Rust replay verification.'); el('error').hidden = false; el('content').hidden = true; el('loading').hidden = true; document.body.dataset.ready = 'error';
  }
})();
