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

const X_RANGES: readonly [number, number][] = [
	[0, 4351],
	[8192, 8205],
	[8208, 8223],
	[8242, 8247],
];
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/*
 * URLs as X (twitter-text v3) finds them, so the count never comes out lower than X's:
 * - "https://" plus a host, or a bare domain (ASCII or Latin-accented labels and a letter-only TLD). Bare domains
 *   do not start right after a letter, digit, "@", "$" or "#", nor after ".", "/" or "-" glued to such a character.
 * - A port, path and query continue the URL only with characters X keeps inside one, so an emoji, "…", "»" or CJK
 *   text right after a link is counted as text; the URL ends on a character X lets a URL end on.
 * - A URL counts 23 when its TLD is one X certainly links (KNOWN_TLDS). Any other "domain" may be a URL that ends
 *   early (at an inner label, or inside a label before a non-ASCII character) or plain text, so it counts the
 *   larger of the two: max(its own weight, 23 + the rest after the earliest possible end), and its path is text.
 */
const LATIN = String.raw`\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0253\u0254\u0256\u0257\u0259\u025B\u0263\u0268\u026F\u0272\u0289\u028B\u02BB\u0300-\u036F\u1E00-\u1EFF`;
const SCHEME_HOST = /(?<![A-Za-z0-9@＠$#＃])https?:\/\/((?:[\p{L}\p{N}\p{M}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?\.)+[\p{L}\p{N}\p{M}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?)/giu;
const BARE_HOST = new RegExp(
	String.raw`(?<![A-Za-z0-9@＠$#＃])(?<![A-Za-z0-9@＠$#＃_./-][./-])((?:[a-z0-9${LATIN}](?:[a-z0-9${LATIN}-]*[a-z0-9${LATIN}])?\.)+(?:(?:[a-z]{2,63}|xn--[a-z0-9-]+)(?![a-z0-9@+-])|(?:(?![\x00-\x7F])[\p{L}\p{M}])+))`,
	'giu',
);
const URL_TAIL = /(?::\d+)?(?:[/?][a-z0-9!*';:=+,.$/%#[\]\-_~@|&?]*)?/iy;
const URL_TAIL_END = /[^a-z0-9\-_=#/]+$/i;
/** TLDs every version of X's list has had (checked against twitter-text 3.1.0); any other counts conservatively. */
const KNOWN_TLDS = new Set(
	'com org net edu gov io ai co app dev xyz me tv gg fun info news be us uk de fr es it nl eu ca au jp in br ch link cash finance exchange money md ly to sh so fm cc'.split(' '),
);
const MAX_URL = 4096; // twitter-text: longer "URLs" are text

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

/**
 * The URL at a match (scheme + host, or a bare domain): its span and weight, by the rules above. With
 * `wholeTail`, the span also covers the path of a domain whose TLD is not known (for hashtag counting).
 */
const urlAt = (text: string, start: number, hostStart: number, host: string, wholeTail: boolean): Span => {
	const hostEnd = hostStart + host.length;
	const labels = host.split('.');
	URL_TAIL.lastIndex = hostEnd;
	const tailEnd = hostEnd + (URL_TAIL.exec(text)?.[0] ?? '').replace(URL_TAIL_END, '').length;
	const known = KNOWN_TLDS.has(labels[labels.length - 1].toLowerCase()) && host.length <= 253 && labels.every((l) => l.length <= 63) && tailEnd - start <= MAX_URL;
	if (known) return {start, end: tailEnd, weight: LIMITS.xUrlWeight};
	// earliest end of a URL X could see here: after the second label's ASCII run (a TLD is never followed by an
	// ASCII letter, digit or "-"), or after its first character when it starts with a non-ASCII one (Unicode TLD)
	const earliest = hostStart + labels[0].length + 1 + Math.max(1, /^[0-9a-z-]*/i.exec(labels[1])?.[0].length ?? 0);
	const weight = Math.max(plainWeight(text.slice(start, hostEnd)), LIMITS.xUrlWeight + plainWeight(text.slice(earliest, hostEnd)));
	return {start, end: wholeTail ? tailEnd : hostEnd, weight};
};

/** Every URL X would count as 23 (or might), left to right. */
const urlSpans = (text: string, wholeTail = false): Span[] => {
	const spans: Span[] = [];
	for (let at = 0; at < text.length; ) {
		SCHEME_HOST.lastIndex = at;
		BARE_HOST.lastIndex = at;
		const scheme = SCHEME_HOST.exec(text);
		const bare = BARE_HOST.exec(text);
		const first = scheme && (!bare || scheme.index <= bare.index) ? scheme : bare;
		if (!first) break;
		const host = first[1];
		const span = urlAt(text, first.index, first.index + first[0].length - host.length, host, wholeTail);
		spans.push(span);
		at = span.end;
	}
	return spans;
};

/** Hashtags as Instagram and TikTok see them (twitter-text's rule as a proxy): "#" or "＃" not glued to a letter,
 * digit, "_" or "&", then letters, digits or "_" with at least one letter. Hashtags inside URLs do not count. */
const HASHTAG = /(?<![\p{L}\p{N}\p{M}_&])[#＃](?![\uFE0F\u20E3])[\p{L}\p{N}\p{M}_]*\p{L}[\p{L}\p{N}\p{M}_]*/gu;

export const countHashtags = (input: string): number => {
	const text = input.normalize('NFC');
	let plain = '';
	let at = 0;
	for (const span of urlSpans(text, true)) {
		plain += `${text.slice(at, span.start)} `;
		at = span.end;
	}
	return [...`${plain}${text.slice(at)}`.matchAll(HASHTAG)].length;
};

/** X's weighted length (twitter-text v3 rules, see LIMITS.xWeighted); it may over-count, never under-count. */
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
