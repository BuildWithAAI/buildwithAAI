/**
 * The real Fetcher for `verify`: redirects followed by hand so every hop is checked, a timeout, a size cap, one page per
 * URL per run, and a pause between requests to the same host. Bot challenges (Cloudflare, Vercel) are reported as
 * such, never as a read page.
 *   - allowlist mode (content/facts/hosts.json): global fetch; every hop's host must be on the list.
 *   - any-host mode (--any-host): every hop's host must be a public DNS name that resolves only to public addresses
 *     (netguard.ts); without a proxy, the request is pinned to the checked addresses, so DNS rebinding cannot reach an
 *     internal address. Behind a proxy, the proxy resolves and connects.
 * Behind this cloud session's proxy, Node's fetch needs NODE_USE_ENV_PROXY=1; scripts/facts/cli.ts sets it for verify.
 */
import {checkedAddresses, hostProblem, pinnedGet, proxiedFor, systemResolver, type Address, type PinnedGet, type Resolver} from './netguard.ts';
import {hostAllowed} from './store.ts';
import type {Fetcher, FetchOutcome} from './verify.ts';

export type FetchOptions = {
	allow: string[] | 'any';
	timeoutMs?: number;
	maxBytes?: number;
	delayMs?: number;
	userAgent?: string;
	/** any-host mode only (tests inject these): DNS, the pinned request, and whether an HTTPS proxy carries requests
	 * (default: HTTPS_PROXY is set and NO_PROXY does not exempt the host). */
	resolve?: Resolver;
	get?: PinnedGet;
	proxied?: boolean;
};

/** A generic, honest client name: no project or owner details go to the sites we read. */
export const USER_AGENT = 'Mozilla/5.0 (compatible; fact-check-verify/1.0)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const challengeNote = (header: (name: string) => string | null, body: string): string => {
	if (header('cf-mitigated') === 'challenge' || /<title>\s*just a moment/i.test(body)) return ' (Cloudflare bot challenge)';
	if (/<title>\s*attention required/i.test(body)) return ' (Cloudflare block page)';
	if (header('x-vercel-mitigated')) return ' (Vercel security checkpoint)';
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

	const anyHost = opts.allow === 'any';
	const resolve = opts.resolve ?? systemResolver;
	const get = opts.get ?? pinnedGet;
	const isProxied = (host: string) => opts.proxied ?? proxiedFor(host);
	const headers = {'user-agent': ua, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.9'};

	/** One request; the same small shape from both transports. */
	const request = async (url: string, pinned: Address[] | null): Promise<{status: number; header: (n: string) => string | null; body: () => Promise<string>; drop: () => Promise<void>}> => {
		if (pinned) {
			const r = await get(url, pinned, {headers, timeoutMs, maxBytes});
			return {status: r.status, header: r.header, body: async () => r.body, drop: async () => {}};
		}
		const res = await fetch(url, {redirect: 'manual', headers, signal: AbortSignal.timeout(timeoutMs)});
		return {status: res.status, header: (n) => res.headers.get(n), body: () => readCapped(res, maxBytes), drop: async () => void (await res.body?.cancel())};
	};

	const one = async (start: string): Promise<FetchOutcome> => {
		let url = start;
		for (let hop = 0; hop <= 5; hop++) {
			const host = (() => {
				try {
					return new URL(url).hostname;
				} catch {
					return url;
				}
			})();
			if (!hostAllowed(url, opts.allow)) {
				return {ok: false, notAllowed: true, reason: hop ? `redirected to ${host}, which is not on the allowlist` : `${host} is not on the allowlist`};
			}
			let pinned: Address[] | null = null;
			if (anyHost) {
				// every hop: a public name, and (where this machine resolves it) only public addresses
				const syntax = hostProblem(host);
				if (syntax) return {ok: false, notAllowed: true, reason: hop ? `redirected to ${host}: ${syntax}` : syntax};
				const checked = await checkedAddresses(host, resolve);
				const proxied = isProxied(host);
				if (!checked.ok) {
					// behind a proxy this machine may not resolve names at all: the proxy resolves, and its rules apply
					const unresolvable = /did not resolve/.test(checked.reason);
					if (!(proxied && unresolvable)) return {ok: false, notAllowed: true, reason: hop ? `redirected to ${host}: ${checked.reason}` : checked.reason};
				} else if (!proxied) pinned = checked.addresses;
			}
			const wait = (lastHit.get(host) ?? 0) + delayMs - Date.now();
			if (wait > 0) await sleep(wait);
			lastHit.set(host, Date.now());
			let res: Awaited<ReturnType<typeof request>>;
			try {
				res = await request(url, pinned);
			} catch (e) {
				return {ok: false, reason: errorReason(e)};
			}
			if (res.status >= 300 && res.status < 400) {
				const loc = res.header('location');
				await res.drop();
				if (!loc) return {ok: false, status: res.status, reason: `HTTP ${res.status} without a Location header`};
				url = new URL(loc, url).toString();
				continue;
			}
			let body: string;
			try {
				body = await res.body();
			} catch (e) {
				return {ok: false, status: res.status, reason: `reading the page failed: ${errorReason(e)}`};
			}
			if (res.status >= 400) return {ok: false, status: res.status, reason: `HTTP ${res.status}${challengeNote(res.header, body)}`};
			return {ok: true, page: {status: res.status, finalUrl: url, contentType: res.header('content-type') ?? '', body}};
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
