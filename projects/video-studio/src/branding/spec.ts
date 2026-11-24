/**
 * YouTube channel-branding specs used by the branding kit (pure data, no Remotion imports).
 *
 * Verified 2026-11-24 by reading the official pages through this session:
 *  - support.google.com/youtube/answer/10456525 "Manage your channel branding" (profile picture, banner, watermark)
 *  - support.google.com/youtube/answer/12950272 "Channel banner & profile picture tips"
 *  - support.google.com/youtube/answer/6388789 "Add end screens to videos"
 *  - support.google.com/youtube/answer/3219384 "Customize your YouTube channel layout" (trailer, sections)
 *  - developers.google.com/youtube/v3/docs/channels (description, keywords and API title limits)
 * Device crop bands (TV, desktop, tablet, phone) are NOT on the current Help pages: they come from YouTube's
 * long-standing channel-art template as quoted by secondary guides (2026). Treat them as design checks only; the
 * binding rule is the official safe area.
 */

/** Byte limits use decimal megabytes (the stricter reading of "MB"). */
export const MB = 1_000_000;

export type Size = {width: number; height: number};
export type Rect = {x: number; y: number; w: number; h: number};

export const BANNER = {
	width: 2560,
	height: 1440,
	/** Official minimum upload and its safe area for text and logos (answer/10456525). */
	minUpload: {width: 2048, height: 1152},
	minSafe: {width: 1235, height: 338},
	/** The minimum-size safe area scaled to 2560x1440 is 1543.75 x 422.5; the widely used template rounds it to 1546 x 423. */
	safe: {width: 1546, height: 423},
	maxBytes: 6 * MB,
	/** "Do not include any additional file embellishments (e.g. shadows, borders, and frames)." */
	noBordersOrFrames: true,
} as const;

/** Visible crop of the banner per device class (secondary sources; centred on the canvas). */
export const BANNER_CROPS = {
	tv: {width: 2560, height: 1440},
	desktop: {width: 2560, height: 423},
	tablet: {width: 1855, height: 423},
	phone: {width: 1546, height: 423},
} as const;
export type BannerCrop = keyof typeof BANNER_CROPS;

export const AVATAR = {
	width: 800,
	height: 800,
	/** "Image that renders at 98 X 98 px." It is shown as a circle. */
	display: 98,
	/** Other sizes the same picture is shown at across YouTube (comments, watch page, Studio), checked by QA. */
	smallSizes: [160, 98, 48, 36, 24],
	maxBytes: 15 * MB,
	formats: ['JPG', 'GIF (not animated)', 'BMP', 'PNG'],
} as const;

export const WATERMARK = {
	width: 150,
	height: 150,
	/** "Minimum 150x150 pixels. Square image less than 1 MB in size." */
	maxBytesExclusive: 1 * MB,
	/** Display-time options in Studio. "End of video" = the last 15 s, but watermarks are suppressed during end screens. */
	endOfVideoSec: 15,
} as const;

export const END_SCREEN = {
	width: 1920,
	height: 1080,
	minSec: 5,
	maxSec: 20,
	minVideoSec: 25,
	maxElements: 4,
	/** "If you use a custom image, we recommend using an image that's at least 300 x 300 pixel width." */
	customImageMin: 300,
} as const;

export const STING = {
	width: 1920,
	height: 1080,
	fps: 30,
	minSec: 3,
	maxSec: 5,
	defaultSec: 4,
} as const;

/** Thumbnails are rendered at 1280x720 (CLAUDE.md); badges are sized for that canvas. */
export const THUMBNAIL = {width: 1280, height: 720, smallestListWidth: 168} as const;

export const TEXT_LIMITS = {
	channelDescription: 1000,
	channelKeywordsTotal: 500,
	/** brandingSettings.channel.title (Data API). Studio may allow longer names; keep within the API limit. */
	channelTitleApi: 30,
	homeTabCustomSections: 12,
	profileLinks: 14,
} as const;

/** Rectangle of size `s` centred on a canvas of size `c`. */
export const centred = (c: Size, s: Size): Rect => ({x: (c.width - s.width) / 2, y: (c.height - s.height) / 2, w: s.width, h: s.height});

export const bannerSafeRect = (): Rect => centred(BANNER, BANNER.safe);
export const bannerCropRect = (crop: BannerCrop): Rect => centred(BANNER, BANNER_CROPS[crop]);

export const inset = (r: Rect, d: number): Rect => ({x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d});
export const contains = (outer: Rect, inner: Rect, eps = 0): boolean =>
	inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
export const union = (rs: readonly Rect[]): Rect => {
	const x0 = Math.min(...rs.map((r) => r.x));
	const y0 = Math.min(...rs.map((r) => r.y));
	const x1 = Math.max(...rs.map((r) => r.x + r.w));
	const y1 = Math.max(...rs.map((r) => r.y + r.h));
	return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
};
