/** CLI tests: `draft` writes files only when the lint passes, `--kit-draft` (mocked fetch), `lint` and usage errors. */
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, before, describe, it} from 'node:test';
import {main, type CliDeps} from './cli.ts';

const KIT = fileURLToPath(new URL('./fixtures/kit.json', import.meta.url));
const OFFERS = fileURLToPath(new URL('./fixtures/offers.json', import.meta.url));

type Run = {code: number; out: string; err: string};

describe('newsletter CLI', () => {
	let dir = '';
	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'newsletter-cli-'));
	});
	after(() => rmSync(dir, {recursive: true, force: true}));

	const run = async (argv: string[], deps: Partial<CliDeps> = {}): Promise<Run> => {
		const out: string[] = [];
		const err: string[] = [];
		const code = await main(argv, {
			env: {},
			cwd: dir,
			now: () => new Date('2026-11-24T12:00:00Z'),
			fetch: (() => assert.fail('Kit must not be called')) as typeof fetch,
			print: (line) => out.push(line),
			printError: (line) => err.push(line),
			...deps,
		});
		return {code, out: out.join('\n'), err: err.join('\n')};
	};
	const writeKit = (name: string, change: (kit: Record<string, unknown>) => void): string => {
		const kit = JSON.parse(readFileSync(KIT, 'utf8')) as Record<string, unknown>;
		change(kit);
		const file = join(dir, name);
		writeFileSync(file, JSON.stringify(kit));
		return file;
	};

	it('draft writes <slug>.md and <slug>.html and reports which offers were left out', async () => {
		const {code, out, err} = await run(['draft', KIT, '--offers', OFFERS, '--out', 'drafts']);
		assert.equal(code, 0, err);
		assert.match(out, /Newsletter draft "fake-support-dm": POV: "Support" DMs you first/);
		assert.match(out, /offers in the email: hardware-wallet/);
		assert.match(out, /left out: exchange-demo: restricted by country/);
		assert.match(out, /wrote drafts\/fake-support-dm\.md\n {2}wrote drafts\/fake-support-dm\.html/);
		assert.match(out, /Kit adds the unsubscribe link and your postal address/);
		const html = readFileSync(join(dir, 'drafts', 'fake-support-dm.html'), 'utf8');
		assert.match(html, /go\.zoora\.ai\/go\/hardware-wallet\?v=fake-support-dm&amp;s=email/);
		assert.match(readFileSync(join(dir, 'drafts', 'fake-support-dm.md'), 'utf8'), /^---\nsubject: /);
	});

	it('draft names the kit channel unless --brand or BRAND_NAME is given', async () => {
		const kit = writeKit('security.json', (k) => {
			k.channel = 'zoora-security';
			k.slug = 'security-episode';
		});
		const footer = (out: string): string => /subscribed to (.*?) emails/.exec(readFileSync(join(dir, out, 'security-episode.md'), 'utf8'))?.[1] ?? '';
		const byChannel = await run(['draft', kit, '--offers', OFFERS, '--out', 'brand-channel']);
		assert.equal(byChannel.code, 0, byChannel.err);
		assert.equal(footer('brand-channel'), 'Zoodger News');
		assert.equal((await run(['draft', kit, '--offers', OFFERS, '--out', 'brand-env'], {env: {BRAND_NAME: 'Zoora AI'}})).code, 0);
		assert.equal(footer('brand-env'), 'Zoora AI');
		assert.equal((await run(['draft', kit, '--offers', OFFERS, '--out', 'brand-flag', '--brand', 'Test Brand'], {env: {BRAND_NAME: 'Zoora AI'}})).code, 0);
		assert.equal(footer('brand-flag'), 'Test Brand');
		const blank = await run(['draft', kit, '--offers', OFFERS, '--out', 'brand-blank'], {env: {BRAND_NAME: ' '}});
		assert.equal(blank.code, 2);
		assert.match(blank.err, /--brand must be 1-60 characters/);
	});

	it('draft fails the lint on an income claim and writes nothing', async () => {
		const kit = writeKit('claim.json', (k) => {
			k.slug = 'claim-episode';
			k.summary = 'Learn the guaranteed way to spot a fake support agent.';
		});
		const {code, out, err} = await run(['draft', kit, '--offers', OFFERS, '--out', 'claims']);
		assert.equal(code, 1);
		assert.equal(out, '');
		assert.match(err, /error: summary: income or return claim \(guaranteed\)/);
		assert.match(err, /No files were written\./);
		assert.equal(existsSync(join(dir, 'claims')), false);
	});

	it('draft fails an offer missing its disclosure', async () => {
		const kit = writeKit('bare.json', (k) => {
			(k.offers as {disclosure?: string}[])[0]!.disclosure = '';
		});
		const {code, err} = await run(['draft', kit, '--offers', OFFERS, '--out', 'bare']);
		assert.equal(code, 1);
		assert.match(err, /offers\[0\] "hardware-wallet": has no disclosure in kit\.json/);
		assert.equal(existsSync(join(dir, 'bare')), false);
	});

	it('draft --kit-draft creates a Kit draft with the email fragment and says it was not sent', async () => {
		const calls: {url: string; body: Record<string, unknown>}[] = [];
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown>});
			return new Response(JSON.stringify({broadcast: {id: 77, subject: 'x', send_at: null, created_at: '2026-11-24T12:00:01Z'}}), {status: 201});
		}) as typeof fetch;
		const {code, out, err} = await run(['draft', KIT, '--offers', OFFERS, '--out', 'kit', '--kit-draft'], {env: {KIT_API_KEY: 'test-key', KIT_SUBSCRIBER_FILTER: 'tag:4242'}, fetch: fetchImpl});
		assert.equal(code, 0, err);
		assert.match(out, /created Kit broadcast draft 77 for subscribers with tag 4242\. It has NOT been sent or scheduled/);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.url, 'https://api.kit.com/v4/broadcasts');
		assert.equal(calls[0]?.body.send_at, null);
		assert.equal(calls[0]?.body.public, false);
		assert.deepEqual(calls[0]?.body.subscriber_filter, [{all: [{type: 'tag', ids: [4242]}]}]);
		assert.equal(calls[0]?.body.subject, 'POV: "Support" DMs you first');
		assert.doesNotMatch(String(calls[0]?.body.content), /<html|<head|<body/);
		assert.match(String(calls[0]?.body.content), /Affiliate link: I may earn a commission/);
	});

	it('draft --kit-draft makes the owner choose the recipients before anything reaches Kit', async () => {
		let called = 0;
		const fetchImpl = (async () => {
			called++;
			return new Response(JSON.stringify({broadcast: {id: 78, subject: 'x', send_at: null}}), {status: 201});
		}) as typeof fetch;
		const none = await run(['draft', KIT, '--offers', OFFERS, '--out', 'nofilter', '--kit-draft'], {env: {KIT_API_KEY: 'test-key'}, fetch: fetchImpl});
		assert.equal(none.code, 1);
		assert.match(none.err, /Kit draft not created: choose who it is for\. Set KIT_SUBSCRIBER_FILTER=tag:<id>/);
		assert.equal(called, 0);
		assert.equal(existsSync(join(dir, 'nofilter', 'fake-support-dm.html')), true, 'the files are still written');
		const bad = await run(['draft', KIT, '--offers', OFFERS, '--out', 'badfilter', '--kit-draft'], {env: {KIT_API_KEY: 'test-key', KIT_SUBSCRIBER_FILTER: 'list:7'}, fetch: fetchImpl});
		assert.equal(bad.code, 2);
		assert.match(bad.err, /KIT_SUBSCRIBER_FILTER must look like tag:123/);
		const everyone = await run(['draft', KIT, '--offers', OFFERS, '--out', 'all', '--kit-draft', '--all-subscribers'], {env: {KIT_API_KEY: 'test-key'}, fetch: fetchImpl});
		assert.equal(everyone.code, 0, everyone.err);
		assert.match(everyone.out, /created Kit broadcast draft 78 for all subscribers/);
		assert.equal(called, 1);
	});

	it('draft --kit-draft without KIT_API_KEY keeps the files but fails', async () => {
		const {code, err} = await run(['draft', KIT, '--offers', OFFERS, '--out', 'nokey', '--kit-draft']);
		assert.equal(code, 1);
		assert.match(err, /Kit draft not created: KIT_API_KEY is not set/);
		assert.equal(existsSync(join(dir, 'nokey', 'fake-support-dm.html')), true);
	});

	it('draft takes --youtube-id when kit.json has none yet, and fails without it', async () => {
		const kit = writeKit('novideo.json', (k) => {
			k.youtubeVideoId = null;
		});
		const missing = await run(['draft', kit, '--offers', OFFERS, '--out', 'novideo']);
		assert.equal(missing.code, 1);
		assert.match(missing.err, /no watch link/);
		const fixed = await run(['draft', kit, '--offers', OFFERS, '--out', 'novideo', '--youtube-id', 'ZyXwVuTs987']);
		assert.equal(fixed.code, 0, fixed.err);
		assert.match(readFileSync(join(dir, 'novideo', 'fake-support-dm.md'), 'utf8'), /watch\?v=ZyXwVuTs987/);
	});

	it('draft reports a broken kit.json or offer registry', async () => {
		const badKit = writeKit('bad.json', (k) => {
			k.version = 2;
		});
		const kitRun = await run(['draft', badKit, '--offers', OFFERS]);
		assert.equal(kitRun.code, 1);
		assert.match(kitRun.err, /kit\.json has problems:\n {2}.*bad\.json: "version" must be 1/);
		const missingRegistry = await run(['draft', KIT, '--offers', 'nope.json']);
		assert.equal(missingRegistry.code, 1);
		assert.match(missingRegistry.err, /Offer registry not found: nope\.json/);
		const registry = join(dir, 'offers-launchpad.json');
		writeFileSync(registry, JSON.stringify({version: 1, offers: [{id: 'pad', name: 'Pad', url: 'https://pump.fun/x', category: 'other', relationship: 'referral', disclosure: 'Referral link.', blockedCountries: [], unknownCountry: 'allow', active: true}]}));
		const launchpad = await run(['draft', KIT, '--offers', registry]);
		assert.equal(launchpad.code, 1);
		assert.match(launchpad.err, /memecoin launchpads are never offers/);
	});

	it('lint passes the generated files and fails a hand edit that drops a disclosure', async () => {
		await run(['draft', KIT, '--offers', OFFERS, '--out', 'lint']);
		for (const name of ['fake-support-dm.md', 'fake-support-dm.html']) {
			const result = await run(['lint', join('lint', name)]);
			assert.equal(result.code, 0, result.err);
			assert.match(result.out, /Lint passed\./);
		}
		const md = join(dir, 'lint', 'fake-support-dm.md');
		const stripped = readFileSync(md, 'utf8').replace(/Some of these are affiliate links[\s\S]*?(?=\[Visit Test Hardware Wallet\])/, '');
		assert.doesNotMatch(stripped.slice(0, stripped.indexOf('[Visit Test Hardware Wallet]')), /affiliate/i);
		writeFileSync(md, stripped);
		const edited = await run(['lint', md]);
		assert.equal(edited.code, 1);
		assert.match(edited.err, /hardware-wallet\?v=fake-support-dm&s=email has no disclosure/);
	});

	it('answers usage errors with exit code 2', async () => {
		for (const argv of [[], ['send'], ['draft'], ['draft', KIT, '--nope'], ['draft', KIT, '--youtube-id', 'short'], ['draft', KIT, '--hub', 'http://go.zoora.ai'], ['lint', 'notes.txt']]) {
			const {code, err} = await run(argv);
			assert.equal(code, 2, argv.join(' '));
			assert.match(err, /Usage:/);
		}
		const help = await run(['--help']);
		assert.equal(help.code, 0);
		assert.match(help.out, /npm run newsletter -- draft <kit\.json>/);
	});
});
