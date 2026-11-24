/**
 * Read-only adapter to the reusable fact bank (scripts/facts, docs/FACT_BANK.md; another workflow's tool):
 * content/facts/facts.jsonl, one fact per line {id, statement, tags, verification, verifiedAt, recheckAfter,
 * sources[{url, title, publisher, excerpt}], usage, ...}. The batch only looks facts up, by id (an idea's factIds)
 * and by tag (facts already verified for the idea's topics), for the writer packet. Writing, verifying and turning
 * [fact:<id>] tags into sources stay with the bank's own CLI. A JSON list or {facts: [...]} file is read too.
 */
import {existsSync, readFileSync} from 'node:fs';
import {isRecord, str} from './util.ts';

export type BankFact = {
	id: string;
	text: string;
	tags: string[];
	/** direct-read | search-extract | unverified (the bank's Verification). */
	verification: string | null;
	verifiedAt: string | null;
	/** Last day the fact counts as fresh; after it the bank's to-storyboard refuses it until it is re-verified. */
	recheckAfter: string | null;
	sources: Array<{title: string; url: string; publisher: string | null}>;
	usage: string[];
};

export type FactBank = {path: string; facts: Map<string, BankFact>; note: string} | {path: string | null; facts: null; note: string};

const factOf = (raw: Record<string, unknown>): BankFact | null => {
	const id = str(raw.id);
	const text = str(raw.statement) ?? str(raw.claim) ?? str(raw.text);
	if (!id || !text) return null;
	const sources = (Array.isArray(raw.sources) ? raw.sources : []).filter(isRecord).map((s) => ({title: str(s.title) ?? '', url: str(s.url) ?? '', publisher: str(s.publisher)}));
	return {
		id,
		text,
		tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
		verification: str(raw.verification) ?? str(raw.status),
		verifiedAt: str(raw.verifiedAt),
		recheckAfter: str(raw.recheckAfter),
		sources,
		usage: Array.isArray(raw.usage) ? raw.usage.filter((u): u is string => typeof u === 'string') : [],
	};
};

export const loadFactBank = (path: string | null): FactBank => {
	if (!path) return {path: null, facts: null, note: 'No fact bank is configured (factBank.path in scripts/batch/config.json, or --fact-bank).'};
	if (!existsSync(path)) return {path, facts: null, note: `The fact bank ${path} does not exist yet (node scripts/facts/cli.ts add creates it).`};
	const text = readFileSync(path, 'utf8');
	const records: unknown[] = [];
	const trimmed = text.trim();
	if (trimmed.startsWith('[') || (trimmed.startsWith('{') && !trimmed.includes('\n{'))) {
		try {
			const data = JSON.parse(trimmed) as unknown;
			records.push(...(Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.facts) ? data.facts : [data]));
		} catch {
			return {path, facts: null, note: `${path} is not valid JSON.`};
		}
	} else {
		for (const line of text.split('\n')) {
			if (!line.trim()) continue;
			try {
				records.push(JSON.parse(line));
			} catch {
				// the bank's own `validate` reports bad lines; the packet just skips them
			}
		}
	}
	const facts = new Map<string, BankFact>();
	for (const r of records) {
		const f = isRecord(r) ? factOf(r) : null;
		if (f) facts.set(f.id, f);
	}
	return {path, facts, note: `${facts.size} fact(s) in ${path}.`};
};

/** Usable by the bank's to-storyboard on `today`: verified (not "unverified") and not past recheckAfter. */
export const usable = (f: BankFact, today: string): boolean => f.verification !== null && f.verification !== 'unverified' && (f.recheckAfter === null || f.recheckAfter >= today);

/** Facts already in the bank for these topic tags (or already cited by this episode), freshest first. */
export const factsForTags = (bank: FactBank, tags: string[], slugPath: string): BankFact[] => {
	if (!bank.facts) return [];
	const want = new Set(tags.map((t) => t.toLowerCase()));
	return [...bank.facts.values()].filter((f) => f.usage.includes(slugPath) || f.tags.some((t) => want.has(t.toLowerCase()))).sort((a, b) => (b.verifiedAt ?? '').localeCompare(a.verifiedAt ?? '') || a.id.localeCompare(b.id));
};

/* ------------------------------------------------------------------ wording the cited facts do not support */

/** Number words a title can carry a figure in ("Four of six"). "one" is left out: it is a pronoun far more often. */
const NUMBER_WORDS: Record<string, number> = {
	two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
	sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
	hundred: 100, hundreds: 100, thousand: 1000, thousands: 1000, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9, trillion: 1e12, dozen: 12, dozens: 12, half: 0.5,
};
const SUPERLATIVES = ['most', 'least', 'best', 'worst', 'biggest', 'largest', 'smallest', 'fastest', 'slowest', 'oldest', 'newest', 'highest', 'lowest', 'richest', 'deadliest', 'greatest', 'longest'];
/** "first" and "last" claim something only as adjectives ("the first cases"), not as adverbs ("check the holders first"). */
const ORDINAL = /\b(first|last)\s+(?!(?:and|or|in|on|at|to|with|after|before|when|then|time)\b)[a-z]/gi;
/**
 * Phrases that look like a figure or a superlative but claim nothing about the world: idioms, and counts of what the
 * video itself presents ("Three questions for any AI pitch"). They are removed before the check.
 */
const NOT_CLAIMS = [
	/\b(?:best friends?|track record|at (?:least|last|most|best|first)|first and last|last but not least)\b/gi,
	/\b(?:two|three|four|five|six|seven|eight|nine|ten)\s+(?:simple\s+|quick\s+)?(?:questions|steps|signs|habits|tips|checks|rules|ways|things|mistakes|lessons|red flags|moves|words)\b/gi,
];

export type Unsupported = {where: string; text: string; words: string[]};

const words = (text: string): string[] => text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
const digitRuns = (text: string): string[] => (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((d) => d.replace(/,/g, ''));

/** The figures and superlatives in `text`: digit runs, number words, superlatives, adjectival first/last. */
export const claimWords = (text: string): string[] => {
	const t = NOT_CLAIMS.reduce((acc, re) => acc.replace(re, ' '), text);
	const out = new Set<string>(digitRuns(t));
	for (const w of words(t)) if (w in NUMBER_WORDS || SUPERLATIVES.includes(w)) out.add(w);
	for (const m of t.matchAll(ORDINAL)) out.add(m[1].toLowerCase());
	return [...out];
};

/** True when one of the statements supports `word`: the same word or figure, or (for "most") a majority or a share above 50%. */
export const supportedBy = (word: string, statements: string[]): boolean => {
	const all = statements.join(' \n ');
	const ws = new Set(words(all));
	const digits = new Set(digitRuns(all));
	if (/^\d/.test(word)) return digits.has(word);
	if (ws.has(word)) return true;
	if (word in NUMBER_WORDS && digits.has(String(NUMBER_WORDS[word]))) return true;
	// "most" needs a majority or a share above 50%; "more than half of its stake" says nothing about "most models"
	if (word === 'most') return /\bmajority\b/i.test(all) || [...all.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].some((m) => Number(m[1]) > 50);
	if (word === 'half') return /\bhalf\b/i.test(all);
	return false;
};

/**
 * Titles, Short angles and fact needs that carry a figure or a superlative no cited fact states (the 2026-11-24
 * review found a Short titled "Four of six AI traders lost real money" whose fact says neither). A need is checked
 * against its own fact; a title or Short angle against every fact the idea cites. With no cited fact, every figure
 * and superlative is unsupported: the wording waits for research.
 */
export const unsupportedWording = (idea: {id: string; title: string; shortIdeas: string[]; facts: Array<{need: string; factId: string | null}>}, bank: Map<string, BankFact>): Unsupported[] => {
	const out: Unsupported[] = [];
	const statementOf = (id: string | null): string[] => (id && bank.get(id) ? [(bank.get(id) as BankFact).text] : []);
	const cited = idea.facts.flatMap((f) => statementOf(f.factId));
	const check = (where: string, text: string, statements: string[]) => {
		const bad = claimWords(text).filter((w) => !supportedBy(w, statements));
		if (bad.length) out.push({where: `${idea.id} ${where}`, text, words: bad});
	};
	check('title', idea.title, cited);
	idea.shortIdeas.forEach((s, i) => check(`shortIdeas[${i}]`, s, cited));
	idea.facts.forEach((f, i) => {
		if (f.factId) check(`facts[${i}].need`, f.need, statementOf(f.factId));
	});
	return out;
};
