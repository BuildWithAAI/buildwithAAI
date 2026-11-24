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
