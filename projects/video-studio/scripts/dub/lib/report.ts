/** Dub validation report (pure): Markdown with a side-by-side review table for the native speaker, and a summary. */
import type {DubFinding, DubReport} from './validate.ts';

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

const lines = (f: DubFinding, n: number): string[] => {
	const out = [`${n}. **${f.rule}** · \`${f.where}\` — ${f.message}`];
	if (f.source) out.push(`   - Source: “${f.source}”`);
	if (f.target) out.push(`   - Translation: “${f.target}”`);
	out.push(`   - Fix: ${f.fix}`);
	return out;
};

export const renderDubMarkdown = (r: DubReport): string => {
	const errors = r.findings.filter((f) => f.level === 'error');
	const warnings = r.findings.filter((f) => f.level === 'warning');
	const L: string[] = [];
	L.push(`# Dub check: ${r.channel}/${r.slug} ${r.sourceLang} → ${r.lang} — ${r.pass ? 'PASS' : 'FAIL'}`);
	L.push('');
	L.push(`- Source \`${r.sourceFile}\`, translation \`${r.targetFile}\`, checked ${r.checkedAt}.`);
	L.push(`- Translation record: status **${r.translation.status}**, method ${r.translation.method ?? 'unknown'}, reviewed ${r.translation.reviewed ? 'yes' : 'no'}.${r.translation.badge ? ' Renders show **MACHINE TRANSLATION · needs native review**.' : ''}`);
	L.push(`- ${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}.`);
	for (const n of r.notes) L.push(`- Note: ${n}`);
	L.push('');
	L.push(`## Errors (${errors.length})`);
	L.push('');
	if (!errors.length) L.push('None.');
	errors.forEach((f, i) => L.push(...lines(f, i + 1)));
	L.push('');
	L.push(`## Warnings (${warnings.length})`);
	L.push('');
	if (!warnings.length) L.push('None.');
	warnings.forEach((f, i) => L.push(...lines(f, i + 1)));
	L.push('');
	L.push('## Native review sheet');
	L.push('');
	L.push('Read every line aloud. Check meaning, tone (dry, deadpan, adult), names kept, numbers kept, nothing added, and that it sounds natural when spoken.');
	L.push('');
	L.push('| Key | Source | Translation | Flags |');
	L.push('| --- | --- | --- | --- |');
	for (const row of r.rows) L.push(`| \`${row.key}\` | ${cell(row.source)} | ${cell(row.target) || '—'} | ${row.flags.join('; ') || ''} |`);
	L.push('');
	return L.join('\n');
};

export const renderDubSummary = (r: DubReport, reportPath: string | null): string => {
	const L = [`dub: ${r.channel}/${r.slug} ${r.sourceLang} -> ${r.lang} ${r.pass ? 'PASS' : 'FAIL'}: ${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'} · translation ${r.translation.status}${r.translation.badge ? ' (needs native review)' : ''}`];
	for (const f of r.findings.filter((x) => x.level === 'error').slice(0, 40)) {
		L.push(`  ERROR ${f.rule} [${f.where}] ${f.message}`);
		if (f.target) L.push(`        “${f.target}”`);
		L.push(`        fix: ${f.fix}`);
	}
	if (r.errors > 40) L.push(`  ... ${r.errors - 40} more in the report`);
	if (reportPath) L.push(`  report: ${reportPath}`);
	return L.join('\n');
};
