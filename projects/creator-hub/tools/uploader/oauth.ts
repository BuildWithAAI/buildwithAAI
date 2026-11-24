/**
 * Google OAuth for an installed (desktop) app: loopback redirect on 127.0.0.1 with PKCE (S256), as in
 * https://developers.google.com/identity/protocols/oauth2/native-app (updated 2026-11-19). Endpoints from
 * https://accounts.google.com/.well-known/openid-configuration.
 *
 * Scopes: youtube.upload and youtube.force-ssl (contracts.ts). Users may grant only some scopes, so the granted list
 * is checked: youtube.force-ssl is required (captions, the channel check, playlists).
 *
 * Tokens live in a gitignored file (default tools/uploader/.local/oauth.json, mode 0600), one account per channel
 * slug, with the channel id the owner signed in as. Nothing secret is ever printed.
 *
 * Refresh tokens: an External app whose publishing status is "Testing" gets refresh tokens that expire 7 days after
 * consent (https://developers.google.com/identity/protocols/oauth2#expiration). Avoid it with a "Personal" app (no
 * 7-day expiry, no verification, no unverified-app screen; https://support.google.com/cloud/answer/15549945) or by
 * publishing the External app ("In production"; you then click through Google's unverified-app warning once).
 */
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {type Endpoints, SCOPE_FORCE_SSL, SCOPES} from './contracts.ts';
import type {Transport} from './http.ts';
import {isRecord, num, str, writeJsonAtomic} from './util.ts';

export type OAuthClient = {clientId: string; clientSecret: string};
export type Tokens = {accessToken: string | null; expiresAt: number | null; refreshToken: string; scope: string};
export type Account = {channelId: string; title: string; handle: string | null; authorizedAt: string; tokens: Tokens};
export type OAuthFile = {version: 1; client: OAuthClient | null; accounts: Record<string, Account>};

export class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthError';
	}
}

export const EXPIRY_HELP =
	'If your Google Cloud OAuth app is External with publishing status "Testing", Google expires its refresh tokens 7 days after consent. ' +
	'Fix it once: create a "Personal" app (Google Auth Platform > Personal mode; only your own Google Account can sign in, no 7-day expiry, no verification), ' +
	'or publish the External app (Audience > Publish app; then click "Advanced > Go to app" on the unverified-app warning once). See tools/uploader/README.md.';

export const emptyOAuthFile = (): OAuthFile => ({version: 1, client: null, accounts: {}});

export const readOAuthFile = (path: string): OAuthFile => {
	if (!existsSync(path)) return emptyOAuthFile();
	const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (!isRecord(data) || data.version !== 1 || !isRecord(data.accounts)) throw new AuthError(`${path} is not an uploader OAuth file (version 1). Delete it and run "cli.ts auth" again.`);
	const client = isRecord(data.client) && str(data.client.clientId) && str(data.client.clientSecret) ? {clientId: String(data.client.clientId), clientSecret: String(data.client.clientSecret)} : null;
	const accounts: Record<string, Account> = {};
	for (const [key, value] of Object.entries(data.accounts)) {
		const tokens = isRecord(value) && isRecord(value.tokens) ? value.tokens : null;
		if (!isRecord(value) || !tokens || !str(value.channelId) || !str(tokens.refreshToken)) throw new AuthError(`${path}: account "${key}" is incomplete. Run "cli.ts auth --channel ${key}" again.`);
		accounts[key] = {
			channelId: String(value.channelId),
			title: str(value.title) ?? '',
			handle: str(value.handle),
			authorizedAt: str(value.authorizedAt) ?? '',
			tokens: {accessToken: str(tokens.accessToken), expiresAt: num(tokens.expiresAt), refreshToken: String(tokens.refreshToken), scope: str(tokens.scope) ?? ''},
		};
	}
	return {version: 1, client, accounts};
};

/** Owner-only (0600), in the gitignored state folder. */
export const writeOAuthFile = (path: string, data: OAuthFile): void => writeJsonAtomic(path, data, 0o600);

/** The client id and secret from the JSON that Google Cloud Console offers for a "Desktop app" OAuth client. */
export const readClientSecrets = (path: string): OAuthClient => {
	const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
	const section = isRecord(data) ? (data.installed ?? data.web) : null;
	if (!isRecord(section) || !str(section.client_id) || !str(section.client_secret)) {
		throw new AuthError(`${path} has no "installed" client_id and client_secret. Create an OAuth client of type "Desktop app" and download its JSON.`);
	}
	return {clientId: String(section.client_id), clientSecret: String(section.client_secret)};
};

/** UPLOADER_CLIENT_ID and UPLOADER_CLIENT_SECRET, when both are set, override the client saved in the OAuth file. */
export const clientFromEnv = (env: Record<string, string | undefined>): OAuthClient | null =>
	env.UPLOADER_CLIENT_ID && env.UPLOADER_CLIENT_SECRET ? {clientId: env.UPLOADER_CLIENT_ID, clientSecret: env.UPLOADER_CLIENT_SECRET} : null;

export const grantedScopes = (scope: string): string[] => scope.split(/\s+/).filter(Boolean);

/** Why these granted scopes cannot run the uploader (null = fine). youtube.force-ssl also covers videos.insert and thumbnails.set. */
export const scopeProblem = (scope: string): string | null =>
	grantedScopes(scope).includes(SCOPE_FORCE_SSL)
		? null
		: `The saved authorization lacks ${SCOPE_FORCE_SSL} ("See, edit, and permanently delete your YouTube videos, ratings, comments and captions"), which captions, playlists and the channel check need. Run "cli.ts auth --channel <slug>" again and allow every box on Google's consent screen.`;

const tokenRequest = async (transport: Transport, endpoints: Endpoints, form: Record<string, string>): Promise<Record<string, unknown>> => {
	const res = await transport({
		method: 'POST',
		url: endpoints.token,
		headers: {'content-type': 'application/x-www-form-urlencoded', accept: 'application/json'},
		body: new URLSearchParams(form).toString(),
		timeoutMs: 30_000,
	});
	let body: unknown = null;
	try {
		body = JSON.parse(res.text);
	} catch {
		body = null;
	}
	if (res.status >= 200 && res.status < 300 && isRecord(body)) return body;
	const error = isRecord(body) ? (str(body.error) ?? 'unknown_error') : `http_${res.status}`;
	if (error === 'invalid_grant') throw new AuthError(`Google refused the saved YouTube authorization (invalid_grant: expired or revoked). Run "cli.ts auth --channel <slug>" again. ${EXPIRY_HELP}`);
	const detail = isRecord(body) ? (str(body.error_description) ?? '') : '';
	throw new AuthError(`Google's token endpoint refused the request: ${error}${detail ? ` (${detail})` : ''}.`);
};

const tokensFrom = (body: Record<string, unknown>, nowMs: number, previous: Tokens | null): Tokens => {
	const accessToken = str(body.access_token);
	const refreshToken = str(body.refresh_token) ?? previous?.refreshToken ?? null;
	if (!accessToken || !refreshToken) throw new AuthError('Google did not return a refresh token. Remove this app at https://myaccount.google.com/permissions and run "cli.ts auth" again.');
	return {accessToken, expiresAt: nowMs + (num(body.expires_in) ?? 3600) * 1000, refreshToken, scope: str(body.scope) ?? previous?.scope ?? ''};
};

export type TokenSource = {getAccessToken(force?: boolean): Promise<string>; scope(): string};

/** Hands out access tokens for one saved account, refreshing a minute before expiry; onTokens saves refreshed tokens. */
export const createTokenSource = (opts: {client: OAuthClient; tokens: Tokens; transport: Transport; endpoints: Endpoints; now: () => number; onTokens: (tokens: Tokens) => void}): TokenSource => {
	let tokens = opts.tokens;
	return {
		scope: () => tokens.scope,
		async getAccessToken(force = false) {
			if (!force && tokens.accessToken && tokens.expiresAt !== null && tokens.expiresAt - 60_000 > opts.now()) return tokens.accessToken;
			const body = await tokenRequest(opts.transport, opts.endpoints, {
				grant_type: 'refresh_token',
				refresh_token: tokens.refreshToken,
				client_id: opts.client.clientId,
				client_secret: opts.client.clientSecret,
			});
			tokens = tokensFrom(body, opts.now(), tokens);
			opts.onTokens(tokens);
			return tokens.accessToken ?? '';
		},
	};
};

const page = (title: string, message: string): string =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
	'<style>body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0B0C0F;color:#F4F6F8;margin:0;padding:48px 16px}' +
	'main{max-width:32rem;margin:0 auto}h1{font-size:1.25rem;color:#29B8AD}</style></head>' +
	`<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

export type AuthorizeOptions = {
	client: OAuthClient;
	transport: Transport;
	endpoints: Endpoints;
	/** Shows the consent URL to the owner. */
	openUrl: (url: string) => void | Promise<void>;
	now: () => number;
	timeoutMs?: number;
};

/** Runs the consent flow: a one-shot server on 127.0.0.1 (random port) receives the code; PKCE binds it to this run. */
export const authorize = async (opts: AuthorizeOptions): Promise<Tokens> => {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	const state = randomBytes(16).toString('base64url');
	let settle: {resolve: (code: string) => void; reject: (error: Error) => void} | undefined;
	const received = new Promise<string>((resolve, reject) => {
		settle = {resolve, reject};
	});
	received.catch(() => {}); // awaited below; stops an early rejection from counting as unhandled
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const send = (status: number, title: string, message: string) => {
			res.writeHead(status, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"});
			res.end(page(title, message));
		};
		if (url.pathname !== '/' || req.method !== 'GET') return send(404, 'Not found', 'This address only receives the Google sign-in.');
		if (url.searchParams.get('state') !== state) {
			send(400, 'Sign-in not accepted', 'The sign-in response did not match this request. Run the command again.');
			return settle?.reject(new AuthError('The OAuth response had the wrong state value, so it was rejected.'));
		}
		const code = url.searchParams.get('code');
		if (url.searchParams.get('error') || !code) {
			send(400, 'Access not granted', 'The uploader was not given access. You can close this tab.');
			return settle?.reject(new AuthError(`Google sign-in did not grant access (${url.searchParams.get('error') ?? 'no code'}).`));
		}
		send(200, 'Signed in', 'The uploader can now upload to your channel after your approval. You can close this tab.');
		settle?.resolve(code);
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const timer = setTimeout(() => settle?.reject(new AuthError('Timed out waiting for the Google sign-in.')), opts.timeoutMs ?? 300_000);
	try {
		const authUrl = new URL(opts.endpoints.auth);
		authUrl.search = new URLSearchParams({
			client_id: opts.client.clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: SCOPES.join(' '),
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state,
		}).toString();
		await opts.openUrl(authUrl.toString());
		const code = await received;
		const body = await tokenRequest(opts.transport, opts.endpoints, {
			code,
			client_id: opts.client.clientId,
			client_secret: opts.client.clientSecret,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code',
			code_verifier: verifier,
		});
		return tokensFrom(body, opts.now(), null);
	} finally {
		clearTimeout(timer);
		server.close();
	}
};

/** Revokes a token at Google (the owner can also do it at https://myaccount.google.com/permissions). */
export const revokeToken = async (token: string, transport: Transport, endpoints: Endpoints): Promise<void> => {
	const res = await transport({method: 'POST', url: endpoints.revoke, headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({token}).toString(), timeoutMs: 30_000});
	if ((res.status < 200 || res.status >= 300) && res.status !== 400) throw new AuthError(`Google refused to revoke the token (HTTP ${res.status}).`);
};
