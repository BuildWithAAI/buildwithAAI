import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {SCOPES} from './api.ts';
import {approveInBrowser, createMockGoogle} from './mock-google.ts';
import {AuthError, authorize, clientSecretsWarning, envTokenSource, fileTokenSource, gitIgnoreStatus, hasEnvTokens, readTokenFile, writeSecretFile, writeTokenFile, type TokenFile} from './oauth.ts';

const client = {clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret'};
let dir = '';
before(() => {
	dir = mkdtempSync(join(tmpdir(), 'retention-oauth-'));
});
after(() => rmSync(dir, {recursive: true, force: true}));

describe('installed-app consent (loopback redirect + PKCE)', () => {
	it('asks for exactly the two read-only scopes and exchanges the code with the verifier', async () => {
		const google = createMockGoogle();
		let consent = new URL('http://unset.example');
		const tokens = await authorize({
			client,
			endpoints: google.endpoints,
			fetch: google.fetch,
			openUrl: async (url) => {
				consent = new URL(url);
				await approveInBrowser(url);
			},
		});
		assert.equal(tokens.accessToken, 'at-initial');
		assert.equal(tokens.refreshToken, 'rt-initial');
		const q = consent.searchParams;
		assert.equal(q.get('scope'), SCOPES.join(' '));
		assert.equal(q.get('scope'), 'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly');
		assert.equal(q.get('code_challenge_method'), 'S256');
		assert.match(q.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
		const exchange = google.calls('/token')[0]!.form;
		assert.equal(exchange.get('grant_type'), 'authorization_code');
		assert.ok((exchange.get('code_verifier') ?? '').length >= 43);
	});
	it('refuses when the owner unticks a scope (granular consent)', async () => {
		const google = createMockGoogle();
		google.grantedScope = 'https://www.googleapis.com/auth/yt-analytics.readonly';
		await assert.rejects(
			authorize({client, endpoints: google.endpoints, fetch: google.fetch, openUrl: (url) => approveInBrowser(url)}),
			(err: Error) => err instanceof AuthError && /youtube\.readonly/.test(err.message),
		);
	});
	it('rejects a response with the wrong state, and a denial', async () => {
		const google = createMockGoogle();
		await assert.rejects(authorize({client, endpoints: google.endpoints, fetch: google.fetch, openUrl: (url) => approveInBrowser(url, 'wrong-state')}), /wrong state/);
		await assert.rejects(authorize({client, endpoints: google.endpoints, fetch: google.fetch, openUrl: (url) => approveInBrowser(url, 'deny')}), /did not grant access \(access_denied\)/);
	});
});

describe('saved tokens', () => {
	const file = (): TokenFile => ({version: 1, kind: 'retention-oauth', client, accounts: {default: {channelId: 'UC1', title: 'T', savedAt: '2026-11-24', tokens: {accessToken: 'at-old', expiresAt: 0, refreshToken: 'rt-1', scope: SCOPES.join(' ')}}}});
	it('refreshes an expired access token and saves it back (0600)', async () => {
		const google = createMockGoogle();
		const path = join(dir, 'tokens-a.json');
		writeTokenFile(path, file());
		const {source} = fileTokenSource({path, account: 'default', endpoints: google.endpoints, fetch: google.fetch, now: () => 1_000});
		assert.equal(await source(false), 'at-refreshed-1');
		assert.equal(readTokenFile(path)!.accounts.default!.tokens.accessToken, 'at-refreshed-1');
		assert.equal(statSync(path).mode & 0o777, 0o600);
		assert.equal(await source(false), 'at-refreshed-1', 'still valid: no new refresh');
		assert.equal(await source(true), 'at-refreshed-2', 'forced after a 401');
	});
	it('explains an expired or revoked refresh token, including the 7-day "Testing" limit', async () => {
		const google = createMockGoogle();
		google.revokedRefreshTokens.add('rt-1');
		const path = join(dir, 'tokens-b.json');
		writeTokenFile(path, file());
		const {source} = fileTokenSource({path, account: 'default', endpoints: google.endpoints, fetch: google.fetch});
		await assert.rejects(source(false), (err: Error) => err instanceof AuthError && /7 days/.test(err.message) && /In production/.test(err.message));
	});
	it('names the saved accounts when the requested one is missing', () => {
		const path = join(dir, 'tokens-c.json');
		writeTokenFile(path, file());
		assert.throws(() => fileTokenSource({path, account: 'security'}), /No saved account "security".*saved: default/);
	});
	it('rejects a file that is not ours', () => {
		const path = join(dir, 'other.json');
		writeFileSync(path, JSON.stringify({version: 1, client, accounts: {}}));
		assert.throws(() => readTokenFile(path), /not a retention OAuth file/);
	});
});

describe('secrets never go where git would track them (the repository is public)', () => {
	it('refuses a tracked path and accepts an ignored one', () => {
		const repo = mkdtempSync(join(tmpdir(), 'retention-git-'));
		try {
			execFileSync('git', ['init', '-q'], {cwd: repo});
			writeFileSync(join(repo, '.gitignore'), 'data/\n');
			assert.equal(gitIgnoreStatus(join(repo, 'data', 'retention', 'oauth.json')), 'ignored');
			assert.equal(gitIgnoreStatus(join(repo, 'config', 'oauth.json')), 'tracked');
			assert.throws(() => writeSecretFile(join(repo, 'config', 'oauth.json'), '{}'), /Refusing to write OAuth tokens/);
			writeSecretFile(join(repo, 'data', 'retention', 'oauth.json'), '{}');
			assert.equal(readFileSync(join(repo, 'data', 'retention', 'oauth.json'), 'utf8'), '{}');
		} finally {
			rmSync(repo, {recursive: true, force: true});
		}
	});
	it('warns about a client-secret JSON that git would commit, and is quiet where git ignores it', () => {
		const repo = mkdtempSync(join(tmpdir(), 'retention-git-'));
		try {
			execFileSync('git', ['init', '-q'], {cwd: repo});
			writeFileSync(join(repo, '.gitignore'), 'secrets/\n');
			assert.match(clientSecretsWarning(join(repo, 'client_secret_9.apps.googleusercontent.com.json')) ?? '', /git would commit it/);
			assert.equal(clientSecretsWarning(join(repo, 'secrets', 'client_secret.json')), null);
			assert.equal(clientSecretsWarning(join(dir, 'client_secret.json')), null, 'outside any work tree');
			// in this repository, both tool folders ignore Google's client JSON by name
			for (const tool of ['retention', 'uploader']) {
				const here = new URL(`../${tool}/client_secret_1.apps.googleusercontent.com.json`, import.meta.url).pathname;
				assert.equal(gitIgnoreStatus(here), 'ignored', tool);
			}
		} finally {
			rmSync(repo, {recursive: true, force: true});
		}
	});
	it('outside any git work tree it writes normally', () => {
		assert.equal(gitIgnoreStatus(join(dir, 'x', 'y.json')), 'no-repo');
	});
	it('the default token location in this repository is ignored', () => {
		const here = new URL('../../data/retention/oauth.json', import.meta.url).pathname;
		assert.equal(gitIgnoreStatus(here), 'ignored');
	});
});

describe('tokens from environment variables (a protected CI environment; shared with tools/dashboard)', () => {
	it('uses YT_ANALYTICS_ACCESS_TOKEN as is, or exchanges the refresh token', async () => {
		const google = createMockGoogle();
		assert.equal(hasEnvTokens({}), false);
		assert.equal(await envTokenSource({YT_ANALYTICS_ACCESS_TOKEN: 'at-env'}, google.fetch)(false), 'at-env');
		const env = {YT_ANALYTICS_CLIENT_ID: 'cid', YT_ANALYTICS_REFRESH_TOKEN: 'rt-env', YT_ANALYTICS_CLIENT_SECRET: 'sec'};
		assert.equal(hasEnvTokens(env), true);
		// the dashboard helper posts to Google's real token URL; route it to the mock by host
		const routed = (async (input: string | URL | Request, init?: RequestInit) =>
			google.fetch(String(input).replace('https://oauth2.googleapis.com/token', google.endpoints.token), init)) as typeof fetch;
		assert.equal(await envTokenSource(env, routed)(false), 'at-refreshed-1');
		assert.equal(google.calls('/token')[0]!.form.get('refresh_token'), 'rt-env');
	});
});
