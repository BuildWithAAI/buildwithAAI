/**
 * scripts/news/allowlist.json: names that are NOT private people (rule R4), plus aliases, threat-group names,
 * officials and blocked handles. Loading validates the file; buildIndex adds the brief's own names (incident and
 * protocol names, publishers) and returns a longest-match index over capitalised tokens.
 */
import {isCapitalized, normalizePunct, stripPossessive, tokenize, type Tok} from './text.ts';

export type Official = {name: string; role: string; agency: string; sourceUrl: string; addedOn?: string};

export type AllowlistFile = {
	version: 1;
	updated?: string;
	about?: string;
	show: string[];
	publishers: string[];
	securityFirms: string[];
	organisations: string[];
	protocols: string[];
	chains: string[];
	agencies: string[];
	places: string[];
	terms: string[];
	attributedGroups: string[];
	blocked: string[];
	/** Optional extra ticker symbols, so "1,400 XYZ" reads as a crypto amount. */
	tickers?: string[];
	aliases: string[][];
	officials: Official[];
};

export type AllowCategory =
	| 'show'
	| 'publisher'
	| 'securityFirm'
	| 'organisation'
	| 'protocol'
	| 'chain'
	| 'agency'
	| 'place'
	| 'term'
	| 'group'
	| 'official'
	| 'blocked'
	| 'incident'
	| 'source'
	| 'entity';

export type AllowEntry = {name: string; category: AllowCategory; tokens: string[]; official?: Official};

export type AllowIndex = {
	entries: AllowEntry[];
	byFirst: Map<string, AllowEntry[]>;
	aliasOf: Map<string, Set<string>>; // normalised name -> every name in its alias group (normalised)
	tickers: Set<string>;
};

const LIST_KEYS: Array<[keyof AllowlistFile, AllowCategory]> = [
	['show', 'show'],
	['publishers', 'publisher'],
	['securityFirms', 'securityFirm'],
	['organisations', 'organisation'],
	['protocols', 'protocol'],
	['chains', 'chain'],
	['agencies', 'agency'],
	['places', 'place'],
	['terms', 'term'],
	['attributedGroups', 'group'],
	['blocked', 'blocked'],
];

export type AllowProblem = {level: 'error' | 'warning'; msg: string};

/** Validate a parsed allowlist. Errors make the gate fail closed (INPUT). */
export const validateAllowlist = (raw: unknown): {file: AllowlistFile | null; problems: AllowProblem[]} => {
	const problems: AllowProblem[] = [];
	const e = (msg: string) => problems.push({level: 'error', msg});
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		e('allowlist must be a JSON object');
		return {file: null, problems};
	}
	const o = raw as Record<string, unknown>;
	if (o.version !== 1) e(`allowlist version must be 1 (got ${JSON.stringify(o.version)})`);
	const file: AllowlistFile = {
		version: 1,
		updated: typeof o.updated === 'string' ? o.updated : undefined,
		show: [],
		publishers: [],
		securityFirms: [],
		organisations: [],
		protocols: [],
		chains: [],
		agencies: [],
		places: [],
		terms: [],
		attributedGroups: [],
		blocked: [],
		aliases: [],
		officials: [],
	};
	for (const [key] of LIST_KEYS) {
		const v = o[key];
		if (v === undefined) continue;
		if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) {
			e(`allowlist.${String(key)} must be an array of non-empty strings`);
			continue;
		}
		(file[key] as string[]) = v.map((x: string) => x.trim());
	}
	if (o.tickers !== undefined) {
		if (!Array.isArray(o.tickers) || o.tickers.some((x) => typeof x !== 'string' || !/^\$?[A-Za-z0-9]{2,12}$/.test(x))) e('allowlist.tickers must be an array of ticker symbols');
		else file.tickers = (o.tickers as string[]).map((x) => x.replace(/^\$/, ''));
	}
	const blocked = new Set(file.blocked.map(normName));
	for (const [key, cat] of LIST_KEYS)
		if (cat !== 'blocked') for (const n of file[key] as string[]) if (blocked.has(normName(n))) e(`"${n}" is both blocked and allowed (allowlist.${String(key)})`);
	if (o.aliases !== undefined) {
		if (!Array.isArray(o.aliases) || o.aliases.some((g) => !Array.isArray(g) || g.length < 2 || g.some((x) => typeof x !== 'string' || !x.trim())))
			e('allowlist.aliases must be an array of groups, each an array of 2+ names');
		else file.aliases = (o.aliases as string[][]).map((g) => g.map((x) => x.trim()));
	}
	if (o.officials !== undefined) {
		if (!Array.isArray(o.officials)) e('allowlist.officials must be an array');
		else
			(o.officials as unknown[]).forEach((x, i) => {
				const r = (x ?? {}) as Record<string, unknown>;
				const ok =
					typeof r.name === 'string' &&
					r.name.trim().split(/\s+/).length >= 2 &&
					typeof r.role === 'string' &&
					!!r.role.trim() &&
					typeof r.agency === 'string' &&
					!!r.agency.trim() &&
					typeof r.sourceUrl === 'string' &&
					/^https:\/\/\S+$/.test(r.sourceUrl);
				if (!ok) e(`allowlist.officials[${i}] needs {name (full name), role, agency, sourceUrl (https URL of the law-enforcement or regulator release)}`);
				else file.officials.push({name: String(r.name).trim(), role: String(r.role).trim(), agency: String(r.agency).trim(), sourceUrl: String(r.sourceUrl).trim(), addedOn: typeof r.addedOn === 'string' ? r.addedOn : undefined});
			});
	}
	return {file: problems.some((p) => p.level === 'error') ? null : file, problems};
};

const normTok = (t: string): string => stripPossessive(normalizePunct(t)).toLowerCase();
export const normName = (s: string): string => tokenize(normalizePunct(s)).map((t) => normTok(t.text)).join(' ');

const entryOf = (name: string, category: AllowCategory, official?: Official): AllowEntry | null => {
	const tokens = tokenize(normalizePunct(name)).map((t) => normTok(t.text));
	if (!tokens.length) return null;
	if (tokens.length === 1 && tokens[0].replace(/[^\p{L}\p{N}]/gu, '').length < 2) return null; // "X" alone would match every capital X
	return {name, category, tokens, official};
};

export type DynamicName = {name: string; category: 'incident' | 'source' | 'entity'};

export const buildIndex = (file: AllowlistFile, dynamic: DynamicName[] = [], extraAliases: string[][] = []): AllowIndex => {
	const entries: AllowEntry[] = [];
	for (const [key, cat] of LIST_KEYS) for (const n of file[key] as string[]) {
		const en = entryOf(n, cat);
		if (en) entries.push(en);
	}
	for (const o of file.officials) {
		const en = entryOf(o.name, 'official', o);
		if (en) entries.push(en);
	}
	for (const d of dynamic) {
		const en = entryOf(d.name, d.category);
		if (en) entries.push(en);
	}
	const byFirst = new Map<string, AllowEntry[]>();
	for (const en of entries) {
		const list = byFirst.get(en.tokens[0]) ?? [];
		list.push(en);
		byFirst.set(en.tokens[0], list);
	}
	// blocked first (so a blocked handle is never masked by an allowed entry), then longest first
	const rank = (en: AllowEntry) => (en.category === 'blocked' ? 1000 : 0) + en.tokens.length;
	for (const list of byFirst.values()) list.sort((a, b) => rank(b) - rank(a));
	const aliasOf = new Map<string, Set<string>>();
	for (const g of [...file.aliases, ...extraAliases]) {
		const ns = g.map(normName).filter(Boolean);
		for (const n of ns) {
			const set = aliasOf.get(n) ?? new Set<string>();
			for (const m of ns) set.add(m);
			aliasOf.set(n, set);
		}
	}
	const tickers = new Set((file.tickers ?? []).map((t) => t.toUpperCase()));
	return {entries, byFirst, aliasOf, tickers};
};

export type KnownMatch = {entry: AllowEntry; startTok: number; endTok: number; start: number; end: number; text: string};

/**
 * Known names in a token list, longest match first. A match must start on a capitalised token, unless the entry
 * itself starts lower-case (crypto.news, stETH, dYdX), in which case the text must match its spelling exactly.
 */
export const findKnown = (toks: Tok[], idx: AllowIndex, src: string): KnownMatch[] => {
	const out: KnownMatch[] = [];
	let i = 0;
	while (i < toks.length) {
		const first = normTok(toks[i].text);
		const cands = idx.byFirst.get(first);
		let hit: KnownMatch | null = null;
		if (cands)
			for (const en of cands) {
				const k = en.tokens.length;
				if (i + k > toks.length) continue;
				let ok = true;
				for (let j = 0; j < k && ok; j++) {
					if (normTok(toks[i + j].text) !== en.tokens[j]) ok = false;
					// tokens of one name must be adjacent (only spaces, & or hyphens between)
					if (ok && j > 0 && !/^[\s&-]*$/.test(src.slice(toks[i + j - 1].end, toks[i + j].start))) ok = false;
				}
				if (!ok) continue;
				const t0 = stripPossessive(toks[i].text);
				const exactFirst = t0 === en.name.split(/\s+/)[0];
				// capitalised in the text, or spelled exactly like an entry that starts lower-case (crypto.news, stETH, 1inch)
				const capOk = isCapitalized(t0) || (/^[\p{Ll}\p{N}]/u.test(en.name) && exactFirst);
				if (!capOk) continue;
				// short all-caps blocked handles (CZ, SBF) must match case exactly
				if (en.category === 'blocked' && en.name.length <= 3 && t0 !== en.name) continue;
				hit = {entry: en, startTok: i, endTok: i + k, start: toks[i].start, end: toks[i + k - 1].end, text: src.slice(toks[i].start, toks[i + k - 1].end)};
				break;
			}
		if (hit) {
			out.push(hit);
			i = hit.endTok;
		} else i++;
	}
	return out;
};

/** Every spelling that counts as the same name (the name itself plus its alias group), normalised. */
export const aliasesOf = (idx: AllowIndex, name: string): string[] => {
	const n = normName(name);
	return [...(idx.aliasOf.get(n) ?? new Set([n]))];
};
