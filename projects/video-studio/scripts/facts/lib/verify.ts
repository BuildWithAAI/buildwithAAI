/**
 * Re-verification (pure core; the network is an injected Fetcher). For each source on an allowed host the page is
 * fetched and the excerpt is looked for on it:
 * - found on any source          -> direct-read, verifiedAt = today, recheckAfter renewed;
 * - read but found on none       -> unverified (the support is gone; the report suggests sentences to fix the excerpt);
 * - no source could be read      -> nothing changes, and the report says why. An unreachable page is never "verified".
 * `confirm` records a person's read in a browser, for pages this session cannot fetch (bot challenges, PDFs).
 */
import {hostAllowed} from './store.ts';
import {recheckDate} from './stale.ts';
import {entityAliases, hasEntity, textHasNumber} from './numbers.ts';
import {containsExcerpt, embeddedText, fold, pageTitle, sentences, visibleText} from './text.ts';
import type {CheckResult, Fact, FactSource, SourceCheck, Verification} from './types.ts';

export type Page = {status: number; finalUrl: string; contentType: string; body: string};
export type FetchOutcome = {ok: true; page: Page} | {ok: false; reason: string; status?: number; notAllowed?: boolean};
export type Fetcher = (url: string) => Promise<FetchOutcome>;

export type SourceResult = {index: number; url: string; check: SourceCheck; candidates: string[]};
export type VerifyOutcome = 'upgraded' | 'refreshed' | 'downgraded' | 'unchanged';
export type FactResult = {id: string; before: Verification; after: Verification; outcome: VerifyOutcome; results: SourceResult[]; fact: Fact; message: string};

export const MAX_CHECKS = 10;
const STOP = new Set('the a an and or of to in on for with by at from as is are was were be its it this that new how why what after over into vs via'.split(' '));

const words = (s: string): string[] =>
	fold(s)
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 3 && !STOP.has(w));

const metaContent = (html: string, prop: string): string => {
	const re = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${prop}["'][^>]*>`, 'i');
	const tag = re.exec(html)?.[0] ?? '';
	return /content=["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
};

/** Is this page the article the source names? At least half the words of the stored title appear in the page's titles. */
export const titleMatches = (html: string, sourceTitle: string): boolean => {
	const want = [...new Set(words(sourceTitle))];
	if (!want.length) return true;
	const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)?.[1] ?? '';
	const have = new Set(words([pageTitle(html), metaContent(html, 'og:title'), metaContent(html, 'twitter:title'), h1.replace(/<[^>]+>/g, ' ')].join(' ')));
	return want.filter((w) => have.has(w)).length / want.length >= 0.5;
};

const CHALLENGE = /just a moment|attention required|security checkpoint|access denied|are you a robot|verify you are human|captcha|enable javascript and cookies|request blocked/i;
export const looksLikeChallenge = (html: string): boolean => CHALLENGE.test(pageTitle(html)) || (html.length < 20_000 && /cf-chl|challenge-platform|_vercel_challenge|cf_chl_opt/i.test(html));

/** Up to 3 sentences of the page that carry the most of the claim's figures and entities (verbatim, ≤ 280 chars). */
export const suggestExcerpts = (pageText: string, fact: Pick<Fact, 'numbers' | 'entities' | 'statement'>, max = 3): string[] => {
	const scored: Array<{s: string; score: number}> = [];
	for (const raw of sentences(pageText)) {
		let s = raw;
		if ([...s].length > 280) {
			// keep a verbatim window of the sentence that starts at a word boundary
			const cut = s.slice(0, 280);
			s = cut.slice(0, Math.max(cut.lastIndexOf(' '), 200)).trim();
		}
		const nums = fact.numbers.filter((n) => textHasNumber(s, n, fact.statement)).length;
		const ents = fact.entities.filter((e) => hasEntity(s, e)).length;
		const score = nums * 3 + ents;
		if (score > 0) scored.push({s, score});
	}
	const seen = new Set<string>();
	return scored
		.sort((a, b) => b.score - a.score)
		.filter((x) => (seen.has(x.s) ? false : (seen.add(x.s), true)))
		.slice(0, max)
		.map((x) => x.s);
};

const isHtml = (ct: string): boolean => !ct || /text\/html|application\/xhtml|text\/plain/i.test(ct);

/** Read one source and decide found / missing / unreachable / not-allowed. */
export const checkSource = async (fact: Fact, source: FactSource, index: number, fetcher: Fetcher, allow: string[] | 'any', today: string): Promise<SourceResult> => {
	const done = (result: CheckResult, detail: string, candidates: string[] = []): SourceResult => ({index, url: source.url, check: {at: today, by: 'verify', result, detail}, candidates});
	if (!hostAllowed(source.url, allow)) return done('not-allowed', 'host is not on the fetch allowlist (content/facts/hosts.json); nothing was fetched');
	const got = await fetcher(source.url);
	if (!got.ok) return done(got.notAllowed ? 'not-allowed' : 'unreachable', got.reason);
	const {page} = got;
	if (!isHtml(page.contentType)) return done('unreachable', `not an HTML page (${page.contentType}); read it in a browser, then use confirm`);
	if (looksLikeChallenge(page.body)) return done('unreachable', `HTTP ${page.status}, but the page is a bot challenge, not the article`);
	const text = visibleText(page.body);
	if (containsExcerpt(fold(text), source.excerpt)) return done('found', `excerpt found in the page text (HTTP ${page.status})`);
	if (containsExcerpt(fold(embeddedText(page.body)), source.excerpt)) return done('found', `excerpt found in the article data the page embeds (HTTP ${page.status})`);
	const about = fact.entities.some((e) => entityAliases(e).length && hasEntity(text, e)) || fact.numbers.some((n) => textHasNumber(text, n, fact.statement));
	if (!titleMatches(page.body, source.title) || !about)
		return done('unreachable', `HTTP ${page.status}, but the page does not look like the cited article (title or subject differs: moved, paywall or consent page)`);
	return done('missing', `the page was read (HTTP ${page.status}) and the excerpt is not on it`, suggestExcerpts(text, fact));
};

/**
 * The last MAX_CHECKS checks, but never without the latest "found" one: it is the evidence the fact's verification
 * rests on, and a long run of unreachable reads must not erase it.
 */
export const trimChecks = (checks: SourceCheck[]): SourceCheck[] => {
	if (checks.length <= MAX_CHECKS) return checks;
	const tail = checks.slice(-MAX_CHECKS);
	if (tail.some((c) => c.result === 'found')) return tail;
	const lastFound = [...checks].reverse().find((c) => c.result === 'found');
	return lastFound ? [lastFound, ...checks.slice(-(MAX_CHECKS - 1))] : tail;
};

const withCheck = (s: FactSource, c: SourceCheck): FactSource => ({...s, accessed: c.result === 'found' ? c.at : s.accessed, checks: trimChecks([...s.checks, c])});

/** Re-verify one fact against every source. Sources are read one after another (the fetcher spaces requests per host). */
export const verifyFact = async (fact: Fact, fetcher: Fetcher, allow: string[] | 'any', today: string): Promise<FactResult> => {
	const results: SourceResult[] = [];
	for (let i = 0; i < fact.sources.length; i++) results.push(await checkSource(fact, fact.sources[i], i, fetcher, allow, today));
	const sources = fact.sources.map((s, i) => withCheck(s, results[i].check));
	const before = fact.verification;
	const found = results.filter((r) => r.check.result === 'found').length;
	const missing = results.filter((r) => r.check.result === 'missing').length;
	let next: Fact = {...fact, sources};
	let outcome: VerifyOutcome = 'unchanged';
	let message: string;
	if (found) {
		next = {...next, verification: 'direct-read', verifiedAt: today, recheckAfter: recheckDate(today, fact.volatility)};
		outcome = before === 'direct-read' ? 'refreshed' : 'upgraded';
		message = `${outcome === 'upgraded' ? `upgraded from ${before} to direct-read` : 'direct-read renewed'}: ${found} of ${results.length} source${results.length === 1 ? '' : 's'} carry the excerpt; fresh until ${next.recheckAfter}`;
	} else if (missing) {
		next = {...next, verification: 'unverified', verifiedAt: null, recheckAfter: null};
		outcome = before === 'unverified' ? 'unchanged' : 'downgraded';
		message = `${outcome === 'downgraded' ? `downgraded from ${before} to unverified` : 'still unverified'}: the page${missing === 1 ? ' was' : 's were'} read but no excerpt is on ${missing === 1 ? 'it' : 'them'}; fix the excerpt (suggestions below) or replace the source`;
	} else {
		const why = [...new Set(results.map((r) => r.check.result))].join(', ');
		message = `not re-verified: no source could be read (${why}); status stays ${before}${fact.recheckAfter ? ` (recheck date ${fact.recheckAfter})` : ''}`;
	}
	return {id: fact.id, before, after: next.verification, outcome, results, fact: next, message};
};

export const CONFIRMER = /^[A-Za-z][A-Za-z0-9 ._-]{0,23}$/;

/**
 * A person read source `index` in a browser on `today` and saw the excerpt: record it and mark the fact direct-read.
 * `by` is a role or initials ("owner", "JD"), never a full private name: the repo is public.
 */
export const confirmFact = (fact: Fact, index: number, by: string, today: string): Fact => {
	if (!CONFIRMER.test(by)) throw new Error('--by must be a role or initials (letters, digits, space . _ -; up to 24 characters)');
	if (index < 0 || index >= fact.sources.length) throw new Error(`source ${index + 1} does not exist (the fact has ${fact.sources.length})`);
	const sources = fact.sources.map((s, i) => (i === index ? withCheck(s, {at: today, by: 'person', result: 'found', detail: `excerpt seen on the page in a browser by ${by}`}) : s));
	return {...fact, sources, verification: 'direct-read', verifiedAt: today, recheckAfter: recheckDate(today, fact.volatility)};
};
