/**
 * The real Fetcher for `verify`: global fetch, redirects followed by hand so every hop is checked against the allowlist,
 * a timeout, a size cap, one page per URL per run, and a pause between requests to the same host. Bot challenges
 * (Cloudflare, Vercel) are reported as such, never as a read page.
 * Behind this cloud session's proxy, Node's fetch needs NODE_USE_ENV_PROXY=1; scripts/facts/cli.ts sets it for verify.
 */
import {hostAllowed} from './store.ts';
import type {Fetcher, FetchOutcome} from './verify.ts';

export type FetchOptions = {allow: string[] | 'any'; timeoutMs?: number; maxBytes?: number; delayMs?: number; userAgent?: string};

/** A generic, honest client name: no project or owner details go to the sites we read. */
export const USER_AGENT = 'Mozilla/5.0 (compatible; fact-check-verify/1.0)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const challengeNote = (res: Response, body: string): string => {
	if (res.headers.get('cf-mitigated') === 'challenge' || /<title>\s*just a moment/i.test(body)) return ' (Cloudflare bot challenge)';
	if (/<title>\s*attention required/i.test(body)) return ' (Cloudflare block page)';
	if (res.headers.get('x-vercel-mitigated')) return ' (Vercel security checkpoint)';
	if (/captcha/i.test(body.slice(0, 20_000))) return ' (captcha)';
	return '';
};

const readCapped = async (res: Response, maxBytes: number): Promise<string> => {
	if (!res.body) return '';
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const {done, value} = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.byteLength;
		if (size >= maxBytes) {
			await reader.cancel();
			break;
		}
	}
	const buf = new Uint8Array(Math.min(size, maxBytes));
	let off = 0;
	for (const c of chunks) {
		const take = Math.min(c.byteLength, buf.byteLength - off);
		buf.set(c.subarray(0, take), off);
		off += take;
		if (off >= buf.byteLength) break;
	}
	return new TextDecoder('utf-8', {fatal: false}).decode(buf);
};

const errorReason = (e: unknown): string => {
	const err = e as {name?: string; message?: string; cause?: {code?: string; message?: string}};
	if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timed out';
	const msg = err.cause?.message ?? err.message ?? String(e);
	const code = err.cause?.code;
	if (/Proxy response \((\d+)\)/i.test(msg)) return `the network proxy refused the connection (${/Proxy response \((\d+)\)/i.exec(msg)?.[1]}): the host may not be allowed in this environment`;
	return code ? `${code}: ${msg}` : msg;
};

export const makeFetcher = (opts: FetchOptions): Fetcher => {
	const timeoutMs = opts.timeoutMs ?? 20_000;
	const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
	const delayMs = opts.delayMs ?? 1_000;
	const ua = opts.userAgent ?? USER_AGENT;
	const cache = new Map<string, Promise<FetchOutcome>>();
	const lastHit = new Map<string, number>();

	const one = async (start: string): Promise<FetchOutcome> => {
		let url = start;
		for (let hop = 0; hop <= 5; hop++) {
			if (!hostAllowed(url, opts.allow)) {
				const host = (() => {
					try {
						return new URL(url).hostname;
					} catch {
						return url;
					}
				})();
				return {ok: false, notAllowed: true, reason: hop ? `redirected to ${host}, which is not on the allowlist` : `${host} is not on the allowlist`};
			}
			const host = new URL(url).hostname;
			const wait = (lastHit.get(host) ?? 0) + delayMs - Date.now();
			if (wait > 0) await sleep(wait);
			lastHit.set(host, Date.now());
			let res: Response;
			try {
				res = await fetch(url, {
					redirect: 'manual',
					headers: {'user-agent': ua, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.9'},
					signal: AbortSignal.timeout(timeoutMs),
				});
			} catch (e) {
				return {ok: false, reason: errorReason(e)};
			}
			if (res.status >= 300 && res.status < 400) {
				const loc = res.headers.get('location');
				await res.body?.cancel();
				if (!loc) return {ok: false, status: res.status, reason: `HTTP ${res.status} without a Location header`};
				url = new URL(loc, url).toString();
				continue;
			}
			let body: string;
			try {
				body = await readCapped(res, maxBytes);
			} catch (e) {
				return {ok: false, status: res.status, reason: `reading the page failed: ${errorReason(e)}`};
			}
			if (res.status >= 400) return {ok: false, status: res.status, reason: `HTTP ${res.status}${challengeNote(res, body)}`};
			return {ok: true, page: {status: res.status, finalUrl: url, contentType: res.headers.get('content-type') ?? '', body}};
		}
		return {ok: false, reason: 'more than 5 redirects'};
	};

	return (url: string) => {
		const hit = cache.get(url);
		if (hit) return hit;
		const p = one(url);
		cache.set(url, p);
		return p;
	};
};
