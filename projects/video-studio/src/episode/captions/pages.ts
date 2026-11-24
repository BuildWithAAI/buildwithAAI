/**
 * Caption pages from the timeline's words (pure). 2-4 words per page (unspaced languages: up to 10 characters), a new
 * page at phrase ends and pauses, so a page never straddles a sentence. Single-word pages are merged into a
 * neighbour when that keeps the limits. Each page shows from its first word (minus a 2-frame lead) until the next page
 * starts, or 700 ms after its last word.
 */
import type {TimelineWord} from '../types.ts';
import {UNSPACED} from '../markup.ts';

export type CaptionWord = {text: string; startMs: number; endMs: number};
export type CaptionPage = {startMs: number; endMs: number; words: CaptionWord[]; text: string};

export type PageOpts = {lang: string; maxWords?: number; minWords?: number; maxChars?: number; breakGapMs?: number; leadMs?: number; holdMs?: number};

const ENDS = /[.!?…。！？]$/;
const CLAUSE = /[,;:，、；：]$/;

export const joiner = (lang: string): string => (UNSPACED.has(lang) ? '' : ' ');

export const buildPages = (words: TimelineWord[], o: PageOpts): CaptionPage[] => {
	const unspaced = UNSPACED.has(o.lang);
	const maxWords = o.maxWords ?? (unspaced ? 8 : 4);
	const minWords = o.minWords ?? 2;
	const maxChars = o.maxChars ?? (unspaced ? 10 : 24);
	const gapMs = o.breakGapMs ?? 300;
	const j = joiner(o.lang);
	const len = (ws: CaptionWord[]) => ws.map((w) => w.text).join(j).length;
	const groups: CaptionWord[][] = [];
	let cur: CaptionWord[] = [];
	words.forEach((w, i) => {
		const word = {text: w.text, startMs: w.startMs, endMs: w.endMs};
		const prev = words[i - 1];
		const breakBefore =
			cur.length > 0 &&
			(cur.length >= maxWords ||
				len([...cur, word]) > maxChars ||
				(prev && ENDS.test(prev.text)) ||
				(prev && CLAUSE.test(prev.text) && cur.length >= minWords) ||
				(prev && w.startMs - prev.endMs >= gapMs && cur.length >= minWords));
		if (breakBefore) {
			groups.push(cur);
			cur = [];
		}
		cur.push(word);
	});
	if (cur.length) groups.push(cur);
	// merge lone words into the next (or previous) page when the limits allow and no sentence boundary is crossed
	for (let k = 0; k < groups.length; k++) {
		if (groups[k].length !== 1 || unspaced) continue;
		const g = groups[k];
		const next = groups[k + 1];
		const prev = groups[k - 1];
		const lastOfPrev = prev ? prev[prev.length - 1] : null;
		if (next && !ENDS.test(g[0].text) && next.length < maxWords && len([...g, ...next]) <= maxChars && next[0].startMs - g[0].endMs < gapMs) {
			groups[k + 1] = [...g, ...next];
			groups.splice(k, 1);
			k--;
		} else if (prev && lastOfPrev && !ENDS.test(lastOfPrev.text) && prev.length < maxWords && len([...prev, ...g]) <= maxChars && g[0].startMs - lastOfPrev.endMs < gapMs) {
			groups[k - 1] = [...prev, ...g];
			groups.splice(k, 1);
			k -= 2;
		}
	}
	const lead = o.leadMs ?? 67;
	const hold = o.holdMs ?? 700;
	return groups.map((ws, k) => {
		const next = groups[k + 1];
		const start = Math.max(0, ws[0].startMs - lead);
		const end = Math.min(next ? Math.max(next[0].startMs - lead, start + 1) : Infinity, ws[ws.length - 1].endMs + hold);
		return {startMs: start, endMs: end, words: ws, text: ws.map((w) => w.text).join(j)};
	});
};
