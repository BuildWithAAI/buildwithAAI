/**
 * Post text for every platform. Rules applied here:
 * - Offer links are hub links only: ${hub}/go/<offerId>?v=<slug>&s=<source>, each with its registry disclosure
 *   on the next line. With any offer, the YouTube description and the pinned comment open with a disclosure line.
 * - Offers restricted by region are never named in post text (it is visible in every country). They are only
 *   reachable through the hub's region-filtered link page.
 * - Shorts, TikTok and Instagram captions have no clickable links, so they say "Link in bio: <hub host>";
 *   a clip that promotes an offer carries that offer's disclosure in its own caption.
 */
import {LIMITS, utf16Units, utf8Bytes, xWeightedLength} from './limits.ts';
import {hubLink, hubPage, PLATFORM_SOURCE} from './offers.ts';
import type {Chapter} from './timing.ts';
import type {Episode, Relationship, ResolvedOffer, Short, Source} from './types.ts';
import {clock} from './util.ts';

export type PostContext = {
	episode: Episode;
	offers: ResolvedOffer[]; // the episode's offers found in the registry, in episode order
	hub: string; // hub origin, e.g. https://go.zoora.ai
	chapters: Chapter[];
};

export const NOT_ADVICE = 'Education only, not financial advice.';

const hubHost = (ctx: PostContext): string => new URL(ctx.hub).host;

/** The full episode on YouTube: the video once its id is known, else the channel page. */
export const watchUrl = (e: Episode): string | null =>
	e.youtubeVideoId ? `https://youtu.be/${e.youtubeVideoId}` : e.channelInfo.handle ? `https://www.youtube.com/${e.channelInfo.handle}` : null;

const joinOr = (items: readonly string[]): string =>
	items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

const hashtagLine = (e: Episode, max: number): string => e.hashtags.slice(0, max).map((h) => `#${h}`).join(' ');

/**
 * "Disclosure: some links for this video are affiliate or referral links. ..." or null without offers.
 * Worded to read correctly anywhere (description, pinned comment, and kit.disclosures reused by the newsletter).
 */
export const topDisclosure = (offers: readonly ResolvedOffer[]): string | null => {
	if (!offers.length) return null;
	const kinds = new Set<Relationship>(offers.map((o) => o.offer.relationship));
	const paid = [kinds.has('affiliate') ? 'affiliate' : '', kinds.has('referral') ? 'referral' : '', kinds.has('sponsor') ? 'sponsored' : ''].filter(Boolean);
	const own = kinds.has('own-product');
	const what = paid.length ? `are ${joinOr(paid)} links${own ? ', and some go to my own products' : ''}` : 'go to my own products';
	return `Disclosure: some links for this video ${what}. If you use them, I may earn money. Each one is labelled next to the link.`;
};

/** The link-page line (and its disclosure) that stands in for every offer restricted by region. */
export const restrictedLines = (ctx: PostContext, source: Source): string[] => [
	`More partner links, only where they are available in your country: ${hubPage(ctx.hub, ctx.episode.slug, source)}`,
	'Some of them are affiliate or referral links that may earn me money; each one is disclosed on that page.',
];

/** "<name>: <hub link>" followed by the disclosure, for every offer that may be named. */
const offerLines = (ctx: PostContext, source: Source): string[] => {
	const open = ctx.offers.filter((o) => !o.restricted);
	const lines = open.flatMap((o) => [`${o.offer.name}: ${hubLink(ctx.hub, o.id, ctx.episode.slug, source)}`, o.disclosure]);
	if (ctx.offers.some((o) => o.restricted)) lines.push(...restrictedLines(ctx, source));
	return lines;
};

export const safetyLine = (e: Episode): string =>
	`${e.channelInfo.displayName} will never DM you first, ask for your seed phrase or ask you to connect a wallet. Anyone who does is an impersonator.`;

export const youtubeDescription = (ctx: PostContext): string => {
	const e = ctx.episode;
	const lines: string[] = [];
	const top = topDisclosure(ctx.offers);
	if (top) lines.push(top, '');
	lines.push(e.summary, '', e.cta);
	const links = offerLines(ctx, PLATFORM_SOURCE.youtube);
	if (links.length) lines.push('', 'Links mentioned in this video:', ...links);
	if (ctx.chapters.length) lines.push('', 'Chapters:', ...ctx.chapters.map((c) => `${c.start} ${c.title}`));
	if (e.sources.length) lines.push('', 'Sources:', ...e.sources.map((s) => `${s.title}: ${s.url}`));
	lines.push('', ...e.disclosures, safetyLine(e), NOT_ADVICE);
	const tags = hashtagLine(e, LIMITS.youtubeHashtagsUsed);
	if (tags) lines.push('', tags);
	return lines.join('\n');
};

export const pinnedComment = (ctx: PostContext): string => {
	const e = ctx.episode;
	const lines: string[] = [];
	const top = topDisclosure(ctx.offers);
	if (top) lines.push(top, ...offerLines(ctx, PLATFORM_SOURCE.youtube), '');
	lines.push(`Safety: ${e.channelInfo.displayName} will never DM you first, ask for your seed phrase or ask you to connect a wallet. Replies that do are impersonators: please report them.`);
	return lines.join('\n');
};

/** Disclosure lines for the offers a clip promotes (restricted offers are never named; a check fails instead). */
const mentionLines = (ctx: PostContext, short: Short): string[] =>
	ctx.offers.filter((o) => short.offers.includes(o.id) && !o.restricted).map((o) => `Mentioned: ${o.offer.name}. ${o.disclosure}`);

const youtubeName = (e: Episode): string => e.channelInfo.handle ?? e.channelInfo.displayName;

export const shortDescription = (ctx: PostContext, short: Short): string => {
	const e = ctx.episode;
	const lines = [short.hook, 'Full episode: tap the related video link under the channel name.', ...mentionLines(ctx, short), `More links: ${hubHost(ctx)}`];
	const tags = hashtagLine(e, LIMITS.youtubeHashtagsUsed);
	if (tags) lines.push(tags);
	return lines.join('\n');
};

/** TikTok and Reels: no clickable links, so the bio link (the hub's region-filtered page) carries them. */
export const bioCaption = (ctx: PostContext, short: Short, maxHashtags: number): string => {
	const e = ctx.episode;
	const lines = [short.hook, ...mentionLines(ctx, short), `Full episode on YouTube: ${youtubeName(e)}`, `Link in bio: ${hubHost(ctx)}`];
	const tags = hashtagLine(e, maxHashtags);
	if (tags) lines.push(tags);
	return lines.join('\n');
};

/**
 * X: the hook, a hub link (s=x) with its disclosure for each offer the clip promotes, and the full episode.
 * Hashtags are dropped when they would pass 280 weighted characters; a disclosure never is, so an over-long
 * post fails the x-post check and the owner shortens the hook.
 */
export const xPost = (ctx: PostContext, short: Short): string => {
	const e = ctx.episode;
	const promoted = ctx.offers.filter((o) => short.offers.includes(o.id) && !o.restricted);
	const restricted = ctx.offers.some((o) => short.offers.includes(o.id) && o.restricted);
	const watch = watchUrl(e);
	const lines = [
		short.hook,
		...promoted.flatMap((o) => [`${o.offer.name}: ${hubLink(ctx.hub, o.id, e.slug, PLATFORM_SOURCE.x)}`, o.disclosure]),
		...(restricted ? [`Links and disclosures: ${hubPage(ctx.hub, e.slug, PLATFORM_SOURCE.x)}`] : []),
		watch ? `Full episode: ${watch}` : `Full episode on YouTube: ${youtubeName(e)}`,
	];
	const tags = hashtagLine(e, 2);
	const withTags = [...lines, tags].join('\n');
	return tags && xWeightedLength(withTags) <= LIMITS.xWeighted ? withTags : lines.join('\n');
};

export const instagramCaption = (ctx: PostContext): string => {
	const e = ctx.episode;
	const lines = [e.title, '', e.summary, '', `Full episode on YouTube: ${youtubeName(e)}`, `Link in bio: ${hubHost(ctx)}`];
	const tags = hashtagLine(e, LIMITS.instagramHashtags);
	if (tags) lines.push('', tags);
	return lines.join('\n');
};

/** How each platform measures its text, and its limit. */
export const MEASURE = {
	youtube: {count: utf8Bytes, limit: LIMITS.youtubeDescriptionBytes, unit: 'UTF-8 bytes'},
	shorts: {count: utf8Bytes, limit: LIMITS.youtubeDescriptionBytes, unit: 'UTF-8 bytes'},
	tiktok: {count: utf16Units, limit: LIMITS.tiktokCaptionUnits, unit: 'UTF-16 code units'},
	reels: {count: utf16Units, limit: LIMITS.instagramCaptionChars, unit: 'characters (UTF-16 code units)'},
	instagram: {count: utf16Units, limit: LIMITS.instagramCaptionChars, unit: 'characters (UTF-16 code units)'},
	x: {count: xWeightedLength, limit: LIMITS.xWeighted, unit: 'weighted characters (each URL counts 23)'},
} as const;

export type ClipText = {short: Short; text: string};

/** One file with a captioned section per clip; the header lines are for the owner, not for pasting. */
export const clipFile = (clips: readonly ClipText[], platform: keyof typeof MEASURE): string =>
	clips
		.map(({short, text}, i) => {
			const m = MEASURE[platform];
			const head = `=== Clip ${i + 1} of ${clips.length}: media/short-${short.n}.mp4 (${clock(short.endSec - short.startSec)}) · ${m.count(text)}/${m.limit} ${m.unit} ===`;
			return `${head}\n${text}\n`;
		})
		.join('\n');

/** shorts-<n>.txt: the Short's title and description, labelled. */
export const shortFile = (short: Short, description: string, total: number): string =>
	[
		`=== Short ${short.n} of ${total}: media/short-${short.n}.mp4 (${clock(short.endSec - short.startSec)}) ===`,
		`TITLE (${short.title.length}/${LIMITS.youtubeTitleChars} characters):`,
		short.title,
		'',
		`DESCRIPTION (${utf8Bytes(description)}/${LIMITS.youtubeDescriptionBytes} bytes):`,
		description,
		'',
	].join('\n');
