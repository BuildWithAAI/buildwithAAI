/**
 * Channel settings for the asset multiplier: scripts/assets/config/channels.json (no secrets; null = owner decision
 * pending). An unknown channel (a dev fixture) gets the defaults with its slug as the display name.
 */
import {InputError, isRecord, readJson} from './util.ts';

export type SiteConfig = {articleBase: string; siteName: string; offers: boolean};

export type PodcastShow = {
	title: string;
	description: string;
	author: string;
	ownerName: string;
	ownerEmail: string | null;
	feedUrl: string | null;
	mediaBase: string | null;
	imageUrl: string | null;
	link: string;
	categories: string[][];
	explicit: boolean;
	type: 'episodic' | 'serial';
	copyright: string;
	guid: string | null;
	locked: boolean;
};

export type PodcastConfig = {
	enabled: boolean;
	reason: string | null;
	coverFile: string | null;
	coverComposition: string | null;
	shows: Record<string, PodcastShow>;
};

export type ChannelConfig = {
	channel: string;
	brand: string;
	displayName: string;
	hubOrigin: string;
	defaultSite: string;
	sites: Record<string, SiteConfig>;
	newsletterLangs: string[];
	podcastMinSec: number;
	youtubeChannelUrl: string | null;
	hashtags: Record<string, string[]>;
	/** Owner-approved translations of offer disclosures: {offerId: {lang: text}} (English comes from the registry). */
	offerDisclosures: Record<string, Record<string, string>>;
	podcast: PodcastConfig;
};

const httpsUrl = (value: unknown, where: string, nullable: boolean): string | null => {
	if (value === null || value === undefined) {
		if (nullable) return null;
		throw new InputError(`${where} is required`);
	}
	if (typeof value !== 'string') throw new InputError(`${where} must be a string`);
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new InputError(`${where} must be an https URL, got ${JSON.stringify(value)}`);
	}
	if (url.protocol !== 'https:' || url.username || url.password) throw new InputError(`${where} must be an https URL without credentials`);
	return url.href.replace(/\/$/, value.endsWith('/') ? '/' : '');
};

const str = (value: unknown, where: string, fallback?: string): string => {
	if (typeof value === 'string' && value.trim()) return value.trim();
	if (fallback !== undefined) return fallback;
	throw new InputError(`${where} must be a non-empty string`);
};

const parseShow = (raw: unknown, where: string): PodcastShow => {
	if (!isRecord(raw)) throw new InputError(`${where} must be an object`);
	const categories = Array.isArray(raw.categories) ? raw.categories : [];
	if (!categories.length || !categories.every((c) => Array.isArray(c) && c.length >= 1 && c.length <= 2 && c.every((x) => typeof x === 'string' && x))) {
		throw new InputError(`${where}.categories must be a list of [category] or [category, subcategory] (Apple's list)`);
	}
	const email = raw.ownerEmail;
	if (email !== null && email !== undefined && (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
		throw new InputError(`${where}.ownerEmail must be null or an email address`);
	}
	const guid = raw.guid;
	if (guid !== null && guid !== undefined && (typeof guid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid))) {
		throw new InputError(`${where}.guid must be null or a UUID (podcast:guid)`);
	}
	return {
		title: str(raw.title, `${where}.title`),
		description: str(raw.description, `${where}.description`),
		author: str(raw.author, `${where}.author`),
		ownerName: str(raw.ownerName, `${where}.ownerName`),
		ownerEmail: typeof email === 'string' ? email : null,
		feedUrl: httpsUrl(raw.feedUrl, `${where}.feedUrl`, true),
		mediaBase: httpsUrl(raw.mediaBase, `${where}.mediaBase`, true),
		imageUrl: httpsUrl(raw.imageUrl, `${where}.imageUrl`, true),
		link: httpsUrl(raw.link, `${where}.link`, false) as string,
		categories: categories as string[][],
		explicit: raw.explicit === true,
		type: raw.type === 'serial' ? 'serial' : 'episodic',
		copyright: str(raw.copyright, `${where}.copyright`, ''),
		guid: typeof guid === 'string' ? guid.toLowerCase() : null,
		locked: raw.locked !== false,
	};
};

export const loadChannelConfig = (file: string, channel: string): ChannelConfig => {
	const raw = readJson(file, 'channel config');
	if (!isRecord(raw) || raw.version !== 1) throw new InputError(`${file}: "version" must be 1`);
	const d = isRecord(raw.defaults) ? raw.defaults : {};
	const channels = isRecord(raw.channels) ? raw.channels : {};
	const c = isRecord(channels[channel]) ? channels[channel] : {};
	const sitesRaw = isRecord(c.sites) ? c.sites : isRecord(d.sites) ? d.sites : {};
	const sites: Record<string, SiteConfig> = {};
	for (const [name, s] of Object.entries(sitesRaw)) {
		if (!isRecord(s)) throw new InputError(`${file}: sites.${name} must be an object`);
		sites[name] = {
			articleBase: (httpsUrl(s.articleBase, `sites.${name}.articleBase`, false) as string).replace(/\/+$/, ''),
			siteName: str(s.siteName, `sites.${name}.siteName`),
			offers: s.offers === true,
		};
	}
	if (!Object.keys(sites).length) throw new InputError(`${file}: at least one site is required`);
	const defaultSite = str(c.defaultSite ?? d.defaultSite, 'defaultSite', Object.keys(sites)[0]);
	if (!sites[defaultSite]) throw new InputError(`${file}: defaultSite "${defaultSite}" is not one of ${Object.keys(sites).join(', ')}`);
	const p = isRecord(c.podcast) ? c.podcast : {};
	const showsRaw = isRecord(p.shows) ? p.shows : {};
	const shows: Record<string, PodcastShow> = {};
	for (const [lang, show] of Object.entries(showsRaw)) shows[lang] = parseShow(show, `channels.${channel}.podcast.shows.${lang}`);
	const hashtags: Record<string, string[]> = {};
	if (isRecord(c.hashtags)) {
		for (const [lang, tags] of Object.entries(c.hashtags)) {
			if (Array.isArray(tags)) hashtags[lang] = tags.filter((t): t is string => typeof t === 'string' && /^[\p{L}\p{N}_]{2,40}$/u.test(t));
		}
	}
	const offerDisclosures: Record<string, Record<string, string>> = {};
	for (const src of [d.offerDisclosures, c.offerDisclosures]) {
		if (!isRecord(src)) continue;
		for (const [id, byLang] of Object.entries(src)) {
			if (!isRecord(byLang)) throw new InputError(`${file}: offerDisclosures.${id} must be an object of {lang: text}`);
			for (const [lang, text] of Object.entries(byLang)) {
				if (typeof text !== 'string' || !text.trim()) throw new InputError(`${file}: offerDisclosures.${id}.${lang} must be a non-empty string`);
				(offerDisclosures[id] ??= {})[lang] = text.trim();
			}
		}
	}
	const minSec = c.podcastMinSec ?? d.podcastMinSec;
	return {
		channel,
		brand: str(c.brand ?? d.brand, 'brand', 'Zoora AI'),
		displayName: str(c.displayName, 'displayName', channel),
		hubOrigin: (httpsUrl(c.hubOrigin ?? d.hubOrigin, 'hubOrigin', false) as string).replace(/\/+$/, ''),
		defaultSite,
		sites,
		newsletterLangs: Array.isArray(c.newsletterLangs ?? d.newsletterLangs) ? ((c.newsletterLangs ?? d.newsletterLangs) as unknown[]).filter((x): x is string => typeof x === 'string') : ['en'],
		podcastMinSec: typeof minSec === 'number' && minSec >= 0 ? minSec : 180,
		youtubeChannelUrl: httpsUrl(c.youtubeChannelUrl, `channels.${channel}.youtubeChannelUrl`, true),
		hashtags,
		offerDisclosures,
		podcast: {
			enabled: p.enabled === true,
			reason: typeof p.reason === 'string' ? p.reason : null,
			coverFile: typeof p.coverFile === 'string' && p.coverFile ? p.coverFile : null,
			coverComposition: typeof p.coverComposition === 'string' && p.coverComposition ? p.coverComposition : null,
			shows,
		},
	};
};
