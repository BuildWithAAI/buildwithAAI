/**
 * Colour maths for the QA checker: WCAG 2.x relative luminance and contrast ratio, CIE L*a*b* (D65) and ΔE76.
 * Inputs are 8-bit sRGB values.
 */

export type RGB = readonly [number, number, number];

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
	const c = i / 255;
	LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB 8-bit channel → linear light (0..1), from a lookup table. */
export const linear = (c: number): number => LIN[Math.max(0, Math.min(255, Math.round(c)))];

/** WCAG 2.x relative luminance. */
export const relLuminance = (r: number, g: number, b: number): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** WCAG contrast ratio (1..21) between two relative luminances. */
export const contrastOfLum = (l1: number, l2: number): number => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

export const contrastRgb = (a: RGB, b: RGB): number => contrastOfLum(relLuminance(a[0], a[1], a[2]), relLuminance(b[0], b[1], b[2]));

export const hexToRgb = (hex: string): RGB => {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const rgbToHex = (c: RGB): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** CIE L*a*b* (D65 white, sRGB primaries). */
export const lab = (r: number, g: number, b: number): [number, number, number] => {
	const R = linear(r);
	const G = linear(g);
	const B = linear(b);
	const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
	const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
	const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
	const fx = f(X);
	const fy = f(Y);
	const fz = f(Z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

export const deltaE76 = (a: RGB, b: RGB): number => {
	const p = lab(a[0], a[1], a[2]);
	const q = lab(b[0], b[1], b[2]);
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** L* of an sRGB colour (0 black .. 100 white). */
export const lightness = (c: RGB): number => lab(c[0], c[1], c[2])[0];

/** p-th percentile (0..100) of a numeric array (linear interpolation); NaN when empty. */
export const percentile = (xs: ArrayLike<number>, p: number): number => {
	const n = xs.length;
	if (!n) return NaN;
	const a = Float64Array.from(xs).sort();
	const k = (Math.max(0, Math.min(100, p)) / 100) * (n - 1);
	const lo = Math.floor(k);
	const hi = Math.ceil(k);
	return a[lo] + (a[hi] - a[lo]) * (k - lo);
};

export const median = (xs: ArrayLike<number>): number => percentile(xs, 50);
