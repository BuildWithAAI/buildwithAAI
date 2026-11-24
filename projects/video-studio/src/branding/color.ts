/** Colour maths for the branding checks (pure). sRGB hex -> relative luminance, WCAG contrast and CIE L*. */

export type RGB = readonly [number, number, number];

export const hexToRgb = (hex: string): RGB => {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const lin = (c8: number): number => {
	const c = c8 / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance of an 8-bit sRGB colour. */
export const luminance = (rgb: RGB): number => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);

/** WCAG contrast ratio (1..21) between two colours (hex or RGB). */
export const contrast = (a: string | RGB, b: string | RGB): number => {
	const la = luminance(typeof a === 'string' ? hexToRgb(a) : a);
	const lb = luminance(typeof b === 'string' ? hexToRgb(b) : b);
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
};

/** CIE L* (D65) of an 8-bit sRGB colour; ART_GUIDE CV4 quotes values on this scale. */
export const lightness = (c: string | RGB): number => {
	const y = luminance(typeof c === 'string' ? hexToRgb(c) : c);
	const f = y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27 * y + 16) / 116;
	return 116 * f - 16;
};
