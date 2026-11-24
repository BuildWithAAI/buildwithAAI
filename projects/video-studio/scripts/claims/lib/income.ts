/**
 * Income, return and "financial advice" framings (pure), per language, with negation: "this is not financial advice"
 * and "nothing is risk-free" pass; "guaranteed returns" and "100x" fail. Positions refer to normText(text), the same
 * normalization a waiver's `match` goes through, so a waiver can be checked against the exact span.
 *
 * Negation is clause-bounded (2026-11-24, VCD fix): the window stops at , ; : and at "but / pero / mas / però / ma /
 * लेकिन / 但", and never reaches back past another rule's hit. So "Not financial advice, buy now." and "No es consejo
 * financiero, compra ahora." fail (research §4.9: "not financial advice" is never a shield), as do "Nadie pierde aquí,
 * ganancias garantizadas." and "Ninguém perde aqui, lucro garantido.". Negated hits are returned (negated: true) and
 * listed as warnings in the report.
 */
import type {Lang} from '../../../src/episode/types.ts';
import {INCOME, NEGATION_AFTER, NEGATORS, type IncomeRule} from './lexicon.ts';
import {allMatches, asciiDigits, clean, expandContractions, UNSPACED} from './text.ts';

export type IncomeHit = {rule: IncomeRule; text: string; start: number; end: number; negated: boolean};

/** The normalized text income patterns and waivers are matched on. */
export const normText = (text: string, lang: Lang): string => {
	const t = asciiDigits(clean(text));
	return (lang === 'en' ? expandContractions(t) : t).toLowerCase();
};

/** Sentence and clause ends: a negation never reaches across them. */
const CLAUSE_END = /[.!?;:…,。！？；：，、।॥]/u;
/** Conjunctions that start a new clause: "not X but Y" does not negate Y. */
const CONTRAST = /(?<![\p{L}\p{M}\p{N}])(?:but|however|pero|sino|mas|porém|però|ma|tuttavia|लेकिन|पर|मगर|किंतु)(?![\p{L}\p{M}\p{N}])|但是|但|可是|不过|しかし|でも|けど/gu;
const stripPunct = (tok: string) => tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');

const isBoundary = (s: string, i: number): boolean => {
	if (!CLAUSE_END.test(s[i])) return false;
	// a decimal point or comma ("1.5", "1,5") is not a boundary
	return !((s[i] === '.' || s[i] === ',') && /\d/.test(s[i - 1] ?? '') && /\d/.test(s[i + 1] ?? ''));
};

/** The clause before `start`: from the last clause end or contrast word (and never before `floor`). */
const windowBefore = (t: string, start: number, floor = 0): string => {
	let cut = floor;
	for (let i = start - 1; i >= floor; i--) {
		if (isBoundary(t, i)) {
			cut = i + 1;
			break;
		}
	}
	let from = cut;
	for (const m of allMatches(CONTRAST, t.slice(cut, start))) from = Math.max(from, cut + m.index + m[0].length);
	return t.slice(from, start);
};
/** The clause after `end`: up to the next clause end or contrast word (and never past `ceil`). */
const windowAfter = (t: string, end: number, ceil = t.length): string => {
	let stop = ceil;
	for (let i = end; i < ceil; i++) {
		if (isBoundary(t, i)) {
			stop = i;
			break;
		}
	}
	const seg = t.slice(end, stop);
	const m = allMatches(CONTRAST, seg)[0];
	return m ? seg.slice(0, m.index) : seg;
};

/**
 * Is the phrase at [start, end) negated? `floor` / `ceil`: the end of the hit before it and the start of the hit after
 * it (another rule's words, e.g. "not financial advice", never negate this one).
 */
export const isNegated = (t: string, start: number, end: number, lang: Lang, floor = 0, ceil = t.length): boolean => {
	const neg = NEGATORS[lang];
	if (UNSPACED.has(lang)) {
		if (lang === 'ja') return neg.test(windowAfter(t, end, ceil).slice(0, 8));
		return neg.test(windowBefore(t, start, floor).slice(-6));
	}
	const before = windowBefore(t, start, floor).split(/\s+/).map(stripPunct).filter(Boolean).slice(-4);
	if (before.some((tok) => neg.test(tok))) return true;
	if (NEGATION_AFTER.has(lang)) {
		const after = windowAfter(t, end, ceil).split(/\s+/).map(stripPunct).filter(Boolean).slice(0, 3);
		if (after.some((tok) => neg.test(tok))) return true;
	}
	return false;
};

/** The multiple in a "100x" match, or NaN. */
const multipleOf = (s: string): number => {
	const m = /(\d+(?:[.,]\d+)?)/.exec(s);
	if (m) return Number(m[1].replace(',', '.'));
	if (/[十]倍/.test(s)) return 10;
	if (/[百千万]倍/.test(s)) return 100;
	if (/翻倍/.test(s)) return 2;
	return NaN;
};

/** Income-claim hits in a text. Negated hits are returned with negated: true (the gate lists them as warnings). */
export const incomeHits = (text: string, lang: Lang): IncomeHit[] => {
	const t = normText(text, lang);
	const out: IncomeHit[] = [];
	for (const rule of INCOME[lang] ?? []) {
		for (const m of allMatches(rule.re, t)) {
			const start = m.index;
			const end = start + m[0].length;
			if (rule.allow && allMatches(rule.allow, t).some((a) => a.index <= start && a.index + a[0].length >= end)) continue;
			// "2x faster" is not a return claim; "10x" and up is. "翻倍" (doubles your money) is one in itself.
			if (rule.id === 'multiplier' && !/翻倍/.test(m[0]) && !(multipleOf(m[0]) >= 10)) continue;
			out.push({rule, text: m[0], start, end, negated: false});
		}
	}
	// one hit per span: the first rule wins when two rules match the same words
	out.sort((a, b) => a.start - b.start || b.end - a.end);
	const kept: IncomeHit[] = [];
	for (const h of out) if (!kept.some((k) => k.start < h.end && h.start < k.end)) kept.push(h);
	// negation, clause by clause; another hit's words (e.g. "not financial advice") never negate this one
	kept.forEach((h, i) => {
		const floor = i > 0 ? kept[i - 1].end : 0;
		const ceil = i + 1 < kept.length ? kept[i + 1].start : t.length;
		h.negated = h.rule.negatable && isNegated(t, h.start, h.end, lang, floor, ceil);
	});
	return kept;
};

/** Is the phrase matched by `re` in `text` said without a negation in its clause? (disclosure and fiction wording) */
export const saysUnnegated = (re: RegExp, text: string, lang: Lang): boolean => {
	const t = normText(text, lang);
	return allMatches(re, t).some((m) => !isNegated(t, m.index, m.index + m[0].length, lang));
};

/** Occurrence spans of a waiver `match` in a text (same normalization as incomeHits). */
export const spansOf = (needle: string, text: string, lang: Lang): Array<[number, number]> => {
	const n = normText(needle, lang);
	const t = normText(text, lang);
	const out: Array<[number, number]> = [];
	if (!n) return out;
	for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) out.push([i, i + n.length]);
	return out;
};
