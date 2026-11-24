/**
 * WCAG 2.x contrast (pure). Relative luminance per WCAG 2.2 "relative luminance" (sRGB, 0.04045 threshold as in the
 * current IEC 61966-2-1 text) and contrast ratio (L1 + 0.05) / (L2 + 0.05). Thumbnail text needs >= 4.5:1 (SC 1.4.3).
 */
export type Rgb = readonly [number, number, number];

export const hexToRgb = (hex: string): Rgb => {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const channel = (c8: number): number => {
	const c = c8 / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export const contrastRgb = (a: Rgb, b: Rgb): number => {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export const contrast = (a: string, b: string): number => contrastRgb(hexToRgb(a), hexToRgb(b));

/** WCAG AA for normal text; thumbnail headlines are large text, but the channel rule asks for 4.5:1 regardless. */
export const MIN_TEXT_CONTRAST = 4.5;

/** CIE L* (D65) of an sRGB colour, for the ART_GUIDE value rules (CV4). */
export const lightness = (rgb: Rgb): number => {
	const y = luminance(rgb);
	return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
};
