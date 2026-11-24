import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {GOOGLE, SCOPE_FORCE_SSL, SCOPE_UPLOAD} from './contracts.ts';
import {createFakeYouTube} from './fake-youtube.ts';
import {fetchTransport} from './http.ts';
import {AuthError, authorize, createTokenSource, readClientSecrets, readOAuthFile, scopeProblem, writeOAuthFile} from './oauth.ts';
import {NOW} from './test-helpers.ts';

/** Plays the owner's browser: reads the consent URL, then calls the loopback redirect like Google would. */
const browser = (fake: ReturnType<typeof createFakeYouTube>, answer: (url: URL) => Record<string, string>) => async (consent: string) => {
	const url = new URL(consent);
	fake.pkceChallenge = url.searchParams.get('code_challenge');
	const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
	for (const [k, v] of Object.entries(answer(url))) redirect.searchParams.set(k, v);
	setTimeout(() => void fetch(redirect).catch(() => {}), 5);
	return url;
};

describe('OAuth (installed app, loopback + PKCE)', () => {
	it('asks for youtube.upload and youtube.force-ssl with PKCE S256 on a 127.0.0.1 redirect, then exchanges the code', async () => {
		const fake = createFakeYouTube();
		let consent: URL | null = null;
		const open = browser(fake, (url) => ({code: 'test-code', state: url.searchParams.get('state') ?? ''}));
		const tokens = await authorize({client: {clientId: 'cid', clientSecret: 'secret'}, transport: fake.transport, endpoints: GOOGLE, now: () => NOW, openUrl: async (u) => void (consent = await open(u))});
		assert.ok(consent);
		const c = consent as URL;
		assert.equal(c.origin + c.pathname, GOOGLE.auth);
		assert.deepEqual(c.searchParams.get('scope')?.split(' '), [SCOPE_UPLOAD, SCOPE_FORCE_SSL]);
		assert.equal(c.searchParams.get('code_challenge_method'), 'S256');
		assert.match(c.searchParams.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
		assert.equal(tokens.refreshToken, 'rt-new');
		assert.equal(scopeProblem(tokens.scope), null);
		const exchange = new URLSearchParams(fake.byLabel('oauth.token')[0]?.body.toString() ?? '');
		assert.equal(exchange.get('grant_type'), 'authorization_code');
		assert.ok(exchange.get('code_verifier'), 'the PKCE verifier was sent (the fake checked it against the challenge)');
	});

	it('rejects an answer with the wrong state', async () => {
		const fake = createFakeYouTube();
		const open = browser(fake, () => ({code: 'test-code', state: 'forged'}));
		await assert.rejects(authorize({client: {clientId: 'cid', clientSecret: 'secret'}, transport: fake.transport, endpoints: GOOGLE, now: () => NOW, openUrl: async (u) => void (await open(u))}), /wrong state/);
	});

	it('needs youtube.force-ssl (captions, playlists, the channel check); force-ssl alone also covers uploads', () => {
		assert.match(scopeProblem(SCOPE_UPLOAD) ?? '', /lacks https:\/\/www\.googleapis\.com\/auth\/youtube\.force-ssl/);
		assert.equal(scopeProblem(SCOPE_FORCE_SSL), null);
		assert.equal(scopeProblem(`${SCOPE_UPLOAD} ${SCOPE_FORCE_SSL}`), null);
	});

	it('refreshes an expired access token and explains the 7-day "Testing" expiry on invalid_grant', async () => {
		const fake = createFakeYouTube();
		let saved = 0;
		const source = createTokenSource({
			client: {clientId: 'cid', clientSecret: 'secret'},
			tokens: {accessToken: 'at-old', expiresAt: NOW - 1, refreshToken: 'rt-0', scope: SCOPE_FORCE_SSL},
			transport: fake.transport,
			endpoints: GOOGLE,
			now: () => NOW,
			onTokens: () => void saved++,
		});
		assert.match(await source.getAccessToken(), /^at-/);
		assert.equal(saved, 1);
		const form = new URLSearchParams(fake.byLabel('oauth.token')[0]?.body.toString() ?? '');
		assert.equal(form.get('grant_type'), 'refresh_token');
		assert.equal(form.get('refresh_token'), 'rt-0');

		fake.revokedRefreshTokens.add('rt-0');
		await assert.rejects(source.getAccessToken(true), (error: unknown) => error instanceof AuthError && /7 days/.test(error.message) && /Personal/.test(error.message) && /Publish app/.test(error.message));
	});

	it('keeps tokens in an owner-only file and reads Desktop-app client secrets', () => {
		const dir = mkdtempSync(join(tmpdir(), 'uploader-oauth-'));
		try {
			const path = join(dir, 'state', 'oauth.json');
			const data = {version: 1 as const, client: {clientId: 'cid', clientSecret: 'secret'}, accounts: {'zoora-ai': {channelId: 'UCx', title: 'T', handle: null, authorizedAt: '2026-11-24T00:00:00.000Z', tokens: {accessToken: null, expiresAt: null, refreshToken: 'rt', scope: SCOPE_FORCE_SSL}}}};
			writeOAuthFile(path, data);
			assert.deepEqual(readOAuthFile(path), data);
			assert.equal(statSync(path).mode & 0o777, 0o600);
			assert.deepEqual(readOAuthFile(join(dir, 'missing.json')), {version: 1, client: null, accounts: {}});
			const secrets = join(dir, 'client_secret.json');
			writeFileSync(secrets, JSON.stringify({installed: {client_id: 'abc.apps.googleusercontent.com', client_secret: 'shh', redirect_uris: ['http://localhost']}}));
			assert.deepEqual(readClientSecrets(secrets), {clientId: 'abc.apps.googleusercontent.com', clientSecret: 'shh'});
			writeFileSync(secrets, JSON.stringify({something: 'else'}));
			assert.throws(() => readClientSecrets(secrets), /Desktop app/);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

describe('real fetch transport', () => {
	it("hands 308 Resume Incomplete (with Range) back to the caller instead of following it", async () => {
		const server = createServer((req, res) => {
			let n = 0;
			req.on('data', (c: Buffer) => (n += c.length));
			req.on('end', () => {
				res.writeHead(308, {range: `bytes=0-${n - 1}`, 'content-length': '0'});
				res.end();
			});
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		try {
			const {port} = server.address() as AddressInfo;
			const res = await fetchTransport({method: 'PUT', url: `http://127.0.0.1:${port}/upload?upload_id=x`, headers: {'content-range': 'bytes 0-1233/5000'}, body: Buffer.alloc(1234), timeoutMs: 5000});
			assert.equal(res.status, 308);
			assert.equal(res.headers.get('range'), 'bytes=0-1233');
		} finally {
			server.close();
		}
	});
});
