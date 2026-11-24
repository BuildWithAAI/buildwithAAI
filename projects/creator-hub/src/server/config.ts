/**
 * Server configuration from environment variables and config/*.json. Everything is validated at
 * startup; any problem stops the server with a list of what to fix (fail fast).
 *
 * Environment:
 *   PUBLIC_BASE_URL      public origin, e.g. https://go.zoora.ai (required, https, when NODE_ENV=production)
 *   PORT                 listen port (default 8080); HOST optional listen address
 *   DATA_DIR             SQLite directory (default ./data)
 *   CONFIG_DIR           directory with offers.json / studio.json (default <project>/config)
 *   ADMIN_USER           admin user name; ADMIN_PASSWORD_HASH scrypt hash from hash-password.ts
 *   HASH_SECRET          >= 32 characters; secret for visitor hashing (required in production)
 *   KIT_FORM_ACTION      Kit form POST URL (default: the owner's form 10168331)
 *   FORM_ACTION_ORIGINS  optional extra https origins forms may post or redirect to (space-separated),
 *                        e.g. the site of Kit's thank-you page; browsers apply CSP form-action to redirects
 *   CONTACT_EMAIL        public business contact shown on pages
 *   BRAND_NAME           default "Zoora AI"
 *   TRUST_PROXY          none | cloudflare | header (default none)
 *   GEO_HEADER           header mode: country header name (optional: without it the country is unknown)
 *   IP_HEADER            header mode: client IP header name (optional, e.g. Fly-Client-IP on Fly.io)
 *   PROXY_SECRET         optional shared secret the proxy adds; PROXY_SECRET_HEADER (default X-Origin-Secret)
 *   RATE_LIMIT_BURST     requests one visitor may burst (default 40); RATE_LIMIT_PER_MINUTE sustained (default 60).
 *                        Each IP gets 10x both, so people sharing one carrier IP are not limited together.
 */
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {OfferRegistry} from '../types.ts';
import {parseHash} from './auth.ts';
import type {GeoSettings, TrustProxy} from './geo.ts';
import type {HubConfig} from './http.ts';
import {checkRegistry} from './offers.ts';

export const DEFAULT_KIT_FORM_ACTION = 'https://app.kit.com/forms/10168331/subscriptions';
const DEFAULT_CONFIG_DIR = fileURLToPath(new URL('../../config/', import.meta.url));
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const EMAIL = /^[^\s@<>"']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;

export type ServerSettings = {
	hub: HubConfig;
	/** Origins allowed in CSP form-action besides 'self': the Kit form origin plus FORM_ACTION_ORIGINS. */
	formOrigins: string[];
	host: string | undefined;
	port: number;
	dataDir: string;
	configDir: string;
	offersFile: string;
	studioFile: string | null;
	geo: GeoSettings;
	rateLimit: {burst: number; perMinute: number};
	production: boolean;
	warnings: string[];
};

export class ConfigError extends Error {
	readonly issues: string[];
	constructor(issues: string[]) {
		super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
		this.name = 'ConfigError';
		this.issues = issues;
	}
}

type Env = Record<string, string | undefined>;

const readJson = (file: string, errors: string[]): unknown => {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		errors.push(`${file}: ${(err as Error).message}`);
		return null;
	}
};

const loadOffers = (configDir: string, errors: string[], warnings: string[]): {file: string; registry: OfferRegistry} => {
	const own = join(configDir, 'offers.json');
	const example = join(configDir, 'offers.example.json');
	const usingExample = !existsSync(own);
	const file = usingExample ? example : own;
	if (!existsSync(file)) {
		errors.push(`no offer registry: create ${own} (start from offers.example.json)`);
		return {file, registry: {version: 1, offers: []}};
	}
	const parsed = readJson(file, errors);
	if (parsed === null) return {file, registry: {version: 1, offers: []}};
	const check = checkRegistry(parsed);
	errors.push(...check.errors.map((e) => `${file}: ${e}`));
	warnings.push(...check.warnings.map((w) => `${file}: ${w}`));
	if (!usingExample) return {file, registry: check.registry};
	warnings.push(`${own} not found: using offers.example.json with every offer inactive`);
	return {file, registry: {version: 1, offers: check.registry.offers.map((offer) => ({...offer, active: false}))}};
};

const loadStudio = (configDir: string, errors: string[]): {file: string | null; studio: unknown} => {
	for (const name of ['studio.json', 'studio.example.json']) {
		const file = join(configDir, name);
		if (existsSync(file)) return {file, studio: readJson(file, errors)};
	}
	return {file: null, studio: null};
};

const parseUrl = (value: string): URL | null => {
	try {
		return new URL(value);
	} catch {
		return null;
	}
};

export const loadSettings = (env: Env = process.env): ServerSettings => {
	const errors: string[] = [];
	const warnings: string[] = [];
	const production = env.NODE_ENV === 'production';

	const port = Number(env.PORT ?? '8080');
	if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push('PORT must be a whole number from 0 to 65535');

	const baseRaw = env.PUBLIC_BASE_URL ?? (production ? '' : `http://localhost:${port}`);
	const base = parseUrl(baseRaw);
	let publicBaseUrl = '';
	if (!base || (base.protocol !== 'https:' && base.protocol !== 'http:')) {
		errors.push('PUBLIC_BASE_URL must be the public origin, e.g. https://go.zoora.ai');
	} else if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
		errors.push('PUBLIC_BASE_URL must be an origin only (no path, query or credentials)');
	} else if (production && base.protocol !== 'https:') {
		errors.push('PUBLIC_BASE_URL must use https in production');
	} else {
		publicBaseUrl = base.origin;
	}

	const adminUser = env.ADMIN_USER ?? '';
	const adminPasswordHash = env.ADMIN_PASSWORD_HASH ?? '';
	if (Boolean(adminUser) !== Boolean(adminPasswordHash)) errors.push('set both ADMIN_USER and ADMIN_PASSWORD_HASH, or neither');
	if (adminPasswordHash && !parseHash(adminPasswordHash)) {
		errors.push('ADMIN_PASSWORD_HASH is not a valid scrypt hash: create one with "node src/server/hash-password.ts"');
	}
	if (!adminUser && !adminPasswordHash) warnings.push('ADMIN_USER / ADMIN_PASSWORD_HASH not set: /admin is disabled');

	let hashSecret = env.HASH_SECRET ?? '';
	if (!hashSecret && production) errors.push('HASH_SECRET is required in production (at least 32 random characters)');
	else if (!hashSecret) {
		hashSecret = randomBytes(32).toString('hex');
		warnings.push('HASH_SECRET not set: using a random secret for this process only (development)');
	} else if (hashSecret.length < 32) errors.push('HASH_SECRET must be at least 32 characters');

	const kitFormAction = env.KIT_FORM_ACTION || DEFAULT_KIT_FORM_ACTION;
	const kitUrl = parseUrl(kitFormAction);
	if (kitUrl?.protocol !== 'https:') errors.push('KIT_FORM_ACTION must be an https URL');
	const formOrigins = kitUrl?.protocol === 'https:' ? [kitUrl.origin] : [];
	for (const entry of (env.FORM_ACTION_ORIGINS ?? '').split(/\s+/).filter(Boolean)) {
		const url = parseUrl(entry);
		if (url?.protocol !== 'https:' || url.origin !== entry.replace(/\/$/, '')) {
			errors.push(`FORM_ACTION_ORIGINS entry "${entry}" must be an https origin such as https://zoora.ai`);
		} else if (!formOrigins.includes(url.origin)) {
			formOrigins.push(url.origin);
		}
	}

	const contactEmail = env.CONTACT_EMAIL ?? '';
	if (contactEmail && !EMAIL.test(contactEmail)) errors.push('CONTACT_EMAIL is not a valid email address');
	if (!contactEmail) warnings.push('CONTACT_EMAIL not set: pages show no contact address');

	const brandName = (env.BRAND_NAME ?? 'Zoora AI').trim();
	if (!brandName || brandName.length > 60) errors.push('BRAND_NAME must be 1-60 characters');

	const trustProxy = (env.TRUST_PROXY || 'none') as TrustProxy;
	if (!['none', 'cloudflare', 'header'].includes(trustProxy)) errors.push('TRUST_PROXY must be none, cloudflare or header');
	const geoHeader = env.GEO_HEADER || null;
	const ipHeader = env.IP_HEADER || null;
	const proxySecret = env.PROXY_SECRET || null;
	const proxySecretHeader = env.PROXY_SECRET_HEADER || 'X-Origin-Secret';
	if (trustProxy === 'header' && !geoHeader && !ipHeader) {
		errors.push('TRUST_PROXY=header needs GEO_HEADER (country header) and/or IP_HEADER (client IP header, e.g. Fly-Client-IP)');
	}
	for (const [name, value] of [['GEO_HEADER', geoHeader], ['IP_HEADER', ipHeader], ['PROXY_SECRET_HEADER', proxySecretHeader]]) {
		if (value && !HEADER_NAME.test(value)) errors.push(`${name} must be a valid HTTP header name`);
	}
	if (proxySecret && proxySecret.length < 32) errors.push('PROXY_SECRET must be at least 32 characters');
	const countryFromProxy = trustProxy === 'cloudflare' || (trustProxy === 'header' && geoHeader !== null);
	if (countryFromProxy && !proxySecret) {
		warnings.push(`TRUST_PROXY=${trustProxy} without PROXY_SECRET: anyone who reaches the server directly can fake country headers`);
	}
	if (!countryFromProxy) warnings.push('no country header is trusted: visitor country is unknown, so offers with unknownCountry "block" stay hidden');

	const burst = Number(env.RATE_LIMIT_BURST || '40');
	const perMinute = Number(env.RATE_LIMIT_PER_MINUTE || '60');
	if (!Number.isInteger(burst) || burst < 1 || burst > 100_000) errors.push('RATE_LIMIT_BURST must be a whole number from 1 to 100000');
	if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > 1_000_000) {
		errors.push('RATE_LIMIT_PER_MINUTE must be a whole number from 1 to 1000000');
	}

	const dataDir = resolve(env.DATA_DIR || './data');
	const configDir = resolve(env.CONFIG_DIR || DEFAULT_CONFIG_DIR);
	const offers = loadOffers(configDir, errors, warnings);
	const studio = loadStudio(configDir, errors);
	const host = env.HOST || undefined;

	if (errors.length > 0) throw new ConfigError(errors);
	return {
		hub: {
			publicBaseUrl,
			brandName,
			offers: offers.registry,
			studio: studio.studio,
			kitFormAction,
			contactEmail,
			adminUser,
			adminPasswordHash,
			hashSecret,
		},
		formOrigins,
		host,
		port,
		dataDir,
		configDir,
		offersFile: offers.file,
		studioFile: studio.file,
		geo: {trustProxy, geoHeader, ipHeader, proxySecret, proxySecretHeader},
		rateLimit: {burst, perMinute},
		production,
		warnings,
	};
};
