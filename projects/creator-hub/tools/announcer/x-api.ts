/**
 * X API v2 "Create Post": POST https://api.x.com/2/tweets with a JSON body {"text": "..."}, signed with OAuth 1.0a
 * user context (oauth1.ts). Success is 201 {"data": {"id", "text"}}.
 *
 * Contract and access (checked 2026-11-24; docs.x.com could not be opened from the build machine, so this rests on
 * search-index extracts of the official pages, cited in README.md):
 * - Auth: OAuth 1.0a User Context or OAuth 2.0 Authorization Code with PKCE (docs.x.com/x-api/posts/manage-tweets/
 *   integrate, v2 authentication mapping). This client uses OAuth 1.0a: its user tokens do not expire, which suits a
 *   command-line tool. The app needs "Read and write" permission, and the access token must be generated after that
 *   permission was set.
 * - Access: pay-per-use credits bought in the Developer Console (docs.x.com/x-api/getting-started/pricing). The
 *   localized copies of that page list "Post: Create" at $0.015 and "Post: Create (with URL)" at $0.200 per request.
 * - Rate limit: the endpoint reference lists 200 requests per 15 minutes per user; an older limits table says 100 per
 *   24 hours per user. The announcer sends at most one post per kit, so either is enough.
 *
 * One request, never retried automatically: X has no idempotency key, and a retry after a lost answer could post
 * twice. The ledger (ledger.ts) records the outcome.
 */
import {signOAuth1, type OAuth1Credentials} from './oauth1.ts';

export const X_API_BASE = 'https://api.x.com/2';
export const X_CREATE_POST_URL = `${X_API_BASE}/tweets`;
const TIMEOUT_MS = 20_000;

/** The four OAuth 1.0a values, from the app's "Keys and tokens" page in the X Developer Console. */
export const X_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'] as const;

export const xCredentialsFromEnv = (env: Record<string, string | undefined>): {credentials: OAuth1Credentials | null; missing: string[]} => {
	const missing = X_ENV.filter((k) => !(env[k] ?? '').trim());
	if (missing.length > 0) return {credentials: null, missing};
	return {
		credentials: {
			consumerKey: (env.X_API_KEY ?? '').trim(),
			consumerSecret: (env.X_API_SECRET ?? '').trim(),
			token: (env.X_ACCESS_TOKEN ?? '').trim(),
			tokenSecret: (env.X_ACCESS_TOKEN_SECRET ?? '').trim(),
		},
		missing,
	};
};

export class XApiError extends Error {
	readonly status: number | null;
	/** True when X answered with a refusal: nothing was posted, so a later run may try again. */
	readonly definite: boolean;
	constructor(status: number | null, definite: boolean, message: string) {
		super(message);
		this.name = 'XApiError';
		this.status = status;
		this.definite = definite;
	}
}

export type XPost = {id: string; text: string; url: string};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** X's problem bodies: {"title", "detail", "type"} or {"errors": [{"message"}]}; falls back to the status. */
const problemText = (body: unknown, status: number, headers: Headers): string => {
	const parts: string[] = [];
	if (isRecord(body)) {
		if (typeof body.title === 'string') parts.push(body.title);
		if (typeof body.detail === 'string') parts.push(body.detail);
		if (Array.isArray(body.errors)) for (const e of body.errors) if (isRecord(e) && typeof e.message === 'string') parts.push(e.message);
	}
	const reset = Number(headers.get('x-rate-limit-reset'));
	const hint =
		status === 401 ? ' Check X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET.'
		: status === 402 ? ' The account may be out of API credits: check the X Developer Console.'
		: status === 403 ? ' The app needs "Read and write" permission (regenerate the access token after changing it); X also refuses duplicate text and accounts without API access or credits.'
		: status === 429 ? ` Rate or usage limit reached${Number.isFinite(reset) && reset > 0 ? `; it resets at ${new Date(reset * 1000).toISOString()}` : ''}.`
		: '';
	return `X answered ${status}${parts.length > 0 ? `: ${[...new Set(parts)].join('; ').slice(0, 400)}` : ''}.${hint}`;
};

export type XClientOptions = {credentials: OAuth1Credentials; fetch?: typeof fetch; timeoutMs?: number; nonce?: string; timestampSec?: number};

export const createPost = async (text: string, options: XClientOptions): Promise<XPost> => {
	if (!text.trim()) throw new XApiError(null, true, 'Refusing to post empty text.');
	const {authorization} = signOAuth1({method: 'POST', url: X_CREATE_POST_URL, credentials: options.credentials, nonce: options.nonce, timestampSec: options.timestampSec});
	let response: Response;
	try {
		response = await (options.fetch ?? fetch)(X_CREATE_POST_URL, {
			method: 'POST',
			headers: {Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json'},
			body: JSON.stringify({text}),
			redirect: 'error', // never send the signed header to another host
			signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
		});
	} catch (err) {
		const reason = err instanceof Error && err.name === 'TimeoutError' ? 'no answer in time' : 'the request failed';
		throw new XApiError(null, false, `Could not reach X (${reason}). The post may still have been created: check the account before running again.`);
	}
	const raw = await response.text().catch(() => '');
	let body: unknown = null;
	try {
		body = raw ? JSON.parse(raw) : null;
	} catch {
		body = null;
	}
	if (!response.ok) throw new XApiError(response.status, response.status < 500, problemText(body, response.status, response.headers));
	const data = isRecord(body) && isRecord(body.data) ? body.data : null;
	const id = data && typeof data.id === 'string' && /^\d{1,25}$/.test(data.id) ? data.id : null;
	if (!id) throw new XApiError(response.status, false, 'X answered without a post id. Check the account for the post before running again.');
	return {id, text: typeof data?.text === 'string' ? data.text : text, url: `https://x.com/i/web/status/${id}`};
};
