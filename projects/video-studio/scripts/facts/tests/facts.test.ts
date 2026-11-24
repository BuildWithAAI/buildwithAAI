/**
 * Fact bank tests (node:test). Run from projects/video-studio:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/facts/tests/facts.test.ts
 * No network: verify runs against a fake fetcher serving tests/fixtures/pages. Names in fixtures/names.txt are invented.
 */
import test, {describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EMPTY_NAMES, loadNames} from '../../claims/lib/names.ts';
import {checkEpisode} from '../../claims/lib/check.ts';
import {factFromInput, promptFact} from '../lib/add.ts';
import {addDays} from '../lib/dates.ts';
import {main} from '../lib/main.ts';
import {extractAtoms, suggestNumbers, textHasNumber, unlistedFigures} from '../lib/numbers.ts';
import {errorsOf, validateBank, validateFact} from '../lib/schema.ts';
import {searchFacts} from '../lib/search.ts';
import {dueFacts, freshness, isUsable, recheckDate} from '../lib/stale.ts';
import {loadBank, serializeBank, hostAllowed} from '../lib/store.ts';
import {primarySource, resolveStoryboard, rewriteText, scanFactTags, topLevelValueSpan} from '../lib/storyboard.ts';
import {containsExcerpt, embeddedText, fold, visibleText} from '../lib/text.ts';
import type {Fact, FactSource} from '../lib/types.ts';
import {checkSource, confirmFact, verifyFact, type Fetcher, type FetchOutcome} from '../lib/verify.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIX = join(HERE, 'fixtures');
const PAGES = join(FIX, 'pages');
const STUDIO = join(HERE, '..', '..', '..');
const TODAY = '2026-11-24';
const NAMES = loadNames(join(FIX, 'names.txt'));
const CTX = {today: TODAY, names: NAMES};

const CN_URL = 'https://crypto.news/pump-funs-token-factory-has-a-69-launch-day-death-rate-coingecko/';
const CN_TITLE = "Pump.fun's token factory has a 69% launch-day death rate: CoinGecko";
const CN_EXCERPT = 'CoinGecko said 12.8m tokens, or 68.67% of the total, recorded their final Pump.fun bonding-curve trade on launch day.';

const source = (over: Partial<FactSource> = {}): FactSource => ({
	url: CN_URL,
	title: CN_TITLE,
	publisher: 'crypto.news',
	tier: 'secondary',
	accessed: TODAY,
	excerpt: CN_EXCERPT,
	checks: [{at: TODAY, by: 'search', result: 'found', detail: 'search-engine extract'}],
	...over,
});

/** A valid search-extract fact; tests override what they need. */
const fact = (over: Partial<Fact> = {}): Fact => ({
	id: 'pumpfun-launch-day-deaths',
	statement: 'CoinGecko found that 12.8 million Pump.fun tokens (68.67%) made their last bonding-curve trade on launch day.',
	numbers: ['12.8 million', '68.67%'],
	entities: ['CoinGecko', 'Pump.fun'],
	tags: ['pump-fun', 'memecoins'],
	volatility: 'historical',
	verification: 'search-extract',
	verifiedAt: TODAY,
	recheckAfter: recheckDate(TODAY, 'historical'),
	sources: [source()],
	languages: {},
	usage: [],
	notes: '',
	...over,
});

const rules = (f: unknown) => errorsOf(validateFact(f, CTX)).map((x) => x.rule);
const page = (file: string, status = 200, contentType = 'text/html; charset=utf-8'): FetchOutcome => ({ok: true, page: {status, finalUrl: 'x', contentType, body: readFileSync(join(PAGES, file), 'utf8')}});
const fetcherOf =
	(map: Record<string, FetchOutcome>): Fetcher =>
	async (url) =>
		map[url] ?? {ok: false, reason: 'HTTP 404'};
const ALLOW = ['crypto.news', 'decrypt.co', 'theblock.co'];

describe('schema validation', () => {
	test('a well-formed fact passes', () => {
		assert.deepEqual(rules(fact()), []);
	});
	test('unknown fields, bad ids, missing fields', () => {
		assert.ok(rules({...fact(), verifiedat: TODAY}).includes('shape'));
		assert.ok(rules(fact({id: 'Bad_ID'})).includes('id'));
		const {notes: _n, ...noNotes} = fact();
		assert.ok(rules(noNotes).includes('shape'));
	});
	test('every figure in the statement must be listed, and every listed figure must be in the statement', () => {
		assert.ok(rules(fact({numbers: ['68.67%']})).includes('number-unlisted'));
		assert.ok(rules(fact({numbers: ['12.8 million', '68.67%', '4.55%']})).includes('number-not-in-statement'));
	});
	test('figures inside a listed entity are names, not claims', () => {
		const f = fact({
			statement: 'GPT-5 lost about 62% in Alpha Arena Season 1, per crypto.news.',
			numbers: ['about 62%'],
			entities: ['GPT-5', 'Alpha Arena Season 1'],
			sources: [source({excerpt: 'GPT-5 lost 62% of its capital in Alpha Arena Season 1, the tracker showed.'})],
		});
		assert.deepEqual(rules(f), []);
		assert.ok(rules({...f, entities: ['Alpha Arena Season 1']}).includes('number-unlisted'));
	});
	test('excerpt limits: 280 characters, relevance, distinct passages', () => {
		assert.ok(rules(fact({sources: [source({excerpt: `${CN_EXCERPT} ${'x'.repeat(200)}`})]})).includes('excerpt-too-long'));
		assert.ok(rules(fact({sources: [source({excerpt: 'Meme coins remain popular with retail traders across many chains.'}), source({url: 'https://decrypt.co/a'})]})).includes('excerpt-relevance'));
		assert.ok(rules(fact({sources: [source({excerpt: `${CN_EXCERPT} … on`})]})).includes('excerpt-fragment'));
	});
	test('a figure no excerpt contains is unsourced', () => {
		const f = fact({sources: [source({excerpt: 'CoinGecko said 12.8m tokens recorded their final Pump.fun bonding-curve trade on launch day.'})]});
		assert.deepEqual(rules(f), ['number-unsourced']);
	});
	test('verification must be backed by a recorded check', () => {
		assert.ok(rules(fact({verification: 'direct-read'})).includes('verification-evidence'));
		const direct = fact({verification: 'direct-read', sources: [source({checks: [{at: TODAY, by: 'verify', result: 'found'}]})]});
		assert.deepEqual(rules(direct), []);
		assert.ok(rules(fact({verification: 'unverified'})).includes('verification-dates'));
		assert.deepEqual(rules(fact({verification: 'unverified', verifiedAt: null, recheckAfter: null})), []);
	});
	test('recheckAfter may not exceed the volatility limit', () => {
		assert.ok(rules(fact({volatility: 'volatile'})).includes('recheck-too-late'));
		assert.deepEqual(rules(fact({volatility: 'volatile', recheckAfter: addDays(TODAY, 30)})), []);
		assert.deepEqual(rules(fact({volatility: 'volatile', recheckAfter: addDays(TODAY, 10)})), []);
	});
	test('sources: https only, dates not in the future, no duplicate URLs', () => {
		assert.ok(rules(fact({sources: [source({url: 'http://crypto.news/x'})]})).includes('source-url'));
		assert.ok(rules(fact({sources: [source({accessed: '2026-12-01'})]})).includes('source-accessed'));
		assert.ok(rules(fact({sources: [source(), source()]})).includes('source-duplicate'));
	});
	test('privacy: private names, wallet addresses and redaction placeholders are errors', () => {
		const named = validateFact(fact({notes: 'Story idea from Quentin Marrowby.'}), CTX);
		const hit = named.find((x) => x.rule === 'private-name');
		assert.ok(hit);
		assert.ok(!hit.message.includes('Marrowby'), 'a matched private name is never printed');
		assert.ok(rules(fact({sources: [source({url: `${CN_URL}?w=0x52908400098527886E0F7030069857D2E4169EE7`})]})).includes('wallet-address'));
		assert.ok(rules(fact({statement: 'CoinGecko said [named person] made 12.8 million Pump.fun tokens (68.67%) on launch day.'})).includes('redaction-placeholder'));
		const confirmedByName = confirmFact(fact(), 0, 'Quentin Marrowby', TODAY);
		assert.ok(rules(confirmedByName).includes('private-name'), 'a confirmer\'s private name in a check is caught too');
	});
	test('translations: shape is an error, lost digits are a warning', () => {
		assert.ok(rules(fact({languages: {fr: {statement: 'x', translation: 'machine'}} as never})).includes('language'));
		const w = validateFact(fact({languages: {es: {statement: 'CoinGecko dice que 12,8 millones de tokens murieron.', translation: 'machine'}}}), CTX);
		assert.ok(w.some((x) => x.rule === 'translation-numbers' && x.level === 'warning'));
		assert.deepEqual(rules(fact({languages: {es: {statement: 'CoinGecko halló que 12,8 millones de tokens (68,67%) murieron el día del lanzamiento.', translation: 'machine'}}})), []);
	});
	test('a bank with a duplicate id fails', () => {
		assert.ok(validateBank([fact(), fact()], CTX).some((x) => x.rule === 'id-duplicate'));
	});
});

describe('figures and excerpt containment', () => {
	test('scale words, separators and currency forms are one value', () => {
		assert.ok(textHasNumber('CoinGecko said 12.8m tokens died', '12.8 million'));
		assert.ok(textHasNumber('about 12,800,000 tokens', '12.8 million'));
		assert.ok(textHasNumber('Pump.fun raised $500 million', '$500M'));
		assert.ok(textHasNumber('a total of 1.08 billion dollars', '$1.08 billion'));
	});
	test('kinds never cross: a percentage is not money, ETH is not SOL', () => {
		assert.ok(!textHasNumber('it paid $68.67 in fees', '68.67%'));
		assert.ok(!textHasNumber('the agent sent 55.5 SOL', '55.5 ETH'));
		assert.ok(textHasNumber('it sent 52.4 million LOBSTAR', '52.4M tokens'));
	});
	test('a figure inside a longer one does not count', () => {
		assert.ok(!textHasNumber('45% of tokens', '5%'));
		assert.ok(!textHasNumber('in 2024, 15 wallets', '5 wallets'));
	});
	test('qualifiers set the tolerance', () => {
		assert.ok(textHasNumber('just 850,180 tokens lasted', 'about 850,000'));
		assert.ok(!textHasNumber('just 850,180 tokens lasted', '850,000'));
		assert.ok(textHasNumber('revenue of $1.08 billion', 'over $1 billion'));
		assert.ok(!textHasNumber('revenue of $1.08 billion', '$1 billion'));
		assert.ok(textHasNumber('lost 82% in a week', 'more than 80%'));
		assert.ok(!textHasNumber('lost 78% in a week', 'more than 80%'));
		assert.ok(textHasNumber('fewer than 5 of them', 'fewer than 5'));
		// a statement's qualifier applies to its bare numbers[] entry
		assert.ok(textHasNumber('just 850,180 tokens lasted', '850,000', 'About 850,000 tokens lasted.'));
	});
	test('dates in any common form', () => {
		for (const t of ['launched on January 19, 2024', 'launched 19 Jan. 2024', 'launched 2024-01-19', 'launched... on January 19th, 2024']) assert.ok(textHasNumber(t, 'January 19, 2024'), t);
		assert.ok(textHasNumber('On Jan. 19 the site went live; 2024 was its first year', 'January 19, 2024'));
		assert.ok(!textHasNumber('launched January 19, 2025', 'January 19, 2024'));
		assert.ok(!textHasNumber('it may 5 times', 'May 5'), 'lower-case "may" is a verb');
	});
	test('names with digits are not figures', () => {
		const a = extractAtoms('ai16z and a16z on Web3 with x402');
		assert.deepEqual(a, []);
		assert.deepEqual(
			unlistedFigures('Claude Opus 4.5 and GPT-5 exploited 19 of 34 contracts.', ['19 of 34'], ['Claude Opus 4.5', 'GPT-5']).map((x) => x.raw),
			[],
		);
	});
	test('suggested numbers keep their qualifier', () => {
		assert.deepEqual(suggestNumbers('About 850,000 tokens lasted more than 90 days, CoinGecko said on June 18, 2026.'), ['about 850,000 tokens', 'more than 90', 'June 18, 2026']);
	});
	test('excerpts match through typography, case and elisions, in page order', () => {
		const hay = fold('Pump.fun’s factory — CoinGecko said “12.8m tokens” died &amp; more. Later: 850,180 tokens lasted.');
		assert.ok(containsExcerpt(hay, `Pump.fun's factory - coingecko said "12.8m tokens" died & more.`));
		assert.ok(containsExcerpt(hay, 'CoinGecko said "12.8m tokens" died … 850,180 tokens lasted.'));
		assert.ok(!containsExcerpt(hay, '850,180 tokens lasted … CoinGecko said "12.8m tokens" died'), 'passages must keep page order');
		assert.ok(!containsExcerpt(hay, 'CoinGecko said 12.9m tokens died'));
	});
	test('page text: visible text and embedded article data', () => {
		const html = readFileSync(join(PAGES, 'article.html'), 'utf8');
		const vis = visibleText(html);
		assert.ok(vis.includes('Jan. 14, 2024'), 'entities and &nbsp; are decoded');
		assert.ok(!vis.includes('dataLayer'), 'scripts are dropped');
		const emb = embeddedText(readFileSync(join(PAGES, 'script-rendered.html'), 'utf8'));
		assert.ok(emb.includes('The $ai16z ticker will remain the same'));
	});
});

describe('verify and confirm', () => {
	const decryptFact = fact({
		id: 'ai16z-rebrand',
		statement: 'ai16z changed its name to ElizaOS after Andreessen Horowitz raised brand-confusion concerns.',
		numbers: [],
		entities: ['ai16z', 'ElizaOS', 'Andreessen Horowitz|a16z'],
		sources: [
			source({
				url: 'https://decrypt.co/303244/ai-dao-ai16z-becomes-elizaos-amid-branding-confusion-concerns',
				title: 'AI DAO ai16z Becomes ElizaOS Amid Branding Confusion Concerns',
				publisher: 'Decrypt',
				excerpt: 'AI decentralized autonomous organization ai16z has changed its name to ElizaOS following concerns from tech venture capital firm Andreessen Horowitz (a16z) over brand confusion.',
			}),
		],
	});
	test('found in the page text: upgraded to direct-read, dates renewed, accessed updated', async () => {
		const r = await verifyFact(fact(), fetcherOf({[CN_URL]: page('article.html')}), ALLOW, '2026-12-01');
		assert.equal(r.outcome, 'upgraded');
		assert.equal(r.fact.verification, 'direct-read');
		assert.equal(r.fact.verifiedAt, '2026-12-01');
		assert.equal(r.fact.recheckAfter, '2027-12-01');
		assert.equal(r.fact.sources[0].accessed, '2026-12-01');
		assert.deepEqual(r.fact.sources[0].checks.at(-1), {at: '2026-12-01', by: 'verify', result: 'found', detail: 'excerpt found in the page text (HTTP 200)'});
		assert.deepEqual(errorsOf(validateFact(r.fact, {...CTX, today: '2026-12-01'})), []);
	});
	test('found in the article data a script-rendered page embeds', async () => {
		const r = await verifyFact(decryptFact, fetcherOf({[decryptFact.sources[0].url]: page('script-rendered.html')}), ALLOW, TODAY);
		assert.equal(r.outcome, 'upgraded');
		assert.match(r.results[0].check.detail ?? '', /embeds/);
	});
	test('read but missing: downgraded to unverified, with verbatim suggestions', async () => {
		const f = fact({sources: [source({excerpt: 'CoinGecko found 12.8 million tokens (68.67%) died on day one on Pump.fun.'})]});
		const r = await verifyFact(f, fetcherOf({[CN_URL]: page('article.html')}), ALLOW, TODAY);
		assert.equal(r.outcome, 'downgraded');
		assert.equal(r.fact.verification, 'unverified');
		assert.equal(r.fact.verifiedAt, null);
		assert.equal(r.results[0].check.result, 'missing');
		assert.ok(r.results[0].candidates.includes(CN_EXCERPT));
		assert.deepEqual(rules(r.fact), []);
	});
	test('never verified from an unreadable page: challenge, error, wrong page, PDF, host off the list', async () => {
		const cases: Array<[FetchOutcome, string]> = [
			[page('challenge.html', 200), 'unreachable'],
			[{ok: false, status: 403, reason: 'HTTP 403 (Cloudflare bot challenge)'}, 'unreachable'],
			[page('other-article.html'), 'unreachable'],
			[page('article.html', 200, 'application/pdf'), 'unreachable'],
			[{ok: false, notAllowed: true, reason: 'redirected to blockworks.com, which is not on the allowlist'}, 'not-allowed'],
		];
		for (const [outcome, want] of cases) {
			const r = await verifyFact(fact(), fetcherOf({[CN_URL]: outcome}), ALLOW, '2026-12-01');
			assert.equal(r.results[0].check.result, want);
			assert.equal(r.outcome, 'unchanged');
			assert.equal(r.fact.verification, 'search-extract');
			assert.equal(r.fact.verifiedAt, TODAY, 'dates are untouched');
			assert.equal(r.fact.sources[0].accessed, TODAY);
		}
		const off = await checkSource(fact(), source({url: 'https://www.sec.gov/x'}), 0, async () => {
			throw new Error('must not fetch');
		}, ALLOW, TODAY);
		assert.equal(off.check.result, 'not-allowed');
	});
	test('one source found outweighs another missing; checks are capped at 10', async () => {
		const many = Array.from({length: 12}, (_, i) => ({at: addDays(TODAY, -40 + i), by: 'search' as const, result: 'found' as const}));
		const f = fact({sources: [source({checks: many}), source({url: 'https://decrypt.co/x', title: CN_TITLE, excerpt: 'CoinGecko counted 12.8 million dead Pump.fun tokens, 68.67% of all.'})]});
		const r = await verifyFact(f, fetcherOf({[CN_URL]: page('article.html'), 'https://decrypt.co/x': page('article.html')}), ALLOW, TODAY);
		assert.equal(r.fact.verification, 'direct-read');
		assert.equal(r.fact.sources[0].checks.length, 10);
		assert.equal(r.fact.sources[1].checks.at(-1)?.result, 'missing');
	});
	test('a long run of unreadable checks never erases the read the verification rests on', async () => {
		let f = confirmFact(fact(), 0, 'owner', TODAY);
		for (let i = 1; i <= 12; i++) f = (await verifyFact(f, fetcherOf({[CN_URL]: {ok: false, status: 403, reason: 'HTTP 403'}}), ALLOW, addDays(TODAY, i))).fact;
		assert.equal(f.sources[0].checks.length, 10);
		assert.deepEqual(f.sources[0].checks[0], {at: TODAY, by: 'person', result: 'found', detail: 'excerpt seen on the page in a browser by owner'});
		assert.deepEqual(errorsOf(validateFact(f, {...CTX, today: addDays(TODAY, 12)})), []);
	});
	test('confirm records a person\'s read; the confirmer must be a role or initials', () => {
		const c = confirmFact(fact(), 0, 'owner', '2026-12-02');
		assert.equal(c.verification, 'direct-read');
		assert.equal(c.sources[0].checks.at(-1)?.by, 'person');
		assert.deepEqual(errorsOf(validateFact(c, {...CTX, today: '2026-12-02'})), []);
		assert.throws(() => confirmFact(fact(), 0, 'Somebody With A Very Long Full Name', TODAY));
		assert.throws(() => confirmFact(fact(), 3, 'JD', TODAY));
	});
	test('host allowlist matches subdomains, not look-alikes', () => {
		assert.ok(hostAllowed('https://www.theblock.co/post/1', ALLOW));
		assert.ok(!hostAllowed('https://theblock.co.evil.example/post/1', ALLOW));
		assert.ok(!hostAllowed('http://crypto.news/x', ALLOW));
	});
});

describe('stale logic', () => {
	test('fresh through recheckAfter, stale the day after', () => {
		const f = fact({volatility: 'volatile', recheckAfter: addDays(TODAY, 30)});
		assert.equal(freshness(f, addDays(TODAY, 30)).state, 'fresh');
		assert.deepEqual(freshness(f, addDays(TODAY, 31)), {state: 'stale', recheckAfter: '2026-12-24', overdueDays: 1});
		assert.ok(isUsable(f, TODAY));
		assert.ok(!isUsable(fact({verification: 'unverified', verifiedAt: null, recheckAfter: null}), TODAY));
	});
	test('policy periods: volatile 30 days, historical 365', () => {
		assert.equal(recheckDate('2026-11-24', 'volatile'), '2026-12-24');
		assert.equal(recheckDate('2026-11-24', 'historical'), '2027-11-24');
	});
	test('due list: unverified first, then the longest overdue, then soon-due within the window', () => {
		const facts = [
			fact({id: 'fresh-long', recheckAfter: '2027-06-01'}),
			fact({id: 'soon', volatility: 'volatile', recheckAfter: '2026-11-28'}),
			fact({id: 'stale-old', volatility: 'volatile', recheckAfter: '2026-10-01'}),
			fact({id: 'stale-new', volatility: 'volatile', recheckAfter: '2026-11-20'}),
			fact({id: 'never', verification: 'unverified', verifiedAt: null, recheckAfter: null}),
		];
		assert.deepEqual(dueFacts(facts, TODAY).map((r) => r.id), ['never', 'stale-old', 'stale-new']);
		assert.deepEqual(dueFacts(facts, TODAY, 7).map((r) => `${r.id}:${r.state}:${r.days}`), ['never:unverified:null', 'stale-old:stale:54', 'stale-new:stale:4', 'soon:soon:4']);
	});
});

describe('to-storyboard', () => {
	const sb = (narration: string, extra: Record<string, unknown> = {}) => ({
		version: 1,
		channel: 'zoora-test',
		slug: 'fact-demo',
		lang: 'en',
		sourceLang: 'en',
		title: 'POV: Your coin dies before lunch',
		fiction: true,
		scenes: [
			{id: 's01', type: 'hook', narration: 'You launch a coin before breakfast. It dies before lunch.'},
			{id: 's02', type: 'talk', narration},
			{id: 's03', type: 'cta', narration: 'None of this is financial advice. This story is fictional. Subscribe.'},
		],
		sources: [],
		...extra,
	});
	const direct = fact({verification: 'direct-read', sources: [source({checks: [{at: TODAY, by: 'verify', result: 'found'}]})]});
	const second = fact({
		id: 'pumpfun-90-day-survivors',
		statement: 'CoinGecko said just 850,180 Pump.fun tokens (4.55%) lasted more than 90 days.',
		numbers: ['850,180', '4.55%', 'more than 90'],
		sources: [source({excerpt: 'The report said just 850,180 tokens, or 4.55%, lasted more than 90 days.', checks: [{at: TODAY, by: 'verify', result: 'found'}]})],
		verification: 'direct-read',
	});

	test('[fact:id] becomes [src:id] plus one verified sources[] entry with the excerpt as its quote', () => {
		const r = resolveStoryboard(sb('Most die fast: 68.67% of Pump.fun tokens traded last on launch day [fact:pumpfun-launch-day-deaths].'), [direct], CTX);
		assert.deepEqual(errorsOf(r.findings), []);
		const scenes = r.storyboard.scenes as Array<{narration: string}>;
		assert.equal(scenes[1].narration, 'Most die fast: 68.67% of Pump.fun tokens traded last on launch day [src:pumpfun-launch-day-deaths].');
		assert.deepEqual(r.storyboard.sources, [{id: 'pumpfun-launch-day-deaths', title: CN_TITLE, url: CN_URL, quote: CN_EXCERPT, accessed: TODAY, status: 'verified'}]);
		assert.deepEqual(r.added, ['pumpfun-launch-day-deaths']);
		assert.equal(r.changed, true);
	});
	test('a tag may list several facts', () => {
		const r = resolveStoryboard(sb('CoinGecko tracked how long they live [fact:pumpfun-launch-day-deaths, pumpfun-90-day-survivors].'), [direct, second], CTX);
		assert.deepEqual(errorsOf(r.findings), []);
		assert.match((r.storyboard.scenes as Array<{narration: string}>)[1].narration, /\[src:pumpfun-launch-day-deaths,pumpfun-90-day-survivors\]\.$/);
		assert.equal((r.storyboard.sources as unknown[]).length, 2);
	});
	test('refuses unknown, unverified and stale facts, and changes nothing', () => {
		const input = sb('Claim [fact:pumpfun-launch-day-deaths]. Other [fact:no-such-fact].');
		const r = resolveStoryboard(input, [direct], CTX);
		assert.deepEqual(errorsOf(r.findings).map((f) => f.rule), ['unknown-fact']);
		assert.deepEqual(r.storyboard, input);
		assert.equal(r.changed, false);
		const unv = resolveStoryboard(sb('Claim [fact:pumpfun-launch-day-deaths].'), [fact({verification: 'unverified', verifiedAt: null, recheckAfter: null})], CTX);
		assert.deepEqual(errorsOf(unv.findings).map((f) => f.rule), ['fact-unverified']);
		const stale = resolveStoryboard(sb('Claim [fact:pumpfun-launch-day-deaths].'), [direct], {...CTX, today: '2027-11-25'});
		assert.deepEqual(errorsOf(stale.findings).map((f) => f.rule), ['fact-stale']);
		const invalid = resolveStoryboard(sb('Claim [fact:pumpfun-launch-day-deaths].'), [{...direct, numbers: ['68.67%']}], CTX);
		assert.deepEqual(errorsOf(invalid.findings).map((f) => f.rule), ['fact-invalid']);
	});
	test('search-extract facts warn, and fail with --require-direct', () => {
		const r = resolveStoryboard(sb('Claim [fact:pumpfun-launch-day-deaths].'), [fact()], CTX);
		assert.deepEqual(errorsOf(r.findings), []);
		assert.ok(r.findings.some((f) => f.rule === 'fact-search-extract' && f.level === 'warning'));
		const strict = resolveStoryboard(sb('Claim [fact:pumpfun-launch-day-deaths].'), [fact()], {...CTX, requireDirect: true});
		assert.deepEqual(errorsOf(strict.findings).map((f) => f.rule), ['fact-search-extract']);
	});
	test('tags outside narration or inside {display|spoken} markup are refused', () => {
		const out = resolveStoryboard(sb('Claim [fact:pumpfun-launch-day-deaths].', {title: 'Title [fact:pumpfun-launch-day-deaths]'}), [direct], CTX);
		assert.ok(errorsOf(out.findings).some((f) => f.rule === 'fact-tag-outside-narration' && f.where === 'title'));
		const inside = resolveStoryboard(sb('{68.67% [fact:pumpfun-launch-day-deaths]|most} died.'), [direct], CTX);
		assert.ok(errorsOf(inside.findings).some((f) => f.rule === 'fact-tag-in-markup'));
		assert.deepEqual(scanFactTags('A [fact:Bad_Id] b').map((t) => t.bad), [['Bad_Id']]);
	});
	test('re-running refreshes sources it wrote and re-checks freshness; a foreign source with the same id is a conflict', () => {
		const first = resolveStoryboard(sb('Claim [fact:pumpfun-launch-day-deaths].'), [direct], CTX).storyboard;
		const renewed = {...direct, sources: [source({accessed: '2026-12-20', checks: [{at: '2026-12-20', by: 'verify', result: 'found'}]})], verifiedAt: '2026-12-20', recheckAfter: '2027-12-20'};
		const again = resolveStoryboard(first, [renewed], {...CTX, today: '2026-12-21'});
		assert.deepEqual(again.refreshed, ['pumpfun-launch-day-deaths']);
		assert.equal((again.storyboard.sources as Array<{accessed: string}>)[0].accessed, '2026-12-20');
		const later = resolveStoryboard(first, [direct], {...CTX, today: '2028-01-01'});
		assert.deepEqual(errorsOf(later.findings).map((f) => f.rule), ['fact-stale']);
		const clash = resolveStoryboard(sb('Claim [fact:pumpfun-launch-day-deaths].', {sources: [{id: 'pumpfun-launch-day-deaths', title: 't', url: 'https://example.com/other', accessed: TODAY, status: 'verified'}]}), [direct], CTX);
		assert.deepEqual(errorsOf(clash.findings).map((f) => f.rule), ['source-id-conflict']);
	});
	test('the cited source: directly read first, then the stronger tier', () => {
		const f = fact({
			sources: [
				source({url: 'https://a.example/1', tier: 'primary'}),
				source({url: 'https://b.example/2', tier: 'tertiary', checks: [{at: TODAY, by: 'verify', result: 'found'}]}),
				source({url: 'https://c.example/3', tier: 'secondary', checks: [{at: TODAY, by: 'verify', result: 'missing'}]}),
			],
		});
		assert.equal(primarySource(f)?.url, 'https://b.example/2');
		assert.equal(primarySource({...f, sources: f.sources.slice(0, 1).concat(f.sources[2])})?.url, 'https://a.example/1');
	});
	test('a cardTitle replaces an unsafe headline on the sources card, and must name the publisher', () => {
		const safe = {...direct, sources: [{...direct.sources[0], cardTitle: 'crypto.news report on the CoinGecko study'}]};
		const r = resolveStoryboard(sb('Claim [fact:pumpfun-launch-day-deaths].'), [safe], CTX);
		assert.equal((r.storyboard.sources as Array<{title: string}>)[0].title, 'crypto.news report on the CoinGecko study');
		assert.ok(rules({...direct, sources: [{...direct.sources[0], cardTitle: 'A calmer headline'}]}).includes('source-card-title'));
	});
	test('a translation without the fact in its language warns', () => {
		const r = resolveStoryboard(sb('Afirmación [fact:pumpfun-launch-day-deaths].', {lang: 'es'}), [direct], CTX);
		assert.ok(r.findings.some((f) => f.rule === 'no-translation'));
	});
	test('the written file keeps the author\'s formatting and parses to the resolved storyboard', () => {
		const text = '{\n  "version": 1,\n  "slug": "x",\n  "scenes": [\n    {"id": "s01", "narration": "Claim [fact:pumpfun-launch-day-deaths]."}\n  ],\n  "sources": []\n}\n';
		const input = JSON.parse(text) as Record<string, unknown>;
		const r = resolveStoryboard(input, [direct], CTX);
		const out = rewriteText(text, r, input);
		assert.ok(out.includes('{"id": "s01", "narration": "Claim [src:pumpfun-launch-day-deaths]."}'), 'compact lines stay compact');
		assert.deepEqual(JSON.parse(out), r.storyboard);
		assert.deepEqual(topLevelValueSpan('{"a": {"sources": 1}, "sources": [1, "]"]}', 'sources'), {start: 33, end: 41, keyStart: 22});
	});
	test('the resolved storyboard passes the existing claim gate unchanged', () => {
		const dir = join(mkdtempSync(join(tmpdir(), 'facts-')), 'zoora-test', 'fact-demo');
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'research.md'), '# Research\n\n## Must not say (binding for the script)\n\n- (none)\n');
		const r = resolveStoryboard(sb('You are not alone: CoinGecko found that 68.67% of Pump.fun tokens made their last trade on launch day [fact:pumpfun-launch-day-deaths].'), [direct], CTX);
		writeFileSync(join(dir, 'storyboard.json'), `${JSON.stringify(r.storyboard, null, 2)}\n`);
		const report = checkEpisode({dir, today: TODAY, namesPath: null, offersPath: null, now: '2026-11-24T12:00:00Z'});
		assert.equal(report.pass, true, JSON.stringify(report.findings.filter((f) => f.level === 'error')));
		assert.deepEqual(report.claims[0].ids, ['pumpfun-launch-day-deaths']);
		// the same narration without resolving fails the gate: the claim has no [src:]
		writeFileSync(join(dir, 'storyboard.json'), JSON.stringify(sb('You are not alone: CoinGecko found that 68.67% of Pump.fun tokens made their last trade on launch day.')));
		assert.equal(checkEpisode({dir, today: TODAY, namesPath: null, offersPath: null}).pass, false);
	});
});

describe('add and search', () => {
	test('new facts are unverified; tool-owned fields and fake checks are refused', () => {
		const input = {id: 'x-fact', statement: 'CoinGecko said 68.67% died.', entities: ['CoinGecko'], volatility: 'historical', tags: ['t'], sources: [{url: CN_URL, title: CN_TITLE, tier: 'secondary', excerpt: CN_EXCERPT}]};
		const f = factFromInput(input, {today: TODAY});
		assert.equal(f.verification, 'unverified');
		assert.deepEqual(f.numbers, ['68.67%'], 'numbers are suggested from the statement');
		assert.equal(f.sources[0].accessed, TODAY);
		assert.throws(() => factFromInput({...input, verification: 'direct-read'}, {today: TODAY}), /set by the tools/);
		assert.throws(() => factFromInput({...input, sources: [{...input.sources[0], checks: [{at: TODAY, by: 'verify', result: 'found'}]}]}, {today: TODAY, searchExtract: true}), /only search checks/);
		const s = factFromInput(input, {today: TODAY, searchExtract: true});
		assert.equal(s.verification, 'search-extract');
		assert.equal(s.recheckAfter, '2027-11-24');
		assert.equal(s.sources[0].checks[0].by, 'search');
	});
	test('interactive add asks for every field and suggests the figures', async () => {
		const answers = ['pumpfun-launch-day-deaths', 'CoinGecko found that 12.8 million Pump.fun tokens (68.67%) made their last bonding-curve trade on launch day.', 'CoinGecko; Pump.fun', '', 'pump-fun; memecoins', 'historical', CN_URL, CN_TITLE, 'crypto.news', 'secondary', CN_EXCERPT, '', 'n', 'CoinGecko does not call them scams.'];
		const asked: string[] = [];
		const input = await promptFact(async (q) => {
			asked.push(q);
			return answers.shift() ?? '';
		}, TODAY);
		assert.ok(asked.some((q) => q.includes('12.8 million; 68.67%')), 'the suggestion is shown');
		const f = factFromInput(input, {today: TODAY});
		assert.deepEqual(f.numbers, ['12.8 million', '68.67%']);
		assert.deepEqual(rules({...f}), []);
	});
	test('search ranks id, entity and tag hits and filters by status', () => {
		const facts = [fact(), fact({id: 'ai16z-rebrand', statement: 'ai16z changed its name to ElizaOS.', numbers: [], entities: ['ai16z', 'ElizaOS'], tags: ['ai-agents'], sources: [source({excerpt: 'ai16z has changed its name to ElizaOS'})]})];
		assert.deepEqual(searchFacts(facts, 'elizaos', {today: TODAY}).map((h) => h.fact.id), ['ai16z-rebrand']);
		assert.deepEqual(searchFacts(facts, '', {today: TODAY, tags: ['pump-fun']}).map((h) => h.fact.id), ['pumpfun-launch-day-deaths']);
		assert.deepEqual(searchFacts(facts, 'coingecko 68.67%', {today: TODAY}).map((h) => h.fact.id), ['pumpfun-launch-day-deaths']);
		assert.deepEqual(searchFacts(facts, '', {today: TODAY, status: 'direct-read'}), []);
	});
});

describe('CLI', () => {
	const run = async (argv: string[], fetcher?: Fetcher) => {
		const out: string[] = [];
		const err: string[] = [];
		const code = await main(argv, {out: (s) => out.push(s), err: (s) => err.push(s), fetcher});
		return {code, out: out.join('\n'), err: err.join('\n')};
	};
	test('add, verify, stale, to-storyboard --write (records usage), validate', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'facts-cli-'));
		const bank = join(dir, 'facts.jsonl');
		const input = join(dir, 'in.json');
		const hosts = join(dir, 'hosts.json');
		writeFileSync(hosts, JSON.stringify({allow: ['crypto.news']}));
		writeFileSync(input, JSON.stringify({...fact(), verification: undefined, verifiedAt: undefined, recheckAfter: undefined, usage: undefined, sources: [{...source(), checks: undefined}]}));
		const common = ['--bank', bank, '--today', TODAY, '--names', join(FIX, 'names.txt')];
		let r = await run(['add', '--json', input, ...common]);
		assert.equal(r.code, 0, r.out + r.err);
		assert.match(r.out, /saved \[fact:pumpfun-launch-day-deaths\] as unverified/);
		r = await run(['add', '--json', input, ...common]);
		assert.equal(r.code, 1, 'a second add of the same id is refused');
		r = await run(['stale', ...common]);
		assert.match(r.out, /pumpfun-launch-day-deaths\s+unverified/);
		r = await run(['to-storyboard', join(FIX, 'missing.json'), ...common]);
		assert.equal(r.code, 2);
		r = await run(['verify', 'pumpfun-launch-day-deaths', '--hosts', hosts, ...common], fetcherOf({[CN_URL]: page('article.html')}));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /1 upgraded/);
		const ep = join(dir, 'zoora-test', 'fact-demo');
		mkdirSync(ep, {recursive: true});
		const sbText = `${JSON.stringify({version: 1, channel: 'zoora-test', slug: 'fact-demo', lang: 'en', sourceLang: 'en', title: 't', fiction: false, scenes: [{id: 's01', type: 'talk', narration: 'Claim [fact:pumpfun-launch-day-deaths].'}], sources: []}, null, 2)}\n`;
		writeFileSync(join(ep, 'storyboard.json'), sbText);
		r = await run(['to-storyboard', ep, '--check', ...common]);
		assert.equal(r.code, 0, r.err);
		assert.equal(readFileSync(join(ep, 'storyboard.json'), 'utf8'), sbText, '--check writes nothing');
		r = await run(['to-storyboard', ep, '--write', ...common]);
		assert.equal(r.code, 0, r.err);
		assert.match(readFileSync(join(ep, 'storyboard.json'), 'utf8'), /\[src:pumpfun-launch-day-deaths\]/);
		const saved = loadBank(bank).facts[0];
		assert.deepEqual(saved.usage, ['zoora-test/fact-demo']);
		assert.equal(saved.verification, 'direct-read');
		r = await run(['validate', ...common]);
		assert.equal(r.code, 0, r.out);
		r = await run(['search', 'coingecko', ...common]);
		assert.match(r.out, /\[fact:pumpfun-launch-day-deaths\]\s+direct-read, fresh to 2027-11-24/);
		r = await run(['verify', '--all-due', '--hosts', hosts, ...common], async () => {
			throw new Error('nothing is due, so nothing is fetched');
		});
		assert.equal(r.code, 0);
		r = await run(['to-storyboard', ep, '--check', ...common, '--today', '2027-11-25']);
		assert.equal(r.code, 1, 'a fact that went stale fails a re-run');
		assert.match(r.err, /fact-stale/);
	});
	test('add from stdin, confirm a browser read, and survive a malformed line', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'facts-cli-'));
		const bank = join(dir, 'facts.jsonl');
		const common = ['--bank', bank, '--today', TODAY, '--no-names'];
		const input = JSON.stringify({...fact(), verification: undefined, verifiedAt: undefined, recheckAfter: undefined, usage: undefined, sources: [{...source(), checks: undefined}]});
		const out: string[] = [];
		let code = await main(['add', '--json', '-', ...common], {out: (x) => out.push(x), err: (x) => out.push(x), stdin: () => input});
		assert.equal(code, 0, out.join('\n'));
		const r = await run(['confirm', 'pumpfun-launch-day-deaths', '--source', '1', '--by', 'owner', ...common]);
		assert.equal(r.code, 0, r.out + r.err);
		assert.equal(loadBank(bank).facts[0].verification, 'direct-read');
		assert.equal((await run(['confirm', 'pumpfun-launch-day-deaths', '--source', '1', '--by', 'Somebody With A Very Long Full Name', ...common])).code, 2);
		writeFileSync(bank, `${readFileSync(bank, 'utf8')}{"id": "broken-fact", "statement": 5}\n`);
		const s = await run(['search', 'coingecko', ...common]);
		assert.equal(s.code, 0);
		assert.match(s.err, /skipping 1 malformed fact/);
		assert.match(s.out, /\[fact:pumpfun-launch-day-deaths\]/);
		code = (await run(['verify', '--all', ...common], async () => ({ok: false, reason: 'not called'}))).code;
		assert.equal(code, 2, 'changing a bank with malformed facts is refused');
		assert.equal((await run(['validate', ...common])).code, 1);
	});
	test('bad input exits 2', async () => {
		assert.equal((await run(['verify'])).code, 2);
		assert.equal((await run(['stale', '--today', '2026-02-30'])).code, 2);
		assert.equal((await run(['search', '--status', 'nope'])).code, 2);
		assert.equal((await run(['nope'])).code, 2);
	});
});

describe('the committed bank', () => {
	test('content/facts/facts.jsonl validates, is sorted and canonical, and names no private person', () => {
		const path = join(STUDIO, 'content', 'facts', 'facts.jsonl');
		const bank = loadBank(path);
		assert.deepEqual(bank.problems, []);
		const findings = validateBank(bank.raw, {today: TODAY, names: EMPTY_NAMES});
		assert.deepEqual(errorsOf(findings), []);
		assert.equal(readFileSync(path, 'utf8'), serializeBank(bank.facts), 'the file is in canonical form (run any write command to normalise it)');
		for (const f of bank.facts) {
			assert.ok(f.verification !== 'unverified' || f.verifiedAt === null);
			if (f.verification === 'direct-read') assert.ok(f.sources.some((s) => s.checks.some((c) => c.result === 'found' && (c.by === 'verify' || c.by === 'person'))), `${f.id} has a direct read on record`);
		}
	});
});
