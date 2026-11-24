/**
 * Builds the newsletter draft for one episode from its publish kit (kit.json).
 *
 * Offers: an email reader's country is unknown, so an offer goes into an email only when the offer
 * registry (config/offers.json, the file the hub serves /go from) says it is live AND allowed for an
 * unknown country: regionDecision(offer, null) === 'allow'. Offers with unknownCountry "block" or a
 * country list (exchanges and other restricted financial offers) are always left out. Included offers
 * link through the hub with ?v=<slug>&s=email and carry their disclosure right above the link.
 */
import {disclosureLines, findOffer, hubPath, isLive, regionDecision, RELATIONSHIP_LABEL, RISK_LINE} from '../../src/server/offers.ts';
import type {Offer, OfferRegistry} from '../../src/types.ts';
import type {Issue} from './lint.ts';
import {parseTimestamp, type NewsletterKit} from './publish-kit.ts';

export type DraftOffer = {
	id: string;
	name: string;
	label: string; // "Affiliate link", "Referral link", ...
	url: string; // absolute hub link: <origin>/go/<id>?v=<slug>&s=email
	disclosure: string[]; // shown right above the link
};

export type NewsletterDraft = {
	slug: string;
	brandName: string;
	subject: string;
	previewText: string;
	title: string;
	summary: string;
	watchUrl: string | null;
	takeaways: {time: string; text: string; url: string | null}[];
	sources: {title: string; url: string}[];
	offers: DraftOffer[];
	leftOut: {id: string; reason: string}[];
	/** The episode's own disclosure lines that are not already shown next to an offer link. */
	episodeDisclosures: string[];
	safetyLine: string;
	footer: string[];
	disclosuresUrl: string | null; // the hub's /disclosures page, when the hub origin is known
	generatedAt: string;
};

export type DraftOptions = {
	registry: OfferRegistry | null; // null: no registry found, so every offer is left out
	hubOrigin?: string | null; // base for relative hubUrl values, e.g. https://go.zoora.ai
	youtubeId?: string | null; // overrides kit.youtubeVideoId (e.g. the video went live after the kit was made)
	brandName?: string;
	now?: Date;
};

export const DEFAULT_BRAND = 'Zoora AI';
const GENERIC_CHAPTER = /^(?:intro(?:duction)?|cold open|opening|outro|credits|end ?screen|ending|subscribe|thanks for watching)$/i;
const MAX_TAKEAWAYS = 10;
/** Failed publish-kit checks that block the email: claims, any disclosure check, restricted offers. */
const BLOCKING_KIT_CHECK = /^(?:income-claims|restricted-offers)$|disclosure/;
const PREVIEW_MAX = 140;

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();
const norm = (text: string): string => flat(text).toLowerCase();

/** The inbox preview line: the summary, cut at a word boundary. */
export const previewText = (summary: string): string => {
	const text = flat(summary);
	if (text.length <= PREVIEW_MAX) return text;
	const cut = text.slice(0, PREVIEW_MAX - 1);
	const space = cut.lastIndexOf(' ');
	return `${(space > PREVIEW_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
};

const restriction = (offer: Offer): string =>
	[
		offer.blockedCountries.length > 0 ? `blocked in ${offer.blockedCountries.join(', ')}` : '',
		offer.allowedCountries?.length ? `only allowed in ${offer.allowedCountries.join(', ')}` : '',
		offer.unknownCountry === 'block' ? 'unknownCountry "block"' : '',
	]
		.filter(Boolean)
		.join('; ');

/** The hub origin of one kit offer link, or why the link cannot be used. */
const hubOrigin = (hubUrl: string, id: string, fallback: string | null): {origin: string} | {problem: string} => {
	let url: URL;
	try {
		url = fallback ? new URL(hubUrl, fallback) : new URL(hubUrl);
	} catch {
		return {problem: 'hubUrl is a relative link: pass --hub <origin>, for example --hub https://go.zoora.ai'};
	}
	if (url.protocol !== 'https:') return {problem: 'hubUrl must use https'};
	if (url.username || url.password) return {problem: 'hubUrl must not contain credentials'};
	if (url.pathname !== `/go/${id}`) return {problem: `hubUrl must point at the hub's /go/${id}`};
	return {origin: url.origin};
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive mention of a name. */
const mentions = (text: string, name: string): boolean =>
	new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text);

export const buildDraft = (kit: NewsletterKit, options: DraftOptions): {draft: NewsletterDraft; issues: Issue[]} => {
	const issues: Issue[] = [];
	const error = (where: string, message: string): void => void issues.push({level: 'error', where, message});
	const warn = (where: string, message: string): void => void issues.push({level: 'warning', where, message});
	const now = options.now ?? new Date();
	const brandName = options.brandName ?? DEFAULT_BRAND;
	const {registry} = options;

	const youtubeId = options.youtubeId ?? kit.youtubeVideoId;
	if (options.youtubeId && kit.youtubeVideoId && options.youtubeId !== kit.youtubeVideoId) {
		warn('youtubeVideoId', `using --youtube-id ${options.youtubeId} instead of ${kit.youtubeVideoId} from kit.json`);
	}
	const watchUrl = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null;
	if (!watchUrl) error('youtubeVideoId', 'no watch link: kit.json has no youtubeVideoId yet. Pass --youtube-id <id> once the video is on YouTube.');

	const named = kit.chapters.filter((c) => !GENERIC_CHAPTER.test(c.title));
	const chapters = named.length > 0 ? named : kit.chapters;
	if (chapters.length > MAX_TAKEAWAYS) warn('chapters', `only the first ${MAX_TAKEAWAYS} chapters are listed as takeaways`);
	const takeaways = chapters.slice(0, MAX_TAKEAWAYS).map((c) => ({
		time: c.start,
		text: c.title,
		url: watchUrl ? `${watchUrl}&t=${parseTimestamp(c.start) ?? 0}s` : null,
	}));

	const offers: DraftOffer[] = [];
	const leftOut: NewsletterDraft['leftOut'] = [];
	const restricted: Offer[] = [];
	const origins: string[] = [];
	kit.offers.forEach((kitOffer, i) => {
		const where = `offers[${i}] "${kitOffer.id}"`;
		if (!kitOffer.disclosure) error(where, 'has no disclosure in kit.json. Every offer link needs one: fix the publish kit and run again.');
		const link = hubOrigin(kitOffer.hubUrl, kitOffer.id, options.hubOrigin ?? null);
		if ('origin' in link) origins.push(link.origin);
		if (offers.some((o) => o.id === kitOffer.id) || leftOut.some((o) => o.id === kitOffer.id)) {
			warn(where, 'appears twice in kit.json; it is listed once');
			return;
		}
		const offer = registry ? findOffer(registry, kitOffer.id) : undefined;
		const leave = (reason: string): void => void leftOut.push({id: kitOffer.id, reason});
		if (!registry) return leave('no offer registry was loaded, so its region rules cannot be checked');
		if (!offer) return leave('not in the offer registry');
		if (!isLive(offer, now.getTime())) return leave('inactive or expired in the offer registry');
		if (regionDecision(offer, null) !== 'allow') {
			restricted.push(offer);
			return leave(`restricted by country (${restriction(offer)}). An email reader's country is unknown, so restricted offers never go into emails.`);
		}
		if ('problem' in link) return error(where, link.problem);
		if (kitOffer.disclosure && norm(kitOffer.disclosure) !== norm(offer.disclosure)) {
			warn(where, 'the disclosure in kit.json differs from the offer registry; the email uses the registry text');
		}
		offers.push({
			id: offer.id,
			name: offer.name,
			label: RELATIONSHIP_LABEL[offer.relationship],
			url: `${link.origin}${hubPath(offer.id, kit.slug, 'email')}`,
			disclosure: disclosureLines(offer),
		});
	});

	const known = new Set(
		[RISK_LINE, ...kit.offers.map((o) => o.disclosure), ...kit.offers.flatMap((o) => (registry && findOffer(registry, o.id)?.disclosure) || [])].map(norm),
	);
	const episodeDisclosures: string[] = [];
	for (const line of kit.disclosures) {
		if (known.has(norm(line))) continue;
		known.add(norm(line));
		episodeDisclosures.push(flat(line));
	}

	const origin = offers[0] ? new URL(offers[0].url).origin : (options.hubOrigin ?? origins[0] ?? null);
	const draft: NewsletterDraft = {
		slug: kit.slug,
		brandName,
		subject: flat(kit.title),
		previewText: previewText(kit.summary),
		title: flat(kit.title),
		summary: flat(kit.summary),
		watchUrl,
		takeaways,
		sources: kit.sources.map((s) => ({title: flat(s.title), url: s.url})),
		offers,
		leftOut,
		episodeDisclosures,
		safetyLine: `${brandName} will never DM you first, ask for your seed phrase or ask you to connect a wallet. Anyone who does is an impersonator.`,
		footer: [
			'Educational content, not financial advice. Some links are affiliate links and are always labelled.',
			`You're getting this email because you subscribed to ${brandName} emails.`,
		],
		disclosuresUrl: origin ? `${origin}/disclosures` : null,
		generatedAt: now.toISOString(),
	};

	const visible = [draft.title, draft.summary, ...takeaways.map((t) => t.text), ...draft.sources.map((s) => s.title), ...episodeDisclosures];
	for (const offer of restricted) {
		if (visible.some((text) => mentions(text, offer.name))) {
			warn('content', `mentions "${offer.name}", which is left out of emails by its region rules: make sure the email does not promote it`);
		}
	}
	for (const check of kit.checks.filter((c) => !c.ok)) {
		// The email repeats the kit's text and offers: a kit that failed a claim, disclosure or region check
		// must be fixed first. Other failed checks (title length, captions...) are only reported.
		if (BLOCKING_KIT_CHECK.test(check.id)) {
			error(`checks "${check.id}"`, `the publish kit check failed, so no email is drafted until the kit passes it: ${check.detail || 'no detail'}`);
		} else {
			warn(`checks "${check.id}"`, `the publish kit check failed: ${check.detail || 'no detail'}`);
		}
	}
	return {draft, issues};
};
