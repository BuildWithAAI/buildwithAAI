/**
 * Figures in fact statements and source excerpts (pure). "$1.08B", "$1.08 billion" and "1,080,000,000 dollars" are one
 * value; "68.67%" never matches "$68.67"; "January 19, 2024" equals "19 Jan 2024" and "2024-01-19". A qualifier written
 * in front of a figure sets how an excerpt may support it: "about 850,000" accepts 850,180 (same value at the written
 * precision), "over $1 billion" accepts $1.08 billion, a bare "68.67%" needs exactly 68.67%.
 */
import {escapeRe, fold, plain, WORD} from './text.ts';

export type AtomKind = 'percent' | 'money' | 'amount' | 'plain' | 'year' | 'date' | 'time' | 'ratio';
export type Qualifier = 'approx' | 'over' | 'under' | 'nearly';

export type Atom = {
	kind: AtomKind;
	/** percent: 68.67 · money/amount/plain: the full value · year: 2024 · time: minutes after midnight · ratio: a / b. */
	value: number;
	/** money: USD | EUR | GBP · amount: an upper-case unit (ETH, SOL, TOKEN, SHARE...). */
	unit?: string;
	/** Significant digits as written ("850,000" -> 2, "1.08" -> 3): the precision an "about" figure claims. */
	sig: number;
	date?: {year?: number; month: number; day?: number};
	ratio?: [number, number];
	qualifier?: Qualifier;
	/** The qualifier words as written ("about", "more than"). */
	qualifierRaw?: string;
	raw: string;
	start: number;
	end: number;
};

const MONTHS: Record<string, number> = {
	january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
	august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_ALT = 'January|February|March|April|May|June|July|August|September|October|November|December|Sept|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
/** "may" and "march" are also verbs: a month name counts only when capitalised ("May 5") or all caps ("MAY 5"). */
const monthOk = (tok: string): boolean => tok !== tok.toLowerCase();

const SCALE_WORD: Record<string, number> = {thousand: 1e3, million: 1e6, mln: 1e6, mn: 1e6, billion: 1e9, bn: 1e9, trillion: 1e12, tn: 1e12};
const SCALE_LETTER: Record<string, number> = {k: 1e3, m: 1e6, b: 1e9, t: 1e12};

/** Upper-case words after a number that are NOT units ("10 AI agents", "4 SEC cases"). */
const NOT_UNITS = new Set(
	'AI LLM LLMS SEC CFTC DOJ FTC FBI FINRA NASAA NFA IRS DEX DEXS CEX CEXS NFT NFTS API APIS APR APY AUM ATH ICO ICOS KOL KOLS OTC ETF ETFS UTC GMT CET EST EDT CST CDT PST PDT AM PM CEO CTO COO CFO DAO DAOS US USA UK EU PDF URL TV PR VC VCS IPO OK ID IDS AND OR THE OF IN ON TO A AN AT BY FOR'.split(' '),
);
const MONEY_WORDS: Array<[RegExp, string]> = [
	[/^(?:us dollars|u\.s\. dollars|dollars?|usd)$/i, 'USD'],
	[/^(?:euros?|eur)$/i, 'EUR'],
	[/^(?:pounds|gbp)$/i, 'GBP'],
];
const UNIT_WORDS: Array<[RegExp, string]> = [
	[/^ether$/i, 'ETH'],
	[/^bitcoins?$/i, 'BTC'],
	[/^(?:tokens?|coins?)$/i, 'TOKEN'],
	[/^shares?$/i, 'SHARE'],
];

const QUALIFIERS: Array<[RegExp, Qualifier]> = [
	[/(?:\b(?:nearly|almost|close to|just under|just shy of)\s+(?:a\s+)?)$/i, 'nearly'],
	[/(?:\b(?:about|around|roughly|approximately|approx\.?|some|an estimated|estimated|circa)\s+(?:a\s+)?|~\s*)$/i, 'approx'],
	[/(?:\b(?:under|less than|below|fewer than|at most)\s+(?:a\s+)?)$/i, 'under'],
	[/(?:\b(?:over|more than|above|at least|upwards of|north of|in excess of|just over|past|passed|surpassed|surpassing|exceeded|exceeding|topped|beyond|crossed|crossing)\s+(?:a\s+)?(?:the\s+)?)$/i, 'over'],
];

export const qualifierBefore = (text: string, start: number): {q: Qualifier; raw: string} | undefined => {
	const before = text.slice(Math.max(0, start - 40), start);
	for (const [re, q] of QUALIFIERS) {
		const m = re.exec(before);
		if (m) return {q, raw: m[0].trim()};
	}
	return undefined;
};

export const sigDigits = (numStr: string): number => {
	const s = numStr.replace(/,/g, '');
	if (s.includes('.')) return Math.max(1, s.replace('.', '').replace(/^0+/, '').length);
	return Math.max(1, s.replace(/^0+/, '').replace(/0+$/, '').length);
};

/** Mask matches with spaces of equal length (offsets stay valid) and return them. */
const mask = (work: {s: string}, re: RegExp): RegExpExecArray[] => {
	const g = re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`);
	const found: RegExpExecArray[] = [];
	let m: RegExpExecArray | null;
	g.lastIndex = 0;
	while ((m = g.exec(work.s))) {
		found.push(m);
		if (m[0] === '') g.lastIndex++;
	}
	let out = work.s;
	for (const f of found) out = out.slice(0, f.index) + ' '.repeat(f[0].length) + out.slice(f.index + f[0].length);
	work.s = out;
	return found;
};

const unitAfter = (s: string, end: number): {unit: string; money: boolean; len: number} | null => {
	const m = /^\s?(US dollars|U\.S\. dollars|[A-Za-z][A-Za-z0-9]{0,11}|\$[A-Za-z][A-Za-z0-9]{0,11})(?![\p{L}\p{N}_])/u.exec(s.slice(end));
	if (!m) return null;
	const w = m[1];
	for (const [re, cur] of MONEY_WORDS) if (re.test(w)) return {unit: cur, money: true, len: m[0].length};
	for (const [re, unit] of UNIT_WORDS) if (re.test(w)) return {unit, money: false, len: m[0].length};
	const t = w.replace(/^\$/, '');
	// a ticker: all caps (ETH, LOBSTAR, AI16Z) or written with $ ($DRB); never a common acronym
	if ((t === t.toUpperCase() && /[A-Z]/.test(t) && t.length >= 2) || w.startsWith('$')) {
		const u = t.toUpperCase();
		if (!NOT_UNITS.has(u)) return {unit: u, money: false, len: m[0].length};
	}
	return null;
};

const NUM_RE =
	/(?<![\p{L}\p{N}_.,$€£])(?<cur>US\$|\$|€|£)?(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(?<scale>thousand|million|billion|trillion|mln|mn|bn|tn)(?![\p{L}])|(?<scl>[kKmMbBtT])(?![\p{L}\p{N}_]))?(?:\s?(?<pct>%|percent\b|per\s?cent\b))?/gu;

const CUR: Record<string, string> = {'$': 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP'};

/** Every figure in a text, in order: dates, times, ratios, percentages, money, amounts with units, years, plain numbers. */
export const extractAtoms = (text: string): Atom[] => {
	const src = plain(text);
	const work = {s: src};
	const out: Atom[] = [];
	// not figures: links, hex strings (addresses, hashes), "24/7"
	mask(work, /https?:\/\/\S+/g);
	mask(work, /0x[0-9a-fA-F]+/g);
	mask(work, /\b24\/7\b/g);

	const push = (a: Omit<Atom, 'qualifier' | 'qualifierRaw'>) => {
		const q = qualifierBefore(src, a.start);
		out.push(q ? {...a, qualifier: q.q, qualifierRaw: q.raw} : a);
	};
	const pushDate = (m: RegExpExecArray, year: string | undefined, month: string, day: string | undefined) => {
		const mo = MONTHS[month.toLowerCase().replace(/\.$/, '')];
		const d = day ? Number(day) : undefined;
		if (!mo || (d !== undefined && (d < 1 || d > 31))) return;
		const date = {month: mo, ...(d !== undefined ? {day: d} : {}), ...(year ? {year: Number(year)} : {})};
		push({kind: 'date', value: (year ? Number(year) * 10000 : 0) + mo * 100 + (d ?? 0), sig: 0, date, raw: m[0], start: m.index, end: m.index + m[0].length});
	};
	for (const m of mask(work, /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d])/g)) {
		const mo = Number(m[2]);
		const d = Number(m[3]);
		if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
			push({kind: 'date', value: Number(m[1]) * 10000 + mo * 100 + d, sig: 0, date: {year: Number(m[1]), month: mo, day: d}, raw: m[0], start: m.index, end: m.index + m[0].length});
	}
	for (const m of mask(work, new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, 'gi')))
		if (monthOk(m[1])) pushDate(m, m[3], m[1], m[2]);
	for (const m of mask(work, new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, 'gi')))
		if (monthOk(m[2])) pushDate(m, m[3], m[2], m[1]);
	for (const m of mask(work, new RegExp(`\\b(${MONTH_ALT})\\.?,?\\s+(?:of\\s+)?(\\d{4})\\b`, 'gi'))) if (monthOk(m[1])) pushDate(m, m[2], m[1], undefined);
	for (const m of mask(work, /(?<![\d:.,])(\d{1,2}):(\d{2})(?::\d{2})?(?![\d:])(\s?(?:a\.?m\.?|p\.?m\.?)(?![\p{L}]))?/giu)) {
		let h = Number(m[1]);
		const min = Number(m[2]);
		if (h > 23 || min > 59) continue;
		const ap = (m[3] ?? '').toLowerCase();
		if (ap.includes('p') && h < 12) h += 12;
		if (ap.includes('a') && h === 12) h = 0;
		push({kind: 'time', value: h * 60 + min, sig: 0, raw: m[0], start: m.index, end: m.index + m[0].length});
	}
	for (const m of mask(work, /(?<![\d:.,])(\d{1,4})\s?:\s?(\d{1,4})(?![\d:])/g)) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		if (b === 0) continue;
		push({kind: 'ratio', value: a / b, ratio: [a, b], sig: 0, raw: m[0], start: m.index, end: m.index + m[0].length});
	}

	type Raw = {m: RegExpExecArray; cur?: string; numStr: string; scale: number; pct: boolean; unit?: {unit: string; money: boolean; len: number}; ownUnitLen: number};
	const raws: Raw[] = [];
	NUM_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = NUM_RE.exec(work.s))) {
		const g = m.groups ?? {};
		const end = m.index + m[0].length;
		// a figure glued to letters is part of a name ("a16z", "16z", "x402")
		if (/[\p{L}\p{N}_]/u.test(work.s[end] ?? '') && !g.pct) continue;
		const scale = g.scale ? SCALE_WORD[g.scale.toLowerCase()] : g.scl ? SCALE_LETTER[g.scl.toLowerCase()] : 1;
		const pct = Boolean(g.pct);
		const unit = pct ? undefined : unitAfter(work.s, end) ?? undefined;
		raws.push({m, cur: g.cur, numStr: g.num, scale, pct, unit, ownUnitLen: unit?.len ?? 0});
	}
	// ranges share what only the second side spells out: "0.7-0.8%", "$2-3 million", "1.1B to 11B tokens"
	for (let i = 0; i + 1 < raws.length; i++) {
		const a = raws[i];
		const b = raws[i + 1];
		const between = work.s.slice(a.m.index + a.m[0].length, b.m.index);
		if (!/^\s?(?:-|to)\s?$/.test(between)) continue;
		if (b.pct && !a.pct && !a.cur && !a.unit) a.pct = true;
		if (b.scale !== 1 && a.scale === 1 && !a.pct && Number(a.numStr.replace(/,/g, '')) < Number(b.numStr.replace(/,/g, ''))) a.scale = b.scale;
		if (b.cur && !a.cur && !a.pct) a.cur = b.cur;
		if (b.unit && !a.unit && !a.pct && !a.cur) a.unit = b.unit;
	}
	for (const r of raws) {
		const n = Number(r.numStr.replace(/,/g, ''));
		if (!Number.isFinite(n)) continue;
		const value = n * r.scale;
		const sig = sigDigits(r.numStr);
		const end = r.m.index + r.m[0].length + r.ownUnitLen;
		const raw = src.slice(r.m.index, end).trim();
		const base = {sig, raw, start: r.m.index, end};
		if (r.pct) push({kind: 'percent', value: n, ...base});
		else if (r.cur) push({kind: 'money', value, unit: CUR[r.cur] ?? 'USD', ...base});
		else if (r.unit?.money) push({kind: 'money', value, unit: r.unit.unit, ...base});
		else if (r.unit) push({kind: 'amount', value, unit: r.unit.unit, ...base});
		else if (r.scale === 1 && /^\d{4}$/.test(r.numStr) && n >= 1900 && n <= 2100) push({kind: 'year', value: n, ...base});
		else push({kind: 'plain', value, ...base});
	}
	return out.sort((x, y) => x.start - y.start);
};

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

export const roundSig = (x: number, sig: number): number => {
	if (x === 0 || !Number.isFinite(x)) return x;
	const d = Math.floor(Math.log10(Math.abs(x))) + 1;
	const f = 10 ** (sig - d);
	return Math.round(x * f) / f;
};

/** Whether two atoms can denote the same figure at all (a percentage is never money; ETH is never SOL). */
const compatible = (f: Atom, e: Atom): boolean => {
	if (f.kind === 'percent' || e.kind === 'percent') return f.kind === e.kind;
	if (f.kind === 'time' || e.kind === 'time') return f.kind === e.kind;
	if (f.kind === 'ratio' || e.kind === 'ratio') return f.kind === e.kind;
	if (f.kind === 'date') return e.kind === 'date';
	if (f.kind === 'year') return e.kind === 'year' || e.kind === 'plain' || (e.kind === 'date' && e.date?.year !== undefined);
	if (e.kind === 'date' || e.kind === 'year') return false;
	// money, amount, plain: a figure without a unit is compatible with any unit; two explicit units must agree
	if (f.kind === 'money' && e.kind === 'amount') return false;
	if (f.kind === 'amount' && e.kind === 'money') return false;
	// "tokens" is any token: "52.4M tokens" and "52.4M LOBSTAR" are the same amount
	if (f.unit && e.unit) return f.unit === e.unit || (f.kind === 'amount' && (f.unit === 'TOKEN' || e.unit === 'TOKEN'));
	return true;
};

/** Same figure, ignoring qualifiers (used to tie statement figures to the numbers list). */
export const sameFigure = (a: Atom, b: Atom): boolean => {
	if (!compatible(a, b)) return false;
	if (a.kind === 'date' && b.kind === 'date') return a.date?.month === b.date?.month && a.date?.day === b.date?.day && a.date?.year === b.date?.year;
	if (a.kind === 'ratio') return a.ratio?.[0] === b.ratio?.[0] && a.ratio?.[1] === b.ratio?.[1];
	if (a.kind === 'year' && b.kind === 'date') return a.value === b.date?.year;
	return near(a.value, b.value);
};

/**
 * Does excerpt atom `e` support fact atom `f`, read with qualifier `q`? `others` are the excerpt's other atoms (a date
 * without a year is accepted when the excerpt names the fact's year elsewhere).
 */
export const supports = (f: Atom, e: Atom, q: Qualifier | undefined, others: Atom[] = []): boolean => {
	if (!compatible(f, e)) return false;
	if (f.kind === 'date') {
		const fd = f.date;
		const ed = e.date;
		if (!fd || !ed || fd.month !== ed.month) return false;
		if (fd.day !== undefined && fd.day !== ed.day) return false;
		if (fd.year === undefined || ed.year === fd.year) return true;
		// a date written without its year counts when the excerpt names that year elsewhere (often the article's dateline)
		return ed.year === undefined && others.some((o) => ((o.kind === 'year' || o.kind === 'plain') && o.value === fd.year) || (o.kind === 'date' && o.date?.year === fd.year));
	}
	if (f.kind === 'year') return e.kind === 'date' ? e.date?.year === f.value : near(e.value, f.value);
	if (f.kind === 'ratio') return f.ratio?.[0] === e.ratio?.[0] && f.ratio?.[1] === e.ratio?.[1];
	if (f.kind === 'time') return f.value === e.value;
	const v = f.value;
	const x = e.value;
	switch (q) {
		case 'approx': {
			// within half a unit of the last written digit, inclusive: "about 15%" accepts 15.5%, "about $100,000" accepts $106,200
			const unit = 10 ** (Math.floor(Math.log10(Math.abs(v) || 1)) + 1 - Math.max(1, f.sig));
			return near(x, v) || near(roundSig(x, f.sig), v) || Math.abs(x - v) <= unit / 2 + 1e-9 * Math.max(1, Math.abs(v));
		}
		case 'over':
			return x > v || near(x, v);
		case 'under':
			return x < v || near(x, v);
		case 'nearly':
			return (x < v || near(x, v)) && x >= v * 0.8;
		default:
			return near(x, v);
	}
};

/** Spans of an entity (any alias) in a text, on the same-length plain() form. */
export const entitySpans = (text: string, entity: string): Array<[number, number]> => {
	const p = plain(text);
	const out: Array<[number, number]> = [];
	for (const alias of entityAliases(entity)) {
		const re = new RegExp(`(?<![${WORD}])${escapeRe(plain(alias)).replace(/\s+/g, '\\s+')}(?![${WORD}])`, 'giu');
		for (const m of p.matchAll(re)) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
	}
	return out;
};

export const entityAliases = (entity: string): string[] =>
	entity
		.split('|')
		.map((s) => s.trim())
		.filter(Boolean);

/** Is the entity (any alias) named in the text? Case-insensitive, word-bounded, typography-tolerant. */
export const hasEntity = (text: string, entity: string): boolean => {
	const t = fold(text);
	return entityAliases(entity).some((alias) => new RegExp(`(?<![${WORD}])${escapeRe(fold(alias)).replace(/\s+/g, '\\s+')}(?![${WORD}])`, 'iu').test(t));
};

/** The figures of one numbers[] entry, with the qualifier the statement gives it when the entry has none. */
export const entryAtoms = (entry: string, statement?: string): Atom[] => {
	const atoms = extractAtoms(entry);
	if (!statement) return atoms;
	const st = extractAtoms(statement);
	return atoms.map((a) => {
		if (a.qualifier) return a;
		const twin = st.find((s) => sameFigure(s, a) && s.qualifier);
		return twin ? {...a, qualifier: twin.qualifier, qualifierRaw: twin.qualifierRaw} : a;
	});
};

/**
 * Does the text (an excerpt) contain the numbers[] entry? Every figure of the entry must be supported by a figure of the
 * text; an entry without digits ("half") must appear literally.
 */
/** The entry written literally in the text, not inside a longer figure ("5%" is not in "45%"). */
export const literalIn = (text: string, entry: string): boolean => {
	const e = fold(entry).replace(/^(?:about|around|roughly|approximately|nearly|almost|over|more than|under|less than|fewer than|some|~)\s*/, '');
	if (!e) return false;
	return new RegExp(`(?<![${WORD}.,$€£])${escapeRe(e)}(?![${WORD}])`, 'iu').test(fold(text));
};

export const textHasNumber = (text: string, entry: string, statement?: string): boolean => {
	const fa = entryAtoms(entry, statement);
	if (!fa.length) return literalIn(text, entry);
	const ea = extractAtoms(text);
	return fa.every((f) => ea.some((e) => supports(f, e, f.qualifier, ea)));
};

/** Is the numbers[] entry written in the statement (same figures, qualifiers ignored)? */
export const statementHasNumber = (statement: string, entry: string): boolean => {
	const fa = extractAtoms(entry);
	if (!fa.length) return literalIn(statement, entry);
	const sa = extractAtoms(statement);
	return fa.every((f) => sa.some((s) => sameFigure(f, s)));
};

/**
 * Figures in the statement that no numbers[] entry lists and that are not part of a named entity ("GPT-5",
 * "Claude Opus 4.5", "arXiv 2503.16248" are names, not figures, when listed in entities).
 */
export const unlistedFigures = (statement: string, numbers: string[], entities: string[]): Atom[] => {
	const spans = entities.flatMap((e) => entitySpans(statement, e));
	const listed = numbers.flatMap((n) => extractAtoms(n));
	return extractAtoms(statement).filter((a) => !spans.some(([s, e]) => a.start >= s && a.end <= e) && !listed.some((l) => sameFigure(a, l)));
};

/** Suggested numbers[] for a statement: every figure outside the entities, with its qualifier ("about 850,000"). */
export const suggestNumbers = (statement: string, entities: string[] = []): string[] => {
	const spans = entities.flatMap((e) => entitySpans(statement, e));
	const out: string[] = [];
	for (const a of extractAtoms(statement)) {
		if (spans.some(([s, e]) => a.start >= s && a.end <= e)) continue;
		const t = a.qualifierRaw ? `${a.qualifierRaw.toLowerCase()} ${a.raw}` : a.raw;
		if (!out.includes(t)) out.push(t);
	}
	return out;
};

/**
 * Digit runs of a text, for the loose check that a translation kept the statement's figures. Separators and trailing
 * zeros are dropped, so "$2.5 billion" and "2.500 millones" both give "25", and "18.67" and "18,67" both give "1867".
 */
export const digitRuns = (text: string): string[] =>
	[...plain(text).matchAll(/\d+(?:[.,  ]\d{3})*(?:[.,]\d+)?/g)]
		.map((m) => m[0].replace(/[.,  ]/g, '').replace(/0+$/, ''))
		.filter((d) => d.replace(/^0+/, '').length > 0);
