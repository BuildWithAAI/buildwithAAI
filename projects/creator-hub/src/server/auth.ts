/**
 * Admin authentication helpers: scrypt password hashes, HTTP Basic parsing and signed CSRF tokens.
 *
 * Hash format (shell-safe, no "$"): scrypt:<N>:<r>:<p>:<salt base64url>:<key base64url>
 * Create one with: node src/server/hash-password.ts
 */
import {createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions} from 'node:crypto';
import {safeEqual} from './geo.ts';

const DEFAULT_N = 32768;
const KEY_LENGTH = 32;
const MAX_MEM = 64 * 1024 * 1024;

export type ScryptHash = {N: number; r: number; p: number; salt: Buffer; key: Buffer};

const scryptAsync = (password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		scrypt(password.normalize('NFC'), salt, length, options, (err, key) => (err ? reject(err) : resolve(key)));
	});

export const hashPassword = async (password: string, N = DEFAULT_N): Promise<string> => {
	const salt = randomBytes(16);
	const key = await scryptAsync(password, salt, KEY_LENGTH, {N, r: 8, p: 1, maxmem: MAX_MEM});
	return `scrypt:${N}:8:1:${salt.toString('base64url')}:${key.toString('base64url')}`;
};

const isPowerOfTwo = (n: number): boolean => Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;

/** Parses and sanity-checks a stored hash; null when malformed. */
export const parseHash = (stored: string): ScryptHash | null => {
	const parts = stored.trim().split(':');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
	const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
	const salt = Buffer.from(parts[4] ?? '', 'base64url');
	const key = Buffer.from(parts[5] ?? '', 'base64url');
	if (!isPowerOfTwo(N) || N < 16384 || N > 1048576) return null;
	if (!Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) return null;
	if (128 * N * r > MAX_MEM || salt.length < 16 || key.length < 16 || key.length > 64) return null;
	return {N, r, p, salt, key};
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
	const hash = parseHash(stored);
	if (!hash) return false;
	const key = await scryptAsync(password, hash.salt, hash.key.length, {N: hash.N, r: hash.r, p: hash.p, maxmem: MAX_MEM});
	return timingSafeEqual(key, hash.key);
};

/** Parses "Authorization: Basic base64(user:password)". */
export const parseBasicAuth = (header: string | undefined): {user: string; password: string} | null => {
	const match = /^Basic ([A-Za-z0-9+/=]{1,1024})$/i.exec(header?.trim() ?? '');
	if (!match?.[1]) return null;
	const decoded = Buffer.from(match[1], 'base64').toString('utf8');
	const colon = decoded.indexOf(':');
	if (colon < 0) return null;
	return {user: decoded.slice(0, colon), password: decoded.slice(colon + 1)};
};

/**
 * Checks Basic credentials. scrypt always runs, even for a wrong user name, so timing does not reveal
 * which part was wrong.
 */
export const checkCredentials = async (
	credentials: {user: string; password: string},
	adminUser: string,
	adminPasswordHash: string,
): Promise<boolean> => {
	const userOk = safeEqual(credentials.user, adminUser);
	const passwordOk = await verifyPassword(credentials.password, adminPasswordHash);
	return userOk && passwordOk;
};

/** A new random CSRF cookie value. */
export const newCsrfNonce = (): string => randomBytes(32).toString('hex');

/** The form token for a cookie nonce: HMAC(secret, nonce), so a planted cookie alone is useless. */
export const csrfToken = (secret: string, nonce: string): string =>
	createHmac('sha256', secret).update(`csrf:${nonce}`).digest('hex');

export const validCsrf = (secret: string, nonce: string | null, token: string | null): boolean =>
	nonce !== null && token !== null && /^[0-9a-f]{64}$/.test(nonce) && safeEqual(token, csrfToken(secret, nonce));

/** Reads one cookie from the Cookie header. */
export const readCookie = (header: string | undefined, name: string): string | null => {
	for (const part of (header ?? '').split(';')) {
		const index = part.indexOf('=');
		if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
	}
	return null;
};
