/**
 * Text helpers (pure): normalization, sentence splitting, English contractions, tokens, stopwords, a language guess.
 * Matching never runs on raw text: clean() first (NFKC, zero-width characters removed, curly quotes straightened,
 * no-break spaces made plain), so a typographic variant cannot slip past a pattern.
 */

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;

export const clean = (s: string): string =>
	s
		.normalize('NFKC')
		.replace(ZERO_WIDTH, '')
		.replace(/[‘’‚‛′]/g, "'")
		.replace(/[“”„‟″«»]/g, '"')
		.replace(/[‐‑‒–—―−]/g, '-')
		.replace(/[     ]/g, ' ')
		.replace(/…/g, '...');

export const stripAccents = (s: string): string => s.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');

/** Lowercase, accent-free, whitespace-collapsed: for loose "does this text contain that phrase" checks. */
export const fold = (s: string): string => stripAccents(clean(s)).toLowerCase().replace(/\s+/g, ' ').trim();

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Letters, marks and digits: the inside of a word. */
const W = '\\p{L}\\p{M}\\p{N}_';
/** A regex for `src` between word boundaries (any script). */
export const wordRe = (src: string, flags = 'giu'): RegExp => new RegExp(`(?<![${W}])(?:${src})(?![${W}])`, flags);

export const SRC_TAG = /\[src:\s*[^\]]*\]/g;
/** Back-translator notes such as "[note: could also mean ...]" or "[?]": shown to the reviewer, never compared. */
export const NOTE = /\[(?!src:)[^\]]*\]/g;

export const stripTags = (s: string): string => s.replace(SRC_TAG, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
export const stripNotes = (s: string): string => s.replace(NOTE, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();

// ---------------------------------------------------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------------------------------------------------

/** Abbreviations whose final period does not end a sentence (lowercased, without the final period). */
const ABBREV = new Set(
	[
		// English
		'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'approx', 'inc', 'ltd', 'corp', 'u.s', 'u.k', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'fig', 'dept',
		// Spanish and Portuguese
		'sra', 'srta', 'dra', 'lic', 'pág', 'pag', 'núm', 'aprox', 'ee.uu', 'av', 'tel', 'cía', 'ltda', 'obs', 'p.ex',
	].map((s) => s.toLowerCase()),
);

export type Sentence = {text: string; start: number; end: number};

/**
 * Split text into sentences. A sentence ends at . ! ? or ... (plus closing quotes or brackets) followed by space and an
 * opening that can start a sentence (an uppercase letter, a digit, ¿ ¡ " $ or a source tag), or at a blank line.
 * Colons and semicolons never end a sentence. A [src:id] tag right after a sentence end belongs to that sentence.
 * Works for English, Spanish and Portuguese.
 */
export const splitSentences = (input: string): Sentence[] => {
	const text = input.replace(/\r\n?/g, '\n');
	const out: Sentence[] = [];
	let start = 0;
	const push = (end: number) => {
		const raw = text.slice(start, end);
		const lead = raw.length - raw.trimStart().length;
		const t = raw.trim();
		if (t) out.push({text: t, start: start + lead, end: start + lead + t.length});
		start = end;
	};
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '\n' && /^\n[ \t]*\n/.test(text.slice(i))) {
			push(i);
			i++;
			continue;
		}
		if (ch === '.' || ch === '!' || ch === '?') {
			let j = i;
			while (j < text.length && /[.!?]/.test(text[j])) j++;
			while (j < text.length && /["')\]»”’]/.test(text[j])) j++;
			// a source tag directly after the end mark belongs to this sentence: "... buying. [src:x] Next"
			let k = j;
			const tagRun = /^(?:\s*\[src:[^\]]*\])+/.exec(text.slice(k));
			if (tagRun) k += tagRun[0].length;
			const rest = text.slice(k);
			const next = /^(\s+)(\S)/.exec(rest);
			const atEnd = !rest.trim();
			if (ch === '.' && j === i + 1 && !tagRun) {
				// abbreviation or initial? look at the word before the period
				const before = /([\p{L}.]+)$/u.exec(text.slice(0, i));
				const word = before ? before[1].toLowerCase() : '';
				if (ABBREV.has(word) || ABBREV.has(word.replace(/\.$/, '')) || /^\p{Lu}$/u.test(before ? before[1] : '')) {
					i = j;
					continue;
				}
				// a decimal or a version number: "4.2", "v1.5"
				if (/\d$/.test(text.slice(0, i)) && /^\d/.test(text.slice(j))) {
					i = j;
					continue;
				}
			}
			if (atEnd) {
				push(text.length);
				break;
			}
			if (next && /[\p{Lu}\p{N}¿¡"'$\[(«“]/u.test(next[2])) {
				push(k);
				i = k;
				continue;
			}
			i = j;
			continue;
		}
		i++;
	}
	if (start < text.length) push(text.length);
	return out;
};

export const sentenceTexts = (text: string): string[] => splitSentences(text).map((s) => s.text);

// ---------------------------------------------------------------------------------------------------------------------
// English tokens
// ---------------------------------------------------------------------------------------------------------------------

const CONTRACTIONS: Array<[RegExp, string]> = [
	[/\blet's\b/gi, 'let us'],
	[/\bcan't\b/gi, 'can not'],
	[/\bcannot\b/gi, 'can not'],
	[/\bwon't\b/gi, 'will not'],
	[/\bshan't\b/gi, 'shall not'],
	[/\bain't\b/gi, 'is not'],
	[/n't\b/gi, ' not'],
	[/'re\b/gi, ' are'],
	[/'ve\b/gi, ' have'],
	[/'ll\b/gi, ' will'],
	[/'d\b/gi, ' would'],
	[/'m\b/gi, ' am'],
	[/\b(it|that|there|here|what|who|where|how|he|she|this|everyone|everybody|nobody|someone|somebody|no one)'s\b/gi, '$1 is'],
	[/'s\b/gi, ''],
	[/s'(?=\s|$)/gi, 's'],
	[/\bgonna\b/gi, 'going to'],
	[/\bgotta\b/gi, 'got to'],
	[/\bwanna\b/gi, 'want to'],
];

/** English: clean, expand contractions ("don't" -> "do not", "can't" -> "can not"), drop possessive 's. */
export const expandEnglish = (s: string): string => {
	let t = clean(s);
	for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
	return t;
};

export type Token = {word: string; start: number; end: number};

/** Word tokens (letters and digits, inner apostrophes and hyphens kept), lowercased, with offsets into `s`. */
export const tokens = (s: string): Token[] => {
	const out: Token[] = [];
	for (const m of s.matchAll(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)) {
		const i = m.index ?? 0;
		out.push({word: m[0].toLowerCase(), start: i, end: i + m[0].length});
	}
	return out;
};

export const words = (s: string): string[] => tokens(s).map((t) => t.word);

/** Function words: never content (negations, modals, hedges and numbers are handled by their own checks). */
export const STOPWORDS = new Set(
	`a an the and or but if then so of to in on at by for with from into onto upon about as than that this these those there here it its they them their theirs
	he him his she her hers we us our ours you your yours yourself yourselves i me my mine myself who whom whose which what when where why how
	is am are was were be been being do does did doing done have has had having just also very too really quite even
	up down out off over again further once both own same other another such some instead rather either going s t de la el los las o e um uma`
		.split(/\s+/)
		.filter(Boolean),
);

// ---------------------------------------------------------------------------------------------------------------------
// Language guess (is a back-translation really English?)
// ---------------------------------------------------------------------------------------------------------------------

// Distinctive function words only: words that are also English ("no", "as", "do", "con", "sin", "son") are left out.
const EN_FW = new Set('the of and to is are was were you your it this that with for on not be have has will would what who they their them we our from at by an'.split(' '));
const ES_FW = new Set('el la los las de del al que y en es fue por para se su lo como pero más muy sobre también donde quien desde todo nadie nada nunca cuando este esta eso ellos usted tú una'.split(' '));
const PT_FW = new Set('os da de dos das que em é são foi por para não se sua seu ao mais mas já muito sem sobre também há onde quem desde tudo ninguém nada nunca quando este esta isso eles você vocês na nas nos uma'.split(' '));

/** Counts of distinctive function words per language. */
export const languageVotes = (s: string): {en: number; es: number; pt: number; total: number} => {
	const ws = words(clean(s).replace(/\S+\.\S+/g, ' '));
	let en = 0;
	let es = 0;
	let pt = 0;
	for (const w of ws) {
		if (EN_FW.has(w)) en++;
		if (ES_FW.has(w)) es++;
		if (PT_FW.has(w)) pt++;
	}
	return {en, es, pt, total: ws.length};
};

/** true when `s` reads as Spanish or Portuguese rather than English (needs 4+ words to say anything). */
export const looksNotEnglish = (s: string): boolean => {
	const v = languageVotes(stripNotes(stripTags(s)));
	if (v.total < 4) return false;
	const other = Math.max(v.es, v.pt);
	return other >= 2 && other > v.en * 1.5;
};

/** Share of letters that are uppercase (thumbnail and label text is often ALL CAPS). */
export const upperShare = (s: string): number => {
	const letters = [...s].filter((c) => /\p{L}/u.test(c));
	if (!letters.length) return 0;
	return letters.filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length / letters.length;
};
