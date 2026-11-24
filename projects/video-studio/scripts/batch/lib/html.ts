/**
 * The weekly approval page: one self-contained, mobile-first HTML file. No scripts (the CSP forbids them), no
 * external requests, no referrer. Every value from storyboards, sources, gate reports and file names goes through
 * esc() / link(); media are relative paths the batch wrote. Light and dark themes follow the phone's setting.
 */
import {esc, link, safeRelative} from './escape.ts';
import type {ClaimState, DubState, ItemState} from './inspect.ts';
import type {ReviewItem, ReviewModel} from './review.ts';
import {formatBytes} from './util.ts';
import {shortDate} from './week.ts';
import {formatLocal, formatUtcTime} from './zone.ts';

const CSS = `
:root{--bg:#E6E8EB;--card:#F4F6F8;--ink:#0B0C0F;--muted:#4A5260;--line:#C9CED6;--slate:#161A21;--teal:#29B8AD;--teal-ink:#0B5F59;--ok-bg:#D7F0ED;--bad:#B3261E;--bad-bg:#F9DEDC;--soft:#ECEFF3;--code:#E9ECF0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0B0C0F;--card:#161A21;--ink:#F4F6F8;--muted:#AAB2BF;--line:#2A303B;--slate:#C9CED6;--teal-ink:#7FE0D8;--ok-bg:#103B37;--bad:#F2B8B5;--bad-bg:#4A1E1B;--soft:#1E232C;--code:#202631}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
main{max-width:780px;margin:0 auto;padding:12px 16px 48px}
section,header.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}
h1{font-size:1.35rem;line-height:1.25;margin:.25rem 0 .5rem}h2{font-size:1.1rem;line-height:1.3;margin:.2rem 0 .6rem}h3{font-size:.95rem;margin:1rem 0 .35rem}
.kicker{font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin:.45rem 0}.pill{display:inline-block;white-space:nowrap;padding:3px 10px;border-radius:999px;font-weight:700;font-size:.78rem;border:1px solid var(--line);background:var(--soft)}
.ready{background:var(--teal);border-color:var(--teal);color:#0B0C0F}.notready{background:var(--bad);border-color:var(--bad);color:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .notready{color:#0B0C0F}}
.reply{margin:.6rem 0 0;padding:10px 12px;border-radius:10px;background:var(--ok-bg);font-weight:600}
.edit{margin:.4rem 0 0;padding:10px 12px;border-radius:10px;background:var(--soft)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.84rem;background:var(--code);border-radius:6px}code{padding:1px 5px}pre{padding:10px;white-space:pre-wrap;margin:.4rem 0}
ul.tight{margin:.2rem 0;padding-left:1.2rem}ul.tight li{margin:.15rem 0}.blockers li{color:var(--bad);font-weight:600}
table{border-collapse:collapse;width:100%;font-size:.86rem}th,td{text-align:left;border-bottom:1px solid var(--line);padding:6px 4px;vertical-align:top}
.sched td:first-child{white-space:nowrap}
video{display:block;width:100%;max-height:70vh;background:#000;border-radius:10px}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.thumbs figure{margin:0}.thumbs img{width:100%;border-radius:8px;border:1px solid var(--line)}.thumbs figcaption{font-size:.74rem;color:var(--muted)}
.scene{border-top:1px solid var(--line);padding:8px 0}.scene:first-child{border-top:0}.scene-head{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}.tag{font-size:.74rem;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 6px}
.onscreen{font-size:.84rem;color:var(--muted);margin:.15rem 0}.say{margin:.3rem 0}sup.ref{font-size:.7rem;color:var(--teal-ink);font-weight:700;margin-left:2px}
.src{margin:.35rem 0;padding:6px 8px;border-left:3px solid var(--teal);background:var(--soft);font-size:.84rem;border-radius:0 6px 6px 0}.src q{quotes:"\\201C" "\\201D"}
.ok{color:var(--teal-ink);font-weight:700}.no{color:var(--bad);font-weight:700}.muted,.small{color:var(--muted);font-size:.82rem}
details{margin:.45rem 0}summary{cursor:pointer;font-weight:600}a{color:var(--teal-ink)}
`;

const claimSummary = (c: ClaimState): string => {
	if (!c.exists) return '<span class="no">not run</span>';
	if (c.pass === null) return '<span class="no">unreadable report</span>';
	if (!c.pass) return `<span class="no">FAILS: ${c.errors} error(s)</span>`;
	return `<span class="ok">passes</span>${c.warnings ? ` <span class="small">(${c.warnings} warning(s))</span>` : ''}${c.stale ? ' <span class="no">stale: the storyboard changed since</span>' : ''}`;
};

const findingList = (c: ClaimState, level: 'error' | 'warning', scenes: Set<string> | null): string => {
	const list = c.findings.filter((f) => f.level === level && (!scenes || !f.scene || scenes.has(f.scene)));
	if (!list.length) return '';
	const items = list.map((f) => `<li>[${esc(f.rule)}] ${esc(f.where)}: ${esc(f.message)}${f.fix ? `<br><span class="small">Fix: ${esc(f.fix)}</span>` : ''}</li>`).join('');
	return level === 'error' ? `<h3>Gate errors (${list.length})</h3><ul class="tight blockers">${items}</ul>` : `<details><summary>Gate warnings (${list.length})</summary><ul class="tight">${items}</ul></details>`;
};

const dubLine = (d: DubState): string => {
	const state = d.ready && d.reviewed ? '<span class="ok">ready to add</span>' : '<span class="no">not ready</span>';
	const parts = [
		d.storyboard.exists ? `translation: ${esc(d.reviewed ? 'native-reviewed' : (d.status ?? 'machine'))}` : 'translation: missing',
		d.storyboard.exists ? `gate: ${claimSummary(d.claims)}` : '',
		d.timeline.exists ? `voice: ${esc(d.timeline.mode ?? '?')}` : '',
	].filter(Boolean);
	return `<li><b>${esc(d.lang)}</b> ${state}<br><span class="small">${parts.join(' · ')}${d.notes.length && !(d.ready && d.reviewed) ? `<br>${esc(d.notes.join('; '))}` : ''}</span></li>`;
};

const scenesHtml = (s: ItemState): string =>
	s.scenes
		.map((sc) => {
			const refs = sc.refs.map((r) => `<sup class="ref">${esc(r)}</sup>`).join('');
			const head = `<div class="scene-head"><b>${esc(sc.id)}</b><span class="tag">${esc(sc.segment ?? sc.type)}</span></div>`;
			const onscreen = sc.onScreen.length ? `<div class="onscreen">On screen: ${sc.onScreen.map((l) => esc(l)).join(' · ')}</div>` : '';
			return `<div class="scene">${head}${onscreen}<p class="say">${sc.text ? esc(sc.text) : '<span class="small">(silent beat)</span>'}${refs}</p></div>`;
		})
		.join('');

const itemHtml = (r: ReviewItem, timeZone: string): string => {
	const s = r.state;
	const i = s.item;
	const h: string[] = [];
	const title = i.kind === 'short' ? (s.shortTitle ?? i.title) : (s.kitTitle ?? s.title ?? i.title);
	const words = s.scenes.reduce((n, sc) => n + (sc.text ? sc.text.split(/\s+/).length : 0), 0);
	h.push(`<section id="item-${esc(i.id)}">`);
	h.push(`<div class="kicker">${esc(i.id)} · ${esc(i.channelName)} · ${esc(i.kind === 'long' ? `${i.formatLabel}, long-form` : `Short ${i.shortIndex} of ${i.parentId}`)}</div>`);
	h.push(`<h2>${esc(title)}</h2>`);
	h.push(
		`<div class="pills"><span class="pill ${s.ready ? 'ready' : 'notready'}">${s.ready ? 'READY' : 'NOT READY'}</span><span class="pill">${esc(i.slot.day)} ${esc(i.slot.local)}</span><span class="pill">${esc(['en', ...i.languages.dubs].join(' · '))}</span>${s.fiction ? '<span class="pill">fiction</span>' : ''}</div>`,
	);
	h.push(`<p class="small">Proposed slot: <b>${esc(i.slot.day)} ${esc(i.slot.local)}</b> (${esc(formatUtcTime(Date.parse(i.slot.publishAt)))}). Approving uploads it as <b>private</b>, scheduled for this time; nothing goes public before it.</p>`);
	if (s.blockers.length) h.push(`<h3>Not ready: fix first</h3><ul class="tight blockers">${s.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
	if (s.warnings.length) h.push(`<details><summary>Warnings (${s.warnings.length})</summary><ul class="tight">${s.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`);

	h.push('<h3>Preview</h3>');
	const href = r.preview.href ? safeRelative(r.preview.href) : null;
	if (href) {
		h.push(`<video controls playsinline preload="none" src="${esc(href)}"></video>`);
		h.push(`<p class="small"><a href="${esc(href)}">Open ${esc(r.preview.label)}</a>${s.render.bytes ? ` · ${esc(formatBytes(s.render.bytes))}` : ''}${s.render.sha256 ? ` · sha256 <code>${esc(s.render.sha256.slice(0, 12))}</code>` : ''}. This exact file is what the approval binds.</p>`);
	} else h.push(`<p class="small"><b>No preview yet.</b> ${esc(r.preview.label)} is not rendered.</p>`);

	if (i.kind === 'long') {
		h.push('<h3>Thumbnails (Test &amp; Compare variants)</h3>');
		if (!r.thumbs.length) h.push('<p class="small">No thumbnails rendered yet.</p>');
		else h.push(`<div class="thumbs">${r.thumbs.map((t) => (safeRelative(t.href ?? '') ? `<figure><img alt="${esc(t.label)}" src="${esc(t.href)}"><figcaption>${esc(t.label)}</figcaption></figure>` : '')).join('')}</div>`);
	}

	h.push(`<details${i.kind === 'short' ? ' open' : ''}><summary>Script: ${s.scenes.length} scene(s), about ${words} words</summary>${s.scenes.length ? scenesHtml(s) : '<p class="small">No storyboard yet.</p>'}</details>`);

	h.push(`<h3>Claim report: ${claimSummary(s.claims)}</h3>`);
	if (s.claims.exists) {
		const scenes = i.kind === 'short' ? new Set(s.scenes.map((x) => x.id)) : null;
		h.push(findingList(s.claims, 'error', scenes), findingList(s.claims, 'warning', scenes));
		if (s.claims.waivers.length) h.push(`<details><summary>Waivers for you to check (${s.claims.waivers.length})</summary><ul class="tight">${s.claims.waivers.map((w) => `<li>${esc(w.scene)} · ${esc(w.rule)}: “${esc(w.match)}”: ${esc(w.reason)}${w.used ? '' : ' <span class="small">(unused)</span>'}</li>`).join('')}</ul></details>`);
		const ran = s.claims.checkedAt && Number.isFinite(Date.parse(s.claims.checkedAt)) ? formatLocal(Date.parse(s.claims.checkedAt), timeZone) : '?';
		h.push(`<p class="small">Gate run ${esc(ran)}${r.claimReport && safeRelative(r.claimReport) ? ` · <a href="${esc(r.claimReport)}">full report</a>` : ''}.</p>`);
	}

	h.push(`<details><summary>Sources (${s.sources.length})</summary>`);
	if (!s.sources.length) h.push('<p class="small">No sources cited.</p>');
	for (const src of s.sources) h.push(`<div class="src"><sup class="ref">${esc(src.id)}</sup> ${link(src.url, src.title || src.url)}<br><span class="small">${esc(src.status ?? '?')} · accessed ${esc(src.accessed ?? '?')}</span>${src.quote ? `<br><q>${esc(src.quote)}</q>` : ''}</div>`);
	h.push('</details>');

	h.push('<h3>Upload settings (from the publish kit)</h3>');
	if (s.settings) {
		h.push(`<ul class="tight"><li>Made for kids: <b>${s.settings.madeForKids ? 'Yes' : 'No'}</b></li><li>Altered or synthetic content: <b>${s.settings.containsSyntheticMedia ? 'Yes' : 'No'}</b></li><li>Paid promotion: <b>${s.settings.paidPromotion ? 'Yes (tick it in Studio)' : 'No'}</b></li><li>Privacy: <b>private</b>, publishes at the slot above</li></ul>`);
		if (s.settings.reasons.length) h.push(`<details><summary>Why</summary><ul class="tight">${s.settings.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`);
	} else h.push('<p class="small">No publish kit yet.</p>');
	if (s.kitFailing.length) h.push(`<ul class="tight blockers">${s.kitFailing.map((k) => `<li><code>${esc(k.id)}</code>: ${esc(k.detail)}</li>`).join('')}</ul>`);

	if (i.kind === 'long' && s.dubs.length) {
		h.push(`<h3>Dubbed audio tracks</h3><ul class="tight">${s.dubs.map(dubLine).join('')}</ul><p class="small">Tracks are added by hand in Studio after the upload. Only a ready, native-reviewed track is added.</p>`);
	}

	h.push(`<h3>After the upload (Studio)</h3><ul class="tight">${r.studioSteps.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
	h.push(
		s.ready
			? `<div class="reply">Approve: reply <code>${esc(r.reply)}</code></div>`
			: `<div class="reply">Not approvable yet. The fixes are above; you get a new page once they are done.</div>`,
	);
	h.push(`<div class="edit">Edit: reply <code>${esc(r.edit)}</code>. The session applies it, re-runs the gates and the render, and sends a new page.</div>`);
	h.push(`<p class="small"><a href="#top">Back to the schedule</a></p>`);
	h.push('</section>');
	return h.join('');
};

export const renderReviewHtml = (m: ReviewModel): string => {
	const h: string[] = [];
	h.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
	h.push(`<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">`);
	h.push(`<title>Weekly approval ${esc(m.week)}</title><style>${CSS}</style></head><body><main id="top">`);

	h.push('<header class="card">');
	h.push(`<div class="kicker">Weekly batch · ${esc(m.week)} · ${esc(shortDate(m.weekStart))} to ${esc(shortDate(m.weekEnd, true))} · times ${esc(m.timeZone)}</div>`);
	h.push(`<h1>Weekly approval: ${m.items.length} item(s)</h1>`);
	h.push(`<div class="pills"><span class="pill ready">${m.ready.length} READY</span>${m.notReady.length ? `<span class="pill notready">${m.notReady.length} NOT READY</span>` : ''}</div>`);
	h.push(
		m.ready.length
			? `<div class="reply">Approve every READY item: reply <code>${esc(m.replyAll)}</code>. Or name some: <code>${esc(`APPROVE ${m.week} ${m.ready.slice(0, 2).join(' ')}`)}</code>.</div>`
			: '<div class="reply">Nothing is ready to approve yet. Each item lists what is missing.</div>',
	);
	h.push(`<div class="edit">Edits: reply <code>${esc(`EDIT <item>: <what to change>`)}</code>. Only your own reply approves; nothing is uploaded until then.</div>`);
	h.push(`<p class="small">${esc(m.status)} Built ${esc(m.builtAtLocal)}. After your reply, the session writes the uploader's approval records for exactly these files and times; the uploader then sends each one as a private video scheduled for its slot. A file that changes after this page was built needs a new page.</p>`);
	h.push('</header>');

	if (m.ownerInputs.length) h.push(`<section><h2>Needs your decision first</h2><ul class="tight blockers">${m.ownerInputs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`);

	h.push('<section><h2>Schedule</h2><table class="sched"><thead><tr><th>Publishes</th><th>Item</th><th>What</th></tr></thead><tbody>');
	for (const r of m.items) {
		const i = r.state.item;
		const status = r.state.ready ? '<span class="pill ready">READY</span>' : `<span class="pill notready">NOT READY</span> <span class="small">${r.state.blockers.length} to fix</span>`;
		h.push(`<tr><td>${esc(i.slot.day)} ${esc(i.slot.date.slice(5))}<br><span class="small">${esc(i.slot.time)}</span></td><td><a href="#item-${esc(i.id)}">${esc(i.id)}</a><br><span class="small">${esc(i.channelName)}</span></td><td>${esc(i.kind === 'long' ? i.formatLabel : `Short ${i.shortIndex} of ${i.parentId}`)}<br><span class="small">${esc(i.kind === 'short' ? (r.state.shortTitle ?? i.title) : (r.state.kitTitle ?? r.state.title ?? i.title))}</span><br>${status}</td></tr>`);
	}
	h.push('</tbody></table>');
	if (m.warnings.length) h.push(`<details><summary>Plan warnings (${m.warnings.length})</summary><ul class="tight">${m.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`);
	h.push('</section>');

	for (const r of m.items) h.push(itemHtml(r, m.timeZone));

	h.push(`<section class="small"><h2>Versions</h2><p>Plan sha256 <code>${esc(m.planSha256.slice(0, 16))}</code>. Built ${esc(m.builtAt)}. The approve step re-checks the hash of every file shown here and refuses an item whose files changed.</p></section>`);
	h.push('</main></body></html>');
	return h.join('\n');
};
