/**
 * Security headers, the request body limit, a per-visitor token-bucket rate limiter (exported for
 * every route module) and the 13-month retention purge.
 */
import type {IncomingMessage} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';
import type {Ctx} from './http.ts';
import {purgeBefore} from './db.ts';
import {HttpError} from './errors.ts';
import {errorPage} from './html.ts';

export const BODY_LIMIT_BYTES = 16 * 1024;
export const RETENTION_MONTHS = 13;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Headers

/** Headers set on every response. `formOrigins` are the extra origins forms may post to (Kit). */
export const securityHeaders = (publicBaseUrl: string, formOrigins: string[]): [string, string][] => {
	const csp = [
		"default-src 'self'",
		"base-uri 'none'",
		"object-src 'none'",
		`form-action 'self' ${formOrigins.join(' ')}`.trim(),
		"frame-ancestors 'none'",
	].join('; ');
	const headers: [string, string][] = [
		['Content-Security-Policy', csp],
		['X-Content-Type-Options', 'nosniff'],
		['Referrer-Policy', 'strict-origin-when-cross-origin'],
		['X-Frame-Options', 'DENY'],
		['Cross-Origin-Opener-Policy', 'same-origin'],
		['Cross-Origin-Resource-Policy', 'same-origin'],
		['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
	];
	if (new URL(publicBaseUrl).protocol === 'https:') headers.push(['Strict-Transport-Security', 'max-age=31536000']);
	return headers;
};

// ---------------------------------------------------------------------------------------------
// Body

/** Reads an application/x-www-form-urlencoded body of at most `limit` bytes. */
export const readFormBody = (req: IncomingMessage, limit = BODY_LIMIT_BYTES): Promise<URLSearchParams> => {
	if (req.method !== 'POST') return Promise.resolve(new URLSearchParams());
	const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
	if (type !== 'application/x-www-form-urlencoded') {
		return Promise.reject(new HttpError(415, 'Forms must be sent as application/x-www-form-urlencoded.'));
	}
	if (Number(req.headers['content-length']) > limit) return Promise.reject(new HttpError(413, 'The form is too large.'));
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const cleanup = (): void => {
			req.off('data', onData);
			req.off('end', onEnd);
			req.off('error', onError);
			req.off('close', onClose);
		};
		const onData = (chunk: Buffer): void => {
			size += chunk.length;
			if (size <= limit) {
				chunks.push(chunk);
				return;
			}
			cleanup();
			req.resume(); // discard the rest so the 413 page can still be sent
			reject(new HttpError(413, 'The form is too large.'));
		};
		const onEnd = (): void => {
			cleanup();
			resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
		};
		const onError = (err: Error): void => {
			cleanup();
			// A client that aborts its upload is not a server failure: answer 400 and do not log a stack trace.
			const code = (err as NodeJS.ErrnoException).code;
			const interrupted = err.message === 'aborted' || code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'EPIPE';
			reject(interrupted ? new HttpError(400, 'The request was interrupted.') : err);
		};
		const onClose = (): void => {
			cleanup();
			reject(new HttpError(400, 'The request was interrupted.'));
		};
		req.on('data', onData);
		req.on('end', onEnd);
		req.on('error', onError);
		req.on('close', onClose);
	});
};

// ---------------------------------------------------------------------------------------------
// Rate limiting

export type RateLimiter = {
	/** Takes `cost` tokens from the bucket for `key`; false (and nothing taken) when there are too few. */
	take(key: string, cost?: number): boolean;
	/** Gives back `cost` tokens taken earlier (never above the capacity), e.g. after a sign-in succeeded. */
	refund(key: string, cost?: number): void;
	/** Tokens available now, without taking any. */
	available(key: string): number;
	/** Whole seconds until `cost` tokens are available. */
	retryAfter(key: string, cost?: number): number;
};

export type RateLimiterOptions = {
	capacity: number; // burst size
	refillPerSecond: number; // sustained rate
	maxKeys?: number; // memory bound; least recently used keys are dropped first
	now?: () => number;
};

/** In-memory token bucket per key. Keys are kept in memory only, never stored. */
export const createRateLimiter = (options: RateLimiterOptions): RateLimiter => {
	const {capacity, refillPerSecond, maxKeys = 50_000, now = Date.now} = options;
	const buckets = new Map<string, {tokens: number; at: number}>();
	const current = (key: string): {tokens: number; at: number} => {
		const at = now();
		const bucket = buckets.get(key);
		if (!bucket) return {tokens: capacity, at};
		return {tokens: Math.min(capacity, bucket.tokens + ((at - bucket.at) / 1000) * refillPerSecond), at};
	};
	const store = (key: string, bucket: {tokens: number; at: number}): void => {
		buckets.delete(key);
		buckets.set(key, bucket);
		if (buckets.size > maxKeys) {
			const oldest = buckets.keys().next().value;
			if (oldest !== undefined) buckets.delete(oldest);
		}
	};
	return {
		take(key, cost = 1) {
			const bucket = current(key);
			const allowed = bucket.tokens >= cost;
			if (allowed) bucket.tokens -= cost;
			store(key, bucket);
			return allowed;
		},
		refund(key, cost = 1) {
			if (!buckets.has(key)) return; // a dropped or never-used bucket is already full
			const bucket = current(key);
			bucket.tokens = Math.min(capacity, bucket.tokens + cost);
			store(key, bucket);
		},
		available: (key) => current(key).tokens,
		retryAfter(key, cost = 1) {
			const missing = cost - current(key).tokens;
			return missing <= 0 ? 0 : Math.ceil(missing / refillPerSecond);
		},
	};
};

const clientKeys = new WeakMap<IncomingMessage, string>();

/** Called by the core for every request. */
export const setClientKey = (req: IncomingMessage, key: string): void => void clientKeys.set(req, key);

/**
 * The per-visitor rate-limit key: the client IP (IPv6: its /64) as resolved by geo.ts. It is only ever a
 * key of in-memory buckets, never stored. Unlike ctx.visitorHash it does not change with the user agent.
 * When the IP is known to be a proxy's (see app.ts), the visitor hash is used instead.
 */
export const rateLimitKey = (ctx: Ctx): string => clientKeys.get(ctx.req) ?? ctx.visitorHash;

/**
 * For route modules: `if (!checkRateLimit(ctx, myLimiter)) return;`
 * Takes a token for this visitor; when none is left it answers 429 with Retry-After and returns false.
 */
export const checkRateLimit = (ctx: Ctx, limiter: RateLimiter, cost = 1): boolean => {
	const key = rateLimitKey(ctx);
	if (limiter.take(key, cost)) return true;
	ctx.res.setHeader('Retry-After', String(Math.max(1, limiter.retryAfter(key, cost))));
	ctx.html(429, errorPage(ctx.config, 429, 'Too many requests', 'Please wait a little and try again.'));
	return false;
};

// ---------------------------------------------------------------------------------------------
// Retention

/** Rows older than this (unix ms) are deleted: 13 calendar months before `now`. */
export const retentionCutoff = (now: number): number => {
	const date = new Date(now);
	date.setUTCMonth(date.getUTCMonth() - RETENTION_MONTHS);
	return date.getTime();
};

/** Purges once now and then every 24 hours. Returns a stop function. */
export const startRetentionPurge = (db: DatabaseSync, now: () => number = Date.now): (() => void) => {
	const run = (): void => {
		try {
			const removed = purgeBefore(db, retentionCutoff(now()));
			if (removed.clicks + removed.pageEvents + removed.orders > 0) {
				console.log(
					`[hub] retention purge removed ${removed.clicks} clicks, ${removed.pageEvents} page events, ${removed.orders} orders`,
				);
			}
		} catch (err) {
			console.error('[hub] retention purge failed', err);
		}
	};
	run();
	const timer = setInterval(run, DAY_MS);
	timer.unref();
	return () => clearInterval(timer);
};
