/** approval.md: the same packet as Markdown, for reading in the Claude app. Feed text goes through md() (no links/HTML). */
import {md, safeUrl} from './escape.ts';
import {quotesNote, UNTRUSTED_NOTE} from './html.ts';
import {realAnalysisLine, type PacketModel} from './packet.ts';

const fence = (s: string): string => {
	const ticks = (s.match(/`{3,}/g) ?? []).reduce((a, t) => Math.max(a, t.length + 1), 3);
	const f = '`'.repeat(ticks);
	return `${f}text\n${s}\n${f}`;
};

export const renderMd = (m: PacketModel): string => {
	const o: string[] = [];
	o.push(`# Approve ${m.slug}: ${md(m.title)}`, '');
	o.push(`**${m.ready ? 'READY TO APPROVE' : 'NOT READY'}** · **${m.developing ? 'DEVELOPING' : 'CONFIRMED'}** · ${md(m.format)} · ${md(m.incident.protocol)} (${md(m.incident.type)}, ${md(m.incident.dateUtc)}) · built ${md(m.builtAtLocal)}`, '');
	o.push(m.ready ? `> Reply \`${m.reply}\` (or your edits) in the Claude app.` : '> Not ready to approve yet: fix the items below first.', '');
	o.push(`> ${UNTRUSTED_NOTE}`, '');
	if (!m.ready) o.push('## Fix before approving', '', ...m.blockers.map((b) => `- ${md(b)}`), '');
	const openCorrections = m.corrections.filter((c) => !c.recorded || !c.pinned);
	if (openCorrections.length) {
		o.push(`## Corrections to pin (${openCorrections.length})`, '');
		for (const c of openCorrections) {
			o.push(`- **${c.recorded ? 'Recorded, not pinned yet' : c.severity === 'correction' ? 'PIN A CORRECTION' : 'Update worth pinning'}** on \`${md(c.slug)}\`: ${md(c.change)}`);
			if (!c.recorded) o.push('', fence(c.command), '');
		}
		o.push('');
	}
	if (m.names.length) {
		o.push(`## Names the gate flagged (R4): ${m.names.length}`, '', 'No individual\'s name may appear unless a cited law-enforcement or regulator release names them. Check every line.', '');
		for (const f of m.names) o.push(`- ${f.severity.toUpperCase()} · ${md([f.where.scene, f.where.surface].filter(Boolean).join(' '))}: ${md(f.message)}`);
		o.push('');
	}
	if (m.quotes.length) {
		o.push(`## Quotes to check: ${m.quotes.length}`, '', quotesNote(m.aiStory), '');
		for (const q of m.quotes) o.push(`- ${md(q.where)}: “${md(q.text)}”`);
		o.push('');
	}
	o.push('## At a glance', '');
	const g = m.gate;
	if (!m.steps.some((s) => s.id === 'news-gate')) o.push(`- News gate: ${g ? `${g.verdict.toUpperCase()}, ${g.counts.claimsOk}/${g.counts.claims} claims traced` : 'did not run'}`);
	for (const s of m.steps) o.push(`- ${md(s.title)}: **${s.status}**${s.blocking ? ' (blocks)' : ''}. ${md(s.note)}`);
	const ra = realAnalysisLine(m);
	o.push(`- ${md(ra.text)} (**${ra.ok ? 'yes' : 'no'}**)`);
	if (m.developing) o.push(`- DEVELOPING label: ${md(m.developingInfo.labelVia ?? 'missing')}; said aloud in ${md(m.developingInfo.spokenIn ?? 'no scene')}`);
	o.push(`- Preview: ${m.preview.rel ? `${md(m.preview.rel)}${m.preview.durationSec ? ` (${m.preview.durationSec.toFixed(1)} s)` : ''}` : md(m.preview.note)}`);
	if (m.warnings.length) o.push('', '<details><summary>Warnings</summary>', '', ...m.warnings.map((w) => `- ${md(w)}`), '', '</details>');
	o.push('');
	o.push('## Script, claim by claim', '');
	for (const s of m.scenes) {
		o.push(`### ${md(s.id)} · ${md(s.segment)} (${md(s.type)})${s.badger ? ` · Badger: ${md(s.badger)}` : ''}`, '');
		if (s.title || s.bullets.length) o.push(`On screen: ${s.title ? `**${md(s.title)}**` : ''}${s.bullets.length ? ` · ${s.bullets.map(md).join(' · ')}` : ''}`, '');
		if (s.error) o.push(`**${md(s.error)}**`, '');
		for (const sen of s.sentences) {
			if (!sen.claims.length) {
				o.push(md(sen.display), '');
				continue;
			}
			for (const c of sen.claims) {
				o.push(`${c.ok === false ? '[NOT TRACED] ' : c.ok === true ? '[traced] ' : '[not checked] '}**${md(c.text)}**`);
				for (const e of c.excerpts) o.push(`> ${md(e.publisher)} (tier ${md(e.tier)}, \`${md(e.sourceId)}\`): “${md(e.text)}” ${safeUrl(e.url) ? `<${safeUrl(e.url)}>` : ''}`);
				if (!c.excerpts.length) o.push('> No stored excerpt found for this claim.');
				o.push('');
			}
		}
	}
	o.push('## What this video adds', '');
	if (!m.analysis.length) o.push('**No analysis.** A daily video may not publish without real analysis.', '');
	for (const a of m.analysis) o.push(`- **${md(a.id)}** (${md(a.kind)}, ${md(a.basis)}): ${md(a.detail)}${a.method ? `\n  Method: ${md(a.method)}` : ''}`);
	o.push('', '## Thumbnails', '', m.thumbnails.length ? m.thumbnails.map((t) => `- ${md(t.label)}${t.rel ? `: ${md(t.rel)}` : ''}`).join('\n') : 'None rendered.', '');
	const c = m.checklist;
	o.push('## Publish checklist', '');
	o.push(`- Title: ${md(c.title)}`, `- Made for kids: ${md(c.madeForKids)}`, `- Paid promotion: ${md(c.paidPromotion)}`, `- Altered or synthetic content: ${md(c.synthetic)}`, '');
	o.push('Pinned comment (copy exactly):', '', fence(c.pinnedComment), '');
	if (c.description) o.push('<details><summary>YouTube description</summary>', '', fence(c.description), '', '</details>', '');
	if (c.kitFailing.length) o.push('Publish-kit checks to look at:', '', ...c.kitFailing.map((k) => `- \`${md(k.id)}\`: ${md(k.detail)}`), '');
	o.push('After you approve:', '', ...c.upload.map((u, i) => `${i + 1}. ${md(u)}`), '');
	if (g) {
		o.push('## News gate rules', '', '| Rule | Result |', '| --- | --- |', ...g.rules.map((r) => `| ${md(r.rule)} | ${r.status === 'fail' ? `FAIL (${Number(r.errors) || 0})` : r.status === 'warn' ? `pass, ${Number(r.warnings) || 0} warning(s)` : 'pass'} |`), '');
		const errs = g.findings.filter((f) => f.severity === 'error');
		if (errs.length) o.push('Errors:', '', ...errs.map((f) => `- [${md(f.rule)}] ${md([f.where.scene, f.where.surface].filter(Boolean).join(' '))}: ${md(f.message)} Fix: ${md(f.fix)}`), '');
	}
	o.push('## Drafts that go out after approval', '', 'X:', '', fence(m.post.x), '', 'Telegram:', '', fence(m.post.telegram), '', `Threat Brief email: ${md(m.post.email.subject)}`, '', fence(m.post.email.text), '');
	const v = m.versions;
	o.push('## Versions', '', `storyboard \`${v.storyboard.sha256 ?? 'none'}\``, '', `render \`${v.render.sha256 ?? 'none'}\``, '', `brief \`${v.brief.sha256 ?? 'none'}\` · news gate \`${v.newsGate.sha256 ?? 'none'}\``, '');
	if (m.ready) o.push(`> Reply \`${m.reply}\` (or your edits) in the Claude app.`, '');
	return o.join('\n');
};
