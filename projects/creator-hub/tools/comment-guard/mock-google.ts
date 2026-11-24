/**
 * Test support only: a local HTTP server that answers like Google's OAuth token endpoint and the YouTube
 * Data API v3 comment methods, using the recorded-shape responses in fixtures/api/. Tests point the guard
 * at it through the `endpoints` option, so no test ever reaches Google.
 */
import {readFileSync} from 'node:fs';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {Endpoints} from './youtube.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/api/${name}`, import.meta.url), 'utf8'));

export type RecordedRequest = {method: string; path: string; query: URLSearchParams; form: URLSearchParams; authorization: string | undefined};

export type MockGoogle = {
	endpoints: Endpoints;
	requests: RecordedRequest[];
	/** Comment ids that answer 404 commentNotFound when included in setModerationStatus. */
	deleted: Set<string>;
	/** When true, every YouTube API call answers 403 quotaExceeded. */
	quotaExceeded: boolean;
	/** Access tokens the API treats as expired (401). */
	expiredTokens: Set<string>;
	/** Refresh tokens the token endpoint rejects with invalid_grant. */
	revokedRefreshTokens: Set<string>;
	/** setModerationStatus calls: ids and the status set. */
	moderation: {ids: string[]; status: string; banAuthor: string | null}[];
	calls(path: string): RecordedRequest[];
	close(): Promise<void>;
};

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

const readBody = (req: IncomingMessage): Promise<string> =>
	new Promise((resolve) => {
		let body = '';
		req.setEncoding('utf8');
		req.on('data', (chunk: string) => (body += chunk));
		req.on('end', () => resolve(body));
	});

const json = (res: ServerResponse, status: number, body: unknown): void => {
	res.writeHead(status, {'content-type': 'application/json; charset=UTF-8'});
	res.end(JSON.stringify(body));
};

export const startMockGoogle = async (): Promise<MockGoogle> => {
	const mock = {
		requests: [] as RecordedRequest[],
		deleted: new Set<string>(),
		quotaExceeded: false,
		expiredTokens: new Set<string>(),
		revokedRefreshTokens: new Set<string>(),
		moderation: [] as {ids: string[]; status: string; banAuthor: string | null}[],
	};
	const server: Server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const form = new URLSearchParams(await readBody(req));
		const recorded = {method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, form, authorization: req.headers.authorization};
		mock.requests.push(recorded);

		if (url.pathname === '/token') {
			if (form.get('grant_type') === 'authorization_code') {
				if (form.get('code') !== 'test-code' || !form.get('code_verifier') || !form.get('client_secret')) return json(res, 400, {error: 'invalid_grant'});
				return json(res, 200, {access_token: 'at-initial', expires_in: 3599, refresh_token: 'rt-initial', scope: SCOPE, token_type: 'Bearer'});
			}
			if (form.get('grant_type') === 'refresh_token') {
				if (mock.revokedRefreshTokens.has(form.get('refresh_token') ?? '')) {
					return json(res, 400, {error: 'invalid_grant', error_description: 'Token has been expired or revoked.'});
				}
				return json(res, 200, {access_token: 'at-refreshed', expires_in: 3599, scope: SCOPE, token_type: 'Bearer'});
			}
			return json(res, 400, {error: 'unsupported_grant_type'});
		}
		if (url.pathname === '/revoke') return json(res, 200, {});

		const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
		if (!token || mock.expiredTokens.has(token)) {
			return json(res, 401, {error: {code: 401, message: 'Request had invalid authentication credentials.', errors: [{reason: 'authError'}]}});
		}
		if (mock.quotaExceeded) return json(res, 403, fixture('error.quotaExceeded.json'));

		if (url.pathname === '/youtube/v3/channels' && url.searchParams.get('mine') === 'true') return json(res, 200, fixture('channels.mine.json'));
		if (url.pathname === '/youtube/v3/commentThreads') {
			return json(res, 200, fixture(url.searchParams.get('pageToken') === 'PAGE2' ? 'commentThreads.page2.json' : 'commentThreads.page1.json'));
		}
		if (url.pathname === '/youtube/v3/comments' && url.searchParams.get('parentId')) return json(res, 200, fixture('comments.replies.json'));
		if (url.pathname === '/youtube/v3/comments/setModerationStatus' && req.method === 'POST') {
			const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
			if (ids.some((id) => mock.deleted.has(id))) return json(res, 404, fixture('error.commentNotFound.json'));
			mock.moderation.push({ids, status: url.searchParams.get('moderationStatus') ?? '', banAuthor: url.searchParams.get('banAuthor')});
			res.writeHead(204);
			return res.end();
		}
		return json(res, 404, {error: {code: 404, message: 'Not found', errors: [{reason: 'notFound'}]}});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return Object.assign(mock, {
		endpoints: {api: `${base}/youtube/v3`, auth: `${base}/auth`, token: `${base}/token`, revoke: `${base}/revoke`},
		calls: (path: string) => mock.requests.filter((r) => r.path === path),
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	});
};

/** Plays the browser: follows Google's consent URL straight to the loopback redirect with a code. */
export const approveInBrowser = async (consentUrl: string, override: Record<string, string> = {}): Promise<void> => {
	const url = new URL(consentUrl);
	const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
	redirect.search = new URLSearchParams({code: 'test-code', state: url.searchParams.get('state') ?? '', ...override}).toString();
	await fetch(redirect);
};
