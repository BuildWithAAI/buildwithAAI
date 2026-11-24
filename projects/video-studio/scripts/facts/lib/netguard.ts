/**
 * Guards for `verify --any-host` (any https host, for machines with open network such as GitHub Actions or a laptop).
 * A fact source is text someone wrote into the bank, and a page can redirect anywhere, so every hop is checked:
 *   - the host must be a public DNS name: no IP literal (127.0.0.1, [::1], 169.254.169.254), no single-label or
 *     local-only name (localhost, *.local, *.internal, *.home.arpa ...);
 *   - every address it resolves to must be public: no loopback, private (RFC 1918), shared (100.64/10), link-local
 *     (169.254/16, fe80::/10), unique-local (fc00::/7), unspecified, multicast or other reserved range;
 *   - without a proxy, the connection is pinned to exactly the addresses that were checked (a custom lookup for
 *     https.request), so a DNS answer that changes between the check and the connection (rebinding) cannot reach an
 *     internal address. Behind an HTTPS proxy the proxy resolves and connects, and its own egress rules apply; any
 *     answer this machine can still resolve is checked first.
 */
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import type {LookupFunction} from 'node:net';

export type Address = {address: string; family: number};
export type Resolver = (host: string) => Promise<Address[]>;

export const systemResolver: Resolver = async (host) => (await lookup(host, {all: true, verbatim: true})) as Address[];

const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'home.arpa', 'localdomain'];

/** Why a host name may not be fetched in any-host mode, or null. `host` is URL.hostname (IPv6 keeps its brackets). */
export const hostProblem = (host: string): string | null => {
	const h = host.toLowerCase().replace(/\.$/, '');
	if (h.startsWith('[') || isIP(h)) return `${host} is an IP address, not a public host name`;
	const labels = h.split('.');
	if (labels.length < 2 || labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return `${host} is not a public host name`;
	if (/^\d+$/.test(labels[labels.length - 1])) return `${host} is not a public host name`;
	if (LOCAL_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))) return `${host} is a local-only name`;
	return null;
};

const v4 = (a: string): number[] | null => {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
	return m ? m.slice(1).map(Number) : null;
};

const privateV4 = ([a, b, c]: number[]): boolean =>
	a === 0 || // "this network"
	a === 10 ||
	a === 127 ||
	(a === 100 && b >= 64 && b <= 127) || // shared address space (CGNAT)
	(a === 169 && b === 254) ||
	(a === 172 && b >= 16 && b <= 31) ||
	(a === 192 && b === 168) ||
	(a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
	(a === 198 && (b === 18 || b === 19)) || // benchmarking
	(a === 198 && b === 51 && c === 100) || // TEST-NET-2
	(a === 203 && b === 0 && c === 113) || // TEST-NET-3
	a >= 224; // multicast, reserved, broadcast

/** Expands an IPv6 address to 8 groups (numbers); null when it is not one. Handles an embedded IPv4 tail. */
const v6 = (addr: string): number[] | null => {
	let a = addr.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
	if (isIP(a) !== 6) return null;
	const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
	if (tail) {
		const q = v4(tail[1]);
		if (!q) return null;
		a = a.slice(0, -tail[1].length) + `${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
	}
	const [head, rest] = a.split('::');
	const h = head ? head.split(':') : [];
	const r = rest !== undefined ? (rest ? rest.split(':') : []) : [];
	const fill = rest !== undefined ? 8 - h.length - r.length : 0;
	const groups = [...h, ...Array(fill).fill('0'), ...r].map((g) => parseInt(g, 16));
	return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
};

/** True for any address that is not a public unicast address. */
export const isPrivateAddress = (address: string): boolean => {
	const q = v4(address);
	if (q) return privateV4(q);
	const g = v6(address);
	if (!g) return true; // not an IP address at all: refuse
	if (g.every((x) => x === 0)) return true; // ::
	if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
	if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return privateV4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]); // IPv4-mapped / -compatible
	if (g[0] === 0x64 && g[1] === 0xff9b) return privateV4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]); // NAT64
	if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
	if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if ((g[0] & 0xff00) === 0xff00) return true; // multicast
	if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
	if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo (wraps an obfuscated IPv4)
	if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard-only
	if (g[0] === 0x2002) return privateV4([g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff]); // 6to4 wraps an IPv4
	return false;
};

/** Resolves a host and refuses it when any address is not public. Returns the checked addresses. */
export const checkedAddresses = async (host: string, resolve: Resolver): Promise<{ok: true; addresses: Address[]} | {ok: false; reason: string}> => {
	const syntax = hostProblem(host);
	if (syntax) return {ok: false, reason: syntax};
	let addresses: Address[];
	try {
		addresses = await resolve(host);
	} catch (e) {
		return {ok: false, reason: `${host} did not resolve (${(e as {code?: string}).code ?? 'DNS error'})`};
	}
	if (!addresses.length) return {ok: false, reason: `${host} did not resolve`};
	const bad = addresses.find((a) => isPrivateAddress(a.address));
	if (bad) return {ok: false, reason: `${host} resolves to a private or reserved address, which any-host mode never fetches`};
	return {ok: true, addresses};
};

/** A lookup function for https.request that only ever returns the addresses that were checked. */
export const pinnedLookup = (addresses: Address[]): LookupFunction =>
	((_host: string, opts: {all?: boolean} | number | undefined, cb: (err: Error | null, address: string | Address[], family?: number) => void) => {
		if (typeof opts === 'object' && opts?.all) cb(null, addresses);
		else cb(null, addresses[0].address, addresses[0].family);
	}) as unknown as LookupFunction;

/** The parts of a response the fetcher reads. */
export type PinnedResponse = {status: number; header: (name: string) => string | null; body: string};

export type PinnedGet = (url: string, addresses: Address[], o: {headers: Record<string, string>; timeoutMs: number; maxBytes: number}) => Promise<PinnedResponse>;

/** GET over https, connected only to `addresses` (TLS still checks the certificate against the host name). */
export const pinnedGet: PinnedGet = (url, addresses, o) =>
	new Promise((resolveResponse, reject) => {
		let settled = false;
		let timer: NodeJS.Timeout | undefined;
		const finish = (f: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			f();
		};
		const fail = (e: unknown) => finish(() => reject(e));
		const req = httpsRequest(url, {method: 'GET', headers: o.headers, lookup: pinnedLookup(addresses)}, (res) => {
			const chunks: Buffer[] = [];
			let size = 0;
			let capped = false;
			res.on('data', (c: Buffer) => {
				if (capped) return;
				chunks.push(c);
				size += c.length;
				if (size >= o.maxBytes) {
					capped = true;
					res.destroy();
				}
			});
			const done = () =>
				finish(() =>
					resolveResponse({
						status: res.statusCode ?? 0,
						header: (name) => {
							const v = res.headers[name.toLowerCase()];
							return Array.isArray(v) ? v.join(', ') : (v ?? null);
						},
						body: new TextDecoder('utf-8', {fatal: false}).decode(Buffer.concat(chunks).subarray(0, o.maxBytes)),
					}),
				);
			res.on('end', done);
			res.on('close', () => (capped || res.complete ? done() : fail(new Error('the connection closed before the page finished'))));
			res.on('error', (e) => (capped ? done() : fail(e)));
		});
		// one deadline for the whole request, body included (like AbortSignal.timeout for fetch)
		timer = setTimeout(() => {
			fail(Object.assign(new Error('timed out'), {name: 'TimeoutError'}));
			req.destroy();
		}, o.timeoutMs);
		req.on('error', fail);
		req.end();
	});

/** True when an HTTPS proxy from the environment carries requests to `host` (NO_PROXY exempts some). */
export const proxiedFor = (host: string, env: NodeJS.ProcessEnv = process.env): boolean => {
	if (!(env.HTTPS_PROXY || env.https_proxy)) return false;
	const h = host.toLowerCase().replace(/\.$/, '');
	const noProxy = (env.NO_PROXY ?? env.no_proxy ?? '')
		.split(',')
		.map((x) => x.trim().toLowerCase().replace(/:\d+$/, ''))
		.filter(Boolean);
	return !noProxy.some((e) => e === '*' || h === e.replace(/^\*?\./, '') || h.endsWith(e.startsWith('.') || e.startsWith('*.') ? e.replace(/^\*/, '') : `.${e}`));
};
