/**
 * prepare: the blind worksheet. It holds ONLY the Spanish or Portuguese strings (never the English), each with its
 * id, a context line and a hash of the exact text, so a back-translation can be matched to the text it was made
 * from. Written as JSON (for a Claude session or a script) and Markdown (for a person).
 */
import type {BackTranslation, Segment, TargetLang, Worksheet, WorksheetItem} from './types.ts';
import {LANG_NAMES} from './types.ts';

export const instructions = (lang: TargetLang): string[] => {
	const L = LANG_NAMES[lang];
	return [
		`Translate each ${L} text below into English, literally: one English sentence for each ${L} sentence, in the same order.`,
		`Work blind: do not read the English original (or any English version of these texts) before you finish. If you have seen it, say so when the back-translation is imported (--saw-source).`,
		'Keep every number, name, ticker, URL and [src:...] tag exactly as written and in the same place.',
		'Do not fix mistakes or improve the style. Do not add or drop words such as "allegedly", "according to", "may", "must", "will", "never", "not", "always". If the text says something odd, translate the odd thing.',
		'Use the everyday meaning a viewer would understand. When a word has two plausible readings, write both as "first/second" (for example "trade/operation"). Put any comment in [note: ...].',
		'Use only your own knowledge: a Claude session or a person. Never paste the text into a translation website, app or API.',
		'JSON: fill "bt" for every item and change nothing else. Markdown: write the English after "BT:" and change nothing else.',
	];
};

export type PrepareResult = {worksheet: Worksheet; total: number; current: number; missingTranslation: string[]};

/** Items needing a back-translation: every translated segment without a current one (or all with `all`). */
export const buildWorksheet = (meta: {channel: string; slug: string; lang: TargetLang; now: string}, segments: Segment[], record: BackTranslation | null, all: boolean): PrepareResult => {
	const items: WorksheetItem[] = [];
	let current = 0;
	const missingTranslation: string[] = [];
	let total = 0;
	for (const seg of segments) {
		if (seg.translationRaw === null || !(seg.translation ?? '').trim() || seg.hash === null) {
			if (seg.sourceRaw !== null) missingTranslation.push(seg.id);
			continue;
		}
		total++;
		const have = record?.segments[seg.id];
		const isCurrent = !!have && have.hash === seg.hash;
		if (isCurrent) current++;
		if (isCurrent && !all) continue;
		items.push({id: seg.id, hash: seg.hash, context: seg.context, text: seg.translation as string, bt: ''});
	}
	return {
		worksheet: {
			kind: 'backtranslation-worksheet',
			version: 1,
			channel: meta.channel,
			slug: meta.slug,
			lang: meta.lang,
			langName: LANG_NAMES[meta.lang],
			createdAt: meta.now,
			instructions: instructions(meta.lang),
			items,
		},
		total,
		current,
		missingTranslation,
	};
};

const MARK = (id: string, hash: string) => `<!-- id: ${id} · hash: ${hash} -->`;
export const MARK_RE = /^<!-- id: (\S+) · hash: ([0-9a-f]{16}) -->\s*$/;

export const renderWorksheetMarkdown = (ws: Worksheet): string => {
	const lines: string[] = [];
	lines.push(`# Back-translation worksheet: ${ws.channel}/${ws.slug} (${ws.langName} to English)`, '');
	lines.push(`${ws.items.length} text${ws.items.length === 1 ? '' : 's'} to back-translate. Made ${ws.createdAt}.`, '');
	lines.push('## Instructions', '');
	ws.instructions.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
	lines.push('', 'Import when done: `node scripts/backtranslate/cli.ts import <episode> --lang ' + ws.lang + ' --from <this file> --by claude-session|human --who <initials or role> --blind|--saw-source`', '');
	ws.items.forEach((it, i) => {
		lines.push('---', '', `### ${i + 1}. ${it.id}`, MARK(it.id, it.hash), `Context: ${it.context}`, '');
		for (const l of it.text.split('\n')) lines.push(`> ${l}`);
		lines.push('', `BT: ${it.bt}`.trimEnd(), '');
	});
	lines.push('---', '');
	return lines.join('\n');
};

/** Read a filled Markdown worksheet back: [{id, hash, bt}]. */
export const parseWorksheetMarkdown = (md: string): Array<{id: string; hash: string; bt: string}> => {
	const lines = md.replace(/\r\n?/g, '\n').split('\n');
	const out: Array<{id: string; hash: string; bt: string}> = [];
	let cur: {id: string; hash: string; bt: string[]; inBt: boolean} | null = null;
	const close = () => {
		if (cur) out.push({id: cur.id, hash: cur.hash, bt: cur.bt.join('\n').trim()});
		cur = null;
	};
	for (const line of lines) {
		const m = MARK_RE.exec(line);
		if (m) {
			close();
			cur = {id: m[1], hash: m[2], bt: [], inBt: false};
			continue;
		}
		if (!cur) continue;
		const c = cur as {id: string; hash: string; bt: string[]; inBt: boolean};
		if (/^---\s*$/.test(line) || /^#{1,3} /.test(line)) {
			if (c.inBt) close();
			continue;
		}
		const bt = /^BT:\s?(.*)$/.exec(line);
		if (bt) {
			c.inBt = true;
			if (bt[1].trim()) c.bt.push(bt[1].trim());
			continue;
		}
		if (c.inBt && !/^>/.test(line)) c.bt.push(line.trim());
	}
	close();
	return out.map((x) => ({...x, bt: x.bt.replace(/\n{2,}/g, '\n').trim()}));
};
