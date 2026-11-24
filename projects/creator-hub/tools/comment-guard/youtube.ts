/**
 * YouTube Data API v3 client for the comment guard: OAuth for installed apps (loopback redirect with
 * PKCE), reading a channel's comment threads and replies, and holding comments for review.
 *
 * The guard only ever sets `heldForReview` (and `published`, to undo). It never rejects, deletes or bans:
 * held comments wait in YouTube Studio > Comments > "Held for review", where the owner decides.
 *
 * Contracts, checked 2026-11-24:
 * - Methods, parameters, enums and scopes: the API discovery document, revision 20261123, read directly:
 *   https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest
 *     commentThreads.list  GET  youtube/v3/commentThreads  part, allThreadsRelatedToChannelId, maxResults 1-100,
 *                          pageToken, textFormat (html|plainText), order (time|relevance), moderationStatus (default published)
 *     comments.list        GET  youtube/v3/comments  part, parentId, maxResults 1-100, pageToken, textFormat
 *     comments.setModerationStatus  POST youtube/v3/comments/setModerationStatus  id (repeated), moderationStatus
 *                          (heldForReview | published | rejected), banAuthor (only valid with rejected; never sent here)
 *     channels.list        GET  youtube/v3/channels  part, mine
 *   All comment methods need the scope https://www.googleapis.com/auth/youtube.force-ssl.
 * - Reference pages: https://developers.google.com/youtube/v3/docs/commentThreads/list ,
 *   https://developers.google.com/youtube/v3/docs/comments/list ,
 *   https://developers.google.com/youtube/v3/docs/comments/setModerationStatus (id is "a comma-separated list"),
 *   https://developers.google.com/youtube/v3/docs/channels/list
 * - Quota: https://developers.google.com/youtube/v3/determine_quota_cost lists channels.list, comments.list and
 *   commentThreads.list at 1 unit and comments.setModerationStatus at 50; projects get 10,000 units a day by
 *   default and every request, even an invalid one, costs at least 1 unit. developers.google.com could not be
 *   opened from the build machine, so these numbers come from search-index extracts of those pages: check the
 *   Quotas page of your Google Cloud project before raising --max-quota.
 * - OAuth for desktop apps: https://developers.google.com/identity/protocols/oauth2/native-app (loopback redirect
 *   http://127.0.0.1:<port>, PKCE with S256). Endpoints from https://accounts.google.com/.well-known/openid-configuration
 *   (read directly): authorization https://accounts.google.com/o/oauth2/v2/auth, token https://oauth2.googleapis.com/token,
 *   revocation https://oauth2.googleapis.com/revoke.
 */
import {createHash, randomBytes} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {dirname} from 'node:path';

export const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

export type Endpoints = {api: string; auth: string; token: string; revoke: string};
export const GOOGLE: Endpoints = {
	api: 'https://youtube.googleapis.com/youtube/v3',
	auth: 'https://accounts.google.com/o/oauth2/v2/auth',
	token: 'https://oauth2.googleapis.com/token',
	revoke: 'https://oauth2.googleapis.com/revoke',
};

/** Units per call (see the quota note above). Reads cost 1; changing a comment's status costs 50. */
export const QUOTA_COST = {
	'channels.list': 1,
	'commentThreads.list': 1,
	'comments.list': 1,
	'comments.setModerationStatus': 50,
} as const;
export type ApiMethod = keyof typeof QUOTA_COST;

/** The only statuses the guard sets: hold for review, or publish again to undo a hold. */
export type ModerationStatus = 'heldForReview' | 'published';

export class QuotaBudgetError extends Error {
	constructor(method: ApiMethod, used: number, max: number) {
		super(`Stopped before ${method}: it costs ${QUOTA_COST[method]} units and ${used} of the ${max}-unit budget (--max-quota) are used.`);
		this.name = 'QuotaBudgetError';
	}
}

/** Counts API quota units and refuses a call that would go over the budget. */
export class QuotaBudget {
	readonly max: number;
	used = 0;
	readonly calls: Partial<Record<ApiMethod, number>> = {};

	constructor(max: number) {
		if (!Number.isInteger(max) || max < 1) throw new Error('The quota budget must be a whole number of at least 1.');
		this.max = max;
	}

	canAfford(method: ApiMethod, times = 1): boolean {
		return this.used + QUOTA_COST[method] * times <= this.max;
	}

	spend(method: ApiMethod): void {
		if (!this.canAfford(method)) throw new QuotaBudgetError(method, this.used, this.max);
		this.used += QUOTA_COST[method];
		this.calls[method] = (this.calls[method] ?? 0) + 1;
	}
}

export class YouTubeApiError extends Error {
	readonly status: number;
	readonly reason: string;
	constructor(status: number, reason: string, message: string) {
		super(`YouTube API error ${status} (${reason}): ${message}`);
		this.name = 'YouTubeApiError';
		this.status = status;
		this.reason = reason;
	}
	/** The project's daily quota is used up; it resets at midnight Pacific Time. */
	get isQuota(): boolean {
		return this.reason === 'quotaExceeded' || this.reason === 'dailyLimitExceeded';
	}
}

export class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthError';
	}
}

/* ------------------------------------------------------------------ saved credentials */

export type OAuthClient = {clientId: string; clientSecret: string};
export type Tokens = {accessToken: string | null; expiresAt: number | null; refreshToken: string; scope: string};
export type SavedAccount = {channelId: string; title: string; handle: string | null; tokens: Tokens; savedAt: string};
/** config/youtube-oauth.json (gitignored). One Google OAuth client, one or more authorised channels. */
export type OAuthFile = {version: 1; client: OAuthClient; accounts: Record<string, SavedAccount>};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const readOAuthFile = (path: string): OAuthFile | null => {
	if (!existsSync(path)) return null;
	const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
	const client = isRecord(data) && isRecord(data.client) ? data.client : null;
	const accounts = isRecord(data) && isRecord(data.accounts) ? data.accounts : null;
	if (!isRecord(data) || data.version !== 1 || !client || !accounts || !str(client.clientId) || !str(client.clientSecret)) {
		throw new Error(`${path} is not a comment-guard OAuth file (version 1). Delete it and run "guard auth" again.`);
	}
	const out: OAuthFile = {version: 1, client: {clientId: String(client.clientId), clientSecret: String(client.clientSecret)}, accounts: {}};
	for (const [key, value] of Object.entries(accounts)) {
		const tokens = isRecord(value) && isRecord(value.tokens) ? value.tokens : null;
		if (!isRecord(value) || !tokens || !str(value.channelId) || !str(tokens.refreshToken)) {
			throw new Error(`${path}: account "${key}" is incomplete. Run "guard auth --account ${key}" again.`);
		}
		out.accounts[key] = {
			channelId: String(value.channelId),
			title: str(value.title) ?? '',
			handle: str(value.handle),
			savedAt: str(value.savedAt) ?? '',
			tokens: {
				accessToken: str(tokens.accessToken),
				expiresAt: num(tokens.expiresAt),
				refreshToken: String(tokens.refreshToken),
				scope: str(tokens.scope) ?? '',
			},
		};
	}
	return out;
};

/** Writes the file readable by the owner only (0600), via a temporary file so it is never half-written. */
export const writeOAuthFile = (path: string, data: OAuthFile): void => {
	mkdirSync(dirname(path), {recursive: true});
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(data, null, '\t')}\n`, {mode: 0o600});
	renameSync(temporary, path);
	chmodSync(path, 0o600);
};

/** Reads the client id and secret from the JSON file Google Cloud Console offers for a "Desktop app" client. */
export const readClientSecrets = (path: string): OAuthClient => {
	const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
	const section = isRecord(data) ? (data.installed ?? data.web) : null;
	if (!isRecord(section) || !str(section.client_id) || !str(section.client_secret)) {
		throw new Error(`${path} has no "installed" client_id and client_secret. Create an OAuth client of type "Desktop app" and download its JSON.`);
	}
	return {clientId: String(section.client_id), clientSecret: String(section.client_secret)};
};

/* ------------------------------------------------------------------ OAuth */

type FetchLike = typeof fetch;

const base64url = (buffer: Buffer): string => buffer.toString('base64url');

const tokenRequest = async (fetchImpl: FetchLike, url: string, form: Record<string, string>): Promise<Record<string, unknown>> => {
	const res = await fetchImpl(url, {
		method: 'POST',
		headers: {'content-type': 'application/x-www-form-urlencoded', accept: 'application/json'},
		body: new URLSearchParams(form).toString(),
		signal: AbortSignal.timeout(30_000),
	});
	const body: unknown = await res.json().catch(() => null);
	if (res.ok && isRecord(body)) return body;
	const error = isRecord(body) ? (str(body.error) ?? 'unknown_error') : `http_${res.status}`;
	if (error === 'invalid_grant') {
		throw new AuthError(
			'The saved YouTube authorization has expired or was revoked. Run "guard auth" again. ' +
				'If your Google Cloud OAuth consent screen is in "Testing" mode, refresh tokens expire after 7 days: set it to "In production".',
		);
	}
	const detail = isRecord(body) ? (str(body.error_description) ?? '') : '';
	throw new AuthError(`Google's token endpoint refused the request: ${error}${detail ? ` (${detail})` : ''}.`);
};

const tokensFrom = (body: Record<string, unknown>, now: number, refreshToken: string | null): Tokens => {
	const accessToken = str(body.access_token);
	const refresh = str(body.refresh_token) ?? refreshToken;
	if (!accessToken || !refresh) {
		throw new AuthError(
			'Google did not return a refresh token. Remove this app at https://myaccount.google.com/permissions and run "guard auth" again.',
		);
	}
	const expiresIn = num(body.expires_in) ?? 3600;
	return {accessToken, expiresAt: now + expiresIn * 1000, refreshToken: refresh, scope: str(body.scope) ?? SCOPE};
};

export type AuthorizeOptions = {
	client: OAuthClient;
	/** Shows the consent URL to the owner (print it, or open a browser). */
	openUrl: (url: string) => void | Promise<void>;
	endpoints?: Endpoints;
	fetch?: FetchLike;
	timeoutMs?: number;
	now?: () => number;
};

const callbackPage = (title: string, message: string): string =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
	'<style>body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0B0C0F;color:#F4F6F8;margin:0;padding:48px 16px}' +
	'main{max-width:32rem;margin:0 auto}h1{font-size:1.25rem;color:#29B8AD}</style></head>' +
	`<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

/**
 * Installed-app OAuth with a loopback redirect: listens on 127.0.0.1 (random port), sends the owner to
 * Google's consent page, receives the code and exchanges it (with the PKCE verifier) for tokens.
 */
export const authorize = async (options: AuthorizeOptions): Promise<Tokens> => {
	const endpoints = options.endpoints ?? GOOGLE;
	const fetchImpl = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	const verifier = base64url(randomBytes(32));
	const challenge = base64url(createHash('sha256').update(verifier).digest());
	const state = base64url(randomBytes(16));

	let settle: {resolve: (code: string) => void; reject: (error: Error) => void} | undefined;
	const received = new Promise<string>((resolve, reject) => {
		settle = {resolve, reject};
	});
	received.catch(() => {}); // handled where it is awaited; this stops an early rejection counting as unhandled
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const send = (status: number, title: string, message: string) => {
			res.writeHead(status, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"});
			res.end(callbackPage(title, message));
		};
		if (url.pathname !== '/' || req.method !== 'GET') return send(404, 'Not found', 'This address only receives the Google sign-in.');
		if (url.searchParams.get('state') !== state) {
			send(400, 'Sign-in not accepted', 'The sign-in response did not match this request. Run the command again.');
			return settle?.reject(new AuthError('The OAuth response had the wrong state value, so it was rejected.'));
		}
		const error = url.searchParams.get('error');
		const code = url.searchParams.get('code');
		if (error || !code) {
			send(400, 'Access not granted', 'The comment guard was not given access. You can close this tab.');
			return settle?.reject(new AuthError(`Google sign-in did not grant access (${error ?? 'no code'}).`));
		}
		send(200, 'Signed in', 'The comment guard can now read and hold comments on your channel. You can close this tab.');
		settle?.resolve(code);
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const timer = setTimeout(() => settle?.reject(new AuthError('Timed out waiting for the Google sign-in.')), options.timeoutMs ?? 300_000);
	try {
		const authUrl = new URL(endpoints.auth);
		authUrl.search = new URLSearchParams({
			client_id: options.client.clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: SCOPE,
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state,
		}).toString();
		await options.openUrl(authUrl.toString());
		const code = await received;
		const body = await tokenRequest(fetchImpl, endpoints.token, {
			code,
			client_id: options.client.clientId,
			client_secret: options.client.clientSecret,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code',
			code_verifier: verifier,
		});
		const tokens = tokensFrom(body, now(), null);
		if (!tokens.scope.split(/\s+/).includes(SCOPE)) {
			throw new AuthError(`Access to "${SCOPE}" was not granted, and the guard needs it to read and hold comments. Run "guard auth" again and allow it.`);
		}
		return tokens;
	} finally {
		clearTimeout(timer);
		server.close();
	}
};

/** Revokes a refresh token at Google (the owner can also do this at https://myaccount.google.com/permissions). */
export const revokeToken = async (token: string, options: {endpoints?: Endpoints; fetch?: FetchLike} = {}): Promise<void> => {
	const endpoints = options.endpoints ?? GOOGLE;
	const res = await (options.fetch ?? fetch)(endpoints.revoke, {
		method: 'POST',
		headers: {'content-type': 'application/x-www-form-urlencoded'},
		body: new URLSearchParams({token}).toString(),
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok && res.status !== 400) throw new AuthError(`Google refused to revoke the token (HTTP ${res.status}).`);
};

/* ------------------------------------------------------------------ API client */

/** A comment as the guard uses it, from either a commentThreads.list top-level comment or a reply. */
export type GuardComment = {
	id: string;
	threadId: string;
	parentId: string | null;
	videoId: string | null;
	authorName: string;
	authorChannelId: string | null;
	authorChannelUrl: string | null;
	text: string;
	publishedAt: string | null;
	likeCount: number;
};

export type ClientOptions = {
	client: OAuthClient;
	tokens: Tokens;
	budget: QuotaBudget;
	endpoints?: Endpoints;
	fetch?: FetchLike;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	/** Called with refreshed tokens so they can be saved. */
	onTokens?: (tokens: Tokens) => void;
};

export type YouTubeClient = {
	myChannel(): Promise<{id: string; title: string; handle: string | null}>;
	listThreads(channelId: string, pageToken?: string, maxResults?: number): Promise<{comments: GuardComment[]; replyCounts: Map<string, number>; nextPageToken: string | null}>;
	listReplies(parentId: string, threadId: string, pageToken?: string): Promise<{comments: GuardComment[]; nextPageToken: string | null}>;
	setModerationStatus(ids: string[], status: ModerationStatus): Promise<void>;
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const apiError = async (res: Response): Promise<YouTubeApiError> => {
	const body: unknown = await res.json().catch(() => null);
	const error = isRecord(body) && isRecord(body.error) ? body.error : null;
	const first = error && Array.isArray(error.errors) && isRecord(error.errors[0]) ? error.errors[0] : null;
	return new YouTubeApiError(res.status, (first && str(first.reason)) ?? `http_${res.status}`, (error && str(error.message)) ?? res.statusText);
};

const toComment = (resource: unknown, threadId: string, fallbackVideoId: string | null): GuardComment | null => {
	if (!isRecord(resource) || !str(resource.id) || !isRecord(resource.snippet)) return null;
	const s = resource.snippet;
	const author = isRecord(s.authorChannelId) ? str(s.authorChannelId.value) : null;
	return {
		id: String(resource.id),
		threadId,
		parentId: str(s.parentId),
		videoId: str(s.videoId) ?? fallbackVideoId,
		authorName: str(s.authorDisplayName) ?? '',
		authorChannelId: author,
		authorChannelUrl: str(s.authorChannelUrl),
		// textOriginal is only returned to the comment's author; textDisplay (plain text) is always there.
		text: str(s.textOriginal) || str(s.textDisplay) || '',
		publishedAt: str(s.publishedAt),
		likeCount: num(s.likeCount) ?? 0,
	};
};

export const createClient = (options: ClientOptions): YouTubeClient => {
	const endpoints = options.endpoints ?? GOOGLE;
	const fetchImpl = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	let tokens = options.tokens;

	const accessToken = async (force: boolean): Promise<string> => {
		if (!force && tokens.accessToken && tokens.expiresAt !== null && tokens.expiresAt - 60_000 > now()) return tokens.accessToken;
		const body = await tokenRequest(fetchImpl, endpoints.token, {
			grant_type: 'refresh_token',
			refresh_token: tokens.refreshToken,
			client_id: options.client.clientId,
			client_secret: options.client.clientSecret,
		});
		tokens = tokensFrom(body, now(), tokens.refreshToken);
		options.onTokens?.(tokens);
		return tokens.accessToken ?? '';
	};

	const call = async (method: ApiMethod, httpMethod: 'GET' | 'POST', path: string, params: URLSearchParams): Promise<unknown> => {
		let refreshed = false;
		let forceRefresh = false;
		for (let attempt = 0; ; attempt++) {
			options.budget.spend(method); // throws before any request that would exceed --max-quota
			const token = await accessToken(forceRefresh);
			forceRefresh = false;
			const res = await fetchImpl(`${endpoints.api}/${path}?${params}`, {
				method: httpMethod,
				headers: {authorization: `Bearer ${token}`, accept: 'application/json'},
				signal: AbortSignal.timeout(30_000),
			});
			if (res.ok) {
				const text = await res.text();
				return text ? JSON.parse(text) : null;
			}
			const error = await apiError(res);
			if (res.status === 401 && !refreshed) {
				refreshed = true; // the access token was revoked or expired early: refresh once and retry
				forceRefresh = true;
				continue;
			}
			if (RETRYABLE.has(res.status) && !error.isQuota && attempt < 2) {
				await sleep(1000 * 2 ** attempt);
				continue;
			}
			throw error;
		}
	};

	return {
		async myChannel() {
			const body = await call('channels.list', 'GET', 'channels', new URLSearchParams({part: 'snippet', mine: 'true'}));
			const item = isRecord(body) && Array.isArray(body.items) && isRecord(body.items[0]) ? body.items[0] : null;
			const snippet = item && isRecord(item.snippet) ? item.snippet : null;
			if (!item || !str(item.id) || !snippet) throw new AuthError('This Google account has no YouTube channel.');
			return {id: String(item.id), title: str(snippet.title) ?? '', handle: str(snippet.customUrl)};
		},

		async listThreads(channelId, pageToken, maxResults = 100) {
			const params = new URLSearchParams({
				part: 'snippet,replies',
				allThreadsRelatedToChannelId: channelId,
				maxResults: String(Math.max(1, Math.min(100, maxResults))),
				order: 'time',
				textFormat: 'plainText',
			});
			if (pageToken) params.set('pageToken', pageToken);
			const body = await call('commentThreads.list', 'GET', 'commentThreads', params);
			const comments: GuardComment[] = [];
			const replyCounts = new Map<string, number>();
			const items = isRecord(body) && Array.isArray(body.items) ? body.items : [];
			for (const thread of items) {
				if (!isRecord(thread) || !str(thread.id) || !isRecord(thread.snippet)) continue;
				const threadId = String(thread.id);
				const videoId = str(thread.snippet.videoId);
				const top = toComment(thread.snippet.topLevelComment, threadId, videoId);
				if (!top) continue;
				comments.push(top);
				const inline = isRecord(thread.replies) && Array.isArray(thread.replies.comments) ? thread.replies.comments : [];
				for (const reply of inline) {
					const comment = toComment(reply, threadId, videoId);
					if (comment) comments.push(comment);
				}
				const total = num(thread.snippet.totalReplyCount) ?? 0;
				if (total > inline.length) replyCounts.set(top.id, total);
			}
			return {comments, replyCounts, nextPageToken: isRecord(body) ? str(body.nextPageToken) : null};
		},

		async listReplies(parentId, threadId, pageToken) {
			const params = new URLSearchParams({part: 'snippet', parentId, maxResults: '100', textFormat: 'plainText'});
			if (pageToken) params.set('pageToken', pageToken);
			const body = await call('comments.list', 'GET', 'comments', params);
			const items = isRecord(body) && Array.isArray(body.items) ? body.items : [];
			const comments = items.map((item) => toComment(item, threadId, null)).filter((c): c is GuardComment => c !== null);
			return {comments, nextPageToken: isRecord(body) ? str(body.nextPageToken) : null};
		},

		async setModerationStatus(ids, status) {
			if (!ids.length) return;
			if (status !== 'heldForReview' && status !== 'published') throw new Error(`Refusing moderation status "${String(status)}".`);
			await call('comments.setModerationStatus', 'POST', 'comments/setModerationStatus', new URLSearchParams({id: ids.join(','), moderationStatus: status}));
		},
	};
};

export type FetchResult = {comments: GuardComment[]; threads: number; truncated: string | null};

/**
 * Reads the newest comment threads of a channel (its videos and the channel itself) and all their
 * replies, stopping at `maxThreads` or when the quota budget cannot pay for the next page.
 */
export const fetchChannelComments = async (
	client: YouTubeClient,
	budget: QuotaBudget,
	channelId: string,
	maxThreads: number,
): Promise<FetchResult> => {
	const byId = new Map<string, GuardComment>();
	let threads = 0;
	let truncated: string | null = null;
	let pageToken: string | undefined;
	do {
		if (!budget.canAfford('commentThreads.list')) {
			truncated = `quota budget reached after ${threads} threads`;
			break;
		}
		const page = await client.listThreads(channelId, pageToken, maxThreads - threads);
		for (const comment of page.comments) byId.set(comment.id, comment);
		threads += page.comments.filter((c) => c.parentId === null).length;
		for (const [parentId, total] of page.replyCounts) {
			let replyPage: string | undefined;
			let read = 0;
			do {
				if (!budget.canAfford('comments.list')) {
					truncated = 'quota budget reached; some replies were not read';
					break;
				}
				const replies = await client.listReplies(parentId, byId.get(parentId)?.threadId ?? parentId, replyPage);
				for (const reply of replies.comments) byId.set(reply.id, reply);
				read += replies.comments.length;
				replyPage = replies.nextPageToken ?? undefined;
			} while (replyPage && read < total);
		}
		pageToken = page.nextPageToken ?? undefined;
		if (pageToken && threads >= maxThreads) truncated = `stopped at --max-threads ${maxThreads}`;
	} while (pageToken && threads < maxThreads);
	return {comments: [...byId.values()], threads, truncated};
};
