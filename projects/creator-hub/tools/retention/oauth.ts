/**
 * OAuth for the retention tool: an installed ("Desktop app") Google OAuth client, loopback redirect with PKCE
 * (developers.google.com/identity/protocols/oauth2/native-app, read 2026-11-24: "refresh tokens are always returned
 * for installed applications"), read-only scopes yt-analytics.readonly + youtube.readonly.
 *
 * Reused by import: comment-guard's client-secrets reader, token revocation, AuthError and Google endpoints, and the
 * dashboard's environment-variable token exchange (YT_ANALYTICS_*), so CI can run with repository secrets.
 * comment-guard's own `authorize` is not reused: it is fixed to the youtube.force-ssl scope and its consent page text.
 *
 * Tokens live in a file that MUST be gitignored (this repository is public): by default
 * projects/creator-hub/data/retention/oauth.json (data/ is ignored). Before writing, `git check-ignore` is asked; a
 * path git would track is refused. The file is written with mode 0600, in place (no temporary copies).
 *
 * OAuth facts (identity/protocols/oauth2#expiration, read 2026-11-24): a consent screen in "Testing" issues refresh
 * tokens that expire after 7 days (set it to "In production"); unused tokens expire after 6 months; at most 100 live
 * refresh tokens per account and client (the oldest is dropped silently).
 */
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {dirname, resolve} from 'node:path';
import {AuthError, readClientSecrets, revokeToken, type OAuthClient} from '../comment-guard/youtube.ts';
import {resolveAccessToken, type TokenEnv} from '../dashboard/youtube-api.ts';
import {ENDPOINTS, SCOPES, type Endpoints, type FetchLike, type TokenSource} from './api.ts';

export {AuthError, readClientSecrets, revokeToken};
export type {OAuthClient};

export type Tokens = {accessToken: string | null; expiresAt: number | null; refreshToken: string; scope: string};
export type Account = {channelId: string; title: string; tokens: Tokens; savedAt: string};
export type TokenFile = {version: 1; kind: 'retention-oauth'; client: OAuthClient; accounts: Record<string, Account>};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const readTokenFile = (path: string): TokenFile | null => {
	if (!existsSync(path)) return null;
	const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (!isRecord(data) || data.version !== 1 || data.kind !== 'retention-oauth' || !isRecord(data.client) || !isRecord(data.accounts)) {
		throw new AuthError(`${path} is not a retention OAuth file. Delete it and run "auth" again.`);
	}
	const clientId = str(data.client.clientId);
	const clientSecret = str(data.client.clientSecret);
	if (!clientId || !clientSecret) throw new AuthError(`${path} has no OAuth client. Run "auth --client-secrets <file>".`);
	const accounts: Record<string, Account> = {};
	for (const [key, value] of Object.entries(data.accounts)) {
		const tokens = isRecord(value) && isRecord(value.tokens) ? value.tokens : null;
		const refreshToken = tokens ? str(tokens.refreshToken) : null;
		if (!isRecord(value) || !tokens || !refreshToken || !str(value.channelId)) throw new AuthError(`${path}: account "${key}" is incomplete. Run "auth --account ${key}" again.`);
		accounts[key] = {
			channelId: String(value.channelId),
			title: str(value.title) ?? '',
			savedAt: str(value.savedAt) ?? '',
			tokens: {accessToken: str(tokens.accessToken), expiresAt: num(tokens.expiresAt), refreshToken, scope: str(tokens.scope) ?? ''},
		};
	}
	return {version: 1, kind: 'retention-oauth', client: {clientId, clientSecret}, accounts};
};

/** 'ignored', 'tracked' (git would commit it) or 'no-repo' (not in a git work tree, or git is missing). */
export const gitIgnoreStatus = (path: string): 'ignored' | 'tracked' | 'no-repo' => {
	let dir = dirname(resolve(path));
	while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir); // git needs an existing folder to run in
	try {
		execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {cwd: dir, stdio: 'ignore'});
	} catch {
		return 'no-repo';
	}
	try {
		execFileSync('git', ['check-ignore', '-q', resolve(path)], {cwd: dir, stdio: 'ignore'});
		return 'ignored';
	} catch (err) {
		return (err as {status?: number}).status === 1 ? 'tracked' : 'no-repo';
	}
};

/** Writes a secret file (0600) only where git ignores it. */
export const writeSecretFile = (path: string, content: string): void => {
	if (gitIgnoreStatus(path) === 'tracked') {
		throw new AuthError(`Refusing to write OAuth tokens to ${path}: git would track that file, and this repository is public. Use a path under data/ (gitignored).`);
	}
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, content, {mode: 0o600});
	chmodSync(path, 0o600);
};

export const writeTokenFile = (path: string, data: TokenFile): void => writeSecretFile(path, `${JSON.stringify(data, null, '\t')}\n`);

/* ------------------------------------------------------------------ token endpoint */

const tokenRequest = async (fetchImpl: FetchLike, url: string, form: Record<string, string>): Promise<Record<string, unknown>> => {
	let res: Response;
	try {
		res = await fetchImpl(url, {
			method: 'POST',
			headers: {'content-type': 'application/x-www-form-urlencoded', accept: 'application/json'},
			body: new URLSearchParams(form).toString(),
			signal: AbortSignal.timeout(30_000),
		});
	} catch (err) {
		throw new AuthError(`Google's token endpoint could not be reached: ${(err as Error).message}`);
	}
	const body: unknown = await res.json().catch(() => null);
	if (res.ok && isRecord(body)) return body;
	const error = isRecord(body) ? (str(body.error) ?? 'unknown_error') : `http_${res.status}`;
	if (error === 'invalid_grant') {
		throw new AuthError(
			'The saved YouTube authorization has expired or was revoked. Run "auth" again. If the Google Cloud OAuth consent screen is in "Testing", ' +
				'refresh tokens expire after 7 days: set it to "In production". (YouTube API Developer Policies III.E.4: data stored under a lost ' +
				'authorization must be deleted within 30 days unless it is re-authorized; see "forget".)',
		);
	}
	const detail = isRecord(body) ? (str(body.error_description) ?? '') : '';
	throw new AuthError(`Google's token endpoint refused the request: ${error}${detail ? ` (${detail})` : ''}.`);
};

const tokensFrom = (body: Record<string, unknown>, now: number, previousRefresh: string | null, fallbackScope: string): Tokens => {
	const accessToken = str(body.access_token);
	const refreshToken = str(body.refresh_token) ?? previousRefresh;
	if (!accessToken || !refreshToken) throw new AuthError('Google returned no refresh token. Remove this app at https://myaccount.google.com/permissions and run "auth" again.');
	return {accessToken, expiresAt: now + (num(body.expires_in) ?? 3600) * 1000, refreshToken, scope: str(body.scope) ?? fallbackScope};
};

export const missingScopes = (granted: string): string[] => SCOPES.filter((s) => !granted.split(/\s+/).includes(s));

/* ------------------------------------------------------------------ loopback consent */

export type AuthorizeOptions = {
	client: OAuthClient;
	openUrl: (url: string) => void | Promise<void>;
	endpoints?: Endpoints;
	fetch?: FetchLike;
	timeoutMs?: number;
	now?: () => number;
};

const page = (title: string, message: string): string =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
	'<style>body{font:16px/1.5 system-ui,sans-serif;background:#0B0C0F;color:#F4F6F8;margin:0;padding:48px 16px}main{max-width:32rem;margin:0 auto}h1{font-size:1.25rem;color:#29B8AD}</style></head>' +
	`<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

/** Installed-app consent: listens on 127.0.0.1 (random port), sends the owner to Google, exchanges the code with PKCE. */
export const authorize = async (options: AuthorizeOptions): Promise<Tokens> => {
	const endpoints = options.endpoints ?? ENDPOINTS;
	const fetchImpl = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	const state = randomBytes(16).toString('base64url');
	let settle: {resolve: (code: string) => void; reject: (error: Error) => void} | undefined;
	const received = new Promise<string>((resolve, reject) => {
		settle = {resolve, reject};
	});
	received.catch(() => {});
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const send = (status: number, title: string, message: string) => {
			res.writeHead(status, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"});
			res.end(page(title, message));
		};
		if (url.pathname !== '/' || req.method !== 'GET') return send(404, 'Not found', 'This address only receives the Google sign-in.');
		if (url.searchParams.get('state') !== state) {
			send(400, 'Sign-in not accepted', 'The response did not match this request. Run the command again.');
			return settle?.reject(new AuthError('The OAuth response had the wrong state value, so it was rejected.'));
		}
		const code = url.searchParams.get('code');
		if (url.searchParams.get('error') || !code) {
			send(400, 'Access not granted', 'The retention tool was not given access. You can close this tab.');
			return settle?.reject(new AuthError(`Google sign-in did not grant access (${url.searchParams.get('error') ?? 'no code'}).`));
		}
		send(200, 'Signed in', 'The retention tool can now read YouTube Analytics for this channel (read-only). You can close this tab.');
		settle?.resolve(code);
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolveListen());
	});
	const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const timer = setTimeout(() => settle?.reject(new AuthError('Timed out waiting for the Google sign-in.')), options.timeoutMs ?? 300_000);
	try {
		const authUrl = new URL(endpoints.auth);
		authUrl.search = new URLSearchParams({
			client_id: options.client.clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: SCOPES.join(' '),
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
		const tokens = tokensFrom(body, now(), null, SCOPES.join(' '));
		const missing = missingScopes(tokens.scope);
		if (missing.length) {
			throw new AuthError(`Access was not granted to ${missing.join(' and ')}. Both read-only scopes are needed (reports.query requires youtube.readonly). Run "auth" again and allow both.`);
		}
		return tokens;
	} finally {
		clearTimeout(timer);
		server.close();
	}
};

/* ------------------------------------------------------------------ token sources */

export type FileTokenOptions = {path: string; account: string; endpoints?: Endpoints; fetch?: FetchLike; now?: () => number};

/** Access tokens from the token file, refreshed when they expire (and saved back). */
export const fileTokenSource = (options: FileTokenOptions): {source: TokenSource; account: Account} => {
	const file = readTokenFile(options.path);
	if (!file) throw new AuthError(`No authorization saved at ${options.path}. Run "auth --client-secrets <file>" first.`);
	const keys = Object.keys(file.accounts);
	const account = file.accounts[options.account] ?? (options.account === 'default' && keys.length === 1 ? file.accounts[keys[0]!] : undefined);
	if (!account) throw new AuthError(`No saved account "${options.account}" in ${options.path} (saved: ${keys.join(', ') || 'none'}). Run "auth --account ${options.account}".`);
	const endpoints = options.endpoints ?? ENDPOINTS;
	const fetchImpl = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	const source: TokenSource = async (force) => {
		const t = account.tokens;
		if (!force && t.accessToken && t.expiresAt !== null && t.expiresAt - 60_000 > now()) return t.accessToken;
		const body = await tokenRequest(fetchImpl, endpoints.token, {
			grant_type: 'refresh_token',
			refresh_token: t.refreshToken,
			client_id: file.client.clientId,
			client_secret: file.client.clientSecret,
		});
		account.tokens = tokensFrom(body, now(), t.refreshToken, t.scope);
		writeTokenFile(options.path, file);
		return account.tokens.accessToken!;
	};
	return {source, account};
};

/** True when YT_ANALYTICS_* variables are set (CI, repository secrets). */
export const hasEnvTokens = (env: TokenEnv): boolean => Boolean(env.YT_ANALYTICS_ACCESS_TOKEN?.trim() || (env.YT_ANALYTICS_CLIENT_ID?.trim() && env.YT_ANALYTICS_REFRESH_TOKEN?.trim()));

/** Access tokens from the dashboard's YT_ANALYTICS_* variables (shared with tools/dashboard). */
export const envTokenSource = (env: TokenEnv, fetchImpl: FetchLike): TokenSource => {
	let cached: string | null = null;
	return async (force) => {
		if (!cached || force) cached = await resolveAccessToken(force ? {...env, YT_ANALYTICS_ACCESS_TOKEN: undefined} : env, fetchImpl);
		return cached;
	};
};
