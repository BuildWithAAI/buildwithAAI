/**
 * Safe areas and platform UI zones, in composition px (scaled from the reference frame sizes).
 *
 * 16:9 (1920x1080): faces, hands, dog ears, captions and text stay >= 96 px from the left/right edges and
 *   >= 54 px from the top/bottom (docs/ART_GUIDE.md MO18, the 90% title-safe convention; the same box is
 *   SAFE.landscape in src/episode/layout/specs.ts).
 *
 * 9:16 (1080x1920), checked 2026-11-24:
 *  - Margins >= 54 px left/right and >= 96 px top/bottom (ART_GUIDE MO18).
 *  - Organic Shorts player UI. YouTube publishes no pixel spec for organic Shorts (YouTube Help search,
 *    2026-11-24: no Shorts safe-zone article). These zones are the project's layout decision
 *    (src/episode/layout/specs.ts SAFE.vertical and CAPTIONS: top 10%, bottom 20%, and the action-button column
 *    at x > ~950 in the lower half), which sit inside the official ads zone below.
 *  - Google's official "Universal safe zones for video ads on YouTube", vertical 1080x1920: keep logos, products
 *    and supers out of the top 288 px, bottom 672 px, left 48 px and right 192 px
 *    (support.google.com/google-ads/answer/13547298, "About video ad specs", read 2026-11-24; the figure's SVG
 *    is storage.googleapis.com/support-kms-prod/jbb4hOyc2nGdunbKddqpFAEQpHOQvy582jIR). Ads are not overlaid on
 *    organic Shorts, so this is reported as information only, unless --shorts-zone ads makes it binding.
 */
import type {Rect} from '../../../src/qa/protocol.ts';

export type Format = 'landscape' | 'vertical' | 'square';

export const formatOf = (width: number, height: number): Format => (width / height > 1.2 ? 'landscape' : width / height < 0.8 ? 'vertical' : 'square');

export type NamedRect = {name: string; rect: Rect};

export type Zones = {
	format: Format;
	/** Everything important stays inside this box. */
	safe: Rect;
	/** Regions the platform UI covers (Shorts only). */
	ui: NamedRect[];
	/** Official ads safe area (Shorts only), information unless made binding. */
	adsSafe: Rect | null;
	sources: string[];
};

export type ShortsProfile = 'organic' | 'ads';

export const zonesFor = (width: number, height: number, profile: ShortsProfile = 'organic'): Zones => {
	const format = formatOf(width, height);
	if (format === 'landscape') {
		const sx = width / 1920;
		const sy = height / 1080;
		return {
			format,
			safe: {x: 96 * sx, y: 54 * sy, w: width - 192 * sx, h: height - 108 * sy},
			ui: [],
			adsSafe: null,
			sources: ['docs/ART_GUIDE.md MO18: >= 96 px from the sides, >= 54 px from the top and bottom (1920x1080)'],
		};
	}
	if (format === 'vertical') {
		const sx = width / 1080;
		const sy = height / 1920;
		const ads: Rect = {x: 48 * sx, y: 288 * sy, w: width - (48 + 192) * sx, h: height - (288 + 672) * sy};
		const ui: NamedRect[] = [
			{name: 'Shorts top bar (search, camera, menu)', rect: {x: 0, y: 0, w: width, h: 192 * sy}},
			{name: 'Shorts bottom overlay (channel, subscribe, title, sound)', rect: {x: 0, y: 1536 * sy, w: width, h: height - 1536 * sy}},
			{name: 'Shorts action buttons (like, dislike, comments, share, remix)', rect: {x: 950 * sx, y: 960 * sy, w: width - 950 * sx, h: height - 960 * sy}},
		];
		return {
			format,
			safe: profile === 'ads' ? ads : {x: 54 * sx, y: 96 * sy, w: width - 108 * sx, h: height - 192 * sy},
			ui: profile === 'ads' ? [] : ui,
			adsSafe: ads,
			sources: [
				'docs/ART_GUIDE.md MO18: Shorts margins >= 54 px left/right, >= 96 px top/bottom',
				'Organic Shorts UI zones: project layout decision (src/episode/layout/specs.ts SAFE.vertical, CAPTIONS); YouTube publishes no pixel spec for organic Shorts (checked 2026-11-24)',
				'Google Ads "Universal safe zones for video ads on YouTube" (support.google.com/google-ads/answer/13547298, read 2026-11-24): vertical 1080x1920 keep out of top 288, bottom 672, left 48, right 192 px',
			],
		};
	}
	const m = Math.round(Math.min(width, height) * 0.05);
	return {format, safe: {x: m, y: m, w: width - 2 * m, h: height - 2 * m}, ui: [], adsSafe: null, sources: ['square: 5% margin on every side (no project rule; conservative default)']};
};

/** How far `r` sticks out of `safe` on each side (px, >= 0). */
export const outside = (r: Rect, safe: Rect): {left: number; right: number; top: number; bottom: number; max: number} => {
	const left = Math.max(0, safe.x - r.x);
	const right = Math.max(0, r.x + r.w - (safe.x + safe.w));
	const top = Math.max(0, safe.y - r.y);
	const bottom = Math.max(0, r.y + r.h - (safe.y + safe.h));
	return {left, right, top, bottom, max: Math.max(left, right, top, bottom)};
};
