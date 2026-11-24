/**
 * approval.html: one self-contained, mobile-first page the owner reviews on his phone in about 5 minutes. No scripts
 * (the CSP forbids them), no external requests; the preview is a relative link to short.mp4 next to the page, and
 * thumbnails are inlined when small. Every value from feeds or the storyboard goes through esc()/link().
 */
import {esc, link, safeRelative} from './escape.ts';
import type {ClaimView, PacketModel, SceneView} from './packet.ts';
import type {StepResult} from './types.ts';

const CSS = `
:root{--bg:#E6E8EB;--card:#F4F6F8;--ink:#0B0C0F;--muted:#4A5260;--line:#C9CED6;--slate:#161A21;--teal:#29B8AD;--teal-ink:#0B5F59;--ok-bg:#D7F0ED;--bad:#B3261E;--bad-bg:#F9DEDC;--warn-bg:#ECEFF3;--code:#E9ECF0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0B0C0F;--card:#161A21;--ink:#F4F6F8;--muted:#AAB2BF;--line:#2A303B;--slate:#C9CED6;--teal:#29B8AD;--teal-ink:#7FE0D8;--ok-bg:#103B37;--bad:#F2B8B5;--bad-bg:#4A1E1B;--warn-bg:#1E232C;--code:#202631}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
main{max-width:760px;margin:0 auto;padding:12px 16px 40px}
section,header.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}
h1{font-size:1.35rem;line-height:1.25;margin:.25rem 0 .5rem}
h2{font-size:1.05rem;margin:0 0 .6rem}
h3{font-size:.95rem;margin:.9rem 0 .3rem}
.kicker{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin:.4rem 0}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;font-size:.8rem}
.ready{background:var(--teal);color:#0B0C0F}.notready{background:var(--bad);color:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .notready{color:#0B0C0F}}
.dev{background:var(--slate);color:var(--bg)}.conf{background:var(--warn-bg);color:var(--ink);border:1px solid var(--line)}
.reply{margin-top:.6rem;padding:10px 12px;border-radius:10px;background:var(--ok-bg);font-weight:600}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem;background:var(--code);border-radius:6px}
code{padding:1px 5px}pre{padding:10px;white-space:pre-wrap;margin:.4rem 0}
ul.tight{margin:.2rem 0;padding-left:1.2rem}ul.tight li{margin:.15rem 0}
.blockers li{color:var(--bad);font-weight:600}
.glance{list-style:none;padding:0;margin:0}.glance li{padding:6px 0;border-bottom:1px solid var(--line);display:flex;gap:8px}.glance li:last-child{border:0}
.ok::before{content:"\\2713";color:var(--teal-ink);font-weight:700}.no::before{content:"\\2717";color:var(--bad);font-weight:700}.na::before{content:"\\2013";color:var(--muted);font-weight:700}
video{display:block;width:100%;max-height:72vh;background:#000;border-radius:10px}
.scene{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.scene:first-of-type{border:0;margin-top:0;padding-top:0}
.scene-head{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}.scene-head b{font-size:.95rem}.tag{font-size:.75rem;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 6px}
.onscreen{font-size:.85rem;color:var(--muted);margin:.2rem 0}
p.say{margin:.35rem 0}
mark{background:var(--ok-bg);color:inherit;border-radius:4px;padding:0 2px}mark.bad{background:var(--bad-bg);outline:1px solid var(--bad)}mark.unk{background:var(--warn-bg)}
.src{display:block;margin:.25rem 0 .5rem .6rem;padding:6px 8px;border-left:3px solid var(--teal);background:var(--warn-bg);font-size:.82rem;border-radius:0 6px 6px 0}
.src .who{font-weight:700}.src q{quotes:"\\201C" "\\201D"}
table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{text-align:left;border-bottom:1px solid var(--line);padding:5px 4px;vertical-align:top}
.st-passed{color:var(--teal-ink);font-weight:700}.st-failed{color:var(--bad);font-weight:700}.st-missing{color:var(--bad);font-weight:700}.st-warning,.st-skipped{color:var(--muted);font-weight:700}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.thumbs figure{margin:0}.thumbs img{width:100%;border-radius:8px;border:1px solid var(--line)}.thumbs figcaption{font-size:.75rem;color:var(--muted)}
details{margin:.4rem 0}summary{cursor:pointer;font-weight:600}
.small{font-size:.8rem;color:var(--muted)}
.nowrap{white-space:nowrap}
a{color:var(--teal-ink)}
`;

const STATUS_WORD: Record<StepResult['status'], string> = {passed: 'passed', failed: 'FAILED', missing: 'missing', skipped: 'skipped', warning: 'warning'};

const claimHtml = (c: ClaimView): string => {
	const cls = c.ok === true ? '' : c.ok === false ? ' class="bad"' : ' class="unk"';
	const tip = c.ok === false ? ' (NOT traced by the gate)' : '';
	const src = c.excerpts
		.map((e) => `<span class="src"><span class="who">${esc(e.publisher)}</span> <span class="small">tier ${esc(e.tier)} · <code>${esc(e.sourceId)}</code></span><br><q>${esc(e.text)}</q><br><span class="small">${link(e.url, e.title || e.url)}</span></span>`)
		.join('');
	const missing = !c.excerpts.length ? `<span class="src"><span class="who">No stored excerpt found for ${esc(c.srcIds.join(', ') || 'this claim')}</span></span>` : '';
	return `<mark${cls}>${esc(c.text)}</mark>${tip ? `<span class="small">${esc(tip)}</span>` : ''}${src}${missing}`;
};

const sceneHtml = (s: SceneView): string => {
	const head = `<div class="scene-head"><b>${esc(s.id)} · ${esc(s.segment)}</b><span class="tag">${esc(s.type)}</span>${s.badger ? `<span class="tag">Badger: ${esc(s.badger)}</span>` : ''}${s.analysisIds.length ? `<span class="tag">analysis ${esc(s.analysisIds.join(', '))}</span>` : ''}</div>`;
	const onscreen = s.title || s.bullets.length ? `<div class="onscreen">On screen: ${s.title ? `<b>${esc(s.title)}</b>` : ''}${s.bullets.length ? ` · ${s.bullets.map((b) => esc(b)).join(' · ')}` : ''}</div>` : '';
	const body = s.sentences
		.map((sen) => {
			// a tagged sentence is all claims (text after the last tag belongs to the last claim, as in the gate)
			if (!sen.claims.length) return `<p class="say">${esc(sen.display)}</p>`;
			return `<p class="say">${sen.claims.map(claimHtml).join(' ')}</p>`;
		})
		.join('');
	return `<div class="scene">${head}${onscreen}${s.error ? `<p class="blockers">${esc(s.error)}</p>` : ''}${body}</div>`;
};

const stepRow = (s: StepResult): string =>
	`<tr><td>${esc(s.title)}</td><td class="st-${esc(s.status)} nowrap">${esc(STATUS_WORD[s.status])}${s.blocking ? '<br>(blocks)' : ''}</td><td>${esc(s.note)}${s.durationMs ? ` <span class="small">${(s.durationMs / 1000).toFixed(1)} s</span>` : ''}</td></tr>`;

export const renderHtml = (m: PacketModel): string => {
	const h: string[] = [];
	h.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
	h.push(`<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">`);
	h.push(`<title>Approve ${esc(m.slug)}</title><style>${CSS}</style></head><body><main>`);

	// header
	h.push('<header class="card">');
	h.push(`<div class="kicker">${esc(m.showName)} · daily Short · ${esc(m.date)}</div>`);
	h.push(`<h1>${esc(m.title || '(no title)')}</h1>`);
	h.push(`<div class="pills"><span class="pill ${m.ready ? 'ready' : 'notready'}">${m.ready ? 'READY TO APPROVE' : 'NOT READY'}</span><span class="pill ${m.developing ? 'dev' : 'conf'}">${m.developing ? 'DEVELOPING' : 'CONFIRMED'}</span><span class="pill conf">${esc(m.format)}</span></div>`);
	h.push(`<div class="small">${esc(m.incident.protocol)} · ${esc(m.incident.type)} · incident ${esc(m.incident.dateUtc)} · built ${esc(m.builtAtLocal)}</div>`);
	h.push(
		m.ready
			? `<div class="reply">Reply <code>${esc(m.reply)}</code> (or your edits) in the Claude app.</div>`
			: `<div class="reply">Not ready to approve yet: the fixes are listed below. Reply with your edits in the Claude app, or wait for the rebuilt packet.</div>`,
	);
	h.push('</header>');

	if (!m.ready) h.push(`<section><h2>Fix before approving (${m.blockers.length})</h2><ul class="tight blockers">${m.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>`);

	// 5-minute checklist
	const g = m.gate;
	const step = (id: StepResult['id']) => m.steps.find((s) => s.id === id);
	const glance: Array<[string, 'ok' | 'no' | 'na']> = [
		[`News gate: ${g ? `${g.verdict.toUpperCase()}, ${g.counts.claimsOk}/${g.counts.claims} claims traced to stored excerpts` : 'did not run'}`, g?.verdict === 'pass' ? 'ok' : 'no'],
		[`General claim gate: ${step('general-gate')?.status ?? 'n/a'}`, step('general-gate')?.status === 'passed' ? 'ok' : step('general-gate')?.blocking ? 'no' : 'na'],
		[`Real analysis: ${m.analysis.length ? m.analysis.map((a) => `${a.kind} (${a.basis}) in ${a.presentedIn.join(', ') || 'no scene'}`).join('; ') : 'none'}`, m.analysis.some((a) => a.presentedIn.length) ? 'ok' : 'no'],
		[m.developing ? `DEVELOPING label: ${m.developingInfo.labelVia ?? 'missing'}; said aloud in ${m.developingInfo.spokenIn ?? 'no scene'}` : 'Confirmed story: no DEVELOPING label needed', m.developing ? (m.developingInfo.labelVia && m.developingInfo.spokenIn ? 'ok' : 'no') : 'ok'],
		[`Preview: ${m.preview.rel ? `${m.preview.durationSec ? `${m.preview.durationSec.toFixed(1)} s` : 'rendered'}` : m.preview.note}`, m.preview.rel ? 'ok' : 'no'],
		[`Made for kids: No · Paid promotion: ${m.checklist.paidPromotion.startsWith('Yes') ? 'Yes' : 'No'} · Altered content: ${m.checklist.synthetic.split(':')[0]}`, 'ok'],
	];
	h.push(`<section><h2>At a glance</h2><ul class="glance">${glance.map(([t, s]) => `<li class="${s}"><span>${esc(t)}</span></li>`).join('')}</ul>`);
	if (m.warnings.length) h.push(`<details><summary>Warnings (${m.warnings.length})</summary><ul class="tight">${m.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`);
	h.push('</section>');

	// preview
	const rel = m.preview.rel ? safeRelative(m.preview.rel) : null;
	h.push('<section><h2>Preview</h2>');
	if (rel) {
		const poster = m.preview.posterDataUri ? ` poster="${esc(m.preview.posterDataUri)}"` : '';
		h.push(`<video controls playsinline preload="metadata"${poster} src="${esc(rel)}"></video>`);
		h.push(`<p class="small"><a href="${esc(rel)}">Open ${esc(rel)}</a>${m.preview.durationSec ? ` · ${m.preview.durationSec.toFixed(1)} s` : ''}${m.preview.bytes ? ` · ${(m.preview.bytes / 1e6).toFixed(1)} MB` : ''}. If it does not play here, open the MP4 sent with this page.</p>`);
	} else h.push(`<p><b>No preview.</b> ${esc(m.preview.note)}</p>`);
	h.push('</section>');

	// script
	h.push(`<section><h2>Script, claim by claim</h2><p class="small">Highlighted text is a claim; under it is the stored source excerpt it rests on. Red = the gate could not trace it. Grey = not checked by the gate.</p>`);
	for (const s of m.scenes) h.push(sceneHtml(s));
	h.push('</section>');

	// analysis
	h.push('<section><h2>What this video adds</h2>');
	if (!m.analysis.length) h.push('<p class="blockers"><b>No analysis.</b> A daily video may not publish without real analysis.</p>');
	for (const a of m.analysis) h.push(`<h3>${esc(a.id)} · ${esc(a.kind)} · ${esc(a.basis)}</h3><p>${esc(a.detail)}</p>${a.method ? `<p class="small">Method: ${esc(a.method)}</p>` : ''}`);
	h.push('</section>');

	// thumbnails
	h.push('<section><h2>Thumbnails</h2>');
	if (!m.thumbnails.length) h.push('<p class="small">No thumbnails were rendered (see the build steps).</p>');
	else
		h.push(
			`<div class="thumbs">${m.thumbnails
				.map((t) => {
					const src = t.dataUri ?? (t.rel ? safeRelative(t.rel) : null);
					return `<figure>${src ? `<img alt="${esc(t.label)}" src="${esc(src)}">` : ''}<figcaption>${esc(t.label)}</figcaption></figure>`;
				})
				.join('')}</div>`,
		);
	h.push('</section>');

	// publish checklist
	const c = m.checklist;
	h.push('<section><h2>Publish checklist</h2><ul class="tight">');
	h.push(`<li><b>Title:</b> ${esc(c.title)}</li><li><b>Made for kids:</b> ${esc(c.madeForKids)}</li><li><b>Paid promotion:</b> ${esc(c.paidPromotion)}</li><li><b>Altered or synthetic content:</b> ${esc(c.synthetic)}</li>`);
	h.push('</ul><h3>Pinned comment (copy exactly)</h3>');
	h.push(`<pre>${esc(c.pinnedComment)}</pre>`);
	if (c.corrections.length) h.push(`<p class="small">Corrections in it: ${c.corrections.map((x) => `${esc(x.id)} (${esc(x.status)})`).join(', ')}. After pinning, run <code>node scripts/news/corrections.ts mark-pinned &lt;id&gt;</code>.</p>`);
	if (c.description) h.push(`<details><summary>YouTube description</summary><pre>${esc(c.description)}</pre></details>`);
	if (c.kitFailing.length) h.push(`<details><summary>Publish-kit checks to look at (${c.kitFailing.length})</summary><ul class="tight">${c.kitFailing.map((k) => `<li><code>${esc(k.id)}</code>: ${esc(k.detail)}</li>`).join('')}</ul></details>`);
	if (c.kitNotApplicable.length) h.push(`<p class="small">Not applicable to a Short: ${c.kitNotApplicable.map((k) => `${esc(k.id)} (${esc(k.why)})`).join(', ')}</p>`);
	h.push(`<h3>After you approve</h3><ol class="tight">${c.upload.map((u) => `<li>${esc(u)}</li>`).join('')}</ol>`);
	h.push('</section>');

	// gates
	h.push('<section><h2>Gate reports and build steps</h2>');
	h.push(`<table><thead><tr><th>Step</th><th>Result</th><th>Note</th></tr></thead><tbody>${m.steps.map(stepRow).join('')}</tbody></table>`);
	if (g) {
		h.push(`<h3>News gate rules: ${esc(g.verdict.toUpperCase())}</h3><table><thead><tr><th>Rule</th><th>Result</th><th>What it checks</th></tr></thead><tbody>`);
		for (const r of g.rules) h.push(`<tr><td class="nowrap">${esc(r.rule)}</td><td class="${r.status === 'fail' ? 'st-failed' : 'st-passed'} nowrap">${r.status === 'fail' ? `FAIL (${r.errors})` : r.status === 'warn' ? `pass, ${r.warnings} warning(s)` : 'pass'}</td><td>${esc(r.title)}</td></tr>`);
		h.push('</tbody></table>');
		const errs = g.findings.filter((f) => f.severity === 'error');
		const warns = g.findings.filter((f) => f.severity === 'warning');
		if (errs.length) h.push(`<h3>Errors (${errs.length})</h3><ul class="tight blockers">${errs.map((f) => `<li>[${esc(f.rule)}] ${esc([f.where.scene, f.where.surface].filter(Boolean).join(' '))}: ${esc(f.message)}<br><span class="small">Fix: ${esc(f.fix)}</span></li>`).join('')}</ul>`);
		if (warns.length) h.push(`<details><summary>Gate warnings (${warns.length})</summary><ul class="tight">${warns.map((f) => `<li>[${esc(f.rule)}] ${esc(f.message)}</li>`).join('')}</ul></details>`);
	}
	h.push('</section>');

	// after approval
	h.push('<section><h2>What goes out after approval (drafts)</h2><p class="small">Nothing is sent or uploaded automatically. Links are added once you upload by hand.</p>');
	h.push(`<details><summary>X post</summary><pre>${esc(m.post.x)}</pre></details>`);
	h.push(`<details><summary>Telegram</summary><pre>${esc(m.post.telegram)}</pre></details>`);
	h.push(`<details><summary>YouTube community post</summary><pre>${esc(m.post.community)}</pre></details>`);
	h.push(`<details><summary>Threat Brief email: ${esc(m.post.email.subject)}</summary><pre>${esc(m.post.email.text)}</pre></details>`);
	h.push('</section>');

	// footer
	const v = m.versions;
	const short = (x: string | null) => (x ? x.slice(0, 12) : 'none');
	h.push('<section class="small"><h2>Versions</h2><ul class="tight">');
	h.push(`<li>storyboard <code>${esc(short(v.storyboard.sha256))}</code> · brief <code>${esc(short(v.brief.sha256))}</code> · render <code>${esc(short(v.render.sha256))}</code> · news gate <code>${esc(short(v.newsGate.sha256))}</code></li>`);
	h.push(`<li>Built ${esc(m.builtAt)} (${esc(m.builtAtLocal)}). Approval checks these hashes, so a changed file needs a new packet.</li>`);
	h.push(`<li>Sentence splitter: ${esc(m.splitter)}.</li></ul></section>`);
	h.push(m.ready ? `<div class="reply">Reply <code>${esc(m.reply)}</code> (or your edits) in the Claude app.</div>` : '');
	h.push('</main></body></html>');
	return h.join('\n');
};
