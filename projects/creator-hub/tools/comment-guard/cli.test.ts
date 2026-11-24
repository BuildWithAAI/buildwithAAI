import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, afterEach, before, beforeEach, describe, it} from 'node:test';
import {type Deps, main} from './cli.ts';
import {approveInBrowser, type MockGoogle, startMockGoogle} from './mock-google.ts';
import type {Report} from './report.ts';
import {type OAuthFile, readOAuthFile, SCOPE, writeOAuthFile} from './youtube.ts';

const CHANNEL = 'UCsyntheticZOORA00000001';
const FIXTURES = new URL('./fixtures/comments.json', import.meta.url).pathname;
const FIXTURE_COUNT = (JSON.parse(readFileSync(FIXTURES, 'utf8')) as {comments: unknown[]}).comments.length;
const noNetwork: typeof fetch = async () => {
	throw new Error('unexpected network call');
};

let google: MockGoogle;
let project: string;
before(async () => {
	google = await startMockGoogle();
});
after(() => google.close());
beforeEach(() => {
	project = mkdtempSync(join(tmpdir(), 'guard-cli-'));
	mkdirSync(join(project, 'config'));
	google.requests.length = 0;
	google.moderation.length = 0;
	google.deleted.clear();
	google.quotaExceeded = false;
});
afterEach(() => rmSync(project, {recursive: true, force: true}));

const oauthPath = () => join(project, 'config', 'youtube-oauth.json');
const saveAccount = (channelId = CHANNEL) => {
	const file: OAuthFile = {
		version: 1,
		client: {clientId: 'test-client', clientSecret: 'test-secret'},
		accounts: {zooratechnologies: {channelId, title: 'Zoora AI', handle: '@zooratechnologies', savedAt: '2026-11-24T00:00:00Z', tokens: {accessToken: 'at-valid', expiresAt: Date.now() + 3_600_000, refreshToken: 'rt-valid', scope: SCOPE}}},
	};
	writeOAuthFile(oauthPath(), file);
};

let clock = Date.parse('2026-11-24T10:00:00Z');
const run = async (argv: string[], overrides: Partial<Deps> = {}) => {
	const stdout: string[] = [];
	const stderr: string[] = [];
	clock += 60_000; // each run gets its own report timestamp
	const now = clock;
	const code = await main(argv, {
		env: {},
		fetch: globalThis.fetch,
		endpoints: google.endpoints,
		stdout: (line) => stdout.push(line),
		stderr: (line) => stderr.push(line),
		now: () => new Date(now),
		openUrl: () => {
			throw new Error('unexpected sign-in');
		},
		projectDir: project,
		...overrides,
	});
	return {code, out: stdout.join('\n'), err: stderr.join('\n')};
};

const reports = (mode: 'scan' | 'apply'): Report[] => {
	const dir = join(project, 'out', 'comment-guard');
	return readdirSync(dir)
		.filter((name) => name.startsWith(`guard-${mode}-`) && name.endsWith('.json'))
		.sort()
		.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Report);
};
const holdIds = (report: Report) => report.items.filter((i) => i.action === 'hold').map((i) => i.commentId).sort();

describe('guard blocked-words and help', () => {
	it('prints a paste-ready list and the Studio settings without any API access', async () => {
		const {code, out} = await run(['blocked-words'], {fetch: noNetwork});
		assert.equal(code, 0);
		assert.match(out, /BLOCKED WORDS/);
		assert.match(out, /whatsapp me, telegram me/);
		assert.match(out, /hold potentially inappropriate comments/i);
		assert.match(out, /Block links/);
		assert.match(out, /Hidden users/);
		assert.equal(google.requests.length, 0);
	});

	it('prints help, and rejects unknown options', async () => {
		assert.equal((await run(['help'])).code, 0);
		const bad = await run(['scan', '--delete-everything']);
		assert.equal(bad.code, 1);
		assert.match(bad.err, /Unknown option/);
	});
});

describe('guard scan (dry run, the default)', () => {
	it('scores a local file and writes a JSON and a Markdown report without touching the network', async () => {
		const {code, out} = await run(['scan', '--input', FIXTURES], {fetch: noNetwork});
		assert.equal(code, 0, out);
		const [report] = reports('scan');
		assert.equal(report.source, 'file');
		assert.ok(FIXTURE_COUNT >= 280);
		assert.equal(report.totals.scanned, FIXTURE_COUNT);
		assert.equal(report.totals.hold + report.totals.review + report.totals.allow, FIXTURE_COUNT);
		assert.ok(report.items.every((item) => item.action !== 'allow'));
		const md = readFileSync(join(project, 'out', 'comment-guard', readdirSync(join(project, 'out', 'comment-guard')).find((n) => n.endsWith('.md')) ?? ''), 'utf8');
		assert.match(md, /Dry run: nothing was changed/);
		assert.match(out, /nothing was changed on YouTube/);
	});

	it('reads the channel through the API by default and changes nothing', async () => {
		saveAccount();
		const {code, out} = await run([]);
		assert.equal(code, 0, out);
		const [report] = reports('scan');
		assert.equal(report.source, 'youtube');
		assert.equal(report.channel.id, CHANNEL);
		assert.equal(report.totals.scanned, 9);
		assert.equal(report.quota?.used, 3);
		const held = holdIds(report);
		for (const id of ['UgxSynthThreadA000000AaABAg.reply0001', 'UgxSynthThreadA000000AaABAg.reply0002', 'UgxSynthThreadB000000AaABAg', 'UgxSynthThreadE000000AaABAg']) {
			assert.ok(held.includes(id), `${id} should be held`);
		}
		for (const id of ['UgxSynthThreadA000000AaABAg', 'UgxSynthThreadA000000AaABAg.reply0003', 'UgxSynthThreadC000000AaABAg', 'UgxSynthThreadD000000AaABAg']) {
			assert.ok(!report.items.some((item) => item.commentId === id), `${id} should be allowed`);
		}
		assert.equal(google.moderation.length, 0);
		assert.equal(google.calls('/youtube/v3/comments/setModerationStatus').length, 0);
		assert.match(out, /apply --confirm --from-report latest/);
	});

	it('explains how to sign in when there is no saved access', async () => {
		const {code, err} = await run(['scan']);
		assert.equal(code, 2);
		assert.match(err, /guard -- auth/);
	});
});

describe('guard apply', () => {
	it('refuses without --confirm and makes no API call', async () => {
		saveAccount();
		const {code, err} = await run(['apply']);
		assert.equal(code, 2);
		assert.match(err, /--confirm/);
		assert.equal(google.requests.length, 0);
	});

	it('holds exactly the "hold" comments for review and leaves the rest alone', async () => {
		saveAccount();
		const {code, out} = await run(['apply', '--confirm']);
		assert.equal(code, 0, out);
		const [report] = reports('apply');
		const expected = holdIds(report);
		assert.ok(expected.length >= 4);
		assert.deepEqual(google.moderation.flatMap((m) => m.ids).sort(), expected);
		assert.ok(google.moderation.every((m) => m.status === 'heldForReview' && m.banAuthor === null));
		assert.deepEqual(report.applied?.done.slice().sort(), expected);
		assert.equal(report.applied?.status, 'heldForReview');
		const reviewOnly = report.items.filter((i) => i.action === 'review').map((i) => i.commentId);
		assert.ok(reviewOnly.every((id) => !google.moderation.some((m) => m.ids.includes(id))));
	});

	it('applies a reviewed report without reading the channel again', async () => {
		saveAccount();
		await run(['scan']);
		google.requests.length = 0;
		const {code} = await run(['apply', '--confirm', '--from-report', 'latest']);
		assert.equal(code, 0);
		assert.equal(google.calls('/youtube/v3/commentThreads').length, 0);
		assert.deepEqual(google.moderation.flatMap((m) => m.ids).sort(), holdIds(reports('scan')[0]));
	});

	it('refuses a report made for another channel', async () => {
		saveAccount();
		await run(['scan']);
		saveAccount('UCsyntheticOTHER00000009');
		const {code, err} = await run(['apply', '--confirm', '--from-report', 'latest']);
		assert.equal(code, 2);
		assert.match(err, /another channel/);
		assert.equal(google.moderation.length, 0);
	});

	it('retries one by one when a comment in the batch was deleted meanwhile', async () => {
		saveAccount();
		google.deleted.add('UgxSynthThreadE000000AaABAg');
		const {code} = await run(['apply', '--confirm']);
		assert.equal(code, 1);
		const [report] = reports('apply');
		assert.deepEqual(report.applied?.failed.map((f) => f.id), ['UgxSynthThreadE000000AaABAg']);
		assert.match(report.applied?.failed[0].error ?? '', /commentNotFound/);
		assert.equal(report.applied?.done.length, holdIds(report).length - 1);
	});

	it('stays inside --max-quota: reads, but skips holds it cannot pay for', async () => {
		saveAccount();
		const {code, out} = await run(['apply', '--confirm', '--max-quota', '40']);
		assert.equal(code, 1);
		const [report] = reports('apply');
		assert.equal(google.moderation.length, 0);
		assert.equal(report.applied?.notAttempted.length, holdIds(report).length);
		assert.match(report.applied?.notAttempted[0].reason ?? '', /--max-quota 40/);
		assert.ok((report.quota?.used ?? 99) <= 40);
		assert.match(out, /Not attempted/);
	});
});

describe('guard release', () => {
	it('publishes held comments again', async () => {
		saveAccount();
		assert.equal((await run(['release', 'UgxSynthThreadB000000AaABAg'])).code, 2);
		const {code} = await run(['release', '--confirm', 'UgxSynthThreadB000000AaABAg']);
		assert.equal(code, 0);
		assert.deepEqual(google.moderation, [{ids: ['UgxSynthThreadB000000AaABAg'], status: 'published', banAuthor: null}]);
	});
});

describe('guard auth', () => {
	it('signs in through the loopback flow, saves the channel privately, and revokes on request', async () => {
		const secrets = join(project, 'client_secret.json');
		writeFileSync(secrets, JSON.stringify({installed: {client_id: 'desktop-client', client_secret: 'desktop-secret'}}));
		const {code, out} = await run(['auth', '--client-secrets', secrets], {openUrl: (url) => approveInBrowser(url)});
		assert.equal(code, 0, out);
		const saved = readOAuthFile(oauthPath());
		assert.equal(saved?.accounts.zooratechnologies.channelId, CHANNEL);
		assert.equal(saved?.accounts.zooratechnologies.tokens.refreshToken, 'rt-initial');
		assert.equal(saved?.client.clientId, 'desktop-client');
		if (process.platform !== 'win32') assert.equal(statSync(oauthPath()).mode & 0o777, 0o600);

		const revoked = await run(['auth', '--revoke']);
		assert.equal(revoked.code, 0);
		assert.equal(google.calls('/revoke')[0].form.get('token'), 'rt-initial');
		assert.deepEqual(readOAuthFile(oauthPath())?.accounts, {});
	});
});

describe('report retention', () => {
	it('deletes its own reports older than 30 days and nothing else', async () => {
		const dir = join(project, 'out', 'comment-guard');
		mkdirSync(dir, {recursive: true});
		for (const name of ['guard-scan-20260101-000000.json', 'guard-scan-20260101-000000.md', 'notes.md']) writeFileSync(join(dir, name), '{}');
		assert.equal((await run(['scan', '--input', FIXTURES])).code, 0);
		const left = readdirSync(dir);
		assert.ok(!left.includes('guard-scan-20260101-000000.json') && !left.includes('guard-scan-20260101-000000.md'));
		assert.ok(left.includes('notes.md'));
		assert.equal(left.filter((name) => name.startsWith('guard-scan-2026112')).length, 2);
	});
});

describe('report safety', () => {
	it('escapes comment text and names in the Markdown report', async () => {
		const input = join(project, 'hostile.json');
		writeFileSync(
			input,
			JSON.stringify([
				{id: 'hostile01', authorName: '<img src=x onerror=alert(1)>', text: 'DM me on Telegram @evil_example <script>alert(1)</script> [click](http://evil.example) # heading'},
			]),
		);
		assert.equal((await run(['scan', '--input', input])).code, 0);
		const dir = join(project, 'out', 'comment-guard');
		const md = readFileSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.md')) ?? ''), 'utf8');
		assert.ok(!md.includes('<script>') && !md.includes('<img'), 'raw HTML must not survive');
		assert.match(md, /&lt;script&gt;/);
		assert.match(md, /\\\[click\\\]/);
		assert.ok(!md.includes('http://evil'), 'links from comment text are defanged');
		assert.match(md, /hxxp:\/\/evil\\\[\.\\\]example/, 'renders as hxxp://evil[.]example');
	});
});
