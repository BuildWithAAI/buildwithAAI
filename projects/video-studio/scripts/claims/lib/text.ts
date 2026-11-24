/**
 * Text helpers shared by the claim gate and the dubbing tools (pure). Matching never runs on the raw text: it runs on
 * clean() output (NFKC, zero-width removed, curly quotes straightened, dashes unified), so a typographic variant of a
 * phrase cannot slip past a pattern.
 */
import type {Lang} from '../../../src/episode/types.ts';

export const LANGS: readonly Lang[] = ['en', 'es', 'pt-br', 'hi', 'it', 'zh', 'ja'];
export const isLang = (x: unknown): x is Lang => typeof x === 'string' && (LANGS as readonly string[]).includes(x);

/** Languages written without spaces between words. */
export const UNSPACED: ReadonlySet<Lang> = new Set<Lang>(['zh', 'ja']);

export const LANG_NAMES: Record<Lang, string> = {
	en: 'English',
	es: 'Spanish',
	'pt-br': 'Brazilian Portuguese',
	hi: 'Hindi',
	it: 'Italian',
	zh: 'Chinese (Simplified)',
	ja: 'Japanese',
};

/** Why a language code is refused, or null when it is supported. French is excluded (no male Kokoro voice). */
export const langProblem = (x: string): string | null => {
	if (isLang(x)) return null;
	if (/^fr(?:-|$)/i.test(x)) return 'French is excluded: Kokoro v1.0 has no male French voice for Zoo (CLAUDE.md, owner decision 2026-11-24)';
	return `unsupported language "${x}"; supported: ${LANGS.join(', ')}`;
};

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Letters, marks (Devanagari vowel signs), digits and underscore: the inside of a word in any script. */
export const WORD_CLASS = '\\p{L}\\p{M}\\p{N}_';

/** A regex for `src` with Unicode word boundaries (spaced scripts). Flags default to case-insensitive. */
export const wordRe = (src: string, flags = 'iu'): RegExp => new RegExp(`(?<![${WORD_CLASS}])(?:${src})(?![${WORD_CLASS}])`, flags);

/** A regex for a Latin-script term inside text of any script: only Latin letters and digits break the match. */
export const latinTermRe = (term: string, flags = 'u'): RegExp =>
	new RegExp(`(?<![\\p{Script=Latin}\\p{N}_])${escapeRe(term).replace(/\s+/g, '\\s+')}(?![\\p{Script=Latin}\\p{N}_])`, flags);

/** All matches of a regex (adds the g flag when missing). */
export const allMatches = (re: RegExp, text: string): RegExpExecArray[] => {
	const g = re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
	g.lastIndex = 0;
	const out: RegExpExecArray[] = [];
	let m: RegExpExecArray | null;
	while ((m = g.exec(text))) {
		out.push(m);
		if (m[0] === '') g.lastIndex++;
	}
	return out;
};

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/** NFKC, zero-width removed, curly quotes straightened, dashes unified, whitespace collapsed. Case kept. */
export const clean = (s: string): string =>
	s
		.normalize('NFKC')
		.replace(ZERO_WIDTH, '')
		.replace(/[‘’‛′`´]/g, "'")
		.replace(/[“”„‟″«»]/g, '"')
		.replace(/[‐‑‒–—―−]/g, '-')
		.replace(/\s+/g, ' ')
		.trim();

/** English contractions expanded, so "can't", "cannot" and "can not" match the same pattern. */
export const expandContractions = (s: string): string =>
	s
		.replace(/\b(c)an't\b/gi, '$1an not')
		.replace(/\b(c)annot\b/gi, '$1an not')
		.replace(/\b(w)on't\b/gi, '$1ill not')
		.replace(/\b(s)han't\b/gi, '$1hall not')
		.replace(/\b(\w+)n't\b/gi, '$1 not')
		.replace(/\b(\w+)'ll\b/gi, '$1 will')
		.replace(/\b(\w+)'re\b/gi, '$1 are')
		.replace(/\b(\w+)'ve\b/gi, '$1 have')
		.replace(/\b(I)'m\b/gi, '$1 am')
		.replace(/\b(\w+)'d\b/gi, '$1 would');

/** The text every lexicon pattern runs on: clean(), contractions expanded, lower case. */
export const matchText = (s: string): string => expandContractions(clean(s)).toLowerCase();

const DEVANAGARI_DIGITS = '०१२३४५६७८९';
/** Devanagari and full-width digits to ASCII (same length, so match indexes stay valid). */
export const asciiDigits = (s: string): string =>
	s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d))).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

/** Collapse whitespace and trim, for display in reports. */
export const oneLine = (s: string, max = 220): string => {
	const t = s.replace(/\s+/g, ' ').trim();
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Words of a text for counting (spaced scripts) or characters (unspaced). */
export const wordCount = (s: string): number => clean(s).split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Han, kana, full-width forms and CJK punctuation. */
export const isCjk = (ch: string): boolean => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u.test(ch);
export const isDevanagari = (ch: string): boolean => /[ऀ-ॿ]/.test(ch);
