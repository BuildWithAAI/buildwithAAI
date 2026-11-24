/**
 * Word cues (pure): when on-screen items (bullets, steps, quote words, chart beats) appear, from the timeline's word
 * timings. Items and narration are in the same language, so matching works for every language. When a cue cannot be
 * found, items are spread evenly over the voiced part, so a missing cue never blocks a render.
 */
import type {TimelineWord} from './types.ts';
import {UNSPACED} from './markup.ts';

/** Lowercase, no diacritics, letters and digits only (any script). */
export const normWord = (s: string): string =>
	s
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '');

const matches = (word: string, cue: string, unspaced: boolean): boolean => {
	const w = normWord(word);
	const c = normWord(cue);
	if (!w || !c) return false;
	if (unspaced) return w.includes(c) || c.startsWith(w) || c.includes(w);
	if (w === c) return true;
	// stems: "explains" ~ "explain", "liquidez" ~ "liquidity" does NOT match (different language), on purpose
	return c.length >= 4 && w.length >= 4 && (w.startsWith(c) || c.startsWith(w)) && Math.abs(w.length - c.length) <= 3;
};

/** Start (ms) of the first word at or after fromMs that matches the cue, or null. */
export const findCueMs = (words: TimelineWord[], cue: string, fromMs: number, lang: string): number | null => {
	const unspaced = UNSPACED.has(lang);
	for (const w of words) if (w.startMs >= fromMs && matches(w.text, cue, unspaced)) return w.startMs;
	if (unspaced) {
		// a cue can span several short runs: match against the running concatenation
		const c = normWord(cue);
		for (let i = 0; i < words.length; i++) {
			if (words[i].startMs < fromMs) continue;
			let acc = '';
			for (let j = i; j < words.length && acc.length < c.length + 4; j++) {
				acc += normWord(words[j].text);
				if (acc.startsWith(c)) return words[i].startMs;
			}
		}
	}
	return null;
};

/** The default cue of an item: its first word of 4+ letters (or the first 2 characters in an unspaced language). */
export const defaultCue = (item: string, lang: string): string => {
	if (UNSPACED.has(lang)) return normWord(item).slice(0, 2);
	const ws = item.split(/\s+/).map(normWord).filter(Boolean);
	return ws.find((w) => w.length >= 4) ?? ws[0] ?? '';
};

export type RevealOpts = {
	lang: string;
	speechMs: number; // the voiced part of the scene
	firstMinMs?: number; // nothing appears before this (default 300 ms)
	minGapMs?: number; // items at least this far apart (default 500 ms)
	leadMs?: number; // appear this much before the cue word (default 100 ms: text lands with the word)
};

/**
 * Reveal time (scene ms) per item. Explicit cues (onScreen.cues[i]) win; otherwise the item's default cue; unmatched
 * items are spread evenly between their matched neighbours. Times are increasing and at least minGapMs apart.
 */
export const revealTimes = (items: string[], words: TimelineWord[], cues: string[] | undefined, o: RevealOpts): number[] => {
	const n = items.length;
	if (!n) return [];
	const first = o.firstMinMs ?? 300;
	const gap = o.minGapMs ?? 500;
	const lead = o.leadMs ?? 100;
	const end = Math.max(first + gap * n, o.speechMs * 0.9);
	const found: Array<number | null> = [];
	let from = 0;
	for (let i = 0; i < n; i++) {
		const cue = cues?.[i] ?? defaultCue(items[i], o.lang);
		const ms = cue ? findCueMs(words, cue, from, o.lang) : null;
		found.push(ms === null ? null : Math.max(first, ms - lead));
		if (ms !== null) from = ms + 1;
	}
	// fill unmatched items linearly between their matched neighbours; the voiced part's start and end are the outer anchors
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const v = found[i];
		if (v !== null) {
			out.push(v);
			continue;
		}
		let a = i - 1;
		while (a >= 0 && found[a] === null) a--;
		let b = i + 1;
		while (b < n && found[b] === null) b++;
		if (a < 0) {
			// before the first match (or no match at all): from `first` towards the next anchor
			const tb = b < n ? (found[b] as number) : end;
			out.push(first + ((tb - first) * i) / (b < n ? b : n));
		} else {
			const ta = found[a] as number;
			const tb = b < n ? (found[b] as number) : end;
			out.push(ta + ((tb - ta) * (i - a)) / ((b < n ? b : n) - a));
		}
	}
	for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
	return out.map((x) => Math.round(x));
};

/**
 * Map a character offset in the scene's display text to the index of the timeline word that ends there (the claim a
 * source tag backs). Words are matched in order against the display text.
 */
export const wordIndexAtOffset = (words: TimelineWord[], display: string, offset: number): number => {
	let pos = 0;
	let last = words.length ? 0 : -1;
	for (let i = 0; i < words.length; i++) {
		const at = display.indexOf(words[i].text, pos);
		if (at < 0) continue; // a word the display text does not contain verbatim: skip it
		if (at >= offset) break;
		last = i;
		pos = at + words[i].text.length;
	}
	return last;
};
