/**
 * Numbers in English, Spanish and Brazilian Portuguese (pure).
 *
 * "$4.2M", "4.2 million dollars", "four point two million dollars", "4,2 millones de dólares" and "US$ 4,2 milhões"
 * are all {money, 4200000, USD}. Units are kept apart (a percentage never matches a dollar amount; "10 minutes" never
 * matches "10 hours"), and so are qualifiers: "more than", "about", "less than" change what a number claims.
 *
 * Traps this module exists for:
 *  - Spanish "billón" is 10^12; English "billion" is "mil millones". Portuguese (Brazil) "bilhão" is 10^9.
 *  - Spanish and Portuguese "mil" is a thousand: "$4,2 mil" is $4,200, not $4.2M.
 *  - Digit grouping: "1,500" is 1.5 to a reader in Brazil or Spain; "1.500" is fifteen hundred. English-style digits
 *    left in a translation are reported (format 'en'); when only that reading matches the source, it is a real risk.
 *  - "$" alone in Spanish is the peso sign in much of Latin America ("US$" or "dólares" is unambiguous).
 */
import {clean} from './text.ts';

export type NumLang = 'en' | 'es' | 'pt-br';
export type NumKind = 'money' | 'percent' | 'crypto' | 'count' | 'duration' | 'multiplier' | 'year' | 'date' | 'time' | 'fraction' | 'magnitude' | 'ordinal';
/** exact, approx ("about"), nearly ("almost"), min ("more than", "at least"), max ("less than", "within", "up to"). */
export type Qual = 'exact' | 'approx' | 'nearly' | 'min' | 'max';

export type Num = {
	kind: NumKind;
	/** money: currency units; duration: seconds; percent: the percent figure; date: month*100+day (year separate); time: minutes. */
	value: number;
	/** Another reading of an ambiguous digit string (e.g. Spanish "1,500": 1.5 by the locale, 1500 by English habit). */
	alt?: number;
	unit?: string;
	year?: number;
	qual: Qual;
	raw: string;
	start: number;
	end: number;
	/** "one", "a single", "un solo": often just an article; a missing match is harmless. */
	soft?: boolean;
	/** Digit style in a Spanish or Portuguese text: 'en' = English grouping or decimal point. */
	format?: 'locale' | 'en' | 'ambiguous';
	/** Spanish/Portuguese "$" with no US/USD/dólares: peso or dollar? */
	bareDollar?: boolean;
	/** Durations: seconds in the unit the text used ("24 hours" -> 3600), for the report. */
	per?: number;
	/** Parsed from number words ("ten thousand"), not digits. */
	words?: boolean;
};

// ---------------------------------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------------------------------

type Vocab = {
	small: Record<string, number>;
	tens: Record<string, number>;
	hundreds: Record<string, number>; // already multiplied: "doscientos" = 200, "hundred" handled separately in English
	thousand: string[]; // multiplies the current group ("mil", "thousand")
	scales: Record<string, number>; // flush the group ("million", "millones", "milhões")
	and: string[]; // connectors inside a number ("and", "y", "e")
	point: string[]; // decimal separators in words
	half: string[]; // "half", "medio", "meio"
	articles: string[]; // "a", "un", "um": 1 only before a scale, unit or "single"
	single: string[]; // "single", "solo", "único": makes the article mean exactly one
	vague: Record<string, number>; // "thousands", "miles", "milhares"
};

const EN: Vocab = {
	small: {zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19},
	tens: {twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90},
	hundreds: {},
	thousand: ['thousand'],
	scales: {million: 1e6, billion: 1e9, trillion: 1e12},
	and: ['and'],
	point: ['point'],
	half: ['half'],
	articles: ['a', 'an'],
	single: ['single'],
	vague: {dozens: 12, hundreds: 100, thousands: 1e3, millions: 1e6, billions: 1e9, trillions: 1e12},
};

const ES: Vocab = {
	small: {
		cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
		trece: 13, catorce: 14, quince: 15, dieciséis: 16, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
		veintiuno: 21, veintiún: 21, veintiuna: 21, veintidós: 22, veintidos: 22, veintitrés: 23, veintitres: 23, veinticuatro: 24,
		veinticinco: 25, veintiséis: 26, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
	},
	tens: {treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90},
	hundreds: {
		cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
		quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800,
		ochocientas: 800, novecientos: 900, novecientas: 900,
	},
	thousand: ['mil'],
	scales: {millón: 1e6, millon: 1e6, millones: 1e6, millardo: 1e9, millardos: 1e9, billón: 1e12, billon: 1e12, billones: 1e12, trillón: 1e18, trillones: 1e18},
	and: ['y'],
	point: ['coma', 'punto'],
	half: ['medio', 'media'],
	articles: ['un', 'una', 'uno'],
	single: ['solo', 'sola', 'único', 'única', 'unico', 'unica'],
	vague: {docenas: 12, decenas: 10, cientos: 100, centenares: 100, miles: 1e3, millones: 1e6},
};

const PT: Vocab = {
	small: {
		zero: 0, um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11,
		doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17, dezassete: 17, dezoito: 18,
		dezenove: 19, dezanove: 19,
	},
	tens: {vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cinqüenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90},
	hundreds: {
		cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
		quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800,
		oitocentas: 800, novecentos: 900, novecentas: 900,
	},
	thousand: ['mil'],
	scales: {milhão: 1e6, milhao: 1e6, milhões: 1e6, milhoes: 1e6, bilhão: 1e9, bilhao: 1e9, bilhões: 1e9, bilhoes: 1e9, trilhão: 1e12, trilhao: 1e12, trilhões: 1e12, trilhoes: 1e12},
	and: ['e'],
	point: ['vírgula', 'virgula', 'ponto'],
	half: ['meio', 'meia'],
	articles: ['um', 'uma'],
	single: ['só', 'único', 'única', 'unico', 'unica'],
	vague: {dúzias: 12, duzias: 12, dezenas: 10, centenas: 100, milhares: 1e3, milhões: 1e6},
};

const VOCAB: Record<NumLang, Vocab> = {en: EN, es: ES, 'pt-br': PT};

/** Time units -> seconds, per language (singular and plural). */
const TIME_UNITS: Record<NumLang, Record<string, number>> = {
	en: {second: 1, seconds: 1, sec: 1, secs: 1, minute: 60, minutes: 60, min: 60, mins: 60, hour: 3600, hours: 3600, hr: 3600, hrs: 3600, day: 86400, days: 86400, week: 604800, weeks: 604800, month: 2592000, months: 2592000, year: 31536000, years: 31536000},
	es: {segundo: 1, segundos: 1, minuto: 60, minutos: 60, hora: 3600, horas: 3600, día: 86400, días: 86400, dia: 86400, dias: 86400, semana: 604800, semanas: 604800, mes: 2592000, meses: 2592000, año: 31536000, años: 31536000},
	'pt-br': {segundo: 1, segundos: 1, minuto: 60, minutos: 60, hora: 3600, horas: 3600, dia: 86400, dias: 86400, semana: 604800, semanas: 604800, mês: 2592000, mes: 2592000, meses: 2592000, ano: 31536000, anos: 31536000},
};

const MONTHS: Record<NumLang, Record<string, number>> = {
	en: {january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12},
	es: {enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12, ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12},
	'pt-br': {janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12, jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12},
};

/** Ordinal words, and the nouns they number: "the second day" = "day two" = "el segundo día" = "o dia dois". */
const ORD_WORDS: Record<NumLang, Record<string, number>> = {
	en: {first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10},
	es: {primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercer: 3, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6, séptimo: 7, séptima: 7, septimo: 7, octavo: 8, octava: 8, noveno: 9, novena: 9, décimo: 10, décima: 10, decimo: 10},
	'pt-br': {primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6, sétimo: 7, sétima: 7, setimo: 7, oitavo: 8, oitava: 8, nono: 9, nona: 9, décimo: 10, décima: 10, decimo: 10},
};
const SEQ_NOUNS: Record<NumLang, Record<string, string>> = {
	en: {day: 'day', week: 'week', month: 'month', year: 'year', round: 'round', phase: 'phase', step: 'step', part: 'part', season: 'season', episode: 'episode', chapter: 'chapter', level: 'level', quarter: 'quarter'},
	es: {día: 'day', dia: 'day', semana: 'week', mes: 'month', año: 'year', ronda: 'round', fase: 'phase', paso: 'step', parte: 'part', temporada: 'season', episodio: 'episode', capítulo: 'chapter', capitulo: 'chapter', nivel: 'level', trimestre: 'quarter'},
	'pt-br': {dia: 'day', semana: 'week', mês: 'month', mes: 'month', ano: 'year', rodada: 'round', fase: 'phase', passo: 'step', parte: 'part', temporada: 'season', episódio: 'episode', episodio: 'episode', capítulo: 'chapter', capitulo: 'chapter', nível: 'level', nivel: 'level', trimestre: 'quarter'},
};

/** Tickers that make "0.25 SOL" a crypto amount (upper case in the text). */
const TICKERS = new Set(
	'BTC ETH SOL BNB XRP ADA DOGE TRX TON SUI APT ARB OP MATIC POL AVAX DOT LINK UNI AAVE LDO USDC USDT DAI USDE PYUSD FDUSD TUSD BUSD WETH WBTC STETH JUP RAY BONK WIF HYPE LTC BCH XMR ZEC XLM ALGO HBAR NEAR ATOM FTM TAO RUNE CRV MKR ENA'.split(' '),
);

/** Qualifier phrases that END right before a number. */
const QUAL_BEFORE: Record<NumLang, Array<[RegExp, Qual]>> = {
	en: [
		[/\b(?:nearly|almost|close to|just under|just shy of)\s+(?:an?\s+)?$/i, 'nearly'],
		[/(?:\b(?:about|around|roughly|approximately|approx\.?|some|an estimated|estimated)\s+(?:an?\s+)?|~\s*)$/i, 'approx'],
		[/\b(?:more than|over|above|at least|upwards of|in excess of|north of|just over|no fewer than|no less than)\s+(?:an?\s+)?$/i, 'min'],
		[/\b(?:less than|fewer than|under|below|within|up to|at most|no more than|inside|in under|only|just|merely|a mere)\s+(?:an?\s+|the\s+)?$/i, 'max'],
	],
	es: [
		[/\b(?:casi|poco menos del?)\s+(?:el\s+|la\s+|los\s+|las\s+)?$/i, 'nearly'],
		[/(?:\b(?:unos|unas|cerca del?|alrededor del?|aproximadamente|aprox\.?|en torno al?|del orden del?)\s+(?:el\s+|la\s+|los\s+|las\s+)?|~\s*)$/i, 'approx'],
		[/\b(?:más del?|mas del?|al menos|por lo menos|como mínimo|como minimo|poco más del?|por encima del?)\s+(?:el\s+|la\s+|los\s+|las\s+)?$/i, 'min'],
		[/\b(?:menos del?|hasta|como máximo|como maximo|dentro de|en menos de|no más del?|no mas del?|por debajo del?|solo|sólo|solamente|apenas|tan solo)\s+(?:el\s+|la\s+|los\s+|las\s+)?$/i, 'max'],
	],
	'pt-br': [
		[/\b(?:quase|pouco menos d[eoa]s?)\s+(?:o\s+|a\s+|os\s+|as\s+)?$/i, 'nearly'],
		[/(?:\b(?:uns|umas|cerca d[eoa]s?|aproximadamente|aprox\.?|em torno d[eoa]s?|por volta d[eoa]s?)\s+(?:o\s+|a\s+|os\s+|as\s+)?|~\s*)$/i, 'approx'],
		[/\b(?:mais d[eoa]s?|pelo menos|no mínimo|no minimo|pouco mais d[eoa]s?|acima d[eoa]s?)\s+(?:o\s+|a\s+|os\s+|as\s+)?$/i, 'min'],
		[/\b(?:menos d[eoa]s?|até|ate|no máximo|no maximo|dentro de|em menos de|não mais que|nao mais que|abaixo d[eoa]s?|só|somente|apenas)\s+(?:o\s+|a\s+|os\s+|as\s+)?$/i, 'max'],
	],
};
const QUAL_AFTER: Record<NumLang, Array<[RegExp, Qual]>> = {
	en: [[/^\s*(?:or so|give or take)\b/i, 'approx'], [/^\s*(?:or more|plus)\b/i, 'min'], [/^\s*(?:or less|or fewer|at most)\b/i, 'max']],
	es: [[/^\s*(?:o así|aproximadamente)\b/i, 'approx'], [/^\s*(?:o más|o mas)\b/i, 'min'], [/^\s*(?:o menos)\b/i, 'max']],
	'pt-br': [[/^\s*(?:ou algo assim|aproximadamente)\b/i, 'approx'], [/^\s*(?:ou mais)\b/i, 'min'], [/^\s*(?:ou menos)\b/i, 'max']],
};

const qualifierAt = (text: string, start: number, end: number, lang: NumLang): Qual => {
	const before = text.slice(Math.max(0, start - 40), start);
	for (const [re, q] of QUAL_BEFORE[lang]) if (re.test(before)) return q;
	const after = text.slice(end, end + 24);
	for (const [re, q] of QUAL_AFTER[lang]) if (re.test(after)) return q;
	return 'exact';
};

// ---------------------------------------------------------------------------------------------------------------------
// Units after a number
// ---------------------------------------------------------------------------------------------------------------------

type UnitHit = {kind: NumKind; unit?: string; mult?: number; len: number; bareDollar?: boolean};

const MONEY_WORDS: Record<NumLang, Array<[RegExp, string]>> = {
	en: [[/^\s*(?:us dollars?|dollars?|usd|bucks)\b/i, 'USD'], [/^\s*(?:euros?|eur)\b/i, 'EUR'], [/^\s*(?:pounds?|gbp)\b/i, 'GBP'], [/^\s*(?:reais|brl)\b/i, 'BRL']],
	es: [[/^\s*(?:de\s+)?(?:dólares|dolares|dólar|dolar|usd)(?:\s+estadounidenses)?(?![\p{L}])/iu, 'USD'], [/^\s*(?:de\s+)?(?:euros?|eur)\b/i, 'EUR'], [/^\s*(?:de\s+)?(?:libras|gbp)\b/i, 'GBP'], [/^\s*(?:de\s+)?(?:reales|brl)\b/i, 'BRL']],
	'pt-br': [[/^\s*(?:de\s+)?(?:dólares|dolares|dólar|dolar|usd)(?![\p{L}])/iu, 'USD'], [/^\s*(?:de\s+)?(?:euros?|eur)\b/i, 'EUR'], [/^\s*(?:de\s+)?(?:libras|gbp)\b/i, 'GBP'], [/^\s*(?:de\s+)?(?:reais|brl)\b/i, 'BRL']],
};
const PERCENT_WORDS: Record<NumLang, RegExp> = {
	en: /^\s*(?:%|percent\b|per cent\b)/i,
	es: /^\s*(?:%|por ciento\b)/i,
	'pt-br': /^\s*(?:%|por cento\b)/i,
};
const PP_WORDS: Record<NumLang, RegExp> = {
	en: /^\s*percentage points?\b/i,
	es: /^\s*puntos porcentuales\b/i,
	'pt-br': /^\s*pontos percentuais\b/i,
};
const TIMES_WORDS: Record<NumLang, RegExp> = {en: /^\s*times\b/i, es: /^\s*veces\b/i, 'pt-br': /^\s*vezes\b/i};
const TOKEN_WORDS: Record<NumLang, RegExp> = {en: /^\s*(?:of\s+)?tokens?\b/i, es: /^\s*(?:de\s+)?tokens?\b/i, 'pt-br': /^\s*(?:de\s+)?tokens?\b/i};

const unitAfter = (text: string, end: number, lang: NumLang): UnitHit | null => {
	const rest = text.slice(end);
	if (PP_WORDS[lang].test(rest)) return {kind: 'percent', unit: 'pp', len: (PP_WORDS[lang].exec(rest) as RegExpExecArray)[0].length};
	const pct = PERCENT_WORDS[lang].exec(rest);
	if (pct) return {kind: 'percent', unit: '%', len: pct[0].length};
	for (const [re, unit] of MONEY_WORDS[lang]) {
		const m = re.exec(rest);
		if (m) return {kind: 'money', unit, len: m[0].length};
	}
	const tok = TOKEN_WORDS[lang].exec(rest);
	if (tok) return {kind: 'crypto', unit: 'TOKEN', len: tok[0].length};
	const tick = /^\s*(?:de\s+)?\$?([A-Z][A-Z0-9]{1,9})\b/.exec(rest);
	if (tick && TICKERS.has(tick[1])) return {kind: 'crypto', unit: tick[1], len: tick[0].length};
	const times = TIMES_WORDS[lang].exec(rest);
	if (times) return {kind: 'multiplier', unit: 'x', len: times[0].length};
	const tu = /^\s*(?:de\s+)?([\p{L}]+)/u.exec(rest);
	if (tu) {
		const w = tu[1].toLowerCase();
		const secs = TIME_UNITS[lang][w];
		if (secs !== undefined) return {kind: 'duration', unit: 's', mult: secs, len: tu[0].length};
	}
	return null;
};

// ---------------------------------------------------------------------------------------------------------------------
// Number words
// ---------------------------------------------------------------------------------------------------------------------

type WordTok = {w: string; start: number; end: number};

const wordToks = (text: string): WordTok[] => {
	const out: WordTok[] = [];
	for (const m of text.matchAll(/[\p{L}]+/gu)) {
		const i = m.index ?? 0;
		out.push({w: m[0].toLowerCase(), start: i, end: i + m[0].length});
	}
	return out;
};

const isNumWord = (v: Vocab, w: string): boolean =>
	w in v.small || w in v.tens || w in v.hundreds || v.thousand.includes(w) || w in v.scales || w === 'hundred' || w === 'dozen';

/** Parse a run of number words starting at toks[i]. Returns null when toks[i] does not start a number. */
const parseWordRun = (text: string, toks: WordTok[], i: number, v: Vocab, lang: NumLang): {value: number; next: number; soft: boolean; start: number; end: number} | null => {
	const t0 = toks[i];
	const peek = (k: number) => toks[k]?.w;
	// only whitespace (or a hyphen) may separate the words of one number
	const adjacent = (a: WordTok, b: WordTok | undefined) => !!b && /^[\s-]*$/.test(text.slice(a.end, b.start));
	let k = i;
	let total = 0;
	let current = 0;
	let lastScale = 1;
	let started = false;
	let soft = false;
	let decimals: string | null = null;
	let endTok = t0;
	const applyDecimals = () => {
		if (decimals !== null && decimals.length) current = Number(`${Math.trunc(current)}.${decimals}`);
		decimals = null;
	};

	// leading article: "a million", "un millón", "a single", "un solo" (an article alone is not a number here; durations
	// such as "an hour" / "una hora" are read by the caller)
	if (v.articles.includes(t0.w) && !(t0.w in v.small && lang !== 'en' && !v.articles.includes(t0.w))) {
		const nx = peek(i + 1);
		const adj = adjacent(t0, toks[i + 1]);
		if (nx && adj && (nx in v.scales || v.thousand.includes(nx) || nx === 'hundred' || nx === 'dozen')) {
			current = 1;
			started = true;
			k = i + 1;
		} else if (nx && adj && v.single.includes(nx)) {
			return {value: 1, next: i + 2, soft: true, start: t0.start, end: toks[i + 1].end};
		} else if (lang === 'en' || !(t0.w in v.small)) {
			return null;
		} else {
			// Spanish/Portuguese "un", "una", "um", "uma" alone: read as a soft 1 (the caller drops it unless a unit follows)
			return {value: 1, next: i + 1, soft: true, start: t0.start, end: t0.end};
		}
	}
	// "half a million", "medio millón", "meio milhão"
	if (!started && v.half.includes(t0.w)) {
		let j = i + 1;
		if (lang === 'en' && (peek(j) === 'a' || peek(j) === 'an')) j++;
		const nx = peek(j);
		if (nx && (nx in v.scales || v.thousand.includes(nx))) {
			current = 0.5;
			started = true;
			k = j;
		} else return null;
	}
	// "single" alone in English ("a single chart" is caught above; "single" without article is rare)
	if (!started && lang === 'en' && t0.w === 'single') return null;

	if (!started && !isNumWord(v, t0.w)) return null;
	for (; k < toks.length; k++) {
		const tok = toks[k];
		const w = tok.w;
		if (k > i && !adjacent(toks[k - 1], tok)) break;
		if (decimals !== null && (w in v.small) && v.small[w] < 10) {
			decimals += String(v.small[w]);
			endTok = tok;
			started = true;
			continue;
		}
		if (w in v.small || w in v.tens) {
			if (decimals !== null) break;
			const val = w in v.small ? v.small[w] : v.tens[w];
			current += val;
			endTok = tok;
			started = true;
			continue;
		}
		if (w in v.hundreds) {
			current += v.hundreds[w];
			endTok = tok;
			started = true;
			continue;
		}
		if (w === 'hundred' && lang === 'en') {
			current = (current || 1) * 100;
			endTok = tok;
			started = true;
			continue;
		}
		if (w === 'dozen' && lang === 'en') {
			current = (current || 1) * 12;
			endTok = tok;
			started = true;
			continue;
		}
		if (v.thousand.includes(w)) {
			applyDecimals();
			current = (current || 1) * 1000;
			endTok = tok;
			started = true;
			continue;
		}
		if (w in v.scales) {
			applyDecimals();
			total += (current || 1) * v.scales[w];
			lastScale = v.scales[w];
			current = 0;
			endTok = tok;
			started = true;
			continue;
		}
		if (v.point.includes(w) && started && decimals === null) {
			const nx = peek(k + 1);
			if (nx && nx in v.small && v.small[nx] < 10 && adjacent(tok, toks[k + 1])) {
				decimals = '';
				continue;
			}
			break;
		}
		if (v.and.includes(w) && started) {
			// "and a half" / "y medio" / "e meio"
			const n1 = peek(k + 1);
			const n2 = peek(k + 2);
			if (lang === 'en' && (n1 === 'a' || n1 === 'an') && n2 === 'half' && adjacent(tok, toks[k + 1])) {
				if (current > 0) current += 0.5;
				else total += 0.5 * lastScale;
				endTok = toks[k + 2];
				k += 2;
				continue;
			}
			if (lang !== 'en' && n1 && v.half.includes(n1) && adjacent(tok, toks[k + 1])) {
				if (current > 0) current += 0.5;
				else total += 0.5 * lastScale;
				endTok = toks[k + 1];
				k += 1;
				continue;
			}
			// "one hundred and twenty", "treinta y uno", "vinte e um"
			if (n1 && (n1 in v.small || n1 in v.tens || n1 in v.hundreds) && adjacent(tok, toks[k + 1])) continue;
			break;
		}
		break;
	}
	if (!started) return null;
	applyDecimals();
	const value = total + current;
	// a lone article-number ("un", "una", "um", "uma", "one") is soft
	if (value === 1 && endTok === t0 && (v.articles.includes(t0.w) || t0.w === 'one')) soft = true;
	return {value, next: Math.max(k, i + 1), soft, start: t0.start, end: endTok.end};
};

// ---------------------------------------------------------------------------------------------------------------------
// Digits
// ---------------------------------------------------------------------------------------------------------------------

/** Read a digit string. English: "1,500.25". Spanish/Portuguese: "1.500,25" (and "1 500"); English habits are flagged. */
export const readDigits = (s: string, lang: NumLang): {value: number; alt?: number; format: 'locale' | 'en' | 'ambiguous'} => {
	const str = s.replace(/\s/g, ' ');
	if (lang === 'en') {
		return {value: Number(str.replace(/[, ]/g, '')), format: 'locale'};
	}
	if (/^\d{1,3}(?: \d{3})+(?:,\d+)?$/.test(str)) return {value: Number(str.replace(/ /g, '').replace(',', '.')), format: 'locale'};
	if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(str)) {
		const value = Number(str.replace(/\./g, '').replace(',', '.'));
		// "4.200" with no decimal comma could be an English 4.2
		const oneGroup = /^\d{1,3}\.\d{3}$/.test(str);
		return oneGroup ? {value, alt: Number(str), format: 'locale'} : {value, format: 'locale'};
	}
	if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(str)) {
		const en = Number(str.replace(/,/g, ''));
		// "1,500": a decimal comma to a Spanish/Brazilian reader (1.5), a thousands separator to an English one
		if (/^\d{1,3},\d{3}$/.test(str)) return {value: Number(str.replace(',', '.')), alt: en, format: 'ambiguous'};
		return {value: en, format: 'en'};
	}
	if (/^\d+,\d+$/.test(str)) return {value: Number(str.replace(',', '.')), format: 'locale'};
	if (/^\d+\.\d+$/.test(str)) return {value: Number(str), format: 'en'};
	return {value: Number(str.replace(/[^\d]/g, '')), format: 'locale'};
};

const DIGIT_RE: Record<NumLang, RegExp> = {
	en: /(?<![\p{L}\p{N}_.,])(?<cur>US\$\s?|USD\s?|\$\s?|€\s?|£\s?|EUR\s?|GBP\s?|R\$\s?)?(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:(?<sp>\s?)(?<scale>thousand|million|billion|trillion|mln|mn|bn|tn|k|m|b|t)(?![\p{L}\p{N}]))?/giu,
	es: /(?<![\p{L}\p{N}_.,])(?<cur>US\$\s?|U\$S\s?|USD\s?|\$\s?|€\s?|£\s?|EUR\s?|R\$\s?)?(?<num>\d{1,3}(?:[. ]\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)(?:\s?(?<scale>mil millones|millones|millón|millon|billones|billón|billon|millardos?|mil|MM|M|k|K)(?![\p{L}\p{N}]))?/gu,
	'pt-br': /(?<![\p{L}\p{N}_.,])(?<cur>US\$\s?|USD\s?|\$\s?|€\s?|£\s?|EUR\s?|R\$\s?)?(?<num>\d{1,3}(?:[. ]\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)(?:\s?(?<scale>mil milhões|mil milhoes|milhões|milhoes|milhão|milhao|bilhões|bilhoes|bilhão|bilhao|trilhões|trilhão|mil|mi|bi|tri|M|k|K)(?![\p{L}\p{N}]))?/gu,
};

const SCALE_VALUE: Record<string, number> = {
	thousand: 1e3, k: 1e3, mil: 1e3, million: 1e6, mln: 1e6, mn: 1e6, m: 1e6, mm: 1e6, millones: 1e6, millón: 1e6, millon: 1e6, mi: 1e6,
	milhões: 1e6, milhoes: 1e6, milhão: 1e6, milhao: 1e6, billion: 1e9, bn: 1e9, b: 1e9, bi: 1e9, bilhões: 1e9, bilhoes: 1e9, bilhão: 1e9,
	bilhao: 1e9, millardo: 1e9, millardos: 1e9, 'mil millones': 1e9, 'mil milhões': 1e9, 'mil milhoes': 1e9, trillion: 1e12, tn: 1e12,
	t: 1e12, billones: 1e12, billón: 1e12, billon: 1e12, trilhões: 1e12, trilhão: 1e12, tri: 1e12,
};

const CURRENCY: Record<string, string> = {'us$': 'USD', 'u$s': 'USD', usd: 'USD', $: 'USD', '€': 'EUR', eur: 'EUR', '£': 'GBP', gbp: 'GBP', r$: 'BRL'};

// ---------------------------------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------------------------------

/** Blank out ranges with spaces (keeps offsets) so later passes do not read them twice. */
const blank = (s: string, start: number, end: number): string => s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);

export const extractNumbers = (input: string, lang: NumLang): Num[] => {
	const src = clean(input);
	let work = src;
	const out: Num[] = [];
	const add = (n: Num) => {
		out.push(n);
		work = blank(work, n.start, n.end);
	};
	// not numbers: source tags, URLs, addresses, ticker symbols with digits, list markers, ratings and "24/7"
	for (const re of [/\[src:[^\]]*\]/g, /https?:\/\/\S+/g, /\b[\w-]+\.(?:com|org|net|io|xyz|example)\S*/g, /0x[0-9a-fA-F]+/g, /\$[A-Za-z][A-Za-z0-9]*/g, /\b[A-Za-z]+-\d+\b/g, /\b24\/7\b/g, /(?:^|\n)\s*\d{1,2}[.)](?=\s)/g])
		for (const m of work.matchAll(re)) work = blank(work, m.index ?? 0, (m.index ?? 0) + m[0].length);

	const months = MONTHS[lang];
	const monthAlt = Object.keys(months)
		.sort((a, b) => b.length - a.length)
		.join('|');
	const pushDate = (start: number, end: number, month: number, day?: number, year?: number) => {
		if (month < 1 || month > 12 || (day !== undefined && (day < 1 || day > 31))) return;
		add({kind: 'date', value: month * 100 + (day ?? 0), year, qual: 'exact', raw: src.slice(start, end), start, end});
	};
	// ISO dates
	for (const m of work.matchAll(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.]+Z?)?\b/g)) pushDate(m.index ?? 0, (m.index ?? 0) + m[0].length, Number(m[2]), Number(m[3]), Number(m[1]));
	// numeric dates: d/m/y in Spanish and Portuguese, m/d/y in English (only when the reading is valid)
	for (const m of work.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		const [mo, d] = lang === 'en' ? [a, b] : [b, a];
		pushDate(m.index ?? 0, (m.index ?? 0) + m[0].length, mo, d, Number(m[3]));
	}
	if (lang === 'en') {
		const monthOk = (tok: string) => tok !== tok.toLowerCase(); // "may 5" (verb) is not a date
		for (const m of work.matchAll(new RegExp(`\\b(${monthAlt})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, 'gi')))
			if (monthOk(m[1])) pushDate(m.index ?? 0, (m.index ?? 0) + m[0].length, months[m[1].toLowerCase()], Number(m[2]), m[3] ? Number(m[3]) : undefined);
		for (const m of work.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthAlt})\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, 'gi')))
			if (monthOk(m[2])) pushDate(m.index ?? 0, (m.index ?? 0) + m[0].length, months[m[2].toLowerCase()], Number(m[1]), m[3] ? Number(m[3]) : undefined);
		for (const m of work.matchAll(new RegExp(`\\b(${monthAlt})\\.?\\s+(\\d{4})\\b`, 'gi')))
			if (monthOk(m[1])) pushDate(m.index ?? 0, (m.index ?? 0) + m[0].length, months[m[1].toLowerCase()], undefined, Number(m[2]));
	} else {
		// "24 de noviembre de 2026", "24 nov 2026", "noviembre de 2026"
		for (const m of work.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${monthAlt})\\.?(?:\\s+(?:de\\s+|del\\s+)?(\\d{4}))?(?![\\p{L}])`, 'giu')))
			pushDate(m.index ?? 0, (m.index ?? 0) + m[0].length, months[m[2].toLowerCase()], Number(m[1]), m[3] ? Number(m[3]) : undefined);
		for (const m of work.matchAll(new RegExp(`(?<![\\p{L}])(${monthAlt})\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b`, 'giu')))
			pushDate(m.index ?? 0, (m.index ?? 0) + m[0].length, months[m[1].toLowerCase()], undefined, Number(m[2]));
	}
	// times
	for (const m of work.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s?([ap])\.?m\.?)?(?:\s?h\b)?/gi)) {
		let h = Number(m[1]);
		if (m[3]?.toLowerCase() === 'p' && h < 12) h += 12;
		if (m[3]?.toLowerCase() === 'a' && h === 12) h = 0;
		const i = m.index ?? 0;
		add({kind: 'time', value: h * 60 + Number(m[2]), qual: 'exact', raw: m[0], start: i, end: i + m[0].length});
	}
	// ordinals that number a day, week, step...: "day two", "the second day", "el primer día", "o dia dois", "2nd day"
	{
		const v = VOCAB[lang];
		const ords = ORD_WORDS[lang];
		const nouns = SEQ_NOUNS[lang];
		const alt = (o: Record<string, unknown>) => Object.keys(o).sort((a, b) => b.length - a.length).join('|');
		const cardinals: Record<string, number> = {...v.small, ...v.tens};
		const ordFirst = new RegExp(`(?<![\\p{L}\\p{N}])(${alt(ords)}|\\d{1,3}(?:st|nd|rd|th|\\.?[ºªoa]))\\s+(${alt(nouns)})(?![\\p{L}])`, 'giu');
		const nounFirst = new RegExp(`(?<![\\p{L}])(${alt(nouns)})\\s+(${alt(cardinals)}|\\d{1,3})(?![\\p{L}\\p{N}])`, 'giu');
		for (const m of work.matchAll(ordFirst)) {
			const i = m.index ?? 0;
			const w = m[1].toLowerCase();
			const value = ords[w] ?? Number(w.replace(/\D/g, ''));
			if (!value) continue;
			add({kind: 'ordinal', value, unit: nouns[m[2].toLowerCase()], qual: 'exact', raw: m[0], start: i, end: i + m[0].length});
		}
		// "launch day" / "on launch day" is day one; soft, so a translation that keeps only "the launch" is not flagged
		if (lang === 'en')
			for (const m of work.matchAll(/\b(?:launch|launching|opening|debut)[- ]day\b/gi)) {
				const i = m.index ?? 0;
				add({kind: 'ordinal', value: 1, unit: 'day', qual: 'exact', raw: m[0], start: i, end: i + m[0].length, soft: true});
			}
		for (const m of work.matchAll(nounFirst)) {
			const i = m.index ?? 0;
			const w = m[2].toLowerCase();
			const value = cardinals[w] ?? Number(w);
			const unit = nouns[m[1].toLowerCase()];
			if (!value || (unit === 'year' && value > 31)) continue;
			add({kind: 'ordinal', value, unit, qual: 'exact', raw: m[0], start: i, end: i + m[0].length});
		}
	}
	// multipliers: 10x, x10, ×10
	for (const m of work.matchAll(/(?<![\p{L}\p{N}])(?:(\d+(?:[.,]\d+)?)\s?[x×]|[x×]\s?(\d+(?:[.,]\d+)?))(?![\p{L}\p{N}])/gu)) {
		const i = m.index ?? 0;
		const v = readDigits(m[1] ?? m[2], lang).value;
		add({kind: 'multiplier', value: v, unit: 'x', qual: qualifierAt(work, i, i + m[0].length, lang), raw: m[0], start: i, end: i + m[0].length});
	}

	// digits (with currency, scale, percent, units)
	const re = DIGIT_RE[lang];
	re.lastIndex = 0;
	const digitHits: Array<Num & {scaleMult: number}> = [];
	for (const m of work.matchAll(re)) {
		const g = m.groups ?? {};
		const start = m.index ?? 0;
		const numStr = g.num ?? '';
		if (!numStr) continue;
		let end = start + m[0].length;
		const read = readDigits(numStr, lang);
		const scaleKey = g.scale ? g.scale.toLowerCase() : undefined;
		// a one-letter "m"/"b"/"t" after an English number is a scale after a currency ("$4.2M") or as a capital
		// ("1.5M tokens", "1.5 M tokens"), never lower case without a currency ("10 m" is metres)
		let scale = 1;
		if (scaleKey) {
			const letter = lang === 'en' && /^[mbt]$/.test(scaleKey);
			if (letter && !g.cur && g.scale !== g.scale?.toUpperCase()) {
				end = start + (g.cur?.length ?? 0) + numStr.length;
			} else scale = SCALE_VALUE[scaleKey] ?? 1;
		}
		const curKey = g.cur ? g.cur.trim().toLowerCase() : undefined;
		const cur = curKey ? CURRENCY[curKey] : undefined;
		const n: Num & {scaleMult: number} = {
			scaleMult: scale,
			kind: 'count',
			value: read.value * scale,
			alt: read.alt !== undefined ? read.alt * scale : undefined,
			qual: 'exact',
			raw: '',
			start,
			end,
			format: lang === 'en' ? undefined : read.format,
		};
		if (cur) {
			n.kind = 'money';
			n.unit = cur;
			if (lang !== 'en' && curKey === '$') n.bareDollar = true;
		}
		const u = unitAfter(work, end, lang);
		if (u) {
			if (u.kind === 'money' && n.kind === 'money') {
				n.bareDollar = false;
				end += u.len;
			} else if (u.kind === 'money' || u.kind === 'percent' || u.kind === 'crypto' || u.kind === 'multiplier') {
				if (n.kind !== 'money') {
					n.kind = u.kind;
					n.unit = u.unit;
					end += u.len;
				}
			} else if (u.kind === 'duration' && n.kind === 'count') {
				n.kind = 'duration';
				n.unit = 's';
				n.per = u.mult ?? 1;
				n.value *= u.mult ?? 1;
				if (n.alt !== undefined) n.alt *= u.mult ?? 1;
				end += u.len;
			}
		}
		if (n.kind === 'count' && !scaleKey && !/[.,\s]/.test(numStr) && n.value >= 1900 && n.value <= 2100) {
			n.kind = 'year';
			n.year = n.value;
		}
		n.end = end;
		n.raw = src.slice(start, end).trim();
		n.qual = qualifierAt(work, start, end, lang);
		digitHits.push(n);
	}
	// ranges: "4-5 million", "4 to 5 million", "entre 4 y 5 millones": the second end's scale and unit apply to the first
	for (let i = 0; i + 1 < digitHits.length; i++) {
		const a = digitHits[i];
		const b = digitHits[i + 1];
		if (!/^\s*(?:-|to|a|y|e|and)\s*$/i.test(work.slice(a.end, b.start))) continue;
		if (a.scaleMult === 1 && b.scaleMult > 1) {
			a.value *= b.scaleMult;
			if (a.alt !== undefined) a.alt *= b.scaleMult;
			a.scaleMult = b.scaleMult;
		}
		if ((a.kind === 'count' || a.kind === 'year') && b.kind !== 'count' && b.kind !== 'year') {
			a.kind = b.kind;
			a.unit = b.unit;
		}
	}
	for (const {scaleMult: _s, ...n} of digitHits) add(n);

	// "within the hour", "in an hour", "half an hour", "una hora", "uma semana", "media hora"
	const tu = TIME_UNITS[lang];
	const unitAlt = Object.keys(tu)
		.sort((a, b) => b.length - a.length)
		.join('|');
	const artDur: Record<NumLang, RegExp> = {
		en: new RegExp(`\\b(?:(half)\\s+)?(an?|the)\\s+(${unitAlt})\\b`, 'gi'),
		es: new RegExp(`(?<![\\p{L}])(?:(media|medio)|(un|una))\\s+(${unitAlt})(?![\\p{L}])`, 'giu'),
		'pt-br': new RegExp(`(?<![\\p{L}])(?:(meia|meio)|(um|uma))\\s+(${unitAlt})(?![\\p{L}])`, 'giu'),
	};
	for (const m of work.matchAll(artDur[lang])) {
		const i = m.index ?? 0;
		const unitWord = m[3].toLowerCase();
		if (lang === 'en' && m[2].toLowerCase() === 'the' && !/\b(?:within|in|inside|under)\s+$/i.test(work.slice(Math.max(0, i - 12), i))) continue;
		if (lang === 'en' && /^(?:min|mins|sec|secs|hr|hrs)$/.test(unitWord)) continue;
		const half = lang === 'en' ? !!m[1] : !!m[1];
		const secs = tu[unitWord] * (half ? 0.5 : 1);
		add({kind: 'duration', value: secs, unit: 's', per: tu[unitWord], qual: qualifierAt(work, i, i + m[0].length, lang), raw: m[0], start: i, end: i + m[0].length});
	}
	// "media hora" alone (no article) in es/pt is covered above; English "half an hour" too.

	// number words
	const v = VOCAB[lang];
	const toks = wordToks(work);
	for (let i = 0; i < toks.length; ) {
		const t = toks[i];
		// vague magnitudes: "thousands of", "miles de", "milhares de" (not preceded by a number)
		if (t.w in v.vague && !(i > 0 && isNumWord(v, toks[i - 1].w) && /^\s+$/.test(work.slice(toks[i - 1].end, t.start)))) {
			const nxt = work.slice(t.end, t.end + 6);
			if (/^\s+(?:of|de|do|da|dos|das)\b/i.test(nxt) || lang === 'en') {
				add({kind: 'magnitude', value: v.vague[t.w], qual: 'approx', raw: t.w, start: t.start, end: t.end, words: true});
				i++;
				continue;
			}
		}
		// fractions: "half of", "a third of", "la mitad de", "metade"
		if (lang === 'en' && t.w === 'half' && /^\s+(?:of|the)\b/i.test(work.slice(t.end, t.end + 6))) {
			add({kind: 'fraction', value: 0.5, qual: qualifierAt(work, t.start, t.end, lang), raw: t.w, start: t.start, end: t.end, words: true});
			i++;
			continue;
		}
		if ((lang === 'es' && t.w === 'mitad') || (lang === 'pt-br' && t.w === 'metade')) {
			add({kind: 'fraction', value: 0.5, qual: 'exact', raw: t.w, start: t.start, end: t.end, words: true});
			i++;
			continue;
		}
		// "once" is a number only in Spanish
		if (lang === 'en' && t.w === 'once') {
			i++;
			continue;
		}
		// "one" in "no one", "anyone", "someone", "the one", "this one", "one another"
		if (lang === 'en' && t.w === 'one') {
			const prev = i > 0 ? toks[i - 1].w : '';
			const next = toks[i + 1]?.w ?? '';
			if (/^(?:no|any|some|every|each|the|this|that|which|another|no-one)$/.test(prev) || next === 'another') {
				i++;
				continue;
			}
		}
		const run = parseWordRun(work, toks, i, v, lang);
		if (!run) {
			i++;
			continue;
		}
		let end = run.end;
		let n: Num = {kind: 'count', value: run.value, qual: 'exact', raw: '', start: run.start, end, soft: run.soft, words: true};
		const u = unitAfter(work, end, lang);
		if (u) {
			if (u.kind === 'duration') {
				n = {...n, kind: 'duration', unit: 's', per: u.mult ?? 1, value: run.value * (u.mult ?? 1), soft: false};
				end += u.len;
			} else if (u.kind === 'money' || u.kind === 'percent' || u.kind === 'crypto' || u.kind === 'multiplier') {
				n = {...n, kind: u.kind, unit: u.unit, soft: false};
				end += u.len;
			}
		}
		// a bare article ("un", "una", "um", "uma") is only a number when it carries a unit or "solo/único"
		if (lang !== 'en' && n.soft && n.kind === 'count' && v.articles.includes(toks[i].w) && !v.single.some((s) => work.slice(run.start, run.end).toLowerCase().includes(s))) {
			i = run.next;
			continue;
		}
		n.end = end;
		n.raw = src.slice(n.start, end).trim();
		n.qual = qualifierAt(work, n.start, end, lang);
		add(n);
		i = run.next;
		while (i < toks.length && toks[i].start < end) i++;
	}
	return out.sort((a, b) => a.start - b.start);
};

// ---------------------------------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------------------------------

const close = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.005;

const sameValue = (a: Num, b: Num): 'value' | 'alt' | null => {
	if (close(a.value, b.value)) return 'value';
	if (b.alt !== undefined && close(a.value, b.alt)) return 'alt';
	if (a.alt !== undefined && close(a.alt, b.value)) return 'alt';
	return null;
};

const kindKey = (n: Num): string => `${n.kind}:${n.unit ?? ''}`;

export type NumPair = {a: Num; b: Num; via: 'value' | 'alt'};
export type NumChange = {a: Num; b: Num; why: 'value' | 'unit' | 'unit-dropped'};
export type NumMatch = {pairs: NumPair[]; changed: NumChange[]; missing: Num[]; added: Num[]};

/** Pair the numbers of `a` (the English source) with those of `b` (a back-translation or a translation). */
export const matchNumbers = (a: Num[], b: Num[]): NumMatch => {
	const usedA = new Set<number>();
	const usedB = new Set<number>();
	const pairs: NumPair[] = [];
	const changed: NumChange[] = [];
	// 1. same kind, unit and value (dates also compare the year when both have one)
	a.forEach((x, i) => {
		const j = b.findIndex((y, k) => !usedB.has(k) && kindKey(x) === kindKey(y) && sameValue(x, y) && (x.kind !== 'date' || !x.year || !y.year || x.year === y.year));
		if (j >= 0) {
			usedA.add(i);
			usedB.add(j);
			pairs.push({a: x, b: b[j], via: sameValue(x, b[j]) as 'value' | 'alt'});
		}
	});
	// 2. same value, different unit or kind (money became a count, minutes became hours...)
	a.forEach((x, i) => {
		if (usedA.has(i) || x.soft) return;
		const j = b.findIndex((y, k) => !usedB.has(k) && !y.soft && sameValue(x, y) && x.kind !== 'year' && y.kind !== 'year' && x.kind !== 'date' && y.kind !== 'date');
		if (j >= 0) {
			usedA.add(i);
			usedB.add(j);
			changed.push({a: x, b: b[j], why: kindKey(x) === 'count:' || kindKey(b[j]) === 'count:' ? 'unit-dropped' : 'unit'});
		}
	});
	// 3. same kind and unit, different value: each to the closest value (by order of magnitude, then position); firm
	//    numbers first, then a soft "one" against whatever firm count is left ("one key" -> "two keys")
	const distance = (x: number, y: number) => Math.abs(Math.log10(Math.abs(x) + 1e-9) - Math.log10(Math.abs(y) + 1e-9));
	for (const softPass of [false, true]) {
		a.forEach((x, i) => {
			if (usedA.has(i) || !!x.soft !== softPass) return;
			let best = -1;
			b.forEach((y, k) => {
				if (usedB.has(k) || y.soft || kindKey(x) !== kindKey(y)) return;
				if (best < 0 || distance(x.value, y.value) < distance(x.value, b[best].value)) best = k;
			});
			if (best >= 0) {
				usedA.add(i);
				usedB.add(best);
				changed.push({a: x, b: b[best], why: 'value'});
			}
		});
	}
	const missing = a.filter((_, i) => !usedA.has(i));
	const added = b.filter((_, i) => !usedB.has(i));
	return {pairs, changed, missing, added};
};

const fmt = (x: number): string => {
	if (Math.abs(x) >= 1e9 && Number.isInteger(x / 1e7)) return `${+(x / 1e9).toFixed(3)} billion`;
	if (Math.abs(x) >= 1e6 && Number.isInteger(x / 1e4)) return `${+(x / 1e6).toFixed(3)} million`;
	return Number.isInteger(x) ? x.toLocaleString('en-US') : String(+x.toFixed(6));
};

const DUR: Array<[number, string]> = [
	[31536000, 'year'],
	[2592000, 'month'],
	[604800, 'week'],
	[86400, 'day'],
	[3600, 'hour'],
	[60, 'minute'],
	[1, 'second'],
];

/** Human description of a number, in English, for the report: "$4.2 million", "10 minutes", "68.67%". */
export const describeNum = (n: Num): string => {
	switch (n.kind) {
		case 'money':
			return n.unit === 'USD' ? `$${fmt(n.value)}` : `${fmt(n.value)} ${n.unit}`;
		case 'percent':
			return n.unit === 'pp' ? `${fmt(n.value)} percentage points` : `${fmt(n.value)}%`;
		case 'crypto':
			return `${fmt(n.value)} ${n.unit === 'TOKEN' ? 'tokens' : n.unit}`;
		case 'duration': {
			const [secs, name] = (n.per ? DUR.find(([s]) => s === n.per) : undefined) ?? DUR.find(([s]) => n.value >= s && Number.isInteger(+(n.value / s).toFixed(6))) ?? [1, 'second'];
			const q = +(n.value / secs).toFixed(3);
			return `${q} ${name}${q === 1 ? '' : 's'}`;
		}
		case 'multiplier':
			return `${fmt(n.value)}x`;
		case 'year':
			return String(n.value);
		case 'date': {
			const mo = Math.floor(n.value / 100);
			const d = n.value % 100;
			const name = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo];
			return `${name}${d ? ` ${d}` : ''}${n.year ? `, ${n.year}` : ''}`;
		}
		case 'time':
			return `${String(Math.floor(n.value / 60)).padStart(2, '0')}:${String(n.value % 60).padStart(2, '0')}`;
		case 'fraction':
			return n.value === 0.5 ? 'half' : fmt(n.value);
		case 'magnitude':
			return `${fmt(n.value)}s (vague)`;
		case 'ordinal':
			return `${n.unit} ${n.value}`;
		default:
			return fmt(n.value);
	}
};

export const QUAL_WORDS: Record<Qual, string> = {exact: 'exact', approx: 'about', nearly: 'nearly', min: 'more than / at least', max: 'less than / within / up to'};

/** How serious a qualifier change is: min <-> max flips a claim; exact <-> approx changes precision. */
export const qualChange = (a: Qual, b: Qual): 'none' | 'minor' | 'major' => {
	if (a === b) return 'none';
	const pair = new Set([a, b]);
	if (pair.has('min') && pair.has('max')) return 'major';
	if (pair.has('nearly') && pair.has('max')) return 'none';
	if (pair.has('nearly') && pair.has('approx')) return 'minor';
	if (pair.has('min') && pair.has('nearly')) return 'major';
	return 'minor';
};
