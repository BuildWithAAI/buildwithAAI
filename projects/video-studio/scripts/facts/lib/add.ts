/**
 * Building new facts (pure, plus an injectable prompt for the interactive mode). A new fact is always saved as
 * 'unverified': only `verify` (a direct fetch) and `confirm` (a person's read) can make it direct-read. The one
 * exception is an import of claims that were checked against search-engine extracts (`add --json <file>
 * --search-extract`), which records exactly that: verification 'search-extract' and a "search" check per source.
 */
import {recheckDate} from './stale.ts';
import {isIsoDate} from './dates.ts';
import {suggestNumbers} from './numbers.ts';
import {squash} from './text.ts';
import {TIERS, type Fact, type FactSource, type SourceCheck, type Tier} from './types.ts';

export type AddOptions = {today: string; searchExtract?: boolean};

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').map((s) => squash(s)).filter(Boolean) : []);

/** Input facts from a JSON file's text: one object, an array of objects, or JSON Lines. */
export const parseFactInput = (text: string): unknown[] => {
	const t = text.trim();
	if (!t) return [];
	try {
		const x = JSON.parse(t) as unknown;
		return Array.isArray(x) ? x : [x];
	} catch {
		return t
			.split('\n')
			.filter((l) => l.trim())
			.map((l, i) => {
				try {
					return JSON.parse(l) as unknown;
				} catch (e) {
					throw new Error(`input line ${i + 1} is not JSON: ${(e as Error).message}`);
				}
			});
	}
};

/**
 * Turn one input object into a Fact. Fields the tools own are set here, never taken from the input: verification,
 * verifiedAt, recheckAfter and usage. Input checks are refused except search checks under --search-extract.
 * Throws an Error with a plain message for input it cannot use; everything else is left to validateFact.
 */
export const factFromInput = (x: unknown, opts: AddOptions): Fact => {
	if (!isRecord(x)) throw new Error('each input fact must be a JSON object');
	for (const k of ['verification', 'verifiedAt', 'recheckAfter', 'usage'])
		if (k in x) throw new Error(`"${k}" is set by the tools, not by the input (remove it from ${typeof x.id === 'string' ? x.id : 'the input'})`);
	const entities = strings(x.entities);
	const statement = typeof x.statement === 'string' ? squash(x.statement) : '';
	const numbers = Array.isArray(x.numbers) ? strings(x.numbers) : suggestNumbers(statement, entities);
	const rawSources = Array.isArray(x.sources) ? x.sources : [];
	const sources: FactSource[] = rawSources.map((s, i) => {
		if (!isRecord(s)) throw new Error(`sources[${i}] must be an object`);
		const accessed = typeof s.accessed === 'string' ? s.accessed : opts.today;
		const given = Array.isArray(s.checks) ? (s.checks as unknown[]) : [];
		const checks: SourceCheck[] = given.map((c, j) => {
			if (!isRecord(c) || c.by !== 'search' || !opts.searchExtract)
				throw new Error(`sources[${i}].checks[${j}]: only search checks can be imported, and only with --search-extract (verify and confirm write the others)`);
			if (c.result !== 'found') throw new Error(`sources[${i}].checks[${j}]: an imported search check records what the extract showed, so its result is "found"`);
			return {at: String(c.at ?? accessed), by: 'search', result: 'found', ...(typeof c.detail === 'string' ? {detail: c.detail} : {})} as SourceCheck;
		});
		// under --search-extract a source without a "checks" key gets the default search check; "checks": [] means none
		if (opts.searchExtract && !('checks' in s)) checks.push({at: accessed, by: 'search', result: 'found', detail: 'search-engine extract; the page itself was not opened'});
		const src: FactSource = {
			url: typeof s.url === 'string' ? s.url.trim() : '',
			title: typeof s.title === 'string' ? squash(s.title) : '',
			...(typeof s.cardTitle === 'string' && s.cardTitle.trim() ? {cardTitle: squash(s.cardTitle)} : {}),
			...(typeof s.publisher === 'string' && s.publisher.trim() ? {publisher: squash(s.publisher)} : {}),
			...(typeof s.published === 'string' ? {published: s.published} : {}),
			tier: s.tier as Tier,
			accessed,
			excerpt: typeof s.excerpt === 'string' ? squash(s.excerpt) : '',
			checks,
		};
		return src;
	});
	let verification: Fact['verification'] = 'unverified';
	let verifiedAt: string | null = null;
	let recheckAfter: string | null = null;
	const volatility = (x.volatility === 'historical' ? 'historical' : x.volatility === 'volatile' ? 'volatile' : x.volatility) as Fact['volatility'];
	if (opts.searchExtract) {
		const dates = sources.flatMap((s) => s.checks.filter((c) => c.by === 'search' && c.result === 'found').map((c) => c.at)).filter((d) => isIsoDate(d)).sort();
		if (dates.length) {
			verification = 'search-extract';
			verifiedAt = dates[dates.length - 1];
			recheckAfter = volatility === 'volatile' || volatility === 'historical' ? recheckDate(verifiedAt, volatility) : null;
		}
	}
	const languages = isRecord(x.languages) ? (x.languages as Fact['languages']) : {};
	return {
		id: typeof x.id === 'string' ? x.id.trim() : '',
		statement,
		numbers,
		entities,
		tags: strings(x.tags),
		volatility,
		verification,
		verifiedAt,
		recheckAfter,
		sources,
		languages,
		usage: [],
		notes: typeof x.notes === 'string' ? squash(x.notes) : '',
	};
};

export type Ask = (question: string) => Promise<string>;

/** Interactive add: asks for each field (suggesting the figures it finds in the statement), returns an input object. */
export const promptFact = async (ask: Ask, today: string): Promise<Record<string, unknown>> => {
	const req = async (q: string, check: (s: string) => string | null = (s) => (s ? null : 'required')): Promise<string> => {
		for (let tries = 0; tries < 5; tries++) {
			const a = (await ask(q)).trim();
			const problem = check(a);
			if (!problem) return a;
			await ask(`  ${problem}. Press Enter to try again. `);
		}
		throw new Error(`no valid answer for: ${q.trim()}`);
	};
	const list = (s: string) => s.split(';').map((p) => p.trim()).filter(Boolean);
	const id = await req('id (a-z, 0-9, hyphens, e.g. pumpfun-launch-date): ', (s) => (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length >= 3 && s.length <= 64 ? null : 'use 3-64 characters of a-z, 0-9 and single hyphens'));
	const statement = await req('statement (one atomic claim, attributed if it is an estimate): ');
	const entities = list(await ask('entities (organisations, products, places; never private people), separated by ";": '));
	const suggested = suggestNumbers(statement, entities);
	const numAnswer = await ask(`numbers, separated by ";" (Enter accepts: ${suggested.length ? suggested.join('; ') : 'none found'}): `);
	const numbers = numAnswer.trim() ? list(numAnswer) : suggested;
	const tags = list(await ask('topic tags, lower-case kebab, separated by ";": '));
	const volatility = await req('volatility: volatile (figures that move, open cases) or historical (settled past events): ', (s) => (s === 'volatile' || s === 'historical' ? null : 'type volatile or historical'));
	const sources: Array<Record<string, unknown>> = [];
	do {
		const n = sources.length + 1;
		const url = await req(`source ${n} url (https): `, (s) => (/^https:\/\/\S+$/.test(s) ? null : 'an https URL'));
		const title = await req(`source ${n} title (as the page shows it): `);
		const publisher = (await ask(`source ${n} publisher (optional): `)).trim();
		const tier = await req(`source ${n} tier (primary | secondary | tertiary): `, (s) => (TIERS.includes(s as Tier) ? null : 'type primary, secondary or tertiary'));
		const excerpt = await req(`source ${n} excerpt (copy up to 280 characters from the page; it must contain the claim's figures or names): `, (s) =>
			[...s].length <= 280 ? null : `that is ${[...s].length} characters; the limit is 280`,
		);
		const accessed = (await ask(`source ${n} date you read it (YYYY-MM-DD, Enter = ${today}): `)).trim() || today;
		sources.push({url, title, ...(publisher ? {publisher} : {}), tier, excerpt, accessed});
	} while (/^y/i.test((await ask('add another source? (y/N): ')).trim()));
	const notes = (await ask('notes (how to say it safely, caveats; optional): ')).trim();
	return {id, statement, numbers, entities, tags, volatility, sources, notes};
};
