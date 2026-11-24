/**
 * The report: segments ranked by risk, the evidence side by side, and the rubric for the native reviewer.
 * Markdown for people, JSON for tools.
 */
import {LANG_NAMES, SEVERITY_ORDER, type BackMethod, type Report, type SegmentResult, type Severity, type TargetLang} from './types.ts';

const KIND_ORDER = ['narration', 'news', 'onScreen', 'title', 'shortTitle', 'thumbnail', 'copy', 'ui', 'showUi'];

export const rankResults = (results: SegmentResult[]): SegmentResult[] =>
	[...results].sort((a, b) => b.risk - a.risk || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.order - b.order);

const worst = (r: SegmentResult): Severity | null => {
	for (const s of SEVERITY_ORDER) if (r.findings.some((f) => f.severity === s)) return s;
	return null;
};

export const buildReport = (args: {channel: string; slug: string; lang: TargetLang; generatedAt: string; results: SegmentResult[]; notes: string[]; translationStatus: string; glossaryFiles: string[]}): Report => {
	const {results} = args;
	const counts = {high: 0, medium: 0, low: 0, info: 0, segments: results.length, checked: 0, flagged: 0, clean: 0, unchecked: 0};
	const people = new Map<string, {method: BackMethod; by: string; blind: boolean; segments: number}>();
	for (const r of results) {
		for (const f of r.findings) counts[f.severity]++;
		if (r.status === 'checked') counts.checked++;
		if (r.status === 'no-back-translation' || r.status === 'stale-back-translation') counts.unchecked++;
		const flagged = r.findings.some((f) => f.severity !== 'info');
		if (flagged) counts.flagged++;
		else if (r.status === 'checked') counts.clean++;
		if (r.back_meta) {
			const key = `${r.back_meta.method}|${r.back_meta.by}|${r.back_meta.blind}`;
			const p = people.get(key) ?? {method: r.back_meta.method, by: r.back_meta.by, blind: r.back_meta.blind, segments: 0};
			p.segments++;
			people.set(key, p);
		}
	}
	const verdict: Report['verdict'] = counts.unchecked > 0 ? 'INCOMPLETE' : counts.high > 0 ? 'FIX' : counts.medium > 0 ? 'REVIEW' : 'CLEAR';
	return {
		kind: 'backtranslation-report',
		version: 1,
		channel: args.channel,
		slug: args.slug,
		lang: args.lang,
		langName: LANG_NAMES[args.lang],
		generatedAt: args.generatedAt,
		verdict,
		counts,
		translationStatus: args.translationStatus,
		backTranslators: [...people.values()],
		glossary: args.glossaryFiles,
		segments: rankResults(results),
		notes: args.notes,
	};
};

const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const SEV_LABEL: Record<Severity, string> = {high: 'HIGH', medium: 'MEDIUM', low: 'low', info: 'info'};

export const RUBRIC = (lang: TargetLang): string[] => {
	const L = LANG_NAMES[lang];
	const region = lang === 'es' ? 'neutral Latin American Spanish with "tú", as in the current drafts (or the audience the owner picks)' : 'Brazilian Portuguese with "você"';
	return [
		`Read each flagged ${L} text aloud next to its English source. Score six criteria: **2** = right, **1** = small fix (write it), **0** = wrong.`,
		'',
		'| Criterion | 2 = right | 0 = wrong |',
		'| --- | --- | --- |',
		`| **Meaning** | Same facts as the English: who did what, numbers, units, dates, names. | Any fact, number, unit or name differs. |`,
		`| **Certainty** | Attribution and hedges kept (${lang === 'es' ? '"según X", "de acuerdo con", "presuntamente", "en desarrollo", "podría"' : '"segundo X", "de acordo com", "supostamente", "em desenvolvimento", "pode"'}). | A claim sounds more certain than the English, or no longer says who reported it. |`,
		`| **Warnings** | Negations and absolutes kept (${lang === 'es' ? '"no", "nunca", "jamás"' : '"não", "nunca", "jamais"'}); instructions stay instructions (imperative), not options. | A warning is inverted or softened ("never" became "avoid", "check" became "you could check"). |`,
		`| **Terms and names** | Glossary renderings; Zoo, Badger and Zoora AI untranslated; tickers, URLs and [src] tags exact; segment names as in every other episode. | A name is translated, a ticker changed, or a term means something else. |`,
		`| **Natural and regional** | Reads as a native adult would say it: ${region}; digits and currency in the audience's style (US$, 1.500,5 or 1,500.5). | Literal calques, the wrong region, a childish or stiff register, misread digits. |`,
		`| **Fit and voice** | On-screen text fits its box; numbers the voice reads are spelled out in {display|spoken}; sentence breaks suit captions. | Text overflows, or the voice would read a number wrongly. |`,
		'',
		'**Decision per segment:** OK (all 2) · Fix (any 1: write the fix) · Retranslate (any 0). A 0 on Meaning, Certainty or Warnings blocks publication until fixed.',
		'',
		`Then the owner records the review in \`storyboard.${lang}.json\`: \`"translation": {"status": "native-reviewed", "reviewed": true, "reviewer": "<initials or role>", "date": "YYYY-MM-DD", ...}\` (never a full name: the repository is public). Until then every render carries the MACHINE TRANSLATION badge.`,
	];
};

const LIMITS = [
	'Deterministic and offline: the same files give the same report. No translation API is called; the back-translation comes from a Claude session or a person.',
	'It catches changed or missing numbers, units and qualifiers ("more than", "about"), negations and softened "never", modality shifts (may / must / will / should; instructions turned into options), lost hedges and attribution ("allegedly", "according to", "says"), dropped or added names, glossary breaks, moved or missing [src:id] tags, caption/voice number mismatches, omitted or added sentences, and low word overlap.',
	'It cannot judge tone, idiom, register, humour, regional naturalness or on-screen fit by eye: that is the native review. A back-translator who silently "fixes" an error hides it; the direct checks on the translation (numbers, negation words, hedge words, names, tags) are there to catch some of those.',
	'Not-blind back-translations (the back-translator saw the English) are marked: they tend to agree with the English more than the translation deserves.',
	'The Spanish and Portuguese word lists (negation, hedges, number words) are machine-made and need a native speaker\'s review like every translation asset.',
];

export const renderMarkdown = (r: Report): string => {
	const L = r.langName;
	const out: string[] = [];
	const c = r.counts;
	out.push(`# Back-translation check: ${r.channel}/${r.slug} · ${L} (${r.lang})`, '');
	const verdictText = {
		FIX: 'high-risk meaning differences found: fix them (or confirm them with the native reviewer) before anything is voiced or published.',
		REVIEW: 'no high-risk difference, but the medium findings below need the native reviewer\'s decision.',
		CLEAR: 'no high or medium finding. The native review still decides; start with the low findings.',
		INCOMPLETE: `${c.unchecked} segment(s) have no back-translation of the current text, so the check is incomplete.`,
	}[r.verdict];
	out.push(`**Verdict: ${r.verdict}**: ${verdictText}`, '');
	out.push(`- ${c.segments} segments: ${c.checked} checked, ${c.flagged} flagged, ${c.clean} clean, ${c.unchecked} not checked yet.`);
	out.push(`- Findings: ${c.high} high, ${c.medium} medium, ${c.low} low${c.info ? `, ${c.info} info` : ''}.`);
	if (r.backTranslators.length)
		for (const p of r.backTranslators) out.push(`- Back-translation: ${p.method} (${p.by}), ${p.segments} segments, ${p.blind ? 'blind (did not read the English)' : '**not blind: the back-translator saw the English, so agreement may be overstated**'}.`);
	else out.push('- Back-translation: none imported yet.');
	out.push(`- Translation record in storyboard.${r.lang}.json: ${r.translationStatus}.`);
	out.push(`- Generated ${r.generatedAt}. Glossary: ${r.glossary.map((g) => g.replace(/^.*\/(scripts\/backtranslate\/)/, '$1')).join(', ')}.`, '');
	for (const n of r.notes) out.push(`> ${n}`, '');

	const flagged = r.segments.filter((s) => s.findings.some((f) => f.severity !== 'info'));
	const unchecked = r.segments.filter((s) => s.status === 'no-back-translation' || s.status === 'stale-back-translation');
	const clean = r.segments.filter((s) => s.status === 'checked' && !s.findings.some((f) => f.severity !== 'info'));

	if (flagged.length) {
		out.push('## Segments to review, highest risk first', '');
		out.push('| # | Segment | Risk | Similarity | Worst finding |', '| --- | --- | --- | --- | --- |');
		flagged.forEach((s, i) => {
			const w = worst(s);
			const f = s.findings.find((x) => x.severity === w);
			out.push(`| ${i + 1} | \`${s.id}\` | ${s.risk} | ${s.similarity ?? '-'} | ${w ? `${SEV_LABEL[w]} ${f?.code}` : '-'} |`);
		});
		out.push('');
		flagged.forEach((s, i) => {
			out.push(`### ${i + 1}. \`${s.id}\` · risk ${s.risk}${s.similarity !== null ? ` · similarity ${s.similarity}` : ''}`, '');
			out.push(`${s.context}${s.status !== 'checked' ? ` · **${s.status.replace(/-/g, ' ')}**` : ''}`, '');
			out.push('| | Text |', '| --- | --- |');
			out.push(`| English | ${esc(s.source ?? '(none)')} |`);
			out.push(`| ${L} | ${esc(s.translation ?? '(none)')} |`);
			out.push(`| Back-translation | ${esc(s.back ?? '(none yet)')} |`, '');
			for (const f of [...s.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))) out.push(`- **${SEV_LABEL[f.severity]}** \`${f.code}\`: ${f.message}`);
			if (s.sentenceCounts) out.push(`- Sentences: English ${s.sentenceCounts.source}, ${L} ${s.sentenceCounts.translation}, back-translation ${s.sentenceCounts.back}.`);
			out.push('', 'Native reviewer: [ ] Meaning [ ] Certainty [ ] Warnings [ ] Terms [ ] Natural [ ] Fit · Decision: OK / Fix / Retranslate · Fix: ________', '');
		});
	}
	if (unchecked.length) {
		out.push('## Not checked yet', '', `These have no back-translation made from the current ${L} text (run prepare, back-translate the worksheet, import):`, '');
		for (const s of unchecked) out.push(`- \`${s.id}\` (${s.status === 'stale-back-translation' ? 'the translation changed after it was back-translated' : 'never back-translated'})`);
		out.push('');
	}
	if (clean.length) {
		out.push('## Clean segments', '', 'No finding. Still part of the native review, but lower priority. "Not back" lists English content words the back-translation does not have: in a long line one changed term can hide in a high score.', '');
		out.push(`| Segment | Similarity | ${L} | Back-translation | Not back |`, '| --- | --- | --- | --- | --- |');
		for (const s of [...clean].sort((a, b) => a.order - b.order)) out.push(`| \`${s.id}\` | ${s.similarity ?? '-'} | ${esc(s.translation ?? '')} | ${esc(s.back ?? '')} | ${esc(s.lostWords.join(', '))} |`);
		out.push('');
	}
	out.push('## Rubric for the native reviewer', '', ...RUBRIC(r.lang), '');
	out.push('## How this check works, and what it cannot see', '');
	for (const l of LIMITS) out.push(`- ${l}`);
	out.push('');
	return out.join('\n');
};

export const renderSummary = (r: Report, reportPath: string): string => {
	const c = r.counts;
	const lines = [`backtranslate: ${r.channel}/${r.slug} (${r.lang}) ${r.verdict}: ${c.high} high, ${c.medium} medium, ${c.low} low; ${c.checked}/${c.segments} checked, ${c.unchecked} not checked · ${reportPath}`];
	const top = r.segments.filter((s) => s.findings.some((f) => f.severity === 'high' || f.severity === 'medium')).slice(0, 8);
	for (const s of top) {
		const f = [...s.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))[0];
		lines.push(`  ${String(s.risk).padStart(3)}  ${s.id.padEnd(28)} ${SEV_LABEL[f.severity].padEnd(6)} ${f.code}: ${f.message.length > 110 ? `${f.message.slice(0, 109)}…` : f.message}`);
	}
	return lines.join('\n');
};
