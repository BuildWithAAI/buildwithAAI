/**
 * Offers for the generated assets. The registry is creator-hub's OfferRegistry (config/offers.json, gitignored);
 * this is a thin reader for the fields used here, so the asset tools do not import hub code.
 *
 * A static page, a post or a podcast cannot know the reader's country, so an offer is used only when the registry
 * says it is live AND allowed for an unknown country with no country lists (the newsletter's rule,
 * creator-hub/tools/newsletter/README.md). Exchanges are always left out. Every link goes through the hub
 * (/go/<id>?v=<slug>&s=<source>), which re-checks the region at click time, and every link carries its disclosure.
 */
import {existsSync} from 'node:fs';
import type {Offer} from './types.ts';
import {InputError, isRecord, readJson} from './util.ts';

export type HubSource = 'yt' | 'shorts' | 'tiktok' | 'reels' | 'x' | 'email' | 'bio' | 'site' | 'other';

export type UsableOffer = {id: string; name: string; disclosure: string; relationship: Offer['relationship']};

export type OfferSelection = {offers: UsableOffer[]; leftOut: {id: string; reason: string}[]; registryPath: string | null};

const OFFER_ID = /^[a-z0-9-]{2,40}$/;
/** A disclosure has to say what the relationship is (same words as the newsletter lint). */
export const DISCLOSURE_WORDS = /\b(?:affiliate|referral|commission|sponsor(?:ed|ship)?|paid|partner(?:ship)?|own product|our own|I own|we own|I built|we built|earn)\b/i;

export const loadRegistry = (path: string): Offer[] => {
	const raw = readJson(path, 'offer registry');
	if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.offers)) throw new InputError(`${path}: expected {"version": 1, "offers": [...]}`);
	const ids = new Set<string>();
	return raw.offers.map((o, i) => {
		if (!isRecord(o) || typeof o.id !== 'string' || !OFFER_ID.test(o.id)) throw new InputError(`${path}: offers[${i}].id must be a slug (a-z, 0-9, "-")`);
		if (ids.has(o.id)) throw new InputError(`${path}: duplicate offer id "${o.id}"`);
		ids.add(o.id);
		for (const key of ['name', 'disclosure', 'category', 'relationship', 'unknownCountry'] as const) {
			if (typeof o[key] !== 'string') throw new InputError(`${path}: offers[${i}].${key} must be a string`);
		}
		if (typeof o.active !== 'boolean' || !Array.isArray(o.blockedCountries)) throw new InputError(`${path}: offers[${i}] needs "active" and "blockedCountries"`);
		return o as unknown as Offer;
	});
};

/**
 * Disclosures must be in the language of the page or post (FTC: a disclosure in a different language from the
 * endorsement is not clear). The registry holds one (English) disclosure per offer, so for any other language an offer
 * is used only when config/channels.json "offerDisclosures" has an owner-approved translation for it.
 */
export type LocalizedDisclosures = Record<string, Record<string, string>>;

export const selectOffers = (
	ids: string[],
	registry: Offer[] | null,
	registryPath: string | null,
	now: Date,
	opts: {lang?: string; localized?: LocalizedDisclosures} = {},
): OfferSelection => {
	const wanted = [...new Set(ids)];
	if (!registry) return {offers: [], leftOut: wanted.map((id) => ({id, reason: 'no offer registry was given, so no offer can be checked'})), registryPath};
	const offers: UsableOffer[] = [];
	const leftOut: {id: string; reason: string}[] = [];
	for (const id of wanted) {
		const o = registry.find((x) => x.id === id);
		const expired = o?.expires ? now.getTime() > Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(o.expires) ? `${o.expires}T23:59:59.999Z` : o.expires) : false;
		const why = !o
			? 'not in the offer registry'
			: !o.active
				? 'inactive in the registry'
				: expired
					? `expired on ${o.expires}`
					: o.category === 'exchange'
						? 'exchanges are never shown on pages or posts whose reader country is unknown'
						: o.unknownCountry !== 'allow' || o.blockedCountries.length > 0 || (o.allowedCountries?.length ?? 0) > 0
							? 'region-restricted: a page or post cannot check the reader country'
							: !o.disclosure.trim()
								? 'has no disclosure'
								: !DISCLOSURE_WORDS.test(o.disclosure)
									? 'its disclosure does not say what the relationship is'
									: null;
		const lang = opts.lang ?? 'en';
		const translated = lang === 'en' ? o?.disclosure.trim() : opts.localized?.[id]?.[lang]?.trim();
		if (why || !o) leftOut.push({id, reason: why ?? 'unknown'});
		else if (!translated) leftOut.push({id, reason: `no ${lang} disclosure (add an owner-approved translation under "offerDisclosures" in config/channels.json)`});
		else offers.push({id: o.id, name: o.name, disclosure: translated, relationship: o.relationship});
	}
	return {offers, leftOut, registryPath};
};

export const loadRegistryIfPresent = (path: string | null): {registry: Offer[] | null; path: string | null} =>
	path && existsSync(path) ? {registry: loadRegistry(path), path} : {registry: null, path: null};

/** The tracked hub link for one offer: https://<hub>/go/<id>?v=<slug>&s=<source>. */
export const hubLink = (hubOrigin: string, offerId: string, slug: string, source: HubSource): string => {
	const url = new URL(`/go/${offerId}`, hubOrigin);
	url.searchParams.set('v', slug);
	url.searchParams.set('s', source);
	return url.href;
};

export const subscribeLink = (hubOrigin: string, slug: string, source: HubSource): string => {
	const url = new URL('/subscribe', hubOrigin);
	url.searchParams.set('s', source);
	url.searchParams.set('v', slug);
	return url.href;
};
