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
 *   KIT_FORM_ACTION      Kit form POST URL for the hub's episode emails (required in production; development
 *                        falls back to the zoora.ai form 10168331, whose consent covers other emails)
 *   FORM_ACTION_ORIGINS  optional extra https origins forms may post or redirect to (space-separated),
 *                        e.g. the site of Kit's thank-you page; browsers apply CSP form-action to redirects
 *   CONTACT_EMAIL        public business contact shown on pages (required in production)
 *   BRAND_NAME           default "Zoora AI"
 *   OPERATOR_NAME        optional: the person or business that runs the site, named on /privacy (default: BRAND_NAME)
 *   TRUST_PROXY          none | cloudflare | header (default none)
 *   GEO_HEADER           header mode: country header name (optional: without it the country is unknown)
 *   IP_HEADER            header mode: client IP header name (optional, e.g. Fly-Client-IP on Fly.io)
 *   PROXY_SECRET         shared secret the proxy adds; PROXY_SECRET_HEADER (default X-Origin-Secret). Required in
 *                        production whenever the country comes from a header (cloudflare, or header + GEO_HEADER)
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

/** The zoora.ai site's Kit form. Its sign-ups agreed to "Zoora product and build updates", not episode emails. */
export const DEFAULT_KIT_FORM_ACTION = 'https://app.kit.com/forms/10168331/subscriptions';
const SITE_FORM_ID = '10168331';
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

const loadStudio = (configDir: string, production: boolean, errors: string[], warnings: string[]): {file: string | null; studio: unknown} => {
	const own = join(configDir, 'studio.json');
	if (existsSync(own)) return {file: own, studio: readJson(own, errors)};
	const example = join(configDir, 'studio.example.json');
	if (!existsSync(example)) return {file: null, studio: null};
	if (production) {
		// The example's deliverables, budgets and FAQ are starting suggestions, not the owner's reviewed offer.
		warnings.push(`${own} not found: /studio is switched off (503, not indexed) until you create it from studio.example.json`);
		return {file: null, studio: null};
	}
	warnings.push(`${own} not found: /studio shows studio.example.json (development only)`);
	return {file: example, studio: readJson(example, errors)};
};

/** The form id in a Kit form URL such as https://app.kit.com/forms/10168331/subscriptions. */
const kitFormId = (url: URL | null): string | null => /^\/forms\/(\d+)(?:\/|$)/.exec(url?.pathname ?? '')?.[1] ?? null;

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
	if (!env.KIT_FORM_ACTION && production) {
		errors.push(
			`KIT_FORM_ACTION is required in production: create a Kit form for the hub's episode emails and set its subscriptions URL (the zoora.ai form ${SITE_FORM_ID} collected consent for other emails)`,
		);
	} else if (!env.KIT_FORM_ACTION) {
		warnings.push(`KIT_FORM_ACTION not set: /subscribe posts to the zoora.ai form ${SITE_FORM_ID} (development only)`);
	} else if (kitFormId(kitUrl) === SITE_FORM_ID) {
		warnings.push(
			`KIT_FORM_ACTION is the zoora.ai form ${SITE_FORM_ID}, whose sign-ups agreed to "Zoora product and build updates", not episode emails with affiliate links: create a separate form for the hub`,
		);
	}
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
	if (!contactEmail && production) {
		errors.push('CONTACT_EMAIL is required in production: /privacy, /disclosures and the studio tell visitors to email it');
	} else if (!contactEmail) warnings.push('CONTACT_EMAIL not set: pages show no contact address');

	const brandName = (env.BRAND_NAME ?? 'Zoora AI').trim();
	if (!brandName || brandName.length > 60) errors.push('BRAND_NAME must be 1-60 characters');
	const operatorName = (env.OPERATOR_NAME ?? '').trim();
	if (operatorName.length > 120) errors.push('OPERATOR_NAME must be at most 120 characters');
	if (!operatorName && production) warnings.push('OPERATOR_NAME not set: /privacy names the brand, not the person or business that runs the site');

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
	if (countryFromProxy && !proxySecret && production) {
		// The origin is reachable directly (e.g. <app>.fly.dev), so an unauthenticated country header would let
		// anyone unlock offers that are blocked in their region, and fake their IP past the rate limits.
		errors.push(
			`TRUST_PROXY=${trustProxy} takes the visitor's country from a request header, so PROXY_SECRET is required in production: without it anyone who reaches the server directly can fake the country and see offers blocked in their region`,
		);
	} else if (countryFromProxy && !proxySecret) {
		warnings.push(`TRUST_PROXY=${trustProxy} without PROXY_SECRET: anyone who reaches the server directly can fake country headers (an error in production)`);
	}
	if (trustProxy === 'header' && ipHeader && !geoHeader && !proxySecret) {
		warnings.push(
			`IP_HEADER ${ipHeader} is trusted with no PROXY_SECRET set: this is only safe if your platform's proxy always sets that header itself (Fly.io describes Fly-Client-IP as the address its proxy saw); otherwise anyone can fake an IP to get past the rate limits`,
		);
	}
	if (trustProxy === 'none' && production) {
		warnings.push(
			'TRUST_PROXY=none: fine when visitors connect straight to this server. Behind a proxy or load balancer (Fly.io, Cloudflare, nginx) set TRUST_PROXY and the client IP header, or every visitor shares one rate-limit key (see docs/link-hub.md)',
		);
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
	const studio = loadStudio(configDir, production, errors, warnings);
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
			...(operatorName ? {operatorName} : {}),
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
