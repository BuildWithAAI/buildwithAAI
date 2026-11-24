/**
 * Numbers written in WORDS (pure), so the spoken side of {display|spoken} can be checked: "nearly nineteen million",
 * "casi diecinueve millones", "quase dezenove milhões", "quasi diciannove milioni", "लगभग उन्नीस", "将近一千九百万".
 * Added 2026-11-24 (VCD fix): a translation could make Kokoro say another number while the screen kept the right one.
 *
 * The word tables mirror the voice step's normalizers (scripts/voice/voicelib/normalize/{en,es,pt_br,it,hi}.py, the
 * words Kokoro is actually given); tests/dub.test.ts checks them against those files. zh reuses parseCjkNumeral.
 * A value is the run's number; "and a half" / "y medio" / "e meio" / "e mezzo" / "साढ़े" add 0.5; a percent word after
 * the run marks it as a percentage. Approximation words ("nearly", "casi", "quase") are ignored: compare with a tolerance.
 */
import type {Lang} from '../../../src/episode/types.ts';
import {clean} from '../../claims/lib/text.ts';
import {parseCjkNumeral, type Quantity} from './numbers.ts';

type Table = {
	/** word -> value: units, teens, tens, hundreds that are one word ("doscientos", "duzentos"), compounds ("veintiuno"). */
	small: Record<string, number>;
	/** "hundred" words that multiply what came before (en "hundred", hi "सौ"). */
	hundred: string[];
	/** scale words -> value: thousand, million ... */
	scale: Record<string, number>;
	/** words that may join two parts of one number ("and", "y", "e"). */
	join: string[];
	/** words that start the decimal part ("point", "coma", "vírgula", "virgola", "दशमलव"). */
	decimal: string[];
	/** a half after the number ("and a half", "y medio", "e meio") or before it (hi "साढ़े"). */
	halfAfter: RegExp | null;
	halfBefore: string[];
	/** a percent word right after the run. */
	percent: RegExp;
	/** words that may precede a number and are skipped ("a" hundred). */
	article: string[];
};

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const tableOf = (list: string[], start = 0): Record<string, number> => Object.fromEntries(list.map((w, i) => [w, start + i]));

// ---------------------------------------------------------------------------------------------------------------------
// en (voicelib/normalize/en.py ONES, TENS)
// ---------------------------------------------------------------------------------------------------------------------
export const EN_ONES = words('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen');
export const EN_TENS = words('twenty thirty forty fifty sixty seventy eighty ninety');
const EN: Table = {
	small: {...tableOf(EN_ONES), ...Object.fromEntries(EN_TENS.map((w, i) => [w, (i + 2) * 10]))},
	hundred: ['hundred'],
	scale: {thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12},
	join: ['and'],
	decimal: ['point'],
	halfAfter: /^\s*and a half\b/u,
	halfBefore: [],
	percent: /^\s*(?:percent|per cent)(?![\p{L}])/u,
	article: ['a'],
};

// ---------------------------------------------------------------------------------------------------------------------
// es (voicelib/normalize/es.py UNITS, TENS, HUNDREDS)
// ---------------------------------------------------------------------------------------------------------------------
export const ES_UNITS = words(
	'cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve veinte veintiuno veintidós veintitrés veinticuatro veinticinco veintiséis veintisiete veintiocho veintinueve',
);
export const ES_TENS = {treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90};
export const ES_HUNDREDS = {ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900};
const ES: Table = {
	small: {
		...tableOf(ES_UNITS),
		un: 1,
		una: 1,
		veintiún: 21,
		veintiuna: 21,
		...ES_TENS,
		cien: 100,
		...ES_HUNDREDS,
		...Object.fromEntries(Object.entries(ES_HUNDREDS).filter(([w]) => w.endsWith('os')).map(([w, v]) => [`${w.slice(0, -2)}as`, v])),
	},
	hundred: [],
	scale: {mil: 1e3, millón: 1e6, millones: 1e6, billón: 1e12, billones: 1e12},
	join: ['y'],
	decimal: ['coma', 'punto'],
	halfAfter: /^\s*y medi[oa]\b/u,
	halfBefore: [],
	percent: /^\s*por ?ciento(?![\p{L}])/u,
	article: [],
};

// ---------------------------------------------------------------------------------------------------------------------
// pt-br (voicelib/normalize/pt_br.py UNITS, TENS, HUNDREDS, SCALES)
// ---------------------------------------------------------------------------------------------------------------------
export const PT_UNITS = words('zero um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis dezessete dezoito dezenove');
export const PT_TENS = {vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90};
export const PT_HUNDREDS = {cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900};
const PT: Table = {
	small: {
		...tableOf(PT_UNITS),
		uma: 1,
		duas: 2,
		catorze: 14,
		dezesseis: 16,
		dezasseis: 16,
		...PT_TENS,
		cem: 100,
		...PT_HUNDREDS,
		...Object.fromEntries(Object.entries(PT_HUNDREDS).filter(([w]) => w.endsWith('os')).map(([w, v]) => [`${w.slice(0, -2)}as`, v])),
	},
	hundred: [],
	scale: {mil: 1e3, milhão: 1e6, milhões: 1e6, bilhão: 1e9, bilhões: 1e9, trilhão: 1e12, trilhões: 1e12},
	join: ['e'],
	decimal: ['vírgula', 'ponto'],
	halfAfter: /^\s*e mei[oa]\b/u,
	halfBefore: [],
	percent: /^\s*por ?cento(?![\p{L}])/u,
	article: [],
};

// ---------------------------------------------------------------------------------------------------------------------
// it (voicelib/normalize/it.py UNITS, TENS): compounds are one word ("sessantanove", "duemilaventisei")
// ---------------------------------------------------------------------------------------------------------------------
export const IT_UNITS = words('zero uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici sedici diciassette diciotto diciannove');
export const IT_TENS = {venti: 20, trenta: 30, quaranta: 40, cinquanta: 50, sessanta: 60, settanta: 70, ottanta: 80, novanta: 90};
const IT_MORPHS: Array<[string, number, 'unit' | 'hundred' | 'thousand']> = [
	...IT_UNITS.map((w, i) => [w, i, 'unit'] as [string, number, 'unit']),
	['tré', 3, 'unit'],
	['un', 1, 'unit'],
	...Object.entries(IT_TENS).flatMap(([w, v]) => [[w, v, 'unit'] as [string, number, 'unit'], [w.slice(0, -1), v, 'unit'] as [string, number, 'unit']]),
	['cento', 100, 'hundred'],
	['cent', 100, 'hundred'],
	['mille', 1000, 'thousand'],
	['mila', 1000, 'thousand'],
];
IT_MORPHS.sort((a, b) => b[0].length - a[0].length);
const IT: Table = {
	small: {},
	hundred: [],
	scale: {milione: 1e6, milioni: 1e6, miliardo: 1e9, miliardi: 1e9},
	join: ['e'],
	decimal: ['virgola', 'punto'],
	halfAfter: /^\s*e mezz[oa]\b/u,
	halfBefore: [],
	percent: /^\s*per ?cento(?![\p{L}])/u,
	article: [],
};

/** One Italian compound word ("sessantanove", "duemilaventisei", "centotré") -> its value, or null. */
export const italianWord = (w: string): number | null => {
	let total = 0;
	let cur = 0;
	let i = 0;
	let any = false;
	while (i < w.length) {
		const m = IT_MORPHS.find(([s]) => w.startsWith(s, i));
		if (!m) return null;
		const [s, v, kind] = m;
		if (kind === 'unit') cur += v;
		else if (kind === 'hundred') cur = (cur || 1) * 100;
		else {
			total += (cur || 1) * 1000;
			cur = 0;
		}
		i += s.length;
		any = true;
	}
	return any ? total + cur : null;
};

// ---------------------------------------------------------------------------------------------------------------------
// hi (voicelib/normalize/hi.py HI_0_99, SCALES)
// ---------------------------------------------------------------------------------------------------------------------
export const HI_0_99 = words(
	'शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उनासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे',
);
const HI: Table = {
	small: {...tableOf(HI_0_99), छः: 6, उन्यासी: 79},
	hundred: ['सौ'],
	scale: {हज़ार: 1e3, हजार: 1e3, लाख: 1e5, करोड़: 1e7, करोड: 1e7, अरब: 1e9, खरब: 1e11, मिलियन: 1e6, बिलियन: 1e9},
	join: [],
	decimal: ['दशमलव'],
	halfAfter: null,
	halfBefore: ['साढ़े'],
	percent: /^\s*(?:प्रतिशत|फ़ीसदी|फीसदी)/u,
	article: [],
};

const TABLES: Partial<Record<Lang, Table>> = {en: EN, es: ES, 'pt-br': PT, it: IT, hi: HI};

const norm = (s: string): string => clean(s).normalize('NFC').toLowerCase();

/** Value of one word in a language, or null (Italian compounds parsed by morphemes). */
const wordValue = (w: string, lang: Lang): number | null => {
	const t = TABLES[lang];
	if (!t) return null;
	if (w in t.small) return t.small[w];
	if (lang === 'it' && /^[a-zàèéìòù]+$/u.test(w) && w.length > 2) return italianWord(w);
	return null;
};

type Tok = {w: string; start: number; end: number};

const tokenize = (text: string): Tok[] => {
	const out: Tok[] = [];
	for (const m of text.matchAll(/[\p{L}\p{M}]+/gu)) out.push({w: m[0], start: m.index, end: m.index + m[0].length});
	return out;
};

/** Every number written in words in a text, with its value (zh: Chinese numerals; ja: none). */
export const wordQuantities = (text: string, lang: Lang): Quantity[] => {
	const t = norm(text);
	if (lang === 'zh' || lang === 'ja') {
		const out: Quantity[] = [];
		for (const m of t.matchAll(/[零〇一二两三四五六七八九十百千万亿億点]+/gu)) {
			if (/^分之/u.test(t.slice(m.index + m[0].length))) continue; // the 百 of 百分之 (percent) is not a hundred
			if (!/[十百千万亿億点]/u.test(m[0]) && m[0].length < 2) continue;
			if (/^(?:一|十分|万一|一点|一些|一起|一定|一直|一样|一下|一般|千万|一旦)$/u.test(m[0])) continue;
			const v = parseCjkNumeral(m[0]);
			if (v !== null) out.push({value: v, pct: /百分之$/u.test(t.slice(0, m.index)), raw: m[0]});
		}
		return out;
	}
	const tab = TABLES[lang];
	if (!tab) return [];
	const toks = tokenize(t);
	const out: Quantity[] = [];
	let i = 0;
	while (i < toks.length) {
		let half = 0;
		let k = i;
		if (tab.halfBefore.includes(toks[k].w) && k + 1 < toks.length && wordValue(toks[k + 1].w, lang) !== null) {
			half = 0.5;
			k++;
		}
		if (tab.article.includes(toks[k].w) && k + 1 < toks.length && (tab.hundred.includes(toks[k + 1].w) || toks[k + 1].w in tab.scale)) k++;
		// "por ciento", "por cento", "per cento": the percent word, not a hundred
		if (k > 0 && /^(?:ciento|cento)$/u.test(toks[k].w) && /^(?:por|per)$/u.test(toks[k - 1].w)) {
			i = k + 1;
			continue;
		}
		const first = wordValue(toks[k].w, lang);
		const startsScale = toks[k].w in tab.scale || tab.hundred.includes(toks[k].w);
		// "a hundred", "a million"; es/pt "mil" alone is a thousand ("mil billeteras")
		const bareThousand = (lang === 'es' || lang === 'pt-br') && toks[k].w === 'mil';
		if (first === null && !(startsScale && (toks[i] !== toks[k] || bareThousand))) {
			i++;
			continue;
		}
		let total = 0;
		let cur = 0;
		let last = Infinity; // place of the last part: a joined part must be smaller ("vinte e três", not "dois e três")
		let j = k;
		let fracDigits = '';
		const startAt = toks[i].start;
		let endAt = toks[k].end;
		for (; j < toks.length; j++) {
			const w = toks[j].w;
			const v = wordValue(w, lang);
			if (v !== null) {
				const place = v >= 100 ? 10 ** Math.floor(Math.log10(v)) : v >= 10 ? 10 : 1;
				if (cur && !(place < last)) break; // "two three" is two numbers
				cur += v;
				last = place;
				endAt = toks[j].end;
				continue;
			}
			if (tab.hundred.includes(w)) {
				cur = (cur || 1) * 100;
				last = 100;
				endAt = toks[j].end;
				continue;
			}
			if (w in tab.scale) {
				const s = tab.scale[w];
				if (!cur && total > 0 && total < s) total *= s;
				else total += (cur || 1) * s;
				cur = 0;
				last = s;
				endAt = toks[j].end;
				continue;
			}
			if (tab.join.includes(w) && j + 1 < toks.length) {
				const nv = wordValue(toks[j + 1].w, lang);
				if (nv !== null && (cur || total) && nv < Math.min(last, 1000) && (lang !== 'en' || cur % 100 === 0 || total > 0)) continue;
				break;
			}
			if (tab.decimal.includes(w) && j + 1 < toks.length && wordValue(toks[j + 1].w, lang) !== null) {
				// "point six seven" / "coma sesenta y siete": the digits of the decimal part
				let q = j + 1;
				const digitWords: number[] = [];
				let asNumber = 0;
				for (; q < toks.length; q++) {
					const dv = wordValue(toks[q].w, lang);
					if (dv !== null) {
						digitWords.push(dv);
						asNumber += dv;
						endAt = toks[q].end;
						continue;
					}
					if (tab.join.includes(toks[q].w) && q + 1 < toks.length && wordValue(toks[q + 1].w, lang) !== null) continue;
					break;
				}
				fracDigits = digitWords.every((d) => d < 10) ? digitWords.join('') : String(asNumber);
				j = q;
				// "one point five million", "uno coma cinco millones"
				if (j < toks.length && toks[j].w in tab.scale) {
					total = (total + cur + Number(`0.${fracDigits}`)) * tab.scale[toks[j].w];
					cur = 0;
					fracDigits = '';
					endAt = toks[j].end;
					j++;
				}
				break;
			}
			break;
		}
		let value = total + cur + half + (fracDigits ? Number(`0.${fracDigits}`) : 0);
		const after = t.slice(endAt);
		if (tab.halfAfter && tab.halfAfter.test(after)) {
			value += 0.5;
			endAt += (tab.halfAfter.exec(after)?.[0].length ?? 0);
		}
		const pct = tab.percent.test(t.slice(endAt));
		const raw = t.slice(startAt, endAt).trim();
		if (raw) out.push({value, pct, raw});
		i = Math.max(j, k + 1);
	}
	return out;
};

/** Relative difference of two values (0 = equal). */
export const relDiff = (a: number, b: number): number => Math.abs(a - b) / Math.max(1e-9, Math.abs(a), Math.abs(b));
