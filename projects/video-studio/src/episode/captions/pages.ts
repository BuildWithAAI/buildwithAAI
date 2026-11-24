/**
 * Caption pages from the timeline's words (pure). 2-4 words per page (unspaced languages: up to 10 characters), never
 * across a sentence. Within a sentence the page breaks are CHOSEN, not filled greedily (fixed 2026-11-24, review:
 * "Most new memecoins on / Pump.fun never see day / two."): the cheapest split by a small cost model that
 *  - avoids one-word pages (a lone last word joins its neighbours whenever the limits allow),
 *  - avoids ending a page on a word that leans on the next one ("on", "the", "de", "never"; text/phrasing.ts) or
 *    starting one with a word that leans on the previous one (Hindi postpositions),
 *  - prefers breaking at pauses (>= breakGapMs) and after commas, and avoids very short pages.
 * Each page shows from its first word (minus a 2-frame lead) until the next page starts, or 700 ms after its last word;
 * captionTrack (Captions.tsx) also clips it to the end of its scene.
 */
import type {TimelineWord} from '../types.ts';
import type {Box} from '../layout/specs.ts';
import {joinTokens, UNSPACED} from '../markup.ts';
import {closesPhrase, leansNext, leansPrev} from '../text/phrasing.ts';

export type CaptionWord = {text: string; startMs: number; endMs: number};
export type CaptionPage = {startMs: number; endMs: number; words: CaptionWord[]; text: string};

export type PageOpts = {lang: string; maxWords?: number; minWords?: number; maxChars?: number; breakGapMs?: number; leadMs?: number; holdMs?: number};

const ENDS = /[.!?…。！？।॥]$/;
const CLAUSE = /[,;:，、；：]$/;

/** Page costs (relative; only their order matters). */
export const PAGE_COST = {page: 10, lone: 40, leanEnd: 30, leanStart: 30, pauseInside: 35, clauseInside: 8, breakMidPhrase: 4} as const;

export const buildPages = (words: TimelineWord[], o: PageOpts): CaptionPage[] => {
	const lang = o.lang;
	const unspaced = UNSPACED.has(lang);
	const maxWords = o.maxWords ?? (unspaced ? 8 : 4);
	const maxChars = o.maxChars ?? (unspaced ? 10 : 24);
	const gapMs = o.breakGapMs ?? 300;
	const shortChars = Math.round(maxChars * 0.42); // pages shorter than this read as a flash
	const len = (ws: CaptionWord[]) => joinTokens(ws.map((w) => w.text), lang).length;

	// 1. sentences: a page never straddles one
	const runs: CaptionWord[][] = [];
	let cur: CaptionWord[] = [];
	words.forEach((w, i) => {
		const prev = words[i - 1];
		if (cur.length && prev && ENDS.test(prev.text)) {
			runs.push(cur);
			cur = [];
		}
		cur.push({text: w.text, startMs: w.startMs, endMs: w.endMs});
	});
	if (cur.length) runs.push(cur);

	// 2. each sentence: the cheapest split into pages (dynamic programming over the break positions)
	const pageCost = (run: CaptionWord[], i: number, j: number, chars: number): number => {
		let c = PAGE_COST.page;
		if (j - i === 1 && run.length > 1) c += PAGE_COST.lone;
		if (run.length > 1 && chars < shortChars) c += shortChars - chars;
		const last = run[j - 1].text;
		if (j < run.length) {
			if (leansNext(last, lang)) c += PAGE_COST.leanEnd;
			if (!closesPhrase(last) && run[j].startMs - run[j - 1].endMs < gapMs) c += PAGE_COST.breakMidPhrase;
		}
		if (i > 0 && leansPrev(run[i].text, lang)) c += PAGE_COST.leanStart;
		for (let k = i; k < j - 1; k++) {
			if (run[k + 1].startMs - run[k].endMs >= gapMs) c += PAGE_COST.pauseInside;
			if (CLAUSE.test(run[k].text)) c += PAGE_COST.clauseInside;
		}
		return c;
	};
	const split = (run: CaptionWord[]): CaptionWord[][] => {
		const n = run.length;
		const best = Array<number>(n + 1).fill(Infinity);
		const back = Array<number>(n + 1).fill(-1);
		best[0] = 0;
		for (let j = 1; j <= n; j++) {
			for (let i = Math.max(0, j - maxWords); i < j; i++) {
				if (best[i] === Infinity) continue;
				const chars = len(run.slice(i, j));
				if (j - i > 1 && chars > maxChars) continue; // a single over-long word is allowed: it cannot be split
				const c = best[i] + pageCost(run, i, j, chars);
				if (c < best[j]) {
					best[j] = c;
					back[j] = i;
				}
			}
		}
		const out: CaptionWord[][] = [];
		for (let j = n; j > 0; j = back[j]) out.unshift(run.slice(back[j], j));
		return out;
	};
	const groups = runs.flatMap(split);

	const lead = o.leadMs ?? 67;
	const hold = o.holdMs ?? 700;
	return groups.map((ws, k) => {
		const next = groups[k + 1];
		const start = Math.max(0, ws[0].startMs - lead);
		const end = Math.min(next ? Math.max(next[0].startMs - lead, start + 1) : Infinity, ws[ws.length - 1].endMs + hold);
		return {startMs: start, endMs: end, words: ws, text: joinTokens(ws.map((w) => w.text), lang)};
	});
};

/** One caption track = the pages of each scene, offset to composition ms, with the faces of that scene's shot. */
export type TrackPage = CaptionPage & {faces: Box[]};
export type CaptionTrack = TrackPage[];

/**
 * Build the caption track for a list of scenes placed at composition frames. `toMs` (the end of the scene's span): every
 * page is clipped to it, so a scene's last caption cuts with its shot instead of running over the next one (fixed
 * 2026-11-24, review: "and a slow bleed." stayed over the next Short scene for 3 frames).
 */
export const captionTrack = (
	scenes: Array<{fromMs: number; toMs?: number; words: Array<{text: string; startMs: number; endMs: number}>; faces: Box[]}>,
	lang: string,
): CaptionTrack =>
	scenes.flatMap((s) =>
		buildPages(s.words, {lang})
			.map((p) => ({
				...p,
				faces: s.faces,
				startMs: p.startMs + s.fromMs,
				endMs: Math.min(p.endMs + s.fromMs, s.toMs ?? Infinity),
				words: p.words.map((w) => ({...w, startMs: w.startMs + s.fromMs, endMs: w.endMs + s.fromMs})),
			}))
			.filter((p) => p.endMs > p.startMs),
	);
