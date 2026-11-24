/**
 * Server core: builds the Ctx for each request, applies security headers and the global rate limit,
 * routes to the registered modules and turns errors into pages. main.ts starts it; tests use it on an
 * ephemeral port.
 */
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {DatabaseSync} from 'node:sqlite';
import {isBotRequest} from './bots.ts';
import type {ServerSettings} from './config.ts';
import {openDb} from './db.ts';
import {HttpError} from './errors.ts';
import {headerValue, isPrivateAddress, proxyTrusted, resolveCountry, resolveIpKey, visitorHash} from './geo.ts';
import {errorPage} from './html.ts';
import type {Ctx} from './http.ts';
import {createRouter, type HubRouter} from './router.ts';
import {routeModules} from './routes/index.ts';
import {notFound} from './routes/pages.ts';
import {createRateLimiter, readFormBody, securityHeaders, setClientKey, startRetentionPurge} from './security.ts';

export type Hub = {
	server: Server;
	db: DatabaseSync;
	router: HubRouter;
	settings: ServerSettings;
	/** Starts listening; resolves with the local base URL, e.g. http://127.0.0.1:43123 */
	listen(): Promise<string>;
	close(): Promise<void>;
};

/** Parses the request target against the configured origin, never the Host header; "//host" stays a path. */
const requestUrl = (origin: string, rawUrl: string): URL | null => {
	if (!rawUrl.startsWith('/')) return null;
	try {
		return new URL(origin + rawUrl);
	} catch {
		return null;
	}
};

const ERROR_TITLES: Record<number, string> = {
	400: 'Bad request',
	403: 'Not allowed',
	404: 'Not found',
	405: 'Method not allowed',
	413: 'Too large',
	415: 'Unsupported form',
	429: 'Too many requests',
	500: 'Server error',
};

const send = (res: ServerResponse, status: number, type: string, body: string): void => {
	res.statusCode = status;
	res.setHeader('Content-Type', type);
	if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
	res.setHeader('Content-Length', Buffer.byteLength(body));
	res.end(body);
};

export const createHub = (settings: ServerSettings): Hub => {
	const {hub: config, geo} = settings;
	const db = openDb(settings.dataDir);
	const router = createRouter();
	for (const module of routeModules) module.register(router);

	const headers = securityHeaders(config.publicBaseUrl, settings.formOrigins);
	// Two buckets: per visitor (IP + user agent) and a 10x looser one per IP, so many people behind one
	// carrier NAT are not limited together, while rotating user agents does not escape the IP bucket.
	const {burst, perMinute} = settings.rateLimit;
	const visitorLimiter = createRateLimiter({capacity: burst, refillPerSecond: perMinute / 60});
	const ipLimiter = createRateLimiter({capacity: burst * 10, refillPerSecond: (perMinute * 10) / 60});
	let proxyWarned = false;

	const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		for (const [name, value] of headers) res.setHeader(name, value);
		const url = requestUrl(config.publicBaseUrl, req.url ?? '/');
		const trusted = proxyTrusted(req, geo);
		const ip = resolveIpKey(req, geo, trusted);
		// In production with TRUST_PROXY=none, a request from a private address almost always comes through
		// a proxy, so its IP is the proxy's and every visitor would share it. Such requests are limited per
		// visitor (IP + user agent) only, and the owner is told how to fix the setting.
		const sharedProxy = settings.production && geo.trustProxy === 'none' && isPrivateAddress(req.socket.remoteAddress ?? '');
		if (sharedProxy && !proxyWarned) {
			proxyWarned = true;
			console.warn(
				`[hub] requests arrive from the private address ${req.socket.remoteAddress} while TRUST_PROXY=none: the hub is probably behind a proxy, so per-IP limits are off for them. Set TRUST_PROXY and the client IP header for your platform (docs/link-hub.md).`,
			);
		}
		if (!sharedProxy) setClientKey(req, ip);
		const userAgent = (headerValue(req, 'user-agent') ?? '').slice(0, 512);
		let formBody: Promise<URLSearchParams> | null = null;
		const ctx: Ctx = {
			req,
			res,
			url: url ?? new URL(config.publicBaseUrl),
			params: {},
			country: resolveCountry(req, geo, trusted),
			visitorHash: visitorHash(config.hashSecret, ip, userAgent, new Date()),
			isBot: isBotRequest(req),
			db,
			config,
			form: () => (formBody ??= readFormBody(req)),
			html: (status, body) => send(res, status, 'text/html; charset=utf-8', body),
			json: (status, body) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body)),
			redirect: (status, location) => {
				res.statusCode = status;
				res.setHeader('Location', location);
				res.setHeader('Cache-Control', 'no-store');
				res.setHeader('Content-Length', 0);
				res.end();
			},
		};
		try {
			if (!url) throw new HttpError(400, 'Bad request.');
			if (url.pathname !== '/healthz' && !(visitorLimiter.take(ctx.visitorHash) && (sharedProxy || ipLimiter.take(ip)))) {
				const wait = Math.max(1, visitorLimiter.retryAfter(ctx.visitorHash), sharedProxy ? 0 : ipLimiter.retryAfter(ip));
				res.setHeader('Retry-After', String(wait));
				throw new HttpError(429, 'Too many requests. Please wait a little and try again.');
			}
			const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
			const route = method === 'GET' || method === 'POST' ? router.match(method, url.pathname) : null;
			if (!route) {
				const allowed = router.methodsFor(url.pathname);
				if (allowed.length > 0) {
					res.setHeader('Allow', [...allowed, ...(allowed.includes('GET') ? ['HEAD'] : [])].join(', '));
					throw new HttpError(405, 'This address does not accept that kind of request.');
				}
				await notFound(ctx);
				return;
			}
			ctx.params = route.params;
			await route.handler(ctx);
			if (!res.headersSent) throw new Error(`handler for ${method} ${url.pathname} sent no response`);
		} catch (err) {
			const status = err instanceof HttpError ? err.status : 500;
			if (status === 500) console.error(`[hub] ${req.method} ${url?.pathname ?? '?'} failed:`, err);
			if (res.headersSent) {
				res.destroy();
				return;
			}
			if (status === 413 || status === 400) res.setHeader('Connection', 'close');
			const message = err instanceof HttpError ? err.message : 'Something went wrong on our side. Please try again later.';
			send(res, status, 'text/html; charset=utf-8', errorPage(config, status, ERROR_TITLES[status] ?? 'Request not accepted', message));
		}
	};

	const server = createServer({requestTimeout: 30_000, headersTimeout: 15_000, keepAliveTimeout: 5_000, maxHeaderSize: 16_384}, (req, res) => {
		handle(req, res).catch((err: unknown) => {
			console.error('[hub] unhandled request error:', err);
			res.destroy();
		});
	});
	const stopPurge = startRetentionPurge(db);

	return {
		server,
		db,
		router,
		settings,
		listen: () =>
			new Promise((resolveListen, rejectListen) => {
				server.once('error', rejectListen);
				server.listen(settings.port, settings.host, () => {
					server.off('error', rejectListen);
					const address = server.address() as AddressInfo;
					const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
					resolveListen(`http://${host}:${address.port}`);
				});
			}),
		close: () =>
			new Promise((resolveClose) => {
				stopPurge();
				server.close(() => {
					db.close();
					resolveClose();
				});
				server.closeIdleConnections();
				setTimeout(() => server.closeAllConnections(), 5_000).unref();
			}),
	};
};
