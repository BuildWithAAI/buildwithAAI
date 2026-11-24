/**
 * RGBA8 raster helpers for the QA checker: crops, scaling, compositing, outlines, luma, binary-mask morphology
 * and connected components. Pure functions on {width, height, data}; no dependencies.
 */
import type {Rect} from '../../../src/qa/protocol.ts';
import type {Image} from './png.ts';

export type {Image};
export type RGBA = readonly [number, number, number, number];

export const blank = (width: number, height: number, rgba: RGBA = [0, 0, 0, 0]): Image => {
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
	return {width, height, data};
};

/** Integer pixel rect clamped to the image; null when empty. */
export const clampRect = (r: Rect, w: number, h: number): {x0: number; y0: number; x1: number; y1: number} | null => {
	const x0 = Math.max(0, Math.floor(r.x));
	const y0 = Math.max(0, Math.floor(r.y));
	const x1 = Math.min(w, Math.ceil(r.x + r.w));
	const y1 = Math.min(h, Math.ceil(r.y + r.h));
	return x1 > x0 && y1 > y0 ? {x0, y0, x1, y1} : null;
};

export const inflate = (r: Rect, d: number): Rect => ({x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d});

export const intersectRect = (a: Rect, b: Rect): Rect | null => {
	const x0 = Math.max(a.x, b.x);
	const y0 = Math.max(a.y, b.y);
	const x1 = Math.min(a.x + a.w, b.x + b.w);
	const y1 = Math.min(a.y + a.h, b.y + b.h);
	return x1 > x0 && y1 > y0 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : null;
};

export const rectArea = (r: Rect | null): number => (r ? Math.max(0, r.w) * Math.max(0, r.h) : 0);

export const unionRect = (rs: Rect[]): Rect | null => {
	if (!rs.length) return null;
	const x0 = Math.min(...rs.map((r) => r.x));
	const y0 = Math.min(...rs.map((r) => r.y));
	const x1 = Math.max(...rs.map((r) => r.x + r.w));
	const y1 = Math.max(...rs.map((r) => r.y + r.h));
	return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
};

export const crop = (img: Image, r: Rect): Image => {
	const c = clampRect(r, img.width, img.height);
	if (!c) return blank(1, 1);
	const w = c.x1 - c.x0;
	const h = c.y1 - c.y0;
	const out = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++) out.set(img.data.subarray(((c.y0 + y) * img.width + c.x0) * 4, ((c.y0 + y) * img.width + c.x1) * 4), y * w * 4);
	return {width: w, height: h, data: out};
};

/** Area-average downscale (or nearest upscale) to exactly width x height. */
export const resize = (img: Image, width: number, height: number): Image => {
	const out = new Uint8Array(width * height * 4);
	const sx = img.width / width;
	const sy = img.height / height;
	if (sx <= 1 && sy <= 1) {
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const si = (Math.min(img.height - 1, Math.floor(y * sy)) * img.width + Math.min(img.width - 1, Math.floor(x * sx))) * 4;
				out.set(img.data.subarray(si, si + 4), (y * width + x) * 4);
			}
		return {width, height, data: out};
	}
	for (let y = 0; y < height; y++) {
		const y0 = y * sy;
		const y1 = Math.min(img.height, (y + 1) * sy);
		for (let x = 0; x < width; x++) {
			const x0 = x * sx;
			const x1 = Math.min(img.width, (x + 1) * sx);
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let wsum = 0;
			for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
				const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
				for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
					const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
					const wgt = wx * wy;
					const i = (yy * img.width + xx) * 4;
					const al = img.data[i + 3] * wgt;
					r += img.data[i] * al;
					g += img.data[i + 1] * al;
					b += img.data[i + 2] * al;
					a += al;
					wsum += wgt;
				}
			}
			const o = (y * width + x) * 4;
			if (a > 0) {
				out[o] = Math.round(r / a);
				out[o + 1] = Math.round(g / a);
				out[o + 2] = Math.round(b / a);
			}
			out[o + 3] = wsum > 0 ? Math.round(a / wsum) : 0;
		}
	}
	return {width, height, data: out};
};

/** Scale to fit inside maxW x maxH, keeping the aspect ratio (never upscales beyond `maxUp`). */
export const fit = (img: Image, maxW: number, maxH: number, maxUp = 4): Image => {
	const s = Math.min(maxW / img.width, maxH / img.height, maxUp);
	return resize(img, Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s)));
};

/** Source-over compositing of `top` onto `base` at (x, y), in place. */
export const compositeOver = (base: Image, top: Image, x: number, y: number): Image => {
	for (let ty = 0; ty < top.height; ty++) {
		const by = ty + y;
		if (by < 0 || by >= base.height) continue;
		for (let tx = 0; tx < top.width; tx++) {
			const bx = tx + x;
			if (bx < 0 || bx >= base.width) continue;
			const ti = (ty * top.width + tx) * 4;
			const bi = (by * base.width + bx) * 4;
			const a = top.data[ti + 3] / 255;
			if (a <= 0) continue;
			const ba = base.data[bi + 3] / 255;
			const oa = a + ba * (1 - a);
			for (let k = 0; k < 3; k++) base.data[bi + k] = Math.round((top.data[ti + k] * a + base.data[bi + k] * ba * (1 - a)) / (oa || 1));
			base.data[bi + 3] = Math.round(oa * 255);
		}
	}
	return base;
};

/** A copy of `img` flattened over a solid colour (alpha becomes 255). */
export const flatten = (img: Image, bg: readonly [number, number, number]): Image => {
	const out = new Uint8Array(img.data.length);
	for (let i = 0; i < img.width * img.height; i++) {
		const a = img.data[i * 4 + 3] / 255;
		for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(img.data[i * 4 + k] * a + bg[k] * (1 - a));
		out[i * 4 + 3] = 255;
	}
	return {width: img.width, height: img.height, data: out};
};

/** Rectangle outline, in place (thickness grows inward from the rect, clipped to the image). */
export const strokeRect = (img: Image, r: Rect, color: RGBA, thickness = 3): Image => {
	const c = clampRect(r, img.width, img.height);
	if (!c) return img;
	const put = (x: number, y: number) => {
		if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
		const i = (y * img.width + x) * 4;
		const a = color[3] / 255;
		for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(color[k] * a + img.data[i + k] * (1 - a));
		img.data[i + 3] = 255;
	};
	for (let t = 0; t < thickness; t++) {
		for (let x = c.x0; x < c.x1; x++) {
			put(x, c.y0 + t);
			put(x, c.y1 - 1 - t);
		}
		for (let y = c.y0; y < c.y1; y++) {
			put(c.x0 + t, y);
			put(c.x1 - 1 - t, y);
		}
	}
	return img;
};

/** Side-by-side strip with a gap, on a solid background. */
export const hstack = (imgs: Image[], gap = 8, bg: RGBA = [32, 34, 38, 255]): Image => {
	const w = imgs.reduce((a, i) => a + i.width, 0) + gap * (imgs.length + 1);
	const h = Math.max(...imgs.map((i) => i.height)) + 2 * gap;
	const out = blank(w, h, bg);
	let x = gap;
	for (const i of imgs) {
		compositeOver(out, i, x, gap + Math.floor((h - 2 * gap - i.height) / 2));
		x += i.width + gap;
	}
	return out;
};

/** BT.709 luma of the sRGB values (0..255, gamma-encoded), as used for structure comparisons. */
export const luma = (img: Image): Float32Array => {
	const n = img.width * img.height;
	const y = new Float32Array(n);
	for (let i = 0; i < n; i++) y[i] = 0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2];
	return y;
};

/** Square dilation (Chebyshev radius r) of a 0/1 mask; separable running max. */
export const dilate = (mask: Uint8Array, w: number, h: number, r: number): Uint8Array => {
	if (r <= 0) return mask.slice();
	const tmp = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		// two sweeps: distance to the nearest set pixel on the left and on the right
		let prev = -Infinity;
		for (let x = 0; x < w; x++) {
			if (mask[y * w + x]) prev = x;
			if (x - prev <= r) tmp[y * w + x] = 1;
		}
		let next = Infinity;
		for (let x = w - 1; x >= 0; x--) {
			if (mask[y * w + x]) next = x;
			if (next - x <= r) tmp[y * w + x] = 1;
		}
	}
	const out = new Uint8Array(w * h);
	for (let x = 0; x < w; x++) {
		let prev = -Infinity;
		for (let y = 0; y < h; y++) {
			if (tmp[y * w + x]) prev = y;
			if (y - prev <= r) out[y * w + x] = 1;
		}
		let next = Infinity;
		for (let y = h - 1; y >= 0; y--) {
			if (tmp[y * w + x]) next = y;
			if (next - y <= r) out[y * w + x] = 1;
		}
	}
	return out;
};

export const erode = (mask: Uint8Array, w: number, h: number, r: number): Uint8Array => {
	const inv = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
	const d = dilate(inv, w, h, r);
	const out = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) out[i] = d[i] ? 0 : 1;
	return out;
};

export type Component = {label: number; area: number; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number};

/** 8-connected components of a 0/1 mask (iterative flood fill). */
export const components = (mask: Uint8Array, w: number, h: number, minArea = 1): {labels: Int32Array; comps: Component[]} => {
	const labels = new Int32Array(w * h);
	const comps: Component[] = [];
	const stack = new Int32Array(w * h);
	let next = 1;
	for (let start = 0; start < w * h; start++) {
		if (!mask[start] || labels[start]) continue;
		const label = next++;
		let sp = 0;
		stack[sp++] = start;
		labels[start] = label;
		let area = 0;
		let x0 = w;
		let y0 = h;
		let x1 = -1;
		let y1 = -1;
		let sx = 0;
		let sy = 0;
		while (sp > 0) {
			const p = stack[--sp];
			const x = p % w;
			const y = (p - x) / w;
			area++;
			sx += x;
			sy += y;
			if (x < x0) x0 = x;
			if (y < y0) y0 = y;
			if (x > x1) x1 = x;
			if (y > y1) y1 = y;
			for (let dy = -1; dy <= 1; dy++) {
				const yy = y + dy;
				if (yy < 0 || yy >= h) continue;
				for (let dx = -1; dx <= 1; dx++) {
					const xx = x + dx;
					if ((dx === 0 && dy === 0) || xx < 0 || xx >= w) continue;
					const q = yy * w + xx;
					if (mask[q] && !labels[q]) {
						labels[q] = label;
						stack[sp++] = q;
					}
				}
			}
		}
		if (area >= minArea) comps.push({label, area, x0, y0, x1: x1 + 1, y1: y1 + 1, cx: sx / area, cy: sy / area});
	}
	return {labels, comps};
};

