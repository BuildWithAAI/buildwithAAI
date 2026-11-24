/**
 * Text helpers for the fact bank (pure). Matching never runs on raw text: `fold` makes typographic variants equal
 * (curly quotes, dashes, non-breaking spaces, zero-width characters, HTML entities, case), so a page that prints
 * "Pump.fun’s" still contains the excerpt "Pump.fun's".
 */

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The inside of a word in any script. */
export const WORD = '\\p{L}\\p{M}\\p{N}_';

const NAMED: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', hairsp: ' ',
	rsquo: '’', lsquo: '‘', sbquo: '‚', rdquo: '”', ldquo: '“', bdquo: '„', prime: '′', Prime: '″',
	ndash: '–', mdash: '—', minus: '−', hellip: '…', middot: '·', bull: '•', laquo: '«', raquo: '»',
	shy: '', zwj: '', zwnj: '', lrm: '', rlm: '', times: '×', divide: '÷', deg: '°', percnt: '%',
	dollar: '$', euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™', sect: '§', para: '¶',
	frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', plusmn: '±', micro: 'µ', iexcl: '¡', iquest: '¿',
	aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç', atilde: 'ã', otilde: 'õ',
	acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', egrave: 'è', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
	Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Ccedil: 'Ç', Atilde: 'Ã', Otilde: 'Õ',
	colon: ':', comma: ',', period: '.', excl: '!', quest: '?', num: '#', lpar: '(', rpar: ')', sol: '/', bsol: '\\',
	lsqb: '[', rsqb: ']', lcub: '{', rcub: '}', vert: '|', ast: '*', plus: '+', equals: '=', semi: ';', commat: '@',
	rarr: '→', larr: '←', harr: '↔', uarr: '↑', darr: '↓', rArr: '⇒', check: '✓', star: '☆', starf: '★',
};

/** Decode HTML character references (named, decimal, hex). Unknown names are left as written. */
export const decodeEntities = (s: string): string =>
	s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (m, body: string) => {
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m;
			return code === 0 ? '' : String.fromCodePoint(code);
		}
		return Object.hasOwn(NAMED, body) ? NAMED[body] : m;
	});

const ZERO_WIDTH = /[­​-‏⁠⁡⁢⁣⁤﻿]/g;
const SPACES = /[   -   　\t\r\n\f\v]+/g;
const DASHES = /[‐-―−﹘﹣－]/g;
const SQUOTES = /[‘’‚‛′ʼ＇`´]/g;
const DQUOTES = /[“”„‟″«»＂]/g;

/**
 * Same-length typographic cleanup (offsets stay valid): curly quotes straight, every dash a hyphen, odd spaces a plain
 * space. Used where spans matter (number extraction).
 */
export const plain = (s: string): string => s.replace(SQUOTES, "'").replace(DQUOTES, '"').replace(DASHES, '-').replace(/[   -   　]/g, ' ');

/** Matching form: NFKC, entities decoded, zero-width removed, quotes/dashes unified, "…" as "...", spaces collapsed, lower case. */
export const fold = (s: string): string =>
	decodeEntities(s)
		.normalize('NFKC')
		.replace(ZERO_WIDTH, '')
		.replace(SQUOTES, "'")
		.replace(DQUOTES, '"')
		.replace(DASHES, '-')
		.replace(/…/g, '...')
		.replace(SPACES, ' ')
		.replace(/ {2,}/g, ' ')
		.trim()
		.toLowerCase();

/** Collapse whitespace and trim (display form). */
export const squash = (s: string): string => s.replace(SPACES, ' ').replace(/ {2,}/g, ' ').trim();

/** An excerpt split at its elisions ("...", "…", "[...]"), every fragment folded. Empty fragments are dropped. */
export const excerptFragments = (excerpt: string): string[] =>
	fold(excerpt)
		.split(/\s*(?:\[\s*\.\.\.\s*\]|\.{3,})\s*/)
		.map((f) => f.replace(/^[\s,;:]+|[\s,;:]+$/g, ''))
		.filter((f) => f.length > 0);

/**
 * True when every fragment of the excerpt appears in `haystack` (already folded), in order, each one starting after the
 * previous one ended and within `gap` characters of it (an article's dateline and a sentence deep in its body can be
 * 8,000 characters apart, so the default is generous: the passages only have to belong to the same page).
 */
export const containsExcerpt = (haystack: string, excerpt: string, gap = 20_000): boolean => {
	const frags = excerptFragments(excerpt);
	if (!frags.length) return false;
	const tryFrom = (fi: number, from: number, limit: number): boolean => {
		if (fi === frags.length) return true;
		let at = haystack.indexOf(frags[fi], from);
		while (at >= 0 && at <= limit) {
			if (tryFrom(fi + 1, at + frags[fi].length, at + frags[fi].length + gap)) return true;
			at = haystack.indexOf(frags[fi], at + 1);
		}
		return false;
	};
	return tryFrom(0, 0, haystack.length);
};

const BLOCK_END = /<\/(?:p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|blockquote|figcaption|figure|aside|main|nav|dd|dt|pre)\s*>|<br\s*\/?>|<hr\s*\/?>/gi;

/** The page <title>, decoded and squashed, or ''. */
export const pageTitle = (html: string): string => {
	const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
	return m ? squash(decodeEntities(m[1].replace(/<[^>]+>/g, ' '))) : '';
};

/** Visible text of an HTML page: scripts, styles and templates removed, block ends as newlines, entities decoded. */
export const visibleText = (html: string): string => {
	const t = html
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<(script|style|noscript|template|svg|iframe|object|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
		.replace(BLOCK_END, '\n')
		.replace(/<[^>]+>/g, '');
	return decodeEntities(t)
		.split('\n')
		.map((l) => squash(l))
		.filter(Boolean)
		.join('\n');
};

/** Unescape the body of a JSON string literal; returns null when it is not valid JSON. */
const jsonString = (body: string): string | null => {
	try {
		return JSON.parse(`"${body}"`) as string;
	} catch {
		return null;
	}
};

/**
 * Text the server sent inside <script> data (Next.js __NEXT_DATA__, JSON-LD articleBody, Nuxt payloads): every string
 * literal of 40+ characters, unescaped, with HTML tags removed. Article bodies of script-rendered sites live here.
 */
export const embeddedText = (html: string): string => {
	const out: string[] = [];
	for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
		const body = m[1];
		if (body.length < 40) continue;
		for (const s of body.matchAll(/"((?:[^"\\\n]|\\.){40,})"/g)) {
			const v = jsonString(s[1]);
			if (v === null) continue;
			const txt = squash(decodeEntities(v.replace(/<[^>]+>/g, ' ')));
			if (txt.length >= 40 && /\s/.test(txt)) out.push(txt);
		}
	}
	return out.join('\n');
};

/** Words that end with a period without ending the sentence ("Jan. 14", "U.S. regulators", "Mr. Smith"). */
const ABBREV = new Set(['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'etc', 'inc', 'ltd', 'corp', 'co', 'no', 'u.s', 'u.k', 'e.g', 'i.e', 'a.m', 'p.m', 'approx', 'est', 'jr', 'sr', 'gov', 'rep', 'sen', 'gen', 'fig']);

/** Split text into sentences (for excerpt suggestions): ". ", "! ", "? " and line ends, not after abbreviations. */
export const sentences = (text: string): string[] => {
	const out: string[] = [];
	for (const line of text.split(/\n+/)) {
		let start = 0;
		for (const m of line.matchAll(/[.!?…]["'”’)]?\s+(?=["'“‘(]?[A-Z0-9$])/g)) {
			const end = (m.index ?? 0) + 1;
			const word = /([\p{L}.]+)\.$/u.exec(line.slice(start, end))?.[1]?.toLowerCase() ?? '';
			if (line[m.index ?? 0] === '.' && (ABBREV.has(word) || /^\p{L}$/u.test(word))) continue;
			out.push(line.slice(start, (m.index ?? 0) + m[0].trimEnd().length));
			start = (m.index ?? 0) + m[0].length;
		}
		out.push(line.slice(start));
	}
	return out.map((s) => squash(s)).filter((s) => s.length >= 20);
};

/** Shorten for display, never in the middle of a word when avoidable. */
export const clip = (s: string, max = 120): string => {
	const t = squash(s);
	if (t.length <= max) return t;
	const cut = t.slice(0, max - 1);
	const sp = cut.lastIndexOf(' ');
	return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
};
