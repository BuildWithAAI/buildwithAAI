/**
 * Structural similarity (Wang et al. 2004) with box windows over integral images, optionally restricted to a
 * mask: only windows whose mask coverage is at least `minCover` count. Values are 8-bit scale (0..255).
 */

export type SsimResult = {
	/** Mean SSIM over the counted windows (1 = identical). NaN when no window counted. */
	mean: number;
	/** Lowest window SSIM, and where it is (top-left of the window, in input px). */
	min: number;
	minAt: {x: number; y: number};
	/** 5th percentile of the window values (robust "worst area"). */
	p5: number;
	count: number;
	/** Per-window SSIM (NaN for windows that did not count), mapW x mapH, window stride `step`. */
	map: Float32Array;
	mapW: number;
	mapH: number;
	step: number;
	win: number;
};

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

const integral = (src: ArrayLike<number>, w: number, h: number, f: (v: number, i: number) => number): Float64Array => {
	const I = new Float64Array((w + 1) * (h + 1));
	for (let y = 0; y < h; y++) {
		let row = 0;
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			row += f(src[i], i);
			I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
		}
	}
	return I;
};
const boxSum = (I: Float64Array, w: number, x0: number, y0: number, x1: number, y1: number): number => {
	const W = w + 1;
	return I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
};

export const ssim = (a: ArrayLike<number>, b: ArrayLike<number>, w: number, h: number, mask: Uint8Array | null = null, win = 8, step = 4, minCover = 0.5): SsimResult => {
	if (a.length !== w * h || b.length !== w * h) throw new Error(`ssim: expected ${w * h} values, got ${a.length} and ${b.length}`);
	const mapW = w >= win ? Math.floor((w - win) / step) + 1 : 0;
	const mapH = h >= win ? Math.floor((h - win) / step) + 1 : 0;
	const map = new Float32Array(mapW * mapH).fill(NaN);
	const empty: SsimResult = {mean: NaN, min: NaN, minAt: {x: 0, y: 0}, p5: NaN, count: 0, map, mapW, mapH, step, win};
	if (!mapW || !mapH) return empty;
	const Ia = integral(a, w, h, (v) => v);
	const Ib = integral(b, w, h, (v) => v);
	const Iaa = integral(a, w, h, (v) => v * v);
	const Ibb = integral(b, w, h, (v) => v * v);
	const Iab = integral(a, w, h, (v, i) => v * b[i]);
	const Im = mask ? integral(mask, w, h, (v) => (v ? 1 : 0)) : null;
	const n = win * win;
	const vals: number[] = [];
	let min = Infinity;
	let minAt = {x: 0, y: 0};
	for (let my = 0; my < mapH; my++) {
		const y0 = my * step;
		for (let mx = 0; mx < mapW; mx++) {
			const x0 = mx * step;
			if (Im && boxSum(Im, w, x0, y0, x0 + win, y0 + win) < minCover * n) continue;
			const sa = boxSum(Ia, w, x0, y0, x0 + win, y0 + win);
			const sb = boxSum(Ib, w, x0, y0, x0 + win, y0 + win);
			const ma = sa / n;
			const mb = sb / n;
			const va = Math.max(0, boxSum(Iaa, w, x0, y0, x0 + win, y0 + win) / n - ma * ma);
			const vb = Math.max(0, boxSum(Ibb, w, x0, y0, x0 + win, y0 + win) / n - mb * mb);
			const cov = boxSum(Iab, w, x0, y0, x0 + win, y0 + win) / n - ma * mb;
			const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
			map[my * mapW + mx] = s;
			vals.push(s);
			if (s < min) {
				min = s;
				minAt = {x: x0, y: y0};
			}
		}
	}
	if (!vals.length) return empty;
	vals.sort((p, q) => p - q);
	const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
	return {mean, min, minAt, p5: vals[Math.floor(0.05 * (vals.length - 1))], count: vals.length, map, mapW, mapH, step, win};
};

/** One channel (0 = R, 1 = G, 2 = B) of an RGBA buffer as floats. */
export const channel = (data: Uint8Array, n: number, k: 0 | 1 | 2): Float32Array => {
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) out[i] = data[i * 4 + k];
	return out;
};
