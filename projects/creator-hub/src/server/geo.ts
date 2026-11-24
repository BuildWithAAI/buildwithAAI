/**
 * Visitor country, IP key and visitor hash.
 *
 * Country and client-IP headers are trusted ONLY when TRUST_PROXY says a proxy sets them:
 *   cloudflare -> CF-IPCountry ("XX" = no country data, "T1" = Tor: both mean unknown) and CF-Connecting-IP
 *   header     -> the GEO_HEADER country header, and the optional IP_HEADER
 *   none       -> no headers: the country is unknown and the IP is the socket address
 * When PROXY_SECRET is set, those headers are trusted only on requests that carry the shared secret
 * header the proxy adds (e.g. a Cloudflare request-header Transform Rule), so requests sent straight to
 * the origin cannot spoof a country.
 *
 * Raw IPs are never stored: they live in memory for one request (rate limiting) and are otherwise
 * only used inside the daily-salted visitor hash.
 */
import type {IncomingMessage} from 'node:http';
import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import type {CountryCode} from '../types.ts';
import {isCountryCode} from './countries.ts';

export type TrustProxy = 'none' | 'cloudflare' | 'header';

export type GeoSettings = {
	trustProxy: TrustProxy;
	geoHeader: string | null; // header mode: country header name
	ipHeader: string | null; // header mode: client IP header name (optional)
	proxySecret: string | null; // when set, proxy headers count only if the secret header matches
	proxySecretHeader: string;
};

export const headerValue = (req: IncomingMessage, name: string): string | null => {
	const value = req.headers[name.toLowerCase()];
	if (Array.isArray(value)) return value[0] ?? null;
	return value ?? null;
};

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Constant-time string comparison (hashing first makes the lengths equal). */
export const safeEqual = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

/** True when this request came through the configured trusted proxy. */
export const proxyTrusted = (req: IncomingMessage, geo: GeoSettings): boolean => {
	if (geo.trustProxy === 'none') return false;
	if (geo.proxySecret === null) return true;
	const presented = headerValue(req, geo.proxySecretHeader);
	return presented !== null && safeEqual(presented, geo.proxySecret);
};

export const resolveCountry = (req: IncomingMessage, geo: GeoSettings, trusted: boolean): CountryCode | null => {
	if (!trusted) return null;
	const name = geo.trustProxy === 'cloudflare' ? 'cf-ipcountry' : geo.geoHeader;
	if (!name) return null;
	const code = headerValue(req, name)?.trim().toUpperCase() ?? '';
	if (code === '' || code === 'XX' || code === 'T1') return null;
	return isCountryCode(code) ? code : null;
};

/** IPv6 visitors are keyed by their /64 prefix (one household or device), IPv4 by the address. */
export const ipKey = (address: string): string | null => {
	const ip = address.trim().replace(/^\[|\]$/g, '');
	if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
	const version = isIP(ip);
	if (version === 4) return ip;
	if (version !== 6) return null;
	const bare = ip.split('%')[0] ?? ip;
	const [head = '', tail] = bare.split('::');
	const left = head ? head.split(':') : [];
	const right = tail === undefined ? [] : tail ? tail.split(':') : [];
	const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
	return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
};

const lastListItem = (value: string | null): string => (value ?? '').split(',').pop()?.trim() ?? '';

/** The key used for rate limiting and hashing. Falls back to the socket when headers are absent. */
export const resolveIpKey = (req: IncomingMessage, geo: GeoSettings, trusted: boolean): string => {
	let candidate = '';
	if (trusted && geo.trustProxy === 'cloudflare') candidate = headerValue(req, 'cf-connecting-ip') ?? '';
	if (trusted && geo.trustProxy === 'header' && geo.ipHeader) candidate = lastListItem(headerValue(req, geo.ipHeader));
	return ipKey(candidate) ?? ipKey(req.socket.remoteAddress ?? '') ?? 'unknown';
};

/** HMAC-SHA256(HASH_SECRET + UTC date, ip + '|' + user agent), first 16 hex characters. */
export const visitorHash = (secret: string, ip: string, userAgent: string, now: Date): string =>
	createHmac('sha256', secret + now.toISOString().slice(0, 10))
		.update(`${ip}|${userAgent}`)
		.digest('hex')
		.slice(0, 16);
