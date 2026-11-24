/**
 * Post text per target, built only from the episode's checked text (title, hook, summary, sources, offers and
 * disclosures from the publish kit):
 *
 * X (280 weighted characters; every URL counts 23):
 *   [DEVELOPING: ]<hook>  /  <first summary sentence, if it fits>  /  <video link>
 *   <disclosure> <hub link ?s=x>   (one per offer)  /  <up to 2 hashtags, if they fit>
 *
 * Telegram (sendMessage: 4096 characters; sendVideo caption: 1024), plain text:
 *   [DEVELOPING: ]<title>  /  <summary>  /  Watch: <video link>
 *   <disclosure> + <hub link ?s=other> per offer  /  the hub's region page line for restricted offers
 *   <the kit's other disclosures>  /  Sources  /  [the developing-story line]
 *
 * Offers (same policy as the newsletter): a post is read everywhere, so an offer goes in only when the offer registry
 * says it is live and allowed for an unknown country. Restricted offers (exchanges and other region-limited financial
 * offers) never appear by name; Telegram gets the hub's region-filtered page instead, X gets nothing.
 */
import {findOffer, disclosureLines, hubPath, isLive, regionDecision, restrictedOfferLines} from '../../src/server/offers.ts';
import type {OfferRegistry, Source} from '../../src/types.ts';
import {hasErrors, isSafeQuote, quoteLine, scanText, type NameAllow} from '../threat-brief/safety.ts';
import type {AnnounceSource} from './source.ts';
import {TELEGRAM_CAPTION_LIMIT, TELEGRAM_TEXT_LIMIT} from './telegram.ts';
import {X_LIMIT, xLength} from './x-count.ts';

export type Target = 'x' | 'telegram';
export const TARGETS: readonly Target[] = ['telegram', 'x'];
/** The hub's ?s= source for each target (src/types.ts Source). */
export const HUB_SOURCE: Record<Target, Source> = {x: 'x', telegram: 'other'};

export const VIDEO_LINK_PENDING = '[video link: added after the video is public]';
export const DEVELOPING_LINE = 'This is a developing story. Corrections will be pinned under the video.';

export const watchUrlFor = (youtubeVideoId: string | null): string | null => (youtubeVideoId ? `https://youtu.be/${youtubeVideoId}` : null);

export type PlannedOffer = {id: string; disclosure: string[]};
export type OfferPlan = {
	included: PlannedOffer[];
	restricted: string[];
	leftOut: {id: string; reason: string}[];
	origin: string | null;
	problems: string[];
};

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

const httpsOrigin = (value: string): string | null => {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
	} catch {
		return null;
	}
};

/** Decides which of the kit's offers may appear in a post, and from which hub origin. */
export const planOffers = (source: AnnounceSource, registry: OfferRegistry | null, now: Date, hubOrigin: string | null): OfferPlan => {
	const plan: OfferPlan = {included: [], restricted: [], leftOut: [], origin: hubOrigin, problems: []};
	for (const kitOffer of source.offers) {
		if (plan.included.some((o) => o.id === kitOffer.id) || plan.restricted.includes(kitOffer.id) || plan.leftOut.some((o) => o.id === kitOffer.id)) continue;
		if (!kitOffer.disclosure.trim()) plan.problems.push(`offer "${kitOffer.id}" has no disclosure in kit.json: every offer link needs one`);
		let origin: string | null = null;
		try {
			const url = new URL(kitOffer.hubUrl, hubOrigin ?? undefined);
			if (httpsOrigin(url.href) && url.pathname === `/go/${kitOffer.id}`) origin = url.origin;
		} catch {
			origin = null;
		}
		if (!origin) {
			plan.problems.push(`offer "${kitOffer.id}": hubUrl must be an https hub link to /go/${kitOffer.id} (got "${kitOffer.hubUrl}")`);
			continue;
		}
		plan.origin ??= origin;
		const offer = registry ? findOffer(registry, kitOffer.id) : undefined;
		const leave = (reason: string): void => void plan.leftOut.push({id: kitOffer.id, reason});
		if (!registry) leave('no offer registry was loaded, so its region rules cannot be checked');
		else if (!offer) leave('not in the offer registry');
		else if (!isLive(offer, now.getTime())) leave('inactive or expired in the offer registry');
		else if (regionDecision(offer, null) !== 'allow') plan.restricted.push(offer.id);
		else plan.included.push({id: offer.id, disclosure: disclosureLines(offer)});
	}
	return plan;
};

export const offerLink = (origin: string, offerId: string, slug: string, target: Target): string => `${origin}${hubPath(offerId, slug, HUB_SOURCE[target])}`;

export type PlannedPost = {
	target: Target;
	method: 'create-post' | 'sendMessage' | 'sendVideo';
	text: string;
	length: number;
	limit: number;
	unit: string;
	watchUrl: string | null;
	notes: string[];
};

/**
 * One source line. Kit titles look like "<headline> (<Publisher>)": the headline is quoted and credited to its
 * publisher when it passes the safety rules, and left out (publisher and link only) when it does not.
 */
/** A trailing parenthetical is a publisher only when it reads like a name: never a date, a year or a number. */
const MONTH_DATE = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d/i;
export const looksLikePublisher = (text: string): boolean => /[A-Za-z]/.test(text) && !/^\d/.test(text.trim()) && !MONTH_DATE.test(text.trim());

export const sourceLine = (title: string, url: string, allow: NameAllow): string => {
	const m = /^(.*\S)\s+\(([^()]{2,60})\)$/.exec(title.trim());
	if (m?.[1] && m[2] && looksLikePublisher(m[2])) {
		const [, headline, publisher] = m;
		// a label that already names its publisher ("DefiLlama hacks: ...") is shown as it is
		if (headline.toLowerCase().startsWith(publisher.toLowerCase()) && !hasErrors(scanText(headline, {where: 'source', allow}))) return `- ${headline}: ${url}`;
		return isSafeQuote(headline, publisher, allow) ? `- ${quoteLine(publisher, headline)} ${url}` : `- ${publisher}: ${url}`;
	}
	if (title.trim() && !hasErrors(scanText(title, {where: 'source', allow}))) return `- ${title.trim()}: ${url}`;
	let host = url;
	try {
		host = new URL(url).hostname.replace(/^www\./, '');
	} catch {
		// keep the raw link text
	}
	return `- ${host}: ${url}`;
};

/** Titles may already carry the label; it is added once, by the template. */
const unlabelled = (text: string): string => text.replace(/^\s*DEVELOPING\s*[:·-]\s*/i, '').trim();

const firstSentence = (text: string): string => (text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)[0] ?? '').trim();

const graphemes = (text: string): string[] => [...new Intl.Segmenter('en', {granularity: 'grapheme'}).segment(text)].map((g) => g.segment);

/**
 * The longest start of `hook` (whole words, then whole characters for a single long word) that still fits once
 * `compose` adds the rest of the post, measured the way X counts: an ellipsis, emoji and CJK characters weigh 2.
 */
export const fitHook = (hook: string, fits: (head: string) => boolean): string => {
	if (fits(hook)) return hook;
	const words = hook.split(/\s+/).filter(Boolean);
	for (let n = words.length - 1; n >= 1; n--) {
		const head = `${words.slice(0, n).join(' ').replace(/[\s,;:–—-]+$/, '')}…`;
		if (fits(head)) return head;
	}
	const chars = graphemes(words[0] ?? hook);
	for (let n = chars.length - 1; n >= 1; n--) {
		const head = `${chars.slice(0, n).join('')}…`;
		if (fits(head)) return head;
	}
	return `${chars[0] ?? ''}…`; // nothing fits: the lint reports the length and nothing is posted
};

export const buildXPost = (source: AnnounceSource, plan: OfferPlan): PlannedPost => {
	const notes: string[] = [];
	const watch = watchUrlFor(source.youtubeVideoId);
	const link = watch ?? VIDEO_LINK_PENDING;
	const hook = unlabelled(source.hook || source.title);
	const prefix = source.developing ? 'DEVELOPING: ' : '';
	const summary = firstSentence(source.summary);
	const useSummary = summary && norm(summary) !== norm(hook) && norm(summary) !== norm(source.title);
	const offers = plan.origin ? plan.included.map((o) => `${o.disclosure.join(' ')} ${offerLink(plan.origin ?? '', o.id, source.slug, 'x')}`) : [];
	if (plan.restricted.length > 0) notes.push(`left out on X: ${plan.restricted.join(', ')} (region-restricted offers are never named in posts)`);
	const tags = source.hashtags.slice(0, 2).join(' ');
	const compose = (head: string, withSummary: boolean, withTags: boolean): string =>
		[head, withSummary && useSummary ? summary : '', link, ...offers, withTags ? tags : ''].filter(Boolean).join('\n\n');
	const head = `${prefix}${hook}`;
	let text = compose(head, true, true);
	if (xLength(text) > X_LIMIT && tags) text = compose(head, true, false);
	if (xLength(text) > X_LIMIT && useSummary) {
		text = compose(head, false, Boolean(tags));
		if (xLength(text) > X_LIMIT) text = compose(head, false, false);
		notes.push('the summary sentence did not fit and was left out');
	}
	if (xLength(text) > X_LIMIT) {
		const short = fitHook(hook, (h) => xLength(compose(`${prefix}${h}`, false, false)) <= X_LIMIT);
		text = compose(`${prefix}${short}`, false, false);
		notes.push(xLength(text) <= X_LIMIT ? 'the hook was shortened to fit' : 'even a one-word hook does not fit with the links and disclosures');
	}
	if (!watch) notes.push('the video link is a placeholder until the YouTube id is known; a real link counts 23');
	return {target: 'x', method: 'create-post', text, length: xLength(text), limit: X_LIMIT, unit: 'weighted characters (each link counts 23)', watchUrl: watch, notes};
};

export const buildTelegramPost = (source: AnnounceSource, plan: OfferPlan, options: {video: boolean; allow: NameAllow}): PlannedPost => {
	const notes: string[] = [];
	const watch = watchUrlFor(source.youtubeVideoId);
	const link = watch ?? VIDEO_LINK_PENDING;
	const limit = options.video ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_TEXT_LIMIT;
	const head = `${source.developing ? 'DEVELOPING: ' : ''}${unlabelled(source.title)}`;
	const offerBlocks = plan.origin ? plan.included.map((o) => [...o.disclosure, offerLink(plan.origin ?? '', o.id, source.slug, 'telegram')].join('\n')) : [];
	const restrictedBlock = plan.restricted.length > 0 && plan.origin ? restrictedOfferLines(plan.origin, source.slug, HUB_SOURCE.telegram).join('\n') : '';
	const shown = new Set([...plan.included.flatMap((o) => o.disclosure), ...source.offers.map((o) => o.disclosure)].map(norm));
	let noAdviceShown = false;
	const others = source.disclosures.filter((d) => {
		const n = norm(d);
		if (shown.has(n) || /\bdeveloping\b/i.test(d)) return false;
		if (plan.included.length === 0 && /^disclosure:/i.test(d)) return false; // no offer links in this post
		// kits often carry two wordings of the same line ("Education only, not financial advice.")
		if (/not financial advice/i.test(d)) {
			if (noAdviceShown) return false;
			noAdviceShown = true;
		}
		shown.add(n);
		return true;
	});
	const sources = source.sources.length > 0 ? ['Sources:', ...source.sources.map((s) => sourceLine(s.title, s.url, options.allow))].join('\n') : '';
	const compose = (withSummary: boolean, withSources: boolean): string =>
		[
			head,
			withSummary ? source.summary : '',
			`${options.video ? 'Full episode' : 'Watch'}: ${link}`,
			...offerBlocks,
			restrictedBlock,
			others.join('\n'),
			withSources ? sources : '',
			source.developing ? DEVELOPING_LINE : '',
		]
			.filter(Boolean)
			.join('\n\n');
	let text = compose(true, !options.video);
	if (text.length > limit && sources) {
		text = compose(true, false);
		notes.push('the source list did not fit and was left out (it is in the video description)');
	}
	if (text.length > limit && source.summary) {
		text = compose(false, false);
		notes.push('the summary did not fit and was left out');
	}
	if (!watch) notes.push('the video link is a placeholder until the YouTube id is known');
	return {target: 'telegram', method: options.video ? 'sendVideo' : 'sendMessage', text, length: text.length, limit, unit: options.video ? 'caption characters' : 'characters', watchUrl: watch, notes};
};
