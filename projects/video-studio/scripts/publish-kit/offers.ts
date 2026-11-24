/**
 * Offer registry (creator-hub/config/offers.json, else offers.example.json) and hub links.
 * The registry is the only source of disclosures. Destination URLs are read only to detect raw affiliate links
 * in post text; they are never written into any output.
 */
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {Offer, OfferRegistry, Platform, ResolvedOffer, Source} from './types.ts';
import {InputError, isRecord, readJsonFile} from './util.ts';

export const DEFAULT_HUB = 'https://go.zoora.ai';

/** Platform -> the hub's ?s= source (creator-hub Source). Instagram traffic arrives through the bio link. */
export const PLATFORM_SOURCE: Record<Platform, Source> = {
	youtube: 'yt',
	shorts: 'shorts',
	tiktok: 'tiktok',
	reels: 'reels',
	x: 'x',
	instagram: 'reels',
};

/** Mirrors RISK_LINE in creator-hub/src/server/offers.ts: added next to exchange links whose disclosure lacks it. */
export const RISK_LINE = 'Crypto assets are high risk and you could lose all the money you put in. Not financial advice.';

/** Channel rule: memecoin launchpads are never offers (same list as the hub). */
const LAUNCHPAD_HOSTS = ['pump.fun', 'letsbonk.fun', 'four.meme', 'sunpump.meme', 'believe.app'];
const CATEGORIES = ['security', 'tools', 'exchange', 'education', 'own-product', 'other'];
const RELATIONSHIPS = ['affiliate', 'referral', 'own-product', 'sponsor'];
export const OFFER_ID = /^[a-z0-9-]{2,40}$/;
const COUNTRY = /^[A-Z]{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Validates the registry fields this tool relies on. The hub validates the rest at its own startup. */
export const checkRegistry = (input: unknown): {registry: OfferRegistry; errors: string[]} => {
	const errors: string[] = [];
	if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.offers)) {
		return {registry: {version: 1, offers: []}, errors: ['expected {"version": 1, "offers": [...]}']};
	}
	const offers: Offer[] = [];
	const seen = new Set<string>();
	input.offers.forEach((raw, i) => {
		const where = `offers[${i}]${isRecord(raw) && typeof raw.id === 'string' ? ` "${raw.id}"` : ''}`;
		const problems: string[] = [];
		if (!isRecord(raw)) {
			errors.push(`${where}: must be an object`);
			return;
		}
		if (typeof raw.id !== 'string' || !OFFER_ID.test(raw.id)) problems.push('"id" must be 2-40 characters of a-z, 0-9 and "-"');
		else if (seen.has(raw.id)) problems.push('duplicate id');
		if (typeof raw.name !== 'string' || !raw.name.trim()) problems.push('"name" must be a non-empty string');
		if (typeof raw.disclosure !== 'string' || !raw.disclosure.trim()) problems.push('"disclosure" must be a non-empty string');
		if (!CATEGORIES.includes(raw.category as string)) problems.push(`"category" must be one of ${CATEGORIES.join(', ')}`);
		if (!RELATIONSHIPS.includes(raw.relationship as string)) problems.push(`"relationship" must be one of ${RELATIONSHIPS.join(', ')}`);
		if (raw.unknownCountry !== 'allow' && raw.unknownCountry !== 'block') problems.push('"unknownCountry" must be "allow" or "block"');
		if (typeof raw.active !== 'boolean') problems.push('"active" must be true or false');
		for (const key of ['blockedCountries', 'allowedCountries'] as const) {
			const value = raw[key];
			if (value === undefined && key === 'allowedCountries') continue;
			if (!Array.isArray(value) || !value.every((c) => typeof c === 'string' && COUNTRY.test(c))) problems.push(`"${key}" must be a list of ISO country codes such as "GB"`);
		}
		if (raw.expires !== undefined && (typeof raw.expires !== 'string' || Number.isNaN(Date.parse(raw.expires)))) problems.push('"expires" must be an ISO date');
		let host = '';
		try {
			const url = new URL(String(raw.url));
			if (url.protocol !== 'https:') problems.push('"url" must use https');
			host = url.hostname.toLowerCase();
		} catch {
			problems.push('"url" must be a valid https URL');
		}
		if (host && LAUNCHPAD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) problems.push('memecoin launchpads are never offers on this channel');
		if (problems.length) {
			errors.push(...problems.map((p) => `${where}: ${p}`));
			return;
		}
		seen.add(raw.id as string);
		offers.push(raw as unknown as Offer);
	});
	return {registry: {version: 1, offers}, errors};
};

export type RegistryLoad = {registry: OfferRegistry; path: string; isExample: boolean};

/** Reads `override`, else <creatorHub>/config/offers.json, else offers.example.json. Throws InputError on problems. */
export const loadRegistry = (creatorHubDir: string, override?: string | null): RegistryLoad => {
	const real = join(creatorHubDir, 'config', 'offers.json');
	const example = join(creatorHubDir, 'config', 'offers.example.json');
	const path = override ?? (existsSync(real) ? real : example);
	const parsed = readJsonFile(path, 'offer registry');
	if (parsed === null) throw new InputError(`offer registry not found: ${path}`);
	const {registry, errors} = checkRegistry(parsed);
	if (errors.length) throw new InputError(`${path}:\n  ${errors.join('\n  ')}`);
	return {registry, path, isExample: !override && path === example};
};

/** Active and not expired. A date-only `expires` lasts to the end of that UTC day (as in the hub). */
export const isLive = (offer: Offer, now: Date): boolean => {
	if (!offer.active) return false;
	if (!offer.expires) return true;
	const end = DATE_ONLY.test(offer.expires) ? Date.parse(`${offer.expires}T00:00:00Z`) + 86_400_000 : Date.parse(offer.expires);
	return now.getTime() < end;
};

/** Restricted offers are hidden by region at the hub, so static post text must never name them. */
export const isRestricted = (offer: Offer): boolean =>
	offer.blockedCountries.length > 0 || (offer.allowedCountries?.length ?? 0) > 0 || offer.unknownCountry === 'block';

/** The registry disclosure, plus the hub's risk line for exchanges whose disclosure does not mention risk. */
export const offerDisclosure = (offer: Offer): string => {
	const base = offer.disclosure.trim();
	return offer.category === 'exchange' && !/\brisk/i.test(base) ? `${base} ${RISK_LINE}` : base;
};

export const resolveOffers = (ids: readonly string[], registry: OfferRegistry, now: Date): {resolved: ResolvedOffer[]; missing: string[]} => {
	const resolved: ResolvedOffer[] = [];
	const missing: string[] = [];
	for (const id of ids) {
		const offer = registry.offers.find((o) => o.id === id);
		if (!offer) {
			missing.push(id);
			continue;
		}
		resolved.push({id, offer, disclosure: offerDisclosure(offer), restricted: isRestricted(offer), live: isLive(offer, now)});
	}
	return {resolved, missing};
};

/** Validates and normalizes the hub origin (https, no path, query or credentials). */
export const hubBase = (value: string): string => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new InputError(`hub base URL is not a valid URL: ${JSON.stringify(value)}`);
	}
	if (url.protocol !== 'https:') throw new InputError(`hub base URL must use https: ${value}`);
	if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
		throw new InputError(`hub base URL must be an origin such as ${DEFAULT_HUB} (no path, query or credentials): ${value}`);
	}
	return url.origin;
};

/** ${hub}/go/<offerId>?v=<slug>&s=<source>: the only form an offer link ever takes. */
export const hubLink = (base: string, offerId: string, slug: string, source: Source): string => {
	const url = new URL(`/go/${offerId}`, base);
	url.searchParams.set('v', slug);
	url.searchParams.set('s', source);
	return url.href;
};

/** The hub's region-filtered link page: ${hub}/?v=<slug>&s=<source>. */
export const hubPage = (base: string, slug: string | null, source: Source): string => {
	const url = new URL('/', base);
	if (slug) url.searchParams.set('v', slug);
	url.searchParams.set('s', source);
	return url.href;
};

/** Hosts of every registry destination, for spotting raw affiliate links in text. */
export const destinationHosts = (registry: OfferRegistry): string[] =>
	registry.offers
		.map((o) => {
			try {
				return new URL(o.url).hostname.toLowerCase().replace(/^www\./, '');
			} catch {
				return '';
			}
		})
		.filter(Boolean);
