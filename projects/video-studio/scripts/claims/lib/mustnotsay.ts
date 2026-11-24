/**
 * The "Must not say" section of an episode's research.md, turned into matchable patterns (pure).
 *
 * The research agents write the bullets for people, so the parser reads them the way a careful editor would:
 *  - Quoted phrases ('...', "...", ‘...’, `...`) in a prohibition are banned phrases. Apostrophes inside words
 *    ("Pump.fun's", "isn't") do not end a quote.
 *  - "A / B / C" inside a quote are alternatives ("Pump.fun is a scam / rigged casino" also bans "Pump.fun is a rigged
 *    casino"); "scams/fraud" inside a word expands the same way. A leading or trailing "..." is dropped.
 *  - [named person] (any [bracketed placeholder]) matches any 1-4 words.
 *  - 'X' or 'Y' followed by a short tail ("'Graduated' or 'LP burned' means safe") bans "X means safe" and "Y means safe".
 *  - A parenthesis that only lists figures ("($9.99M, 777 calls, 73%, 9q8zt)") bans each figure.
 *  - Instructions are NOT bans: clauses and parentheses that start with Say / Use / Write / Prefer ... ("Use 'over
 *    $2 billion'", "(say 'alleged' or 'estimated')"), and explanatory clauses after the prohibition.
 *  - Unquoted @handles in a prohibition are banned; unquoted figures in a prohibition give warnings.
 * Phrases of three or more words, or with a figure, handle or proper noun, are errors; one or two plain words are
 * warnings (too common to fail a script on their own). Bullets the parser cannot turn into patterns are listed in the
 * report for a human read ("manual"/"partial" coverage).
 */
import {ORGS} from './lexicon.ts';
import {clean, matchText} from './text.ts';

export type MnsPattern = {
	phrase: string;
	tokens: Array<string | null>;
	level: 'error' | 'warning';
	kind: 'phrase' | 'composite' | 'figure' | 'handle' | 'figure-mention';
};
export type MnsRule = {id: string; line: number; text: string; patterns: MnsPattern[]; coverage: 'full' | 'partial' | 'manual'};
export type MnsList = {found: boolean; heading: string | null; rules: MnsRule[]};

const WILD = '';
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const SECTION = /must[\s-]+not[\s-]+say/i;

// ---------------------------------------------------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------------------------------------------------

const trimTok = (p: string): string => p.replace(/^[^\p{L}\p{N}$€£¥₹+\-@#]+/u, '').replace(/[^\p{L}\p{N}%]+$/u, '');
/** Figures lose their sign and currency so "$331K", "+$331K" and "331K" are one token. */
const canonTok = (t: string): string => (/^[+-]?[$€£¥₹]?\d/.test(t) ? t.replace(/^[+-]/, '').replace(/^[$€£¥₹]/, '') : t);

/** Tokens for phrase matching: lower case, contractions expanded, "61 percent" = "61%", "rug-pulled" = "rug pulled". */
export const matchTokens = (s: string): string[] => {
	const t = matchText(s)
		.replace(/(\d)\s*(?:percent|per cent)(?![\p{L}])/gu, '$1%')
		.replace(/(\d)\s+%/g, '$1%');
	const out: string[] = [];
	for (const raw of t.split(' ')) {
		for (const piece of raw.split(/(?<=[\p{L}\p{N}%])\/(?=[+\-$€£\p{L}\p{N}])/u)) {
			const tok = trimTok(piece);
			if (!tok) continue;
			// "rug-pulled" = "rug pulled"; a range "$10k-$100k" is two figures
			for (const h of tok.split(/(?<=\p{L})-(?=\p{L})|(?<=[\p{N}%])-(?=[$€£¥₹\p{N}])|(?<=\d[kmbt])-(?=[$€£¥₹\p{N}])/u)) {
				const c = canonTok(h);
				if (c) out.push(c);
			}
		}
	}
	return out;
};

const isCodeLike = (t: string): boolean => /^[a-z0-9]{4,}$/.test(t) && /\d/.test(t) && /[a-z]/.test(t);
const tokEq = (pat: string, tok: string): boolean => pat === tok || (isCodeLike(pat) && tok.includes(pat));

/** Index of the first match of a token pattern (null = 1-4 arbitrary tokens), or -1. */
export const findPhrase = (text: string[], pat: Array<string | null>): number => {
	const rec = (ti: number, pi: number): boolean => {
		if (pi === pat.length) return true;
		const p = pat[pi];
		if (p === null) {
			for (let k = 1; k <= 4 && ti + k <= text.length; k++) if (rec(ti + k, pi + 1)) return true;
			return false;
		}
		return ti < text.length && tokEq(p, text[ti]) && rec(ti + 1, pi + 1);
	};
	for (let s = 0; s < text.length; s++) if (rec(s, 0)) return s;
	return -1;
};

// ---------------------------------------------------------------------------------------------------------------------
// bullet structure: quotes, parentheses, clauses
// ---------------------------------------------------------------------------------------------------------------------

type Span = {start: number; end: number};
type Quote = Span & {inner: string};

const stripMd = (s: string): string =>
	s
		.replace(/\*\*|__/g, '')
		.replace(/(^|[\s(])\*(\S[^*]*?\S|\S)\*(?=[\s).,;:!?]|$)/g, '$1$2')
		.replace(/`([^`]+)`/g, "'$1'")
		.replace(/\s+/g, ' ')
		.trim();

const OPEN_BEFORE = /[\s([{/—–\-"“]/;
const quoteSpans = (s: string): Quote[] => {
	const out: Quote[] = [];
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === '"' || c === '“') {
			let j = s.indexOf(c === '“' ? '”' : '"', i + 1);
			if (j < 0 && c === '“') j = s.indexOf('"', i + 1);
			if (j > i) {
				out.push({start: i, end: j + 1, inner: s.slice(i + 1, j)});
				i = j + 1;
				continue;
			}
		}
		if ((c === "'" || c === '‘') && (i === 0 || OPEN_BEFORE.test(s[i - 1])) && i + 1 < s.length && !/\s/.test(s[i + 1])) {
			let j = -1;
			for (let k = i + 1; k < s.length; k++) {
				if (s[k] !== "'" && s[k] !== '’') continue;
				const next = s[k + 1];
				if (/\S/.test(s[k - 1]) && (next === undefined || !/[\p{L}\p{N}]/u.test(next))) {
					j = k;
					break;
				}
			}
			if (j > i) {
				out.push({start: i, end: j + 1, inner: s.slice(i + 1, j)});
				i = j + 1;
				continue;
			}
		}
		i++;
	}
	return out;
};

const inside = (i: number, spans: Span[]): Span | undefined => spans.find((sp) => i >= sp.start && i < sp.end);

const parenSpans = (s: string, quotes: Quote[]): Span[] => {
	const out: Span[] = [];
	let depth = 0;
	let start = -1;
	for (let i = 0; i < s.length; i++) {
		if (inside(i, quotes)) continue;
		if (s[i] === '(') {
			if (depth === 0) start = i;
			depth++;
		} else if (s[i] === ')' && depth > 0) {
			depth--;
			if (depth === 0) out.push({start, end: i + 1});
		}
	}
	return out;
};

const clauseSpans = (s: string, quotes: Quote[], parens: Span[]): Span[] => {
	const out: Span[] = [];
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		if (inside(i, quotes) || inside(i, parens)) continue;
		const c = s[i];
		const boundary = c === ';' || ('.!?'.includes(c) && /\s/.test(s[i + 1] ?? '') && /[A-Z'"‘“(]/.test(s.slice(i + 1).trimStart()[0] ?? ''));
		if (boundary) {
			out.push({start, end: i + 1});
			start = i + 1;
		}
	}
	if (start < s.length) out.push({start, end: s.length});
	return out.filter((c) => s.slice(c.start, c.end).trim());
};

const INSTRUCTION =
	/^(?:(?:instead|if needed|if necessary|if you must|rather|otherwise|also|only|always|script fix|safe wording|better)[,:]?\s+)*(?:say|use|write|prefer|describe|present|frame|keep|call it|refer to|try|attribute|label|mark|stick to|reword|rephrase|cite)\b/i;
const PROHIBIT = /^(?:do not|don't|dont|never|no|avoid|must not|not|nor|without|any)\b/i;
const CONTINUES = /^(?:or|and|nor|that|or that|and that|or say|or call)\b/i;

const leadTrim = (s: string): string => s.replace(/^[\s,;:.\-–—]+/, '').trim();

// ---------------------------------------------------------------------------------------------------------------------
// phrases -> patterns
// ---------------------------------------------------------------------------------------------------------------------

const PROPER = new Set(ORGS.map((o) => o.toLowerCase()));

const patternOf = (phrase: string, kind: MnsPattern['kind'], forceLevel?: 'error' | 'warning'): MnsPattern | null => {
	const marked = phrase.replace(/\[[^\]]{1,40}\]/g, ` ${WILD} `);
	const toks: Array<string | null> = matchTokens(marked).map((t) => (t.startsWith(WILD) ? null : t));
	while (toks.length && toks[0] === null) toks.shift();
	while (toks.length && toks[toks.length - 1] === null) toks.pop();
	const real = toks.filter((t): t is string => t !== null);
	if (!real.length || !real.some((t) => /[\p{L}\p{N}]/u.test(t))) return null;
	let level: 'error' | 'warning';
	if (forceLevel) level = forceLevel;
	else {
		const words = clean(phrase.replace(/\[[^\]]{1,40}\]/g, ' ')).split(' ').filter(Boolean);
		const proper =
			words.some((wd, i) => (i > 0 && /^\p{Lu}/u.test(wd)) || /^\p{Lu}{2,}/u.test(wd) || /\p{L}\.\p{L}/u.test(wd)) ||
			real.some((t) => PROPER.has(t));
		level = real.length >= 3 || real.some((t) => /\d|^@|[$€£%]/.test(t)) || proper ? 'error' : 'warning';
	}
	const display = clean(phrase.replace(/\[[^\]]{1,40}\]/g, '…'));
	return {phrase: display, tokens: toks, level, kind};
};

/** "scams/fraud" -> ["scams", "fraud"] variants of a phrase (at most 8). */
const expandSlashWords = (phrase: string): string[] => {
	let variants = [''];
	for (const word of phrase.split(/(\s+)/)) {
		const alts = /^[\p{L}][\p{L}.'-]*(?:\/[\p{L}][\p{L}.'-]*)+$/u.test(word) ? word.split('/') : [word];
		const next: string[] = [];
		for (const v of variants) for (const a of alts) next.push(v + a);
		variants = next.slice(0, 8);
	}
	return variants;
};

/** Phrases from one quote: ellipses dropped, " / " alternatives expanded (later ones also take the first one's head). */
const phrasesOfQuote = (inner: string): Array<{text: string; standalone: boolean}> => {
	const q = inner.trim().replace(/^(?:\.{3}|…)\s*/, '').replace(/\s*(?:\.{3}|…)$/, '').trim();
	if (!q) return [];
	const parts = q.split(/\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
	const out: Array<{text: string; standalone: boolean}> = [{text: parts[0], standalone: true}];
	const head = parts[0].split(/\s+/).slice(0, -1).join(' ');
	for (const alt of parts.slice(1)) {
		if (head) out.push({text: `${head} ${alt}`, standalone: true});
		if (alt.split(/\s+/).length >= 2) out.push({text: alt, standalone: false});
	}
	return out.flatMap((p) => expandSlashWords(p.text).map((text) => ({text, standalone: p.standalone})));
};

const FIGURE_ITEM = (item: string): boolean => {
	const t = item.trim();
	if (!t || t.split(/\s+/).length > 3) return false;
	return /\d/.test(t) || /^@[A-Za-z0-9_]{2,}$/.test(t) || (/^[A-Za-z0-9]{4,}$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t));
};
const listItems = (inner: string): string[] => inner.split(/\s*[;,]\s+|\s+(?:or|and)\s+/).map((x) => x.trim()).filter(Boolean);

const HANDLE = /(?<![\w@])@[A-Za-z0-9_]{2,30}/g;
const FIGURE_MENTION =
	/(?<![\w.$€£])(?:[+-]?[$€£]\s?\d[\d.,]*(?:\s?(?:bn|[kmbt]|million|billion|thousand)(?![\p{L}]))?|\d[\d.,]*\s?(?:%|percent(?![\p{L}]))|\d[\d.,]*\s?(?:million|billion|thousand)(?![\p{L}])|\d+(?:\.\d+)?\s?SOL(?![\p{L}]))/giu;

const BOILERPLATE = new Set(
	`do not don't dont never say said call mention depict quote repeat give use suggest state treat any or and that the a an as fact of in form to its it this is was were are be about for on with real exact current
	their his her them they he she we you your our anyone anything someone something there here only if when name names`.split(/\s+/),
);

const parseBullet = (rawText: string, id: string, line: number): MnsRule => {
	const s = stripMd(rawText);
	const quotes = quoteSpans(s);
	const parens = parenSpans(s, quotes);
	const clauses = clauseSpans(s, quotes, parens);
	const patterns: MnsPattern[] = [];
	const add = (p: MnsPattern | null) => {
		if (p && !patterns.some((x) => x.tokens.join('\u0001') === p.tokens.join('\u0001'))) patterns.push(p);
	};
	let residual = '';
	let prevForbidden = false;
	clauses.forEach((cl, ci) => {
		const text = leadTrim(s.slice(cl.start, cl.end));
		let kind: 'forbidden' | 'allowed' | 'explain';
		if (INSTRUCTION.test(text)) kind = 'allowed';
		else if (ci === 0 || PROHIBIT.test(text) || (prevForbidden && CONTINUES.test(text))) kind = 'forbidden';
		else kind = 'explain';
		prevForbidden = kind === 'forbidden';
		if (kind !== 'forbidden') return;
		const qs = quotes.filter((q) => q.start >= cl.start && q.end <= cl.end);
		const ps = parens.filter((p) => p.start >= cl.start && p.end <= cl.end);
		const skipQuote = new Set<Quote>();
		for (const p of ps) {
			const inner = s.slice(p.start + 1, p.end - 1);
			const innerQuotes = qs.filter((q) => q.start > p.start && q.end < p.end);
			const withoutQuotes = innerQuotes.reduceRight((acc, q) => acc.slice(0, q.start - p.start - 1) + ' ' + acc.slice(q.end - p.start - 1), inner);
			const exampleList = innerQuotes.length > 0 && /^[\s,;/]*(?:(?:or|and|e\.g\.?|eg|for example|like|such as)[\s,;/]*)*$/i.test(withoutQuotes);
			if (!exampleList) innerQuotes.forEach((q) => skipQuote.add(q)); // instructions and explanations
			if (INSTRUCTION.test(inner.trim()) || exampleList) continue;
			const items = listItems(inner);
			if (items.length && items.every(FIGURE_ITEM)) {
				for (const item of items) for (const part of item.split(/\/(?=[+\-$€£\d@])/)) add(patternOf(part, part.trim().startsWith('@') ? 'handle' : 'figure', 'error'));
			}
		}
		// quote groups: 'X' or 'Y' <tail>
		const live = qs.filter((q) => !skipQuote.has(q));
		const groups: Quote[][] = [];
		for (const q of live) {
			const g = groups[groups.length - 1];
			const prev = g?.[g.length - 1];
			if (prev && /^\s*(?:,|or|and|\/|,\s*or|,\s*and)?\s*$/i.test(s.slice(prev.end, q.start))) g.push(q);
			else groups.push([q]);
		}
		for (const g of groups) {
			const last = g[g.length - 1];
			let tailEnd = cl.end;
			for (const stop of ['(', ';', '.', ',']) {
				const at = s.indexOf(stop, last.end);
				if (at >= 0 && at < tailEnd) tailEnd = at;
			}
			const nextQuote = live.find((q) => q.start >= last.end);
			if (nextQuote && nextQuote.start < tailEnd) tailEnd = nextQuote.start;
			const tail = s.slice(last.end, tailEnd).trim();
			const tailWords = tail.split(/\s+/).filter(Boolean);
			const tailOk =
				tailWords.length >= 1 &&
				tailWords.length <= 3 &&
				/^[a-z][a-z' -]*$/i.test(tail) &&
				!/^(?:or|and|but|that|which|who|when|if|as|because|since|unless|until|than|for|from|with|without|in|on|at|by|of|to|nor|so|yet|then|is|was|are|were|has|have|had|until|unless)$/i.test(tailWords[0]);
			for (const q of g) {
				for (const ph of phrasesOfQuote(q.inner)) {
					if (tailOk) add(patternOf(`${ph.text} ${tail}`, 'composite'));
					const p = patternOf(ph.text, 'phrase');
					if (!p) continue;
					const realCount = p.tokens.filter((t) => t !== null).length;
					// a short quote that formed a composite ("'Graduated' ... means safe") is only banned as the composite
					if (tailOk && realCount < 3 && !/\d/.test(ph.text)) continue;
					if (!ph.standalone && realCount < 2) continue;
					add(p);
				}
			}
		}
		// unquoted handles and figures in the prohibition itself (outside quotes and parentheses)
		let bare = s.slice(cl.start, cl.end);
		for (const q of [...qs, ...ps].sort((a, b) => b.start - a.start)) bare = bare.slice(0, q.start - cl.start) + ' '.repeat(q.end - q.start) + bare.slice(q.end - cl.start);
		for (const m of bare.matchAll(HANDLE)) add(patternOf(m[0], 'handle', 'error'));
		for (const m of bare.matchAll(FIGURE_MENTION)) add(patternOf(m[0], 'figure-mention', 'warning'));
		residual += ' ' + bare.replace(HANDLE, ' ').replace(FIGURE_MENTION, ' ');
	});
	const leftover = residual
		.toLowerCase()
		.split(/[^\p{L}\p{N}']+/u)
		.filter((x) => x.length >= 3 && !BOILERPLATE.has(x));
	const coverage: MnsRule['coverage'] = !patterns.length ? 'manual' : leftover.length > 3 ? 'partial' : 'full';
	return {id, line, text: s, patterns, coverage};
};

/** A language tag in a heading: "Must not say (es)", "Must not say (pt-br)". */
const LANG_TAG = /\(\s*([a-z]{2}(?:-[a-z]{2})?)\s*\)/i;

/**
 * Parse a "Must not say" section (any heading level; ends at the next heading of the same or a higher level).
 * Without `lang`: the untagged section (written in the episode's source language). With `lang`: the section tagged
 * for that language, "## Must not say (es)" (added 2026-11-24, VCD fix: the English phrases cannot match a
 * translation, so each dub language carries its own bans).
 */
export const parseMustNotSay = (md: string, lang?: string): MnsList => {
	const lines = md.split(/\r?\n/);
	let start = -1;
	let level = 0;
	let heading: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const m = HEADING.exec(lines[i]);
		if (!m || !SECTION.test(m[2])) continue;
		const tag = LANG_TAG.exec(m[2])?.[1]?.toLowerCase();
		if (lang ? tag === lang.toLowerCase() : !tag) {
			start = i;
			level = m[1].length;
			heading = m[2];
			break;
		}
	}
	if (start < 0) return {found: false, heading: null, rules: []};
	const items: Array<{line: number; text: string}> = [];
	let inFence = false;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^\s*```/.test(lines[i])) inFence = !inFence;
		if (inFence) continue;
		const h = HEADING.exec(lines[i]);
		if (h && h[1].length <= level) break;
		const b = BULLET.exec(lines[i]);
		if (b) items.push({line: i + 1, text: b[1]});
		else if (items.length && /^\s+\S/.test(lines[i])) items[items.length - 1].text += ` ${lines[i].trim()}`;
	}
	const rules = items
		.filter((it) => !/^\(?\s*(?:none|n\/a|nothing)\s*\)?\.?$/i.test(it.text.trim()))
		.map((it, k) => parseBullet(it.text, `mns-${k + 1}`, it.line));
	return {found: true, heading, rules};
};

export type MnsHit = {rule: MnsRule; pattern: MnsPattern};

/** Banned phrases and figures found in one piece of text. Figures also match inside unspaced (zh/ja) text. */
export const scanMustNotSay = (text: string, list: MnsList): MnsHit[] => {
	if (!list.rules.length) return [];
	const toks = matchTokens(text);
	const flat = matchText(text);
	const out: MnsHit[] = [];
	for (const rule of list.rules) {
		for (const pattern of rule.patterns) {
			let hit = findPhrase(toks, pattern.tokens) >= 0;
			if (!hit && pattern.tokens.length === 1 && pattern.tokens[0] && /\d/.test(pattern.tokens[0])) {
				const f = pattern.tokens[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				hit = new RegExp(`(?<![\\d.,])[$€£¥₹]?${f}(?![\\d])`, 'u').test(flat);
			}
			if (hit) out.push({rule, pattern});
		}
	}
	return out;
};
