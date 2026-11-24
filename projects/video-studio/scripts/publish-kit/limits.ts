/**
 * Platform limits and the way each platform counts text. Checked 2026-11-24. This session's network blocks
 * support.google.com, developers.google.com, docs.x.com, developers.tiktok.com and ffmpeg.org, so most facts
 * come from search-index extracts of the official pages named below (not a direct read). Re-check them in a
 * browser when a platform changes its rules. Sources marked "read directly" were fetched from the source.
 */

export const LIMITS = {
	/**
	 * YouTube Data API, videos resource (developers.google.com/youtube/v3/docs/videos), index extracts:
	 * snippet.title max 100 characters; snippet.description max 5000 BYTES; both accept any valid UTF-8
	 * except "<" and ">". snippet.tags[] max 500 characters in total, where the commas between tags count
	 * and a tag containing a space counts as if wrapped in quotes ("Foo Baz" = 9 characters).
	 */
	youtubeTitleChars: 100,
	youtubeDescriptionBytes: 5000,
	youtubeTagsChars: 500,
	/**
	 * YouTube Help 6390658 (hashtags), index extract: with more than 60 hashtags YouTube ignores every hashtag on
	 * the video. Up to 3 description hashtags show above the title (third-party guides only), so we use 3.
	 */
	youtubeHashtagsIgnoredAbove: 60,
	youtubeHashtagsUsed: 3,
	/**
	 * YouTube Help 9884579 (Video chapters), index extracts: the first timestamp is 00:00, at least 3
	 * timestamps in ascending order, each chapter at least 10 seconds.
	 */
	chaptersMin: 3,
	chapterMinSec: 10,
	/** YouTube Help 15424877: vertical or square uploads up to 3 minutes are Shorts (since 2024-10-15). */
	shortsMaxSec: 180,
	/**
	 * X: docs.x.com/fundamentals/counting-characters (index extract) and the twitter-text config v3, read directly
	 * from raw.githubusercontent.com/twitter/twitter-text/master/config/v3.json: maxWeightedTweetLength 280,
	 * scale 100, defaultWeight 200, transformedURLLength 23 (every URL counts 23), emoji count 2, and code
	 * points in 0-4351, 8192-8205, 8208-8223 and 8242-8247 count 1.
	 */
	xWeighted: 280,
	xUrlWeight: 23,
	/** X Help "About longer videos for X Premium subscribers" (index extract): 140 s for non-Premium accounts. */
	xVideoMaxSecFree: 140,
	/**
	 * Instagram: Meta's IG User Media reference (developers.facebook.com, quoted by third parties): captions up
	 * to 2,200 characters. Hashtags: that reference still says 30, but Adam Mosseri announced a limit of FIVE
	 * hashtags per post and Reel on 2025-12-19 (Social Media Today, Business Today, Betanews), so we use 5.
	 * Reels may be up to 3 minutes since January 2025 (Mosseri, reported by Social Media Today).
	 */
	instagramCaptionChars: 2200,
	instagramHashtags: 5,
	reelsMaxSec: 180,
	/**
	 * TikTok: the app allows 4,000-character captions (third-party guides only); the Content Posting API's
	 * post_info.title allows 2,200 UTF-16 code units (developers.tiktok.com reference, quoted by third parties).
	 * We use 2,200 so one caption works for both manual and API posting.
	 */
	tiktokCaptionUnits: 2200,
	/** Our own cap for TikTok hashtags (TikTok publishes none); keeps captions readable. */
	tiktokHashtags: 5,
} as const;

/** UTF-8 byte length (the YouTube description limit is in bytes). */
export const utf8Bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

/** UTF-16 code units, i.e. JavaScript string length (TikTok's API unit; also our stricter count elsewhere). */
export const utf16Units = (text: string): number => text.length;

/** YouTube's tag budget: tag lengths + 2 quotes for each tag with a space + the commas between tags. */
export const youtubeTagsLength = (tags: readonly string[]): number =>
	tags.reduce((sum, tag) => sum + tag.length + (/\s/.test(tag) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

/** Hashtags as a platform sees them: "#" plus letters, digits or "_", at the start or after a space or bracket. */
export const countHashtags = (text: string): number => [...text.matchAll(/(?:^|[\s(\[{"'“‘])#[\p{L}\p{N}_]+/gu)].length;

const X_RANGES: readonly [number, number][] = [
	[0, 4351],
	[8192, 8205],
	[8208, 8223],
	[8242, 8247],
];
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const SCHEME_URL = /https?:\/\/[^\s]+/gi;
/** Bare domains X also links (e.g. "go.zoora.ai"); counted conservatively as max(23, length). */
const BARE_DOMAIN = /(?<![\w@./-])(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|co|xyz|app|dev|gov|edu|me|tv|gg|fun|info|news)\b(?:\/[^\s]*)?/gi;
const TRAILING_PUNCTUATION = /[.,!?:;)\]}'"”’]+$/;

const segmenter = new Intl.Segmenter('en', {granularity: 'grapheme'});

const plainWeight = (text: string): number => {
	let weight = 0;
	for (const {segment} of segmenter.segment(text)) {
		if (EMOJI.test(segment)) {
			weight += 2;
			continue;
		}
		for (const ch of segment) {
			const cp = ch.codePointAt(0) ?? 0;
			weight += X_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
		}
	}
	return weight;
};

type Span = {start: number; end: number; weight: number};

const urlSpans = (text: string): Span[] => {
	const spans: Span[] = [];
	const add = (re: RegExp, weightOf: (url: string) => number): void => {
		for (const match of text.matchAll(re)) {
			const start = match.index ?? 0;
			const url = match[0].replace(TRAILING_PUNCTUATION, '');
			const end = start + url.length;
			if (spans.some((s) => start < s.end && end > s.start)) continue;
			spans.push({start, end, weight: weightOf(url)});
		}
	};
	add(SCHEME_URL, () => LIMITS.xUrlWeight);
	add(BARE_DOMAIN, (url) => Math.max(LIMITS.xUrlWeight, url.length));
	return spans.sort((a, b) => a.start - b.start);
};

/** X's weighted length (twitter-text v3 rules, see LIMITS.xWeighted). */
export const xWeightedLength = (input: string): number => {
	const text = input.normalize('NFC');
	let weight = 0;
	let at = 0;
	for (const span of urlSpans(text)) {
		weight += plainWeight(text.slice(at, span.start)) + span.weight;
		at = span.end;
	}
	return weight + plainWeight(text.slice(at));
};
