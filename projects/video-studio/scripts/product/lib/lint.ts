/**
 * Content lint for the product editions and their marketing copy. Pure functions.
 *
 * Errors (the build stops):
 *  - unknown citation ids, malformed inline markup;
 *  - a statistic (money, percentage, "million", "billion", a count of complaints...) without a citation in the
 *    same item, paragraph or table row;
 *  - "ZOO" in capitals (the host is "Zoo");
 *  - placeholders (TODO, TBD, REPLACE, lorem ipsum, example.com);
 *  - links that are not https, mailto or in-document anchors;
 *  - a named wallet, exchange or security product without a citation in the same block (we name categories,
 *    not brands; a brand may appear only as a cited source or incident);
 *  - promises a security product must never make ("100% safe", "unhackable", "guaranteed protection"...),
 *    outside quotation marks (the phrasebook quotes scam lines on purpose);
 *  - spot ids that the spot catalog does not define;
 *  - cross-references ([#id]) to a section that does not exist, or in text that has no sections (the copy).
 * Warnings: chapters that don't end with a red-flag box and a one-fix box, sources never cited.
 */
import {blockTexts, walkBlocks, type Block, type Structured} from './markdown.ts';
import {citationsOf, InlineError, linksOf, parseInline, plainText, xrefsOf} from './inline.ts';

export type Finding = {level: 'error' | 'warning'; line: number; rule: string; message: string};

/** Wallet, exchange and security-product names that need a citation next to them (case-sensitive). */
export const BRAND_WATCHLIST = [
	'Ledger',
	'Trezor',
	'MetaMask',
	'Phantom',
	'Rabby',
	'Trust Wallet',
	'Exodus',
	'Coinbase',
	'Kraken',
	'Binance',
	'Bybit',
	'OKX',
	'Gemini',
	'Robinhood',
	'YubiKey',
	'Yubico',
	'Google Authenticator',
	'Microsoft Authenticator',
	'Authy',
	'1Password',
	'Bitwarden',
	'LastPass',
	'Dashlane',
	'Revoke.cash',
	'Etherscan',
	'Arup',
] as const;

const STAT_RE = /(\$\s?\d|\d\s?%|\d[\d,.]*\s(million|billion|thousand)\b|\b\d{1,3}(,\d{3})+\b)/i;

const PROMISE_RE =
	/\b(100\s?%\s?(safe|secure|protected)|(completely|totally|perfectly|fully|absolutely|always)\s+(safe|secure|protected)|unhackable|hack-?proof|bullet-?proof|fool-?proof|risk-?free|zero\s+risk|guarantee[sd]?\s+(your\s+)?(safety|protection|security)|guaranteed\s+(safe|secure|protection)|never\s+(be|get)\s+(hacked|scammed)|(stops?|prevents?|blocks?)\s+(all|every)\s+(scams?|hacks?|attacks?|theft))\b/i;

const PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|REPLACE|lorem ipsum)\b|example\.(com|org)/;

/** Removes text inside quotation marks (straight or curly), so quoted scam lines are not read as our claims. */
export const stripQuoted = (s: string): string => s.replace(/"[^"]*"|“[^”]*”/g, ' ');

const checkText = (
	text: string,
	line: number,
	out: Finding[],
	opts: {knownIds: Set<string>; spotIds?: Set<string>; sectionIds?: Set<string>},
): {cites: string[]; links: string[]} => {
	let nodes;
	try {
		nodes = parseInline(text);
	} catch (e) {
		out.push({level: 'error', line, rule: 'markup', message: e instanceof InlineError ? e.message : String(e)});
		return {cites: [], links: []};
	}
	const cites = citationsOf(nodes);
	for (const id of cites) if (!opts.knownIds.has(id)) out.push({level: 'error', line, rule: 'unknown-source', message: `no source with id "${id}" in sources.json`});
	for (const id of xrefsOf(nodes)) {
		if (!opts.sectionIds) out.push({level: 'error', line, rule: 'xref', message: `cross-reference [#${id}] needs a document with sections`});
		else if (!opts.sectionIds.has(id)) out.push({level: 'error', line, rule: 'xref', message: `cross-reference [#${id}] points at no section`});
	}
	for (const href of linksOf(nodes)) {
		if (!/^(https:\/\/|mailto:|#)/.test(href)) out.push({level: 'error', line, rule: 'link', message: `link must be https, mailto or #anchor: ${href}`});
	}
	const plain = plainText(nodes);
	if (/\bZOO\b/.test(plain)) out.push({level: 'error', line, rule: 'zoo-casing', message: 'write "Zoo", never "ZOO"'});
	if (PLACEHOLDER_RE.test(plain)) out.push({level: 'error', line, rule: 'placeholder', message: `placeholder text: ${PLACEHOLDER_RE.exec(plain)?.[0]}`});
	const ours = stripQuoted(plain);
	const promise = PROMISE_RE.exec(ours);
	if (promise) out.push({level: 'error', line, rule: 'promise', message: `security products must not promise "${promise[0]}"`});
	return {cites, links: linksOf(nodes).filter((h) => h.startsWith('https://'))};
};

/** A block's text units that must each carry their own citation when they state a statistic. */
const units = (b: Block): {text: string; line: number}[] => {
	if (b.type === 'table') return b.rows.map((r) => ({text: r.join(' | '), line: b.line}));
	return blockTexts(b);
};

export const lintStructured = (doc: Structured, opts: {knownIds: Set<string>; spotIds: Set<string>; requireChapterCallouts?: boolean}): Finding[] => {
	const out: Finding[] = [];
	const all: Block[] = [...doc.preamble, ...doc.sections.flatMap((s) => s.blocks)];
	const ledes = doc.sections.filter((s) => s.lede).map((s) => ({text: s.lede as string, line: s.line}));
	// cross-references may point at any section; the free edition has none, so it may not use them
	const textOpts = {...opts, sectionIds: doc.sections.length ? new Set(doc.sections.map((s) => s.id)) : undefined};
	const checkUnit = (u: {text: string; line: number}) => {
		const {cites} = checkText(u.text, u.line, out, textOpts);
		const plain = (() => {
			try {
				return plainText(parseInline(u.text));
			} catch {
				return u.text;
			}
		})();
		if (STAT_RE.test(stripQuoted(plain)) && !cites.length && !/^\s*(0x)?[0-9a-f]{8,}/i.test(plain)) {
			out.push({level: 'error', line: u.line, rule: 'uncited-statistic', message: `a figure needs a citation in the same item: "${plain.slice(0, 90)}"`});
		}
		for (const brand of BRAND_WATCHLIST) {
			const re = new RegExp(`(^|[^A-Za-z0-9])${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`);
			if (re.test(plain) && !cites.length) out.push({level: 'error', line: u.line, rule: 'brand', message: `"${brand}" is named without a citation: name the category, or cite the incident or document`});
		}
	};
	for (const l of ledes) checkUnit(l);
	for (const s of doc.sections) checkUnit({text: s.title, line: s.line});
	for (const b of walkBlocks(all)) for (const u of units(b)) checkUnit(u);
	for (const s of doc.sections) {
		if (s.spot && !opts.spotIds.has(s.spot)) out.push({level: 'error', line: s.line, rule: 'spot', message: `spot "${s.spot}" is not in scripts/product/spots/catalog.ts`});
		if (opts.requireChapterCallouts && s.kind === 'chapter') {
			const kinds = s.blocks.filter((b) => b.type === 'fence').map((b) => (b as {kind: string}).kind);
			const last2 = kinds.slice(-2).join(',');
			if (last2 !== 'redflag,fix') out.push({level: 'warning', line: s.line, rule: 'callouts', message: `chapter "${s.title}" should end with :::redflag then :::fix`});
		}
	}
	for (const v of Object.values(doc.meta)) checkText(v, 1, out, opts);
	return out;
};

/** Lint for plain marketing copy (landing page, email flow): the same text rules, without document structure. */
export const lintCopy = (text: string, opts: {knownIds: Set<string>}): Finding[] => {
	const out: Finding[] = [];
	text.split('\n').forEach((line, k) => {
		if (!line.trim() || /^\s*<!--/.test(line)) return;
		const {cites, links} = checkText(line.replace(/^\s*(#+|[-*]|\d+\.|>)\s*/, ''), k + 1, out, opts);
		const plain = stripQuoted(line);
		// in copy, a citation is either [@source-id] or an https link to the source on the same line
		if (STAT_RE.test(plain) && !cites.length && !links.length && !/\{\{[^}]+\}\}/.test(line)) {
			out.push({level: 'error', line: k + 1, rule: 'uncited-statistic', message: `a figure needs a citation or a placeholder: "${line.trim().slice(0, 90)}"`});
		}
	});
	return out;
};

export const unusedSources = (allIds: string[], citedIds: Iterable<string>): string[] => {
	const used = new Set(citedIds);
	return allIds.filter((id) => !used.has(id));
};

export const formatFindings = (fs: Finding[], file: string): string =>
	fs.map((f) => `${f.level === 'error' ? 'ERROR' : 'warn '} ${file}:${f.line} [${f.rule}] ${f.message}`).join('\n');
