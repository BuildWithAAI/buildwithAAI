/**
 * Numbers for the news claim gate. "$1.5M", "1,500,000" and "1.5 million" are the same number, and so is the spoken
 * "one point five million dollars". Dates, times, years, percentages, currency and crypto units are kept apart so a
 * percentage never "matches" a dollar amount. Pure: no I/O.
 */
import {normalizePunct} from './text.ts';

export type NumKind = 'money' | 'percent' | 'crypto' | 'plain' | 'year' | 'date' | 'time';
/** A rounding word in front of a number: about/around (approx), more than/over (over), less than/under, nearly/almost. */
export type Qualifier = 'approx' | 'over' | 'under' | 'nearly';

export type Num = {
	kind: NumKind;
	value: number; // date: month*100+day (year separate); time: minutes after midnight
	raw: string;
	start: number;
	end: number;
	unit?: string; // USD | EUR | GBP | an upper-case ticker (ETH, BTC...) | TOKEN
	sig?: number; // significant digits as written (rounding checks)
	qualifier?: Qualifier;
	month?: number;
	day?: number;
	year?: number;
	words?: boolean; // parsed from number words
};

export type DateParts = {year?: number; month?: number; day?: number};

const MONTHS: Record<string, number> = {
	january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
	august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_ALT = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec';

/** Tickers that make "1,400 ETH" a crypto amount. Extended at runtime from the allowlist (setKnownTickers). */
let TICKERS = new Set(
	'BTC ETH SOL BNB XRP ADA DOGE TRX TON SUI APT ARB OP MATIC POL AVAX DOT LINK UNI AAVE LDO USDC USDT DAI USDE PYUSD FDUSD TUSD BUSD GHO FRAX LUSD WETH WBTC STETH WSTETH RETH CBETH CBBTC TBTC METH CMETH WEETH EZETH RSETH JITOSOL MSOL BSOL JUP RAY BONK WIF HYPE LTC BCH XMR ZEC XLM ALGO HBAR NEAR ATOM FTM S BERA TAO RUNE CRV CVX MKR SKY ENA'.split(' '),
);
export const setKnownTickers = (extra: Iterable<string>): void => {
	TICKERS = new Set([...TICKERS, ...[...extra].map((t) => t.toUpperCase())]);
};
/** The ticker symbols in use (built-in list plus the allowlist's). */
export const knownTickers = (): Set<string> => TICKERS;

const SCALE: Record<string, number> = {
	thousand: 1e3, k: 1e3, million: 1e6, mln: 1e6, mn: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12, tn: 1e12, t: 1e12,
};

const SMALL: Record<string, number> = {
	zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
	thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90};
const ORD: Record<string, number> = {
	first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11,
	twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
	nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70,
	eightieth: 80, ninetieth: 90,
};
const MULT: Record<string, number> = {thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12};
const DIGIT_WORD: Record<string, number> = {zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9};

export const sigDigits = (numStr: string): number => {
	const s = numStr.replace(/,/g, '');
	if (s.includes('.')) {
		const digits = s.replace('.', '').replace(/^0+/, '');
		return Math.max(1, digits.length);
	}
	const t = s.replace(/^0+/, '').replace(/0+$/, '');
	return Math.max(1, t.length);
};

const QUALIFIERS: Array<[RegExp, Qualifier]> = [
	[/(?:\b(?:nearly|almost|close to|just under|just shy of)\s+(?:a\s+)?)$/i, 'nearly'],
	[/(?:\b(?:about|around|roughly|approximately|approx\.?|some)\s+(?:a\s+)?|~\s*)$/i, 'approx'],
	[/(?:\b(?:under|less than|below|fewer than)\s+(?:a\s+)?)$/i, 'under'],
	[/(?:\b(?:over|more than|at least|upwards of|north of|in excess of|just over|above)\s+(?:a\s+)?)$/i, 'over'],
];
export const qualifierBefore = (text: string, start: number): Qualifier | undefined => {
	const before = text.slice(Math.max(0, start - 32), start);
	for (const [re, q] of QUALIFIERS) if (re.test(before)) return q;
	return undefined;
};

/** Replace matches with spaces of the same length (keeps offsets), returning the matches. */
const mask = (work: {s: string}, re: RegExp): RegExpMatchArray[] => {
	const found = [...work.s.matchAll(re)];
	if (!found.length) return found;
	let out = work.s;
	for (const m of found) {
		const i = m.index ?? 0;
		out = out.slice(0, i) + ' '.repeat(m[0].length) + out.slice(i + m[0].length);
	}
	work.s = out;
	return found;
};

const unitAfter = (s: string, end: number): {unit?: string; kind?: 'money' | 'crypto'; len: number} => {
	const m = /^\s*(US dollars|dollars?|usd|euros?|eur|pounds|gbp|ether|bitcoins?|tokens?|coins?|\$?[A-Za-z][A-Za-z0-9]{0,9})\b/i.exec(s.slice(end));
	if (!m) return {len: 0};
	const w = m[1];
	const lw = w.toLowerCase();
	if (/^(?:us dollars|dollars?|usd)$/.test(lw)) return {unit: 'USD', kind: 'money', len: m[0].length};
	if (/^(?:euros?|eur)$/.test(lw)) return {unit: 'EUR', kind: 'money', len: m[0].length};
	if (/^(?:pounds|gbp)$/.test(lw)) return {unit: 'GBP', kind: 'money', len: m[0].length};
	if (lw === 'ether') return {unit: 'ETH', kind: 'crypto', len: m[0].length};
	if (/^bitcoins?$/.test(lw)) return {unit: 'BTC', kind: 'crypto', len: m[0].length};
	if (/^(?:tokens?|coins?)$/.test(lw)) return {unit: 'TOKEN', kind: 'crypto', len: m[0].length};
	const t = w.replace(/^\$/, '');
	if (TICKERS.has(t.toUpperCase()) && (t === t.toUpperCase() || /^[a-z]{1,3}[A-Z]{2,6}$/.test(t) || w.startsWith('$'))) return {unit: t.toUpperCase(), kind: 'crypto', len: m[0].length};
	return {len: 0};
};

const CURRENCY: Record<string, string> = {'$': 'USD', 'us$': 'USD', usd: 'USD', '€': 'EUR', eur: 'EUR', '£': 'GBP', gbp: 'GBP'};

const NUM_RE =
	/(?<![\p{L}\p{N}_.,])(?<cur>US\$|USD\s?|\$|€|£|EUR\s?|GBP\s?)?(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(?<scale>thousand|million|billion|trillion|mln|mn|bn|tn|k|m|b|t)(?![\p{L}\p{N}]))?(?:\s?(?<pct>%|percent\b|per cent\b))?/giu;

type ExtractOpts = {words?: 'none' | 'display' | 'spoken'};

/** Every number in a text: dates, times, digits (with currency, scale, percent, unit) and, optionally, number words. */
export const extractNumbers = (text: string, opts: ExtractOpts = {}): Num[] => {
	const words = opts.words ?? 'display';
	const src = normalizePunct(text);
	const work = {s: src};
	const out: Num[] = [];
	mask(work, /0x[0-9a-fA-F]+/g); // addresses and hashes are not numbers (R5 bans them separately)
	mask(work, /\b\d+(?:\.\d+)?\s?\/\s?10\b|\b\d+(?:\.\d+)?\s+out of\s+10\b|\b24\/7\b/gi); // editorial ratings (Rekt Meter) and 24/7
	mask(work, /(?:^|\n)\s*\d{1,2}[.)](?=\s)/g); // list markers ("1. Verify the address")

	const pushDate = (m: RegExpMatchArray, year: string | undefined, month: string, day: string | undefined) => {
		const mo = MONTHS[month.toLowerCase().replace(/\.$/, '')];
		const d = day ? Number(day) : undefined;
		const y = year ? Number(year) : undefined;
		if (!mo || (d !== undefined && (d < 1 || d > 31))) return;
		const i = m.index ?? 0;
		out.push({kind: 'date', value: mo * 100 + (d ?? 0), raw: m[0], start: i, end: i + m[0].length, month: mo, day: d, year: y});
	};
	for (const m of mask(work, /\b(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.]+Z?)?\b/g)) {
		const mo = Number(m[2]);
		const d = Number(m[3]);
		if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
			const i = m.index ?? 0;
			out.push({kind: 'date', value: mo * 100 + d, raw: m[0], start: i, end: i + m[0].length, month: mo, day: d, year: Number(m[1])});
		}
	}
	const monthOk = (tok: string) => tok !== tok.toLowerCase(); // "may 5" (verb) is not a date; "May 5" / "MAY 5" are
	for (const m of mask(work, new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, 'gi')))
		if (monthOk(m[1])) pushDate(m, m[3], m[1], m[2]);
	for (const m of mask(work, new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, 'gi')))
		if (monthOk(m[2])) pushDate(m, m[3], m[2], m[1]);
	for (const m of mask(work, new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{4})\\b`, 'gi'))) if (monthOk(m[1])) pushDate(m, m[2], m[1], undefined);
	for (const m of mask(work, /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s?([ap])\.?m\.?)?/gi)) {
		let h = Number(m[1]);
		if (m[3]?.toLowerCase() === 'p' && h < 12) h += 12;
		if (m[3]?.toLowerCase() === 'a' && h === 12) h = 0;
		const i = m.index ?? 0;
		out.push({kind: 'time', value: h * 60 + Number(m[2]), raw: m[0], start: i, end: i + m[0].length});
	}

	const digitNums: Array<Num & {scaleMult: number}> = [];
	for (const m of work.s.matchAll(NUM_RE)) {
		const g = m.groups ?? {};
		const start = m.index ?? 0;
		if (/\p{L}-$/u.test(work.s.slice(Math.max(0, start - 2), start))) continue; // ERC-20, EIP-7702, COVID-19
		const numStr = g.num ?? '';
		const scaleKey = g.scale?.toLowerCase();
		const scaleMult = scaleKey ? SCALE[scaleKey] : 1;
		const value = parseFloat(numStr.replace(/,/g, '')) * scaleMult;
		let end = start + m[0].length;
		const cur = g.cur ? CURRENCY[g.cur.trim().toLowerCase()] : undefined;
		const pct = !!g.pct;
		let kind: NumKind = 'plain';
		let unit = cur;
		if (pct) kind = 'percent';
		else if (cur) kind = 'money';
		if (!pct) {
			const u = unitAfter(work.s, end);
			if (u.kind && !(cur && u.kind === 'crypto')) {
				kind = u.kind;
				unit = u.unit;
				end += u.len;
			}
		}
		if (kind === 'plain' && !scaleKey && !numStr.includes(',') && !numStr.includes('.') && value >= 1990 && value <= 2100) kind = 'year';
		const n: Num & {scaleMult: number} = {kind, value, raw: src.slice(start, end).trim(), start, end, unit, sig: sigDigits(numStr), scaleMult};
		if (kind === 'year') n.year = value;
		n.qualifier = qualifierBefore(work.s, start);
		digitNums.push(n);
	}
	// ranges: "$4-5M", "4 to 5 million": the scale (and currency) of the second end applies to the first
	for (let i = 0; i + 1 < digitNums.length; i++) {
		const a = digitNums[i];
		const b = digitNums[i + 1];
		if (!/^\s*(?:-|to)\s*$/i.test(work.s.slice(a.end, b.start))) continue;
		if (a.scaleMult === 1 && b.scaleMult > 1 && a.value < 1000) {
			a.value *= b.scaleMult;
			if (a.kind === 'year' || a.kind === 'plain') a.kind = b.kind === 'year' ? 'plain' : b.kind;
			a.unit = a.unit ?? b.unit;
		}
		if (a.kind === 'money' && b.kind === 'plain') {
			b.kind = 'money';
			b.unit = a.unit;
		}
	}
	for (const n of digitNums) {
		const {scaleMult: _s, ...rest} = n;
		void _s;
		out.push(rest);
	}
	if (words !== 'none') {
		const masked = {s: work.s};
		for (const n of digitNums) masked.s = masked.s.slice(0, n.start) + ' '.repeat(n.end - n.start) + masked.s.slice(n.end);
		out.push(...wordNumbers(masked.s, words));
	}
	return out.sort((a, b) => a.start - b.start);
};

type WTok = {w: string; start: number; end: number};

/** Number words: "one point five billion dollars", "fourteen hundred", "twenty twenty-six", "October second". */
export const wordNumbers = (s: string, mode: 'display' | 'spoken'): Num[] => {
	const toks: WTok[] = [...s.matchAll(/[A-Za-z]+/g)].map((m) => ({w: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length}));
	const n = toks.length;
	const adjacent = (a: number, b: number) => b < n && /^[\s-]*$/.test(s.slice(toks[a].end, toks[b].start));
	const out: Num[] = [];
	let i = 0;
	while (i < n) {
		let j = i;
		let total = 0;
		let current = 0;
		let any = false;
		let last: 'none' | 'unit' | 'teen' | 'tens' | 'hundred' | 'scale' | 'point' | 'half' = 'none';
		let ordinal = false;
		const w0 = toks[i].w;
		if ((w0 === 'a' || w0 === 'an') && adjacent(i, i + 1) && (MULT[toks[i + 1].w] || toks[i + 1].w === 'hundred')) {
			current = 1;
			any = true;
			last = 'unit';
			j = i + 1;
		} else if (w0 === 'half' && adjacent(i, i + 1) && toks[i + 1].w === 'a' && adjacent(i + 1, i + 2) && MULT[toks[i + 2].w]) {
			current = 0.5;
			any = true;
			last = 'half';
			j = i + 2;
		}
		while (j < n) {
			if (j > i && !adjacent(j - 1, j)) break;
			const w = toks[j].w;
			if (SMALL[w] !== undefined) {
				const v = SMALL[w];
				if (last === 'unit' || last === 'teen' || last === 'point' || last === 'half') break;
				if (last === 'tens' && v >= 10) break;
				if (last === 'tens' && v === 0) break;
				current += v;
				last = v >= 10 ? 'teen' : 'unit';
			} else if (ORD[w] !== undefined) {
				const v = ORD[w];
				if (last === 'unit' || last === 'teen' || last === 'point' || last === 'half') break;
				if (last === 'tens' && v >= 10) break;
				if (mode === 'display' && !any && (w === 'first' || w === 'second')) break; // too common to be a claim
				current += v;
				ordinal = true;
				any = true;
				j++;
				break;
			} else if (TENS[w] !== undefined) {
				if (last === 'unit' || last === 'teen' || last === 'tens' || last === 'point' || last === 'half') break;
				current += TENS[w];
				last = 'tens';
			} else if (w === 'hundred') {
				if (!any || last === 'hundred' || last === 'point') break;
				current = (current || 1) * 100;
				last = 'hundred';
			} else if (MULT[w]) {
				if (!any) break;
				total += (current || 1) * MULT[w];
				current = 0;
				last = 'scale';
			} else if (w === 'point' && any && (last === 'unit' || last === 'teen' || last === 'tens') && adjacent(j, j + 1) && DIGIT_WORD[toks[j + 1].w] !== undefined) {
				let digits = '';
				let k = j + 1;
				while (k < n && adjacent(k - 1, k) && DIGIT_WORD[toks[k].w] !== undefined) {
					digits += String(DIGIT_WORD[toks[k].w]);
					k++;
				}
				current += parseFloat(`0.${digits}`);
				last = 'point';
				j = k;
				continue;
			} else if (w === 'and' && any) {
				if (adjacent(j, j + 1) && toks[j + 1].w === 'a' && adjacent(j + 1, j + 2) && toks[j + 2].w === 'half' && last !== 'half') {
					current += 0.5;
					last = 'half';
					j += 3;
					continue;
				}
				if ((last === 'hundred' || last === 'scale') && adjacent(j, j + 1) && (SMALL[toks[j + 1].w] !== undefined || TENS[toks[j + 1].w] !== undefined)) {
					j++;
					continue;
				}
				break;
			} else break;
			any = true;
			j++;
		}
		if (!any || j === i) {
			i++;
			continue;
		}
		const value = total + current;
		const first = toks[i];
		const lastTok = toks[j - 1];
		const lone = j - i === 1;
		if (mode === 'display' && lone && (first.w === 'one' || first.w === 'zero')) {
			i = j;
			continue;
		}
		let kind: NumKind = 'plain';
		let unit: string | undefined;
		let end = lastTok.end;
		const next = toks[j];
		if (next && adjacent(j - 1, j)) {
			if (next.w === 'percent') {
				kind = 'percent';
				end = next.end;
			} else if (next.w === 'per' && toks[j + 1]?.w === 'cent' && adjacent(j, j + 1)) {
				kind = 'percent';
				end = toks[j + 1].end;
			} else if (next.w === 'dollars' || next.w === 'dollar') {
				kind = 'money';
				unit = 'USD';
				end = next.end;
			} else if (next.w === 'euros') {
				kind = 'money';
				unit = 'EUR';
				end = next.end;
			} else if (next.w === 'ether') {
				kind = 'crypto';
				unit = 'ETH';
				end = next.end;
			} else if (next.w === 'bitcoin' || next.w === 'bitcoins') {
				kind = 'crypto';
				unit = 'BTC';
				end = next.end;
			}
		}
		const num: Num = {kind, value, raw: s.slice(first.start, end), start: first.start, end, unit, words: true, qualifier: qualifierBefore(s, first.start)};
		// "October second", "the second of October"
		const prev = i > 0 ? toks[i - 1] : undefined;
		const prevMonth = prev && MONTHS[prev.w] && /^\s+(?:the\s+)?$/i.test(s.slice(prev.end, first.start)) ? MONTHS[prev.w] : undefined;
		const ofMonth = /^\s+of\s+([A-Za-z]+)/.exec(s.slice(end));
		const nextMonth = ofMonth && MONTHS[ofMonth[1].toLowerCase()] ? MONTHS[ofMonth[1].toLowerCase()] : undefined;
		if (kind === 'plain' && Number.isInteger(value) && value >= 1 && value <= 31 && (prevMonth || nextMonth)) {
			const mo = (prevMonth ?? nextMonth) as number;
			num.kind = 'date';
			num.month = mo;
			num.day = value;
			num.value = mo * 100 + value;
			if (prevMonth && prev) num.start = prev.start;
		} else if (ordinal && kind === 'plain') {
			num.kind = 'plain';
		}
		out.push(num);
		i = j;
	}
	// year style: "twenty twenty-six", "nineteen ninety-nine"
	const merged: Num[] = [];
	for (const x of out) {
		const prev = merged[merged.length - 1];
		if (
			prev &&
			prev.kind === 'plain' &&
			(prev.value === 19 || prev.value === 20) &&
			x.kind === 'plain' &&
			Number.isInteger(x.value) &&
			x.value >= 10 &&
			x.value <= 99 &&
			/^\s+$/.test(s.slice(prev.end, x.start))
		) {
			const y = prev.value * 100 + x.value;
			merged[merged.length - 1] = {kind: 'year', value: y, year: y, raw: s.slice(prev.start, x.end), start: prev.start, end: x.end, words: true};
			continue;
		}
		merged.push(x);
	}
	for (const x of merged) if (x.kind === 'plain' && Number.isInteger(x.value) && x.value >= 1990 && x.value <= 2100 && x.words && /thousand/i.test(x.raw)) {
		x.kind = 'year';
		x.year = x.value;
	}
	return merged;
};

const relEq = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1);

const compatible = (c: Num, e: Num): boolean => {
	if (c.kind === 'date' || c.kind === 'time' || e.kind === 'date' || e.kind === 'time') return false;
	if ((c.kind === 'percent') !== (e.kind === 'percent')) return false;
	if (c.unit && e.unit) {
		const money = (n: Num) => n.kind === 'money';
		if (money(c) !== money(e)) return false;
		if (c.unit !== e.unit && !(c.unit === 'TOKEN' || e.unit === 'TOKEN')) return false;
	}
	return true;
};

export type NumMatch = {ok: boolean; how: 'exact' | 'rounded' | 'date-meta' | 'none'; closest?: Num; droppedQualifier?: boolean};

/** Does claim number `c` appear in the evidence numbers? `metaDates` are source publish dates and incident dates. */
export const matchNum = (c: Num, pool: Num[], metaDates: DateParts[] = []): NumMatch => {
	if (c.kind === 'date') {
		const same = (d: DateParts) => d.month === c.month && (c.day === undefined || d.day === c.day) && (c.year === undefined || d.year === undefined || d.year === c.year);
		if (pool.some((e) => e.kind === 'date' && same(e))) return {ok: true, how: 'exact'};
		if (metaDates.some((d) => same(d))) return {ok: true, how: 'date-meta'};
		return {ok: false, how: 'none'};
	}
	if (c.kind === 'time') return pool.some((e) => e.kind === 'time' && e.value === c.value) ? {ok: true, how: 'exact'} : {ok: false, how: 'none'};
	if (c.kind === 'year') {
		if (pool.some((e) => (e.kind === 'year' || e.kind === 'plain') && relEq(e.value, c.value))) return {ok: true, how: 'exact'};
		if (pool.some((e) => e.kind === 'date' && e.year === c.value)) return {ok: true, how: 'exact'};
		if (metaDates.some((d) => d.year === c.value)) return {ok: true, how: 'date-meta'};
		return {ok: false, how: 'none'};
	}
	const cands = pool.filter((e) => compatible(c, e));
	const exact = cands.find((e) => relEq(e.value, c.value));
	if (exact) return {ok: true, how: 'exact', closest: exact, droppedQualifier: !!exact.qualifier && !c.qualifier};
	let closest: Num | undefined;
	let best = Infinity;
	for (const e of cands) {
		const d = Math.abs(e.value - c.value) / Math.max(Math.abs(e.value), 1e-9);
		if (d < best) {
			best = d;
			closest = e;
		}
	}
	if (closest && c.qualifier) {
		const e = closest.value;
		const v = c.value;
		const rounder = (c.sig ?? 1) <= (closest.sig ?? 99);
		let ok = false;
		if (c.qualifier === 'approx') ok = Math.abs(v - e) / Math.abs(e) <= 0.05 && rounder;
		else if (c.qualifier === 'over') ok = e >= v && (e - v) / Math.abs(e) <= 0.25;
		else if (c.qualifier === 'under') ok = e <= v && (v - e) / Math.abs(v) <= 0.25;
		else if (c.qualifier === 'nearly') ok = e <= v && (v - e) / Math.abs(v) <= 0.1;
		if (ok) return {ok: true, how: 'rounded', closest};
	}
	return {ok: false, how: 'none', closest};
};

/** Split dates that carry a year into a date and a year, so "October 2, 2026" equals "October second, twenty twenty-six". */
const comparable = (ns: Num[]): Num[] =>
	ns.flatMap((x) =>
		x.kind === 'date' && x.year !== undefined
			? [{...x, year: undefined}, {kind: 'year' as const, value: x.year, year: x.year, raw: String(x.year), start: x.start, end: x.end}]
			: [x],
	);

const sameForSpeech = (a: Num, b: Num): boolean => {
	if (a.kind === 'date' || b.kind === 'date') return a.kind === b.kind && a.month === b.month && a.day === b.day;
	if (a.kind === 'time' || b.kind === 'time') return a.kind === b.kind && a.value === b.value;
	if ((a.kind === 'percent') !== (b.kind === 'percent')) return false;
	return relEq(a.value, b.value);
};

/**
 * Compare the numbers shown with the numbers spoken (English only). Returns what is shown but not said and what is
 * said but not shown, so {$4.2M|four point five million dollars} is caught before the voice step reads it.
 */
export const speechMismatch = (display: string, spoken: string): {shownNotSaid: Num[]; saidNotShown: Num[]} => {
	const d = comparable(extractNumbers(display, {words: 'spoken'}));
	const s = comparable(extractNumbers(spoken, {words: 'spoken'}));
	const used = new Set<number>();
	const shownNotSaid: Num[] = [];
	for (const x of d) {
		const k = s.findIndex((y, idx) => !used.has(idx) && sameForSpeech(x, y));
		if (k < 0) shownNotSaid.push(x);
		else used.add(k);
	}
	const saidNotShown = s.filter((_, idx) => !used.has(idx));
	return {shownNotSaid, saidNotShown};
};

export const describeNum = (x: Num): string => x.raw.trim();

/** Parse an ISO date (or date-time) into parts; undefined when it is not one. */
export const isoDateParts = (s: string | undefined): DateParts | undefined => {
	if (!s) return undefined;
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
	if (!m) return undefined;
	return {year: Number(m[1]), month: Number(m[2]), day: Number(m[3])};
};
