/**
 * Offer registry: startup validation (fail fast) and the runtime rules used by /go and the pages.
 * Only URLs from this validated registry are ever used as redirect targets.
 */
import {launchpadEvidence} from '../launchpads.ts';
import type {CountryCode, Offer, OfferCategory, OfferRegistry, Relationship, Source} from '../types.ts';
import {isCountryCode} from './countries.ts';

export const SOURCES: readonly Source[] = ['yt', 'shorts', 'tiktok', 'reels', 'x', 'email', 'bio', 'site', 'other'];
const CATEGORIES: readonly OfferCategory[] = ['security', 'tools', 'exchange', 'education', 'own-product', 'other'];
const RELATIONSHIPS: readonly Relationship[] = ['affiliate', 'referral', 'own-product', 'sponsor'];
const OFFER_KEYS = [
	'id', 'name', 'url', 'category', 'relationship', 'disclosure', 'blockedCountries', 'allowedCountries',
	'unknownCountry', 'financialPromotion', 'active', 'expires', 'termsUrl', 'restrictedReason', 'alternatives',
	'subIdParam', 'notes',
];

/**
 * Words that suggest a financial product. A non-exchange offer that uses them without "financialPromotion"
 * gets a startup warning, because a staking, yield or trading offer filed as "tools" would otherwise be shown
 * in every country. The disclosure is checked without "earn" ("I earn a commission" is every affiliate link).
 */
const FINANCIAL_WORDS = /\b(?:deposit\w*|stak(?:e|es|ing)|yields?|apy|apr|interest|lend(?:s|ing)?|borrow\w*|trad(?:e|es|ing)|leverage|futures|margin|copy[- ]?trad\w*|signals?|savings?|earn)\b/i;
const FINANCIAL_WORDS_IN_DISCLOSURE = /\b(?:deposit\w*|stak(?:e|es|ing)|yields?|apy|apr|interest|lend(?:s|ing)?|borrow\w*|trad(?:e|es|ing)|leverage|futures|margin|copy[- ]?trad\w*|signals?|savings?)\b/i;

const OFFER_ID = /^[a-z0-9-]{2,40}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SUB_ID_PARAM = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
	affiliate: 'Affiliate link',
	referral: 'Referral link',
	'own-product': 'Our product',
	sponsor: 'Sponsor',
};

/** Added automatically next to exchange links whose disclosure does not already mention risk. */
export const RISK_LINE = 'Crypto assets are high risk and you could lose all the money you put in. Not financial advice.';

export const isOfferId = (value: string): boolean => OFFER_ID.test(value);
export const parseVideoId = (value: string | null): string | null => (value !== null && VIDEO_ID.test(value) ? value : null);
export const parseSource = (value: string | null): Source | null => SOURCES.find((s) => s === value) ?? null;

// ---------------------------------------------------------------------------------------------
// Validation

export type RegistryCheck = {registry: OfferRegistry; errors: string[]; warnings: string[]};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** "allowed_countries", "allowedCountry" and "AllowedCountries" all normalize to "allowedcountry". */
const normalizeKey = (key: string): string =>
	key.toLowerCase().replace(/[^a-z]/g, '').replace(/ies$/, 'y').replace(/s$/, '');

const isPlaceholderUrl = (url: string): boolean => {
	const host = new URL(url).hostname;
	return /replace/i.test(url) || /(^|\.)example\.(com|org|net)$/.test(host);
};

const validDate = (value: string): boolean => {
	if (DATE_ONLY.test(value)) {
		const t = Date.parse(`${value}T00:00:00Z`);
		return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
	}
	return DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
};

const checkOffer = (raw: unknown, index: number, errors: string[], warnings: string[]): Offer | null => {
	const at = `offers[${index}]`;
	if (!isRecord(raw)) {
		errors.push(`${at}: must be an object`);
		return null;
	}
	const where = typeof raw.id === 'string' ? `${at} "${raw.id}"` : at;
	const fail = (message: string): void => void errors.push(`${where}: ${message}`);

	for (const key of Object.keys(raw)) {
		if (OFFER_KEYS.includes(key)) continue;
		const near = OFFER_KEYS.find((k) => normalizeKey(k) === normalizeKey(key));
		if (near) fail(`unknown field "${key}" (did you mean "${near}"?)`);
		else warnings.push(`${where}: unknown field "${key}" is ignored`);
	}

	const text = (key: string, max: number, required: boolean): string | undefined => {
		const value = raw[key];
		if (value === undefined && !required) return undefined;
		if (typeof value !== 'string' || value.trim() === '') {
			fail(`"${key}" must be a non-empty string`);
			return undefined;
		}
		if (value.length > max) {
			fail(`"${key}" must be at most ${max} characters`);
			return undefined;
		}
		return value.trim();
	};
	const oneOf = <T extends string>(key: string, options: readonly T[]): T | undefined => {
		const found = options.find((o) => o === raw[key]);
		if (!found) fail(`"${key}" must be one of ${options.map((o) => `"${o}"`).join(', ')}`);
		return found;
	};
	const httpsUrl = (key: string, required: boolean): string | undefined => {
		const value = raw[key];
		if (value === undefined && !required) return undefined;
		let url: URL | null = null;
		try {
			url = typeof value === 'string' ? new URL(value) : null;
		} catch {
			url = null;
		}
		if (!url || typeof value !== 'string') {
			fail(`"${key}" must be a valid https URL`);
			return undefined;
		}
		if (url.protocol !== 'https:') {
			fail(`"${key}" must use https`);
			return undefined;
		}
		if (url.username || url.password) {
			fail(`"${key}" must not contain credentials`);
			return undefined;
		}
		return value;
	};
	const countries = (key: string, required: boolean): CountryCode[] | undefined => {
		const value = raw[key];
		if (value === undefined && !required) return undefined;
		if (!Array.isArray(value)) {
			fail(`"${key}" must be an array of ISO 3166-1 alpha-2 codes`);
			return [];
		}
		const out: CountryCode[] = [];
		for (const code of value) {
			if (typeof code === 'string' && isCountryCode(code)) {
				if (!out.includes(code)) out.push(code);
				continue;
			}
			const upper = typeof code === 'string' ? code.toUpperCase() : '';
			const hint =
				upper === 'UK'
					? ' (use "GB" for the United Kingdom)'
					: isCountryCode(upper)
						? ` (use upper case "${upper}")`
						: '';
			fail(`"${key}" contains ${JSON.stringify(code)}, which is not an ISO 3166-1 alpha-2 code${hint}`);
		}
		return out;
	};

	const id = typeof raw.id === 'string' && OFFER_ID.test(raw.id) ? raw.id : undefined;
	if (!id) fail('"id" must be a slug of 2-40 characters: a-z, 0-9 and "-"');
	const name = text('name', 120, true);
	const url = httpsUrl('url', true);
	const category = oneOf('category', CATEGORIES);
	const relationship = oneOf('relationship', RELATIONSHIPS);
	const disclosure = text('disclosure', 500, true);
	const blockedCountries = countries('blockedCountries', true) ?? [];
	const allowedCountries = countries('allowedCountries', false);
	const unknownCountry = oneOf('unknownCountry', ['allow', 'block'] as const);
	if (raw.financialPromotion !== undefined && typeof raw.financialPromotion !== 'boolean') fail('"financialPromotion" must be true or false');
	const financialPromotion = raw.financialPromotion === true;
	if (typeof raw.active !== 'boolean') fail('"active" must be true or false');
	const active = raw.active === true;
	const expires = raw.expires === undefined ? undefined : typeof raw.expires === 'string' ? raw.expires : '';
	if (expires !== undefined && !validDate(expires)) fail('"expires" must be an ISO date (YYYY-MM-DD) or a date-time with a time zone');
	const termsUrl = httpsUrl('termsUrl', false);
	const restrictedReason = text('restrictedReason', 500, false);
	const alternatives = raw.alternatives;
	if (alternatives !== undefined && !(Array.isArray(alternatives) && alternatives.every((a) => typeof a === 'string'))) {
		fail('"alternatives" must be an array of offer ids');
	}
	const subIdParam = raw.subIdParam;
	if (subIdParam !== undefined && !(typeof subIdParam === 'string' && SUB_ID_PARAM.test(subIdParam))) {
		fail('"subIdParam" must be a query parameter name: 1-40 characters of A-Z, a-z, 0-9, "_" or "-"');
	}
	const notes = text('notes', 2000, false);

	const launchpad = launchpadEvidence({
		name: typeof raw.name === 'string' ? raw.name : undefined,
		url: typeof raw.url === 'string' ? raw.url : undefined,
		notes: typeof raw.notes === 'string' ? raw.notes : undefined,
	});
	if (launchpad) fail(`memecoin launchpads are never offers on this channel (${launchpad})`);
	if (url && active && isPlaceholderUrl(url)) fail('replace the placeholder URL before setting "active": true');
	if (category === 'exchange' && unknownCountry !== 'block') fail('category "exchange" must use unknownCountry "block"');
	if (financialPromotion && unknownCountry !== 'block') fail('a financial promotion ("financialPromotion": true) must use unknownCountry "block"');
	const restricted = blockedCountries.length > 0 || (allowedCountries?.length ?? 0) > 0;
	if (restricted && unknownCountry === 'allow') {
		fail('an offer restricted by country must use unknownCountry "block", or visitors whose country is unknown would bypass the restriction');
	}
	if ((category === 'exchange' || financialPromotion) && !restricted) {
		fail(
			'a financial promotion (category "exchange" or "financialPromotion": true) must list the countries where it may not be shown ("blockedCountries", e.g. "GB" and "US" unless the programme is approved there) or the only ones where it may ("allowedCountries")',
		);
	}
	if (category && category !== 'exchange' && !financialPromotion) {
		const named = [typeof raw.name === 'string' ? raw.name : '', typeof raw.url === 'string' ? raw.url : ''].join(' ');
		const word = FINANCIAL_WORDS.exec(named)?.[0] ?? (typeof raw.disclosure === 'string' ? FINANCIAL_WORDS_IN_DISCLOSURE.exec(raw.disclosure)?.[0] : undefined);
		if (word) {
			warnings.push(
				`${where}: mentions "${word}". If it promotes a financial product (staking, yield, lending, trading, signals), set "financialPromotion": true and its country rules`,
			);
		}
	}

	if (!id || !name || !url || !category || !relationship || !disclosure || !unknownCountry) return null;
	const offer: Offer = {id, name, url, category, relationship, disclosure, blockedCountries, unknownCountry, active};
	if (allowedCountries) offer.allowedCountries = allowedCountries;
	if (financialPromotion) offer.financialPromotion = true;
	if (expires) offer.expires = expires;
	if (termsUrl) offer.termsUrl = termsUrl;
	if (restrictedReason) offer.restrictedReason = restrictedReason;
	if (Array.isArray(alternatives)) offer.alternatives = alternatives.filter((a): a is string => typeof a === 'string');
	if (typeof subIdParam === 'string') offer.subIdParam = subIdParam;
	if (notes) offer.notes = notes;
	return offer;
};

/** Validates parsed offers JSON. Collects every problem instead of stopping at the first. */
export const checkRegistry = (input: unknown): RegistryCheck => {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!isRecord(input)) return {registry: {version: 1, offers: []}, errors: ['the registry must be a JSON object'], warnings};
	if (input.version !== 1) errors.push('"version" must be 1');
	if (!Array.isArray(input.offers)) errors.push('"offers" must be an array');
	const offers: Offer[] = [];
	const ids = new Set<string>();
	(Array.isArray(input.offers) ? input.offers : []).forEach((raw, index) => {
		const offer = checkOffer(raw, index, errors, warnings);
		if (!offer) return;
		if (ids.has(offer.id)) errors.push(`offers[${index}] "${offer.id}": duplicate id`);
		ids.add(offer.id);
		offers.push(offer);
	});
	for (const offer of offers) {
		for (const alt of offer.alternatives ?? []) {
			if (alt === offer.id) errors.push(`offer "${offer.id}": "alternatives" must not include the offer itself`);
			else if (!ids.has(alt)) errors.push(`offer "${offer.id}": alternative "${alt}" does not exist`);
		}
	}
	return {registry: {version: 1, offers}, errors, warnings};
};

// ---------------------------------------------------------------------------------------------
// Runtime rules

export const findOffer = (registry: OfferRegistry, id: string): Offer | undefined => registry.offers.find((o) => o.id === id);

/** A date-only "expires" lasts until the end of that UTC day. */
export const expiresAtMs = (offer: Offer): number | null => {
	if (!offer.expires) return null;
	if (DATE_ONLY.test(offer.expires)) return Date.parse(`${offer.expires}T00:00:00Z`) + DAY_MS;
	return Date.parse(offer.expires);
};

export const isLive = (offer: Offer, now: number): boolean => {
	if (!offer.active) return false;
	const end = expiresAtMs(offer);
	return end === null || now < end;
};

export type RegionDecision = 'allow' | 'blocked_region' | 'blocked_unknown_region';

export const regionDecision = (offer: Offer, country: CountryCode | null): RegionDecision => {
	const allowList = offer.allowedCountries ?? [];
	if (country === null) {
		const restricted = allowList.length > 0 || offer.blockedCountries.length > 0;
		return offer.unknownCountry === 'allow' && !restricted ? 'allow' : 'blocked_unknown_region';
	}
	if (offer.blockedCountries.includes(country)) return 'blocked_region';
	if (allowList.length > 0 && !allowList.includes(country)) return 'blocked_region';
	return 'allow';
};

/**
 * Restricted offers are hidden by region at the hub, so text that is visible everywhere (descriptions,
 * posts, emails, video narration) must never name or promote them: only the hub's region-filtered page may.
 */
export const isRestricted = (offer: Offer): boolean => regionDecision(offer, null) !== 'allow';

export const isAvailable = (offer: Offer, country: CountryCode | null, now: number): boolean =>
	isLive(offer, now) && regionDecision(offer, country) === 'allow';

export const availableOffers = (registry: OfferRegistry, country: CountryCode | null, now: number): Offer[] =>
	registry.offers.filter((o) => isAvailable(o, country, now));

export const availableAlternatives = (registry: OfferRegistry, offer: Offer, country: CountryCode | null, now: number): Offer[] =>
	(offer.alternatives ?? [])
		.map((id) => findOffer(registry, id))
		.filter((o): o is Offer => o !== undefined && o.id !== offer.id && isAvailable(o, country, now));

/** Disclosure lines shown next to every link to this offer. */
export const disclosureLines = (offer: Offer): string[] =>
	offer.category === 'exchange' && !/\brisk/i.test(offer.disclosure) ? [offer.disclosure, RISK_LINE] : [offer.disclosure];

const joinOr = (items: readonly string[]): string =>
	items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

/**
 * The opening disclosure line for text with offer links, worded like the publish kit's description:
 * "Disclosure: some links for this video are affiliate or referral links. ..." (null without offers).
 */
export const topDisclosure = (offers: readonly Offer[]): string | null => {
	if (offers.length === 0) return null;
	const kinds = new Set(offers.map((o) => o.relationship));
	const paid = [kinds.has('affiliate') ? 'affiliate' : '', kinds.has('referral') ? 'referral' : '', kinds.has('sponsor') ? 'sponsored' : ''].filter(Boolean);
	const own = kinds.has('own-product');
	const what = paid.length ? `are ${joinOr(paid)} links${own ? ', and some go to my own products' : ''}` : 'go to my own products';
	return `Disclosure: some links for this video ${what}. If you use them, I may earn money. Each one is labelled next to the link.`;
};

/** The hub's region-filtered link page for one video, e.g. /?v=abc123&s=yt */
export const hubPagePath = (videoId: string | null, source: Source | null): string => {
	const query = new URLSearchParams();
	if (videoId) query.set('v', videoId);
	if (source) query.set('s', source);
	const qs = query.toString();
	return `/${qs ? `?${qs}` : ''}`;
};

/** The line (and its disclosure) that stands in for every restricted offer in text visible everywhere. */
export const restrictedOfferLines = (publicBaseUrl: string, videoId: string | null, source: Source | null): string[] => [
	`More partner links, only where they are available in your country: ${publicBaseUrl}${hubPagePath(videoId, source)}`,
	'Some of them are affiliate or referral links that may earn me money; each one is disclosed on that page.',
];

/** Relative hub link, e.g. /go/hardware-wallet?v=abc123&s=yt */
export const hubPath = (offerId: string, videoId: string | null, source: Source | null): string => {
	const query = new URLSearchParams();
	if (videoId) query.set('v', videoId);
	if (source) query.set('s', source);
	const qs = query.toString();
	return `/go/${encodeURIComponent(offerId)}${qs ? `?${qs}` : ''}`;
};

/**
 * The redirect target: the registry URL, plus `subIdParam=<videoId>.<source>` when the programme
 * supports sub-IDs. The rest of the query string is kept byte for byte (signed or strict affiliate links
 * break when it is re-encoded); v and s are validated slugs.
 */
export const destinationUrl = (offer: Offer, videoId: string | null, source: Source | null): string => {
	const url = new URL(offer.url);
	if (!offer.subIdParam || (!videoId && !source)) return url.href;
	const value = `${videoId ?? 'none'}.${source ?? 'none'}`;
	const param = encodeURIComponent(offer.subIdParam);
	if (url.searchParams.has(offer.subIdParam)) {
		// Networks hand out links with an empty "subid=" placeholder: replace only that key=value pair.
		let replaced = false;
		const pairs = url.search
			.slice(1)
			.split('&')
			.map((pair) => {
				const key = pair.split('=')[0] ?? '';
				let name = key;
				try {
					name = decodeURIComponent(key.replace(/\+/g, ' '));
				} catch {
					// an undecodable key is not ours
				}
				if (replaced || name !== offer.subIdParam) return pair;
				replaced = true;
				return `${param}=${encodeURIComponent(value)}`;
			});
		url.search = '';
		const hash = url.hash;
		url.hash = '';
		return `${url.href}?${pairs.join('&')}${hash}`;
	}
	const hash = url.hash;
	url.hash = '';
	const base = url.href;
	const separator = url.search ? '&' : base.endsWith('?') ? '' : '?';
	return `${base}${separator}${encodeURIComponent(offer.subIdParam)}=${encodeURIComponent(value)}${hash}`;
};
