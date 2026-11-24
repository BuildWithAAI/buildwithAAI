/**
 * Numbers in display text, as values (pure), so a translation can be checked to keep every number of its source.
 *
 * Written forms are read EXACTLY the way the voice step speaks them: parseNum is a port of parse_num in
 * scripts/voice/voicelib/normalize/common.py (keep the two in step). In es / it / pt-br "40.000" and "40,000" are both
 * forty thousand, "1,5" and "68.67" are decimals, and "1,234" is 1.234 (so an English "1,234" kept in a Spanish
 * translation is caught: the voice would read a different number).
 * Also: Devanagari and full-width digits, scale suffixes ($1.5M, 4万), scale words (million, millones, लाख, 亿),
 * percent signs and words (%, por ciento, प्रतिशत, 百分之), and Chinese/Japanese numerals with a unit (四万, 三点五).
 */
import type {Lang} from '../../../src/episode/types.ts';
import {asciiDigits, clean} from '../../claims/lib/text.ts';

export type Quantity = {value: number; pct: boolean; raw: string; month?: boolean};

/** The voice step's decimal separator per language (voicelib/langs.py). */
export const DECIMAL_SEP: Record<Lang, '.' | ','> = {en: '.', es: ',', 'pt-br': ',', it: ',', hi: '.', zh: '.', ja: '.'};

/** Port of parse_num: [integer digits, fraction digits | null], or null for shapes that are not one number ("1.2.3"). */
export const parseNum = (s: string, decimalSep: '.' | ','): [string, string | null] | null => {
	if (!/^\d+(?:[.,]\d+)*$/.test(s)) return null;
	const seps = [...s].filter((c) => c === '.' || c === ',');
	if (!seps.length) return [s, null];
	if (new Set(seps).size === 2) {
		const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
		const groups = s.slice(0, last).split(/[.,]/);
		if (groups.slice(1).some((g) => g.length !== 2 && g.length !== 3)) return null;
		return [groups.join(''), s.slice(last + 1)];
	}
	const sep = seps[0];
	const parts = s.split(sep);
	if (parts.length > 2) {
		const lastPart = parts[parts.length - 1];
		if (lastPart && lastPart.length === 3 && parts.slice(1).every((p) => p.length === 2 || p.length === 3)) return [parts.join(''), null];
		return null;
	}
	const [a, b] = parts;
	if (sep === decimalSep) {
		if (decimalSep === ',' && b.length === 3 && a.length >= 1 && a.length <= 3 && !a.startsWith('0') && b.endsWith('0')) return [a + b, null]; // "40,000" English-style
		return [a, b];
	}
	if (b.length === 3 && a.length >= 1 && a.length <= 3 && !a.startsWith('0')) return [a + b, null];
	return [a, b]; // "68.67" in Spanish text, "0,25" in English text: a decimal
};

const SCALE_SUFFIX: Record<string, number> = {k: 1e3, m: 1e6, b: 1e9, t: 1e12, bn: 1e9};

/** Scale words after a number, longest first (lower case). */
const SCALE_WORDS: Record<Lang, Array<[string, number]>> = {
	en: [['trillion', 1e12], ['billion', 1e9], ['million', 1e6], ['thousand', 1e3]],
	es: [['mil millones', 1e9], ['billones', 1e12], ['billón', 1e12], ['millones', 1e6], ['millón', 1e6], ['mil', 1e3]],
	'pt-br': [['trilhões', 1e12], ['trilhão', 1e12], ['bilhões', 1e9], ['bilhão', 1e9], ['milhões', 1e6], ['milhão', 1e6], ['mil', 1e3]],
	it: [['miliardi', 1e9], ['miliardo', 1e9], ['milioni', 1e6], ['milione', 1e6], ['mila', 1e3], ['mille', 1e3]],
	hi: [['खरब', 1e11], ['अरब', 1e9], ['करोड़', 1e7], ['करोड', 1e7], ['लाख', 1e5], ['हज़ार', 1e3], ['हजार', 1e3], ['बिलियन', 1e9], ['मिलियन', 1e6]],
	zh: [['十亿', 1e9], ['千万', 1e7], ['百万', 1e6], ['十万', 1e5], ['亿', 1e8], ['万', 1e4], ['千', 1e3]],
	ja: [['億', 1e8], ['万', 1e4], ['千', 1e3]],
};

for (const list of Object.values(SCALE_WORDS)) list.forEach((e) => (e[0] = e[0].normalize('NFKC'))); // text is NFKC-cleaned too

const PERCENT_WORDS: Record<Lang, RegExp> = {
	en: /^\s?(?:%|percent(?![\p{L}])|per cent(?![\p{L}]))/iu,
	es: /^\s?(?:%|por ?ciento(?![\p{L}]))/iu,
	'pt-br': /^\s?(?:%|por ?cento(?![\p{L}]))/iu,
	it: /^\s?(?:%|per ?cento(?![\p{L}]))/iu,
	hi: new RegExp('^\\s?(?:%|प्रतिशत|फ़ीसदी|फीसदी|फ़ीसद|फीसद)'.normalize('NFKC'), 'u'),
	zh: /^\s?%/u,
	ja: /^\s?(?:%|パーセント)/u,
};

const URL_RE = /https?:\/\/\S+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|ai|fun|xyz|org|net|gg|app|so|co|me|tv|news|finance|exchange|dev)(?:\/\S*)?/giu;

const NUM = /(?<![\p{Script=Latin}\p{N}]|[\p{Script=Latin}\p{N}][.,])([+\-±])?(R\$|US\$|[$€£¥₹])?\s?(\d+(?:[.,]\d+)*)(?:\s?(bn|BN|[kKmMbBtT])(?![\p{L}\p{N}]))?/gu;

const CJK_DIGIT: Record<string, number> = {零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9};
const CJK_UNIT: Record<string, number> = {十: 10, 百: 100, 千: 1000};
const CJK_BIG: Record<string, number> = {万: 1e4, 亿: 1e8, 億: 1e8};
const CJK_RUN = /[零〇一二两三四五六七八九十百千万亿億点]+/gu;

/** 四万五千 = 45000, 三点五 = 3.5, 一百二十 = 120; null if not a numeral. */
export const parseCjkNumeral = (run: string): number | null => {
	const [intPart, fracPart] = run.split('点');
	let total = 0;
	let section = 0;
	let num = 0;
	let any = false;
	for (const ch of intPart) {
		if (ch in CJK_DIGIT) {
			num = CJK_DIGIT[ch];
			any = true;
		} else if (ch in CJK_UNIT) {
			section += (num || 1) * CJK_UNIT[ch];
			num = 0;
			any = true;
		} else if (ch in CJK_BIG) {
			section += num;
			total += (section || 1) * CJK_BIG[ch];
			section = 0;
			num = 0;
			any = true;
		} else return null;
	}
	if (!any) return null;
	let v = total + section + num;
	if (fracPart !== undefined) {
		const digits = [...fracPart].map((c) => CJK_DIGIT[c]);
		if (!digits.length || digits.some((d) => d === undefined)) return null;
		v += Number(`0.${digits.join('')}`);
	}
	return v;
};

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Every number in a display text, with its value. URLs are ignored. */
export const extractQuantities = (text: string, lang: Lang): Quantity[] => {
	const t = asciiDigits(clean(text)).replace(URL_RE, (m) => ' '.repeat(m.length));
	const out: Quantity[] = [];
	const lower = t.toLowerCase();
	for (const m of t.matchAll(NUM)) {
		const [, , cur, digits] = m;
		let suffix: string | undefined = m[4];
		if (suffix === 'm' && !cur) suffix = undefined; // a bare "5m" stays (minutes? metres?), as in the voice step
		const parsed = parseNum(digits, DECIMAL_SEP[lang]);
		if (!parsed) continue;
		let value = Number(`${parsed[0]}.${parsed[1] ?? '0'}`);
		let end = m.index + m[0].length;
		if (m[4] && !suffix) end -= m[4].length; // the unused suffix is not part of the number
		if (suffix) value *= SCALE_SUFFIX[suffix.toLowerCase()];
		else {
			const rest = lower.slice(end);
			for (const [word, mult] of SCALE_WORDS[lang]) {
				const re = new RegExp(`^\\s?${word}(?![\\p{L}\\p{M}])`, 'u');
				const unspaced = lang === 'zh' || lang === 'ja';
				const hit = unspaced ? rest.startsWith(word) : re.test(rest);
				if (hit) {
					value *= mult;
					end += rest.indexOf(word) + word.length;
					break;
				}
			}
		}
		const after = t.slice(end);
		const pct = PERCENT_WORDS[lang].test(after) || (lang === 'zh' && /百分之\s?$/.test(t.slice(0, m.index)));
		const month = (lang === 'zh' || lang === 'ja') && /^\s?月/.test(after);
		out.push({value, pct, raw: t.slice(m.index, end).trim(), ...(month ? {month} : {})});
	}
	if (lang === 'zh' || lang === 'ja') {
		for (const m of t.matchAll(CJK_RUN)) {
			const run = m[0];
			const before = t.slice(0, m.index);
			const after = t.slice(m.index + run.length);
			const pctPrefix = /百分之$/.test(before);
			if (/[第]$/.test(before)) continue; // ordinals (第一) are not quantities
			if (/^分之/.test(after)) continue; // the 百 of 百分之 (percent) is not a hundred
			if (/^分/.test(after) && /^[十万]$/.test(run)) continue; // 十分 / 万分 mean "very", not 10 / 10,000
			if (/^(?:一|十分|万一|一点|一些|一起|一定|一直|一样|一下|一般|千万|一旦)$/.test(run) && !pctPrefix) continue;
			if (run === '千万' && /^(?:别|不|要|记|小心)/.test(after)) continue;
			if (!pctPrefix && !/[十百千万亿億点]/.test(run)) continue;
			if (/^\d/.test(after) || /\d$/.test(before)) continue; // "4万" is read with its digits above
			const v = parseCjkNumeral(run.replace(/^百分之/, ''));
			if (v === null) continue;
			out.push({value: v, pct: pctPrefix, raw: run, ...(/^月/.test(after) ? {month: true} : {})});
		}
	}
	return out;
};

export type NumberDiff = {missing: Quantity[]; extra: Quantity[]; unitMismatch: Array<[Quantity, Quantity]>};

/** Compare as multisets: a missing source number is an error; an extra target number is a warning. */
export const compareQuantities = (src: Quantity[], tgt: Quantity[]): NumberDiff => {
	const used = new Set<number>();
	const missing: Quantity[] = [];
	const unitMismatch: Array<[Quantity, Quantity]> = [];
	for (const q of src) {
		let k = tgt.findIndex((x, i) => !used.has(i) && near(x.value, q.value) && x.pct === q.pct);
		if (k < 0) {
			k = tgt.findIndex((x, i) => !used.has(i) && near(x.value, q.value));
			if (k >= 0) unitMismatch.push([q, tgt[k]]);
		}
		if (k < 0) missing.push(q);
		else used.add(k);
	}
	const extra = tgt.filter((x, i) => !used.has(i) && !x.month);
	return {missing, extra, unitMismatch};
};

export const formatValue = (q: Quantity): string => {
	const v = Number.isInteger(q.value) && Math.abs(q.value) >= 10_000 ? q.value.toLocaleString('en-US') : String(Number(q.value.toPrecision(12)));
	return `${v}${q.pct ? '%' : ''}`;
};
