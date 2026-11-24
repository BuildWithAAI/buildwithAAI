/** Claim report rendering (pure): Markdown for the owner, a short console summary. Texts are already redacted. */
import type {ClaimReport, Finding} from './types.ts';

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** What the PASS/FAIL line must never hide: whether private names were checked, and a translation's review status. */
export const statusTail = (r: ClaimReport): string => {
	const parts: string[] = [];
	if (r.namesList.skipped) parts.push('names NOT checked (--no-names)');
	else if (!r.namesList.path) parts.push('names NOT checked (no list)');
	else parts.push(`names: ${r.namesList.count} checked`);
	if (r.translation) parts.push(`translation ${r.translation.status}${r.translation.reviewed ? ', reviewed' : ''}${r.translation.badge ? ' (needs native review)' : ''}`);
	return parts.join(' · ');
};
const quote = (s: string): string => `“${s.replace(/\s+/g, ' ').trim()}”`;

const findingLines = (f: Finding, n: number): string[] => {
	const out = [`${n}. **${f.rule}** · \`${f.where}\` — ${f.message}`];
	if (f.text) out.push(`   - Sentence: ${quote(f.text)}`);
	out.push(`   - Fix: ${f.fix}`);
	return out;
};

export const renderMarkdown = (r: ClaimReport): string => {
	const errors = r.findings.filter((f) => f.level === 'error');
	const warnings = r.findings.filter((f) => f.level === 'warning');
	const L: string[] = [];
	L.push(`# Claim check: ${r.channel}/${r.slug} (${r.lang}) — ${r.pass ? 'PASS' : 'FAIL'}`);
	L.push('');
	L.push(`- Checked \`${r.file}\` at ${r.checkedAt}.`);
	L.push(`- ${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}; ${r.claims.length} cited claim${r.claims.length === 1 ? '' : 's'}, ${r.sources.length} source${r.sources.length === 1 ? '' : 's'}, ${r.waivers.length} waiver${r.waivers.length === 1 ? '' : 's'}.`);
	L.push(
		`- Must not say: ${r.mustNotSay.file ? `\`${r.mustNotSay.file}\`, ${r.mustNotSay.rules} rules → ${r.mustNotSay.patterns} patterns${r.mustNotSay.language ? ` (in ${r.mustNotSay.language}: listed below for a human read; ${r.mustNotSay.localRules ?? 0} "Must not say (${r.lang})" rules → ${r.mustNotSay.localPatterns ?? 0} patterns)` : ''}` : 'no research.md'}; global list: income and return claims (${r.lang}), wallet-like strings${r.namesList.path ? `, ${r.namesList.count} private names` : ''}.`,
	);
	L.push(`- Status: ${statusTail(r)}.`);
	for (const n of r.notes) L.push(`- Note: ${n}`);
	L.push('');
	L.push('Every failure names the scene, the sentence and a fix. Private names and wallet-like strings are never printed.');
	L.push('');
	L.push(`## Errors (${errors.length})`);
	L.push('');
	if (!errors.length) L.push('None.');
	errors.forEach((f, i) => L.push(...findingLines(f, i + 1)));
	L.push('');
	L.push(`## Warnings (${warnings.length})`);
	L.push('');
	if (!warnings.length) L.push('None.');
	warnings.forEach((f, i) => L.push(...findingLines(f, i + 1)));
	L.push('');
	L.push('## Claims and their sources');
	L.push('');
	if (!r.claims.length) L.push('No sentence cites a source.');
	else {
		L.push('| Scene | Sentence | Sources |');
		L.push('| --- | --- | --- |');
		for (const c of r.claims) L.push(`| ${c.scene} | ${cell(c.sentence)} | ${c.ids.map((x) => `\`${x}\``).join(', ')} |`);
	}
	L.push('');
	L.push('## Sources');
	L.push('');
	if (!r.sources.length) L.push('None.');
	else {
		L.push('| id | status | accessed | cited by | title | url |');
		L.push('| --- | --- | --- | --- | --- | --- |');
		for (const s of r.sources) L.push(`| \`${s.id}\` | ${s.status || '—'} | ${s.accessed || '—'} | ${s.citedBy.join(', ') || '—'} | ${cell(s.title) || '—'} | ${cell(s.url) || '—'} |`);
	}
	L.push('');
	L.push('## Waivers (for the owner\'s review)');
	L.push('');
	if (!r.waivers.length) L.push('None.');
	else {
		L.push('| Scene | Rule | Match | Reason | Used |');
		L.push('| --- | --- | --- | --- | --- |');
		for (const w of r.waivers) L.push(`| ${w.scene} | ${w.rule} | ${cell(w.match)} | ${cell(w.reason)} | ${w.used ? 'yes' : 'no'} |`);
	}
	L.push('');
	L.push('## Must-not-say rules the gate cannot fully check (read them against the script)');
	L.push('');
	if (!r.mustNotSay.manual.length) L.push(r.mustNotSay.file ? 'None: every rule became patterns.' : 'No research.md.');
	for (const m of r.mustNotSay.manual) L.push(`- \`${m.id}\` (line ${m.line}, ${m.coverage}): ${m.text}`);
	L.push('');
	return L.join('\n');
};

export const renderSummary = (r: ClaimReport, reportPath: string | null): string => {
	const L: string[] = [];
	L.push(`claims: ${r.channel}/${r.slug} (${r.lang}) ${r.pass ? 'PASS' : 'FAIL'}: ${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'} · ${statusTail(r)}`);
	for (const f of r.findings.filter((x) => x.level === 'error').slice(0, 40)) {
		L.push(`  ERROR ${f.rule} [${f.where}] ${f.message}`);
		if (f.text) L.push(`        ${quote(f.text)}`);
		L.push(`        fix: ${f.fix}`);
	}
	const more = r.errors - 40;
	if (more > 0) L.push(`  ... ${more} more error${more === 1 ? '' : 's'} in the report`);
	if (reportPath) L.push(`  report: ${reportPath}`);
	return L.join('\n');
};
