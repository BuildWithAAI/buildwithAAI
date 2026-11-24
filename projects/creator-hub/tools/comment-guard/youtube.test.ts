import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, beforeEach, describe, it} from 'node:test';
import {approveInBrowser, type MockGoogle, startMockGoogle} from './mock-google.ts';
import {
	AuthError,
	authorize,
	createClient,
	fetchChannelComments,
	type OAuthFile,
	QuotaBudget,
	QuotaBudgetError,
	readClientSecrets,
	readOAuthFile,
	SCOPE,
	type Tokens,
	writeOAuthFile,
	YouTubeApiError,
} from './youtube.ts';

const CHANNEL = 'UCsyntheticZOORA00000001';
const client = {clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret'};
const fresh = (): Tokens => ({accessToken: 'at-valid', expiresAt: Date.now() + 3_600_000, refreshToken: 'rt-valid', scope: SCOPE});

let google: MockGoogle;
before(async () => {
	google = await startMockGoogle();
});
after(() => google.close());
beforeEach(() => {
	google.requests.length = 0;
	google.moderation.length = 0;
	google.deleted.clear();
	google.expiredTokens.clear();
	google.revokedRefreshTokens.clear();
	google.quotaExceeded = false;
});

describe('OAuth for installed apps (loopback redirect + PKCE)', () => {
	it('sends the owner to Google, receives the code on 127.0.0.1 and exchanges it with the PKCE verifier', async () => {
		let consent = new URL('http://unset.example');
		const tokens = await authorize({
			client,
			endpoints: google.endpoints,
			openUrl: async (url) => {
				consent = new URL(url);
				await approveInBrowser(url);
			},
		});
		assert.equal(tokens.accessToken, 'at-initial');
		assert.equal(tokens.refreshToken, 'rt-initial');
		assert.equal(consent.origin + consent.pathname, google.endpoints.auth);
		const q = consent.searchParams;
		assert.equal(q.get('response_type'), 'code');
		assert.equal(q.get('scope'), SCOPE);
		assert.equal(q.get('code_challenge_method'), 'S256');
		assert.match(q.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);

		const exchange = google.calls('/token')[0].form;
		assert.equal(exchange.get('grant_type'), 'authorization_code');
		assert.equal(exchange.get('redirect_uri'), q.get('redirect_uri'));
		assert.equal(exchange.get('client_secret'), client.clientSecret);
		const challenge = createHash('sha256').update(exchange.get('code_verifier') ?? '').digest('base64url');
		assert.equal(challenge, q.get('code_challenge'));
	});

	it('rejects a response with the wrong state, and a refusal', async () => {
		await assert.rejects(
			authorize({client, endpoints: google.endpoints, openUrl: (url) => approveInBrowser(url, {state: 'forged'})}),
			(err) => err instanceof AuthError && /state/.test(err.message),
		);
		await assert.rejects(
			authorize({client, endpoints: google.endpoints, openUrl: (url) => approveInBrowser(url, {error: 'access_denied'})}),
			(err) => err instanceof AuthError && /access_denied/.test(err.message),
		);
		assert.equal(google.calls('/token').length, 0);
	});
});

describe('API client', () => {
	it('refreshes an expired access token first and hands the new tokens back for saving', async () => {
		const saved: Tokens[] = [];
		const budget = new QuotaBudget(10);
		const yt = createClient({client, tokens: {...fresh(), accessToken: null, expiresAt: null}, budget, endpoints: google.endpoints, onTokens: (t) => saved.push(t)});
		const channel = await yt.myChannel();
		assert.deepEqual(channel, {id: CHANNEL, title: 'Zoora AI', handle: '@zooratechnologies'});
		assert.equal(saved[0].accessToken, 'at-refreshed');
		assert.equal(saved[0].refreshToken, 'rt-valid');
		assert.equal(google.calls('/youtube/v3/channels')[0].authorization, 'Bearer at-refreshed');
	});

	it('retries once with a refreshed token after a 401', async () => {
		google.expiredTokens.add('at-valid');
		const budget = new QuotaBudget(10);
		const yt = createClient({client, tokens: fresh(), budget, endpoints: google.endpoints});
		await yt.myChannel();
		assert.deepEqual(
			google.calls('/youtube/v3/channels').map((r) => r.authorization),
			['Bearer at-valid', 'Bearer at-refreshed'],
		);
		assert.equal(budget.used, 2, 'the failed call costs quota too');
	});

	it('explains an expired or revoked refresh token', async () => {
		google.revokedRefreshTokens.add('rt-valid');
		const yt = createClient({client, tokens: {...fresh(), accessToken: null}, budget: new QuotaBudget(10), endpoints: google.endpoints});
		await assert.rejects(yt.myChannel(), (err) => err instanceof AuthError && /guard auth/.test(err.message) && /7 days/.test(err.message));
	});

	it('reads threads, inline replies and the remaining replies, without duplicates', async () => {
		const budget = new QuotaBudget(100);
		const yt = createClient({client, tokens: fresh(), budget, endpoints: google.endpoints});
		const result = await fetchChannelComments(yt, budget, CHANNEL, 300);
		assert.equal(result.threads, 6);
		assert.equal(result.truncated, null);
		assert.equal(result.comments.length, 9, '6 top-level + 3 replies (one seen twice)');
		const threadCall = google.calls('/youtube/v3/commentThreads')[0].query;
		assert.equal(threadCall.get('allThreadsRelatedToChannelId'), CHANNEL);
		assert.equal(threadCall.get('part'), 'snippet,replies');
		assert.equal(threadCall.get('textFormat'), 'plainText');
		assert.equal(threadCall.get('maxResults'), '100');
		assert.equal(google.calls('/youtube/v3/comments')[0].query.get('parentId'), 'UgxSynthThreadA000000AaABAg');
		assert.deepEqual(budget.calls, {'commentThreads.list': 2, 'comments.list': 1});
		assert.equal(budget.used, 3);
		const reply = result.comments.find((c) => c.id.endsWith('reply0002'));
		assert.equal(reply?.parentId, 'UgxSynthThreadA000000AaABAg');
		assert.equal(reply?.videoId, 'synthVid001');
		assert.equal(reply?.authorChannelId, 'UCsynthetic0000000000b05');
	});

	it('stops before the quota budget is exceeded', async () => {
		const budget = new QuotaBudget(1);
		const yt = createClient({client, tokens: fresh(), budget, endpoints: google.endpoints});
		const result = await fetchChannelComments(yt, budget, CHANNEL, 300);
		assert.equal(budget.used, 1);
		assert.match(result.truncated ?? '', /quota budget/);
		assert.equal(google.calls('/youtube/v3/commentThreads').length, 1);
		assert.throws(() => budget.spend('comments.setModerationStatus'), QuotaBudgetError);
	});

	it('holds comments with heldForReview in one POST, comma-separated, and never bans', async () => {
		const budget = new QuotaBudget(100);
		const yt = createClient({client, tokens: fresh(), budget, endpoints: google.endpoints});
		await yt.setModerationStatus(['UgxOne000000', 'UgxTwo000000'], 'heldForReview');
		const call = google.calls('/youtube/v3/comments/setModerationStatus')[0];
		assert.equal(call.method, 'POST');
		assert.equal(call.query.get('id'), 'UgxOne000000,UgxTwo000000');
		assert.equal(call.query.get('moderationStatus'), 'heldForReview');
		assert.equal(call.query.get('banAuthor'), null);
		assert.equal(budget.used, 50);
		await assert.rejects(yt.setModerationStatus(['UgxOne000000'], 'rejected' as 'published'), /Refusing/);
	});

	it('reports a used-up daily quota as such', async () => {
		google.quotaExceeded = true;
		const yt = createClient({client, tokens: fresh(), budget: new QuotaBudget(10), endpoints: google.endpoints});
		await assert.rejects(yt.listThreads(CHANNEL), (err) => err instanceof YouTubeApiError && err.isQuota && err.status === 403);
	});
});

describe('credential files', () => {
	it('round-trips config/youtube-oauth.json readable by the owner only', () => {
		const dir = mkdtempSync(join(tmpdir(), 'guard-oauth-'));
		try {
			const path = join(dir, 'config', 'youtube-oauth.json');
			const data: OAuthFile = {version: 1, client, accounts: {zoora: {channelId: CHANNEL, title: 'Zoora AI', handle: '@zooratechnologies', tokens: fresh(), savedAt: '2026-11-24T00:00:00Z'}}};
			writeOAuthFile(path, data);
			assert.deepEqual(readOAuthFile(path), data);
			if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
			assert.equal(readOAuthFile(join(dir, 'missing.json')), null);
			writeFileSync(path, '{"version": 2}');
			assert.throws(() => readOAuthFile(path), /not a comment-guard OAuth file/);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});

	it('reads the "Desktop app" client JSON from Google Cloud Console', () => {
		const dir = mkdtempSync(join(tmpdir(), 'guard-secrets-'));
		try {
			const path = join(dir, 'client_secret.json');
			writeFileSync(path, JSON.stringify({installed: {client_id: 'abc.apps.googleusercontent.com', client_secret: 'shh', redirect_uris: ['http://localhost']}}));
			assert.deepEqual(readClientSecrets(path), {clientId: 'abc.apps.googleusercontent.com', clientSecret: 'shh'});
			writeFileSync(path, '{}');
			assert.throws(() => readClientSecrets(path), /Desktop app/);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});
