/**
 * Narration sentences with their source tags (pure). The markup grammar is the voice step's (src/episode/markup.ts,
 * a port of scripts/voice/voicelib/markup.py): {display|spoken} and [src:id] / [src:a,b].
 *
 * A [src:id] backs "the preceding claim", so a tag belongs to the sentence it closes: "Claim [src:a]." and
 * "Claim. [src:a]" both cite `a` for "Claim". Sentence boundaries are never looked for inside {...} or [src:...].
 */
import type {Lang} from '../../../src/episode/types.ts';
import {displayText, parseMarkup, sourceIds, spokenText} from '../../../src/episode/markup.ts';
import {UNSPACED} from './text.ts';

export type Sentence = {
	/** 0-based index in the scene. */
	index: number;
	/** The sentence as written in the storyboard, markup and tags included (what the author searches for). */
	raw: string;
	/** Caption / on-screen text: display sides, tags removed. */
	display: string;
	/** What Kokoro says: spoken sides, tags removed. */
	spoken: string;
	/** Source ids cited by this sentence, in order. */
	ids: string[];
};

/** Abbreviations that end with a period but do not end a sentence. */
const ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'etc', 'inc', 'ltd', 'corp', 'co', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'e.g', 'i.e', 'u.s', 'u.k', 'a.m', 'p.m', 'approx', 'fig', 'sr', 'jr', 'sra', 'dra', 'núm', 'pág', 'ecc', 'sig']);

const TERMINAL = '.!?…';
const CJK_TERMINAL = '。！？';
const DANDA = '।॥';
const CLOSERS = '"\'”’»)]」』）';

/** Throws MarkupError for malformed narration (the same check the voice step and the renderer run). */
export const assertMarkup = (narration: string): void => {
	parseMarkup(narration);
};

const isBoundary = (s: string, i: number, j: number, lang: Lang): boolean => {
	const c = s[i];
	if (DANDA.includes(c)) return true;
	if (CJK_TERMINAL.includes(c)) return true;
	if (UNSPACED.has(lang) && c !== '.') return true;
	// spaced: needs whitespace (or the end) after the terminator run
	if (j < s.length && !/\s/.test(s[j])) return false;
	let k = j;
	while (k < s.length && /\s/.test(s[k])) k++;
	if (k >= s.length) return true;
	const next = s[k];
	if (/\p{Ll}/u.test(next)) return false; // "U.S. regulators", "approx. ten"
	if (c === '.') {
		// the word before the period: an abbreviation or a single letter (an initial) does not end a sentence
		const before = s.slice(0, i);
		const m = /([\p{L}.]+)$/u.exec(before);
		if (m) {
			const word = m[1].toLowerCase().replace(/\.$/, '');
			if (ABBREV.has(word) || /^\p{L}$/u.test(word)) return false;
		}
	}
	return true;
};

/** Split a scene's narration into sentences, each with the [src:id] tags that back it. */
export const splitSentences = (narration: string, lang: Lang): Sentence[] => {
	assertMarkup(narration);
	const s = narration;
	const cuts: number[] = []; // exclusive end offsets of sentences (in raw)
	let depthBrace = false;
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (depthBrace) {
			if (c === '}') depthBrace = false;
			i++;
			continue;
		}
		if (c === '{') {
			depthBrace = true;
			i++;
			continue;
		}
		if (c === '[' && s.startsWith('[src:', i)) {
			const close = s.indexOf(']', i);
			i = close < 0 ? s.length : close + 1;
			continue;
		}
		if (TERMINAL.includes(c) || CJK_TERMINAL.includes(c) || DANDA.includes(c)) {
			let j = i + 1;
			while (j < s.length && (TERMINAL.includes(s[j]) || CJK_TERMINAL.includes(s[j]) || DANDA.includes(s[j]) || CLOSERS.includes(s[j]))) j++;
			if (isBoundary(s, i, j, lang)) {
				// tags right after the terminator still belong to this sentence ("Claim. [src:a]")
				let k = j;
				for (;;) {
					let p = k;
					while (p < s.length && /\s/.test(s[p])) p++;
					if (s.startsWith('[src:', p)) {
						const close = s.indexOf(']', p);
						k = close < 0 ? s.length : close + 1;
						continue;
					}
					break;
				}
				cuts.push(k);
				i = k;
				continue;
			}
			i = j;
			continue;
		}
		i++;
	}
	if (!cuts.length || cuts[cuts.length - 1] < s.length) cuts.push(s.length);
	const out: Sentence[] = [];
	let start = 0;
	for (const end of cuts) {
		const raw = s.slice(start, end).trim();
		start = end;
		if (!raw) continue;
		const display = displayText(raw);
		const spoken = spokenText(raw);
		const ids = sourceIds(raw);
		if (!display && !spoken && !ids.length) continue;
		if (!display && !spoken && ids.length && out.length) {
			// a narration that is only a tag after the last sentence: attach it to that sentence
			const last = out[out.length - 1];
			last.ids.push(...ids);
			last.raw = `${last.raw} ${raw}`;
			continue;
		}
		out.push({index: out.length, raw, display, spoken, ids});
	}
	return out;
};
