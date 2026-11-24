/**
 * The HTTP seam. Everything the uploader sends goes through a Transport, so tests swap in a fake YouTube and no test
 * ever reaches Google. The real transport is Node's fetch with redirects off: YouTube answers an unfinished
 * resumable upload with 308 "Resume Incomplete", which must reach the caller, not be followed.
 */
import {RETRY} from './contracts.ts';
import type {HttpMethod} from './requests.ts';
import {isRecord, str} from './util.ts';

export type HttpRequest = {method: HttpMethod; url: string; headers: Record<string, string>; body: Buffer | string | null; timeoutMs: number};
export type HttpResponse = {status: number; headers: {get(name: string): string | null}; text: string};
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

export const fetchTransport: Transport = async (request) => {
	const res = await fetch(request.url, {
		method: request.method,
		headers: request.headers,
		body: request.method === 'GET' || request.body === null ? undefined : request.body,
		redirect: 'manual',
		signal: AbortSignal.timeout(request.timeoutMs),
	});
	return {status: res.status, headers: res.headers, text: await res.text()};
};

/** A YouTube or Google error answer: {"error": {"code", "message", "errors": [{"reason"}]}}. */
export class ApiError extends Error {
	readonly status: number;
	readonly reason: string;
	readonly method: string;
	constructor(method: string, status: number, reason: string, message: string) {
		super(`${method}: YouTube answered ${status} (${reason}): ${message}`);
		this.name = 'ApiError';
		this.method = method;
		this.status = status;
		this.reason = reason;
	}
	/** Out of quota for today (resets at midnight Pacific Time), or the channel's own upload limit. */
	get isQuota(): boolean {
		return ['quotaExceeded', 'dailyLimitExceeded', 'uploadLimitExceeded'].includes(this.reason);
	}
}

export const parseApiError = (method: string, response: HttpResponse): ApiError => {
	let body: unknown = null;
	try {
		body = JSON.parse(response.text);
	} catch {
		body = null;
	}
	const error = isRecord(body) && isRecord(body.error) ? body.error : null;
	const first = error && Array.isArray(error.errors) && isRecord(error.errors[0]) ? error.errors[0] : null;
	const reason = (first && str(first.reason)) ?? (error && str(error.status)) ?? `http_${response.status}`;
	const message = (error && str(error.message)) ?? (response.text.slice(0, 200) || 'no details');
	return new ApiError(method, response.status, reason, message);
};

/** A failure worth retrying: the official upload sample retries 500/502/503/504; 429 rate limits too, unless it is a quota or a daily cap. */
export const isRetryable = (error: ApiError): boolean =>
	(RETRY.retriableStatus as readonly number[]).includes(error.status) || (error.status === 429 && error.reason !== 'uploadRateLimitExceeded') || (error.status === 403 && (error.reason === 'rateLimitExceeded' || error.reason === 'userRateLimitExceeded'));

/** Retry-After as milliseconds (delta-seconds or an HTTP date), or null. */
export const parseRetryAfter = (value: string | null, nowMs: number): number | null => {
	if (!value) return null;
	if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
	const at = Date.parse(value);
	return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
};

/** Full-jitter exponential backoff, as in the official upload sample (random() * 2^attempt seconds), capped. */
export const backoffMs = (attempt: number, random: () => number, retryAfterMs: number | null): number =>
	retryAfterMs !== null ? Math.min(retryAfterMs, RETRY.maxDelayMs * 5) : Math.min(RETRY.maxDelayMs, Math.floor(random() * 2 ** attempt * 1000));

/** A transport failure (no HTTP answer at all): connection reset, DNS, timeout. */
export class NetworkError extends Error {
	constructor(cause: unknown) {
		super(`network error: ${cause instanceof Error ? (cause.cause instanceof Error ? `${cause.message} (${cause.cause.message})` : cause.message) : String(cause)}`);
		this.name = 'NetworkError';
	}
}
