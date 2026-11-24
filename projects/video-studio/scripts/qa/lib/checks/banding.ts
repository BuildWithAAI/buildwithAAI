/**
 * Banding and blotch risk from rendered pixels (the DOM check catches the techniques at the source; this
 * catches them however they were drawn, including raster images).
 *
 *  - Gradient: a least-squares plane is fitted to the luma of every 32x32 block. A gradient block has a real
 *    slope (>= `minBlockChange` levels across the block), a dither-sized residual and no edge steps; flat cel
 *    fills have no slope and anti-aliased edges have large steps. Adjacent gradient blocks form regions; a
 *    region changing at least `minChange` levels is reported. Chrome dithers CSS gradients, which a plane fit
 *    tolerates. Every region is a gradient, blur, glow or vignette, which H.264/VP9/AV1 turn into bands
 *    (ART_GUIDE E2, N2).
 *  - Texture: 16x16 blocks whose luma is neither flat (4 dominant values cover < 82%) nor edge-dominated,
 *    outside text: noise, grain, halftone and photographic texture (blotches after compression, ART_GUIDE E3).
 */
import type {FrameFacts, Rect} from '../../../../src/qa/protocol.ts';
import {lightness} from '../color.ts';
import {components, luma, type Image} from '../image.ts';
import type {Finding} from '../issues.ts';
import {THRESHOLDS as T} from '../thresholds.ts';

const B = 16;
/** Gradient analysis block (px). */
export const GB = 32;

export type BlockFit = {change: number; residual: number; maxStep: number; range: number};

/**
 * Least-squares plane through one block's luma: the change across the block along the steepest direction,
 * the RMS residual (dither and noise), the largest neighbour step (edges) and the value range.
 */
export const fitBlock = (Y: Float32Array, w: number, x0: number, y0: number, bw: number, bh: number): BlockFit => {
	let n = 0;
	let sum = 0;
	for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) {
		sum += Y[y * w + x];
		n++;
	}
	const mean = sum / n;
	const cx = x0 + (bw - 1) / 2;
	const cy = y0 + (bh - 1) / 2;
	let sxy = 0;
	let syy = 0;
	let sxx = 0;
	let syv = 0;
	let lo = Infinity;
	let hi = -Infinity;
	let maxStep = 0;
	for (let y = y0; y < y0 + bh; y++)
		for (let x = x0; x < x0 + bw; x++) {
			const v = Y[y * w + x];
			const dx = x - cx;
			const dy = y - cy;
			sxy += dx * (v - mean);
			sxx += dx * dx;
			syv += dy * (v - mean);
			syy += dy * dy;
			if (v < lo) lo = v;
			if (v > hi) hi = v;
			if (x + 1 < x0 + bw) maxStep = Math.max(maxStep, Math.abs(Y[y * w + x + 1] - v));
			if (y + 1 < y0 + bh) maxStep = Math.max(maxStep, Math.abs(Y[(y + 1) * w + x] - v));
		}
	const bx = sxx ? sxy / sxx : 0;
	const by = syy ? syv / syy : 0;
	let res = 0;
	for (let y = y0; y < y0 + bh; y++)
		for (let x = x0; x < x0 + bw; x++) {
			const e = Y[y * w + x] - (mean + bx * (x - cx) + by * (y - cy));
			res += e * e;
		}
	return {change: Math.hypot(bx, by) * Math.max(bw, bh), residual: Math.sqrt(res / n), maxStep, range: hi - lo};
};

/** A gradient block: a real slope, a smooth (dither-sized) residual, no edges, no outliers. */
export const isGradientBlock = (f: BlockFit): boolean => {
	const G = T.gradient;
	return f.change >= G.minBlockChange && f.residual <= Math.max(G.maxResidual, 0.15 * f.change) && f.maxStep <= G.maxStep && f.range <= f.change + 3;
};

export type Prepared = {Y: Float32Array; grad: Uint8Array; gw: number; gh: number};

/** Luma and the gradient-block grid (GB px blocks) of a frame, shared by the gradient and texture checks. */
export const prepareFrame = (img: Image): Prepared => {
	const Y = luma(img);
	const {width: w, height: h} = img;
	const gw = Math.floor(w / GB);
	const gh = Math.floor(h / GB);
	const grad = new Uint8Array(gw * gh);
	for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) grad[by * gw + bx] = isGradientBlock(fitBlock(Y, w, bx * GB, by * GB, GB, GB)) ? 1 : 0;
	return {Y, grad, gw, gh};
};

const blockGrid = (w: number, h: number) => ({bw: Math.ceil(w / B), bh: Math.ceil(h / B)});

const textMask = (f: FrameFacts, w: number, h: number): Uint8Array => {
	const m = new Uint8Array(w * h);
	for (const t of f.texts)
		for (const r of t.rects) {
			const x0 = Math.max(0, Math.floor(r.x - 6));
			const y0 = Math.max(0, Math.floor(r.y - 6));
			const x1 = Math.min(w, Math.ceil(r.x + r.w + 6));
			const y1 = Math.min(h, Math.ceil(r.y + r.h + 6));
			for (let y = y0; y < y1; y++) m.fill(1, y * w + x0, y * w + x1);
		}
	return m;
};

type Region = {rect: Rect; blocks: number; meanRgb: [number, number, number]; lumaRange: number};

const regionsOf = (blockMask: Uint8Array, bw: number, bh: number, minBlocks: number, img: Image, Y: Float32Array | null, size = B): Region[] => {
	const {comps} = components(blockMask, bw, bh, minBlocks);
	return comps.map((c) => {
		const rect = {x: c.x0 * size, y: c.y0 * size, w: Math.min(img.width, c.x1 * size) - c.x0 * size, h: Math.min(img.height, c.y1 * size) - c.y0 * size};
		let r = 0;
		let g = 0;
		let b = 0;
		let n = 0;
		let lo = 255;
		let hi = 0;
		for (let y = rect.y; y < rect.y + rect.h; y += 2)
			for (let x = rect.x; x < rect.x + rect.w; x += 2) {
				const bi = Math.floor(y / size) * bw + Math.floor(x / size);
				if (!blockMask[bi]) continue;
				const i = (y * img.width + x) * 4;
				r += img.data[i];
				g += img.data[i + 1];
				b += img.data[i + 2];
				n++;
				if (Y) {
					const v = Y[y * img.width + x];
					if (v < lo) lo = v;
					if (v > hi) hi = v;
				}
			}
		return {rect, blocks: c.area, meanRgb: [r / Math.max(1, n), g / Math.max(1, n), b / Math.max(1, n)], lumaRange: Y ? Math.round(hi - lo) : 0};
	});
};

export const gradientFindings = (f: FrameFacts, P: Image, pre: Prepared = prepareFrame(P)): Finding[] => {
	const {width: w, height: h} = P;
	const tm = textMask(f, w, h);
	// gradient blocks that are not mostly text
	const blocks = new Uint8Array(pre.gw * pre.gh);
	for (let by = 0; by < pre.gh; by++)
		for (let bx = 0; bx < pre.gw; bx++) {
			if (!pre.grad[by * pre.gw + bx]) continue;
			let txt = 0;
			for (let y = by * GB; y < (by + 1) * GB; y += 4) for (let x = bx * GB; x < (bx + 1) * GB; x += 4) txt += tm[y * w + x];
			blocks[by * pre.gw + bx] = txt / ((GB / 4) * (GB / 4)) < 0.5 ? 1 : 0;
		}
	const regions = regionsOf(blocks, pre.gw, pre.gh, T.gradient.minBlocks, P, pre.Y, GB).filter((r) => r.lumaRange >= T.gradient.minChange);
	if (!regions.length) return [];
	// one finding per frame (a vignette or a soft shadow splits into many regions around the artwork)
	const area = regions.reduce((a, r) => a + r.blocks * GB * GB, 0);
	const frac = area / (w * h);
	const darkest = regions.reduce((a, r) => (lightness(r.meanRgb) < lightness(a.meanRgb) ? r : a));
	const L = lightness(darkest.meanRgb);
	const x0 = Math.min(...regions.map((r) => r.rect.x));
	const y0 = Math.min(...regions.map((r) => r.rect.y));
	const box = {x: x0, y: y0, w: Math.max(...regions.map((r) => r.rect.x + r.rect.w)) - x0, h: Math.max(...regions.map((r) => r.rect.y + r.rect.h)) - y0};
	const range = Math.max(...regions.map((r) => r.lumaRange));
	const sev = frac >= T.gradient.largeFrac || L < T.gradient.darkLstar ? 'error' : 'warn';
	return [
		{
			check: 'gradient' as const,
			severity: sev,
			frame: f.frame,
			box,
			subject: `${regions.length} gradient region${regions.length === 1 ? '' : 's'}`,
			key: 'gradient',
			message: `smooth ${L < T.gradient.darkLstar ? 'dark ' : ''}gradient in ${regions.length} region${regions.length === 1 ? '' : 's'} covering ${(frac * 100).toFixed(1)}% of the frame (darkest L* ${L.toFixed(0)}, luma range up to ${range}): it will band after YouTube's re-encode; use 2-3 flat steps (ART_GUIDE LS5)`,
			measured: {framePercent: Number((frac * 100).toFixed(2)), regions: regions.length, darkestLightness: Math.round(L), lumaRange: range},
			related: regions.slice(0, 8).map((r) => ({rect: r.rect, label: 'gradient'})),
			score: frac * (L < T.gradient.darkLstar ? 2 : 1),
		},
	];
};

export const textureFindings = (f: FrameFacts, P: Image, pre: Prepared = prepareFrame(P)): Finding[] => {
	const {width: w, height: h} = P;
	const Y = pre.Y;
	const tm = textMask(f, w, h);
	// characters carry their own detail (hair, beard, spots) and are checked by the off-model comparison
	for (const c of f.chars) {
		const x0 = Math.max(0, Math.floor(c.box.x - 4));
		const y0 = Math.max(0, Math.floor(c.box.y - 4));
		const x1 = Math.min(w, Math.ceil(c.box.x + c.box.w + 4));
		const y1 = Math.min(h, Math.ceil(c.box.y + c.box.h + 4));
		for (let y = y0; y < y1; y++) tm.fill(1, y * w + x0, y * w + x1);
	}
	const {bw, bh} = blockGrid(w, h);
	const blocks = new Uint8Array(bw * bh);
	const hist = new Uint32Array(256);
	for (let by = 0; by < bh; by++)
		for (let bx = 0; bx < bw; bx++) {
			hist.fill(0);
			let n = 0;
			let edges = 0;
			let steps = 0;
			let skip = false;
			for (let y = by * B; y < Math.min(h, (by + 1) * B) && !skip; y++)
				for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x++) {
					const i = y * w + x;
					if (tm[i]) {
						skip = true;
						break;
					}
					const v = Math.round(Y[i]);
					hist[v]++;
					n++;
					if (x + 1 < w) {
						steps++;
						if (Math.abs(Y[i + 1] - Y[i]) > T.texture.edgeStep) edges++;
					}
					if (y + 1 < h) {
						steps++;
						if (Math.abs(Y[i + w] - Y[i]) > T.texture.edgeStep) edges++;
					}
				}
			// smooth gradients belong to the gradient check
			const gx = Math.floor((bx * B) / GB);
			const gy = Math.floor((by * B) / GB);
			if (skip || n < B * B * 0.5 || (gx < pre.gw && gy < pre.gh && pre.grad[gy * pre.gw + gx])) continue;
			// coverage of the 4 most common values, +-2 levels
			const tops: number[] = [];
			const h2 = Array.from(hist);
			for (let k = 0; k < 4; k++) {
				let best = -1;
				let bi = -1;
				for (let v = 0; v < 256; v++) if (h2[v] > best) {
					best = h2[v];
					bi = v;
				}
				if (best <= 0) break;
				tops.push(bi);
				for (let v = Math.max(0, bi - 2); v <= Math.min(255, bi + 2); v++) h2[v] = 0;
			}
			let cov = 0;
			for (let v = 0; v < 256; v++) if (hist[v] && tops.some((t) => Math.abs(t - v) <= 2)) cov += hist[v];
			if (cov / n < T.texture.flatFrac && edges / Math.max(1, steps) < T.texture.maxEdgeFrac) blocks[by * bw + bx] = 1;
		}
	return regionsOf(blocks, bw, bh, T.texture.minBlocks, P, null).map((r) => {
		const frac = (r.blocks * B * B) / (w * h);
		return {
			check: 'texture' as const,
			severity: 'warn' as const,
			frame: f.frame,
			box: r.rect,
			subject: `texture at ${Math.round(r.rect.x)},${Math.round(r.rect.y)}`,
			key: `${Math.round(r.rect.x / 64)}:${Math.round(r.rect.y / 64)}`,
			message: `non-flat texture (noise, grain, halftone or photo) over ${(frac * 100).toFixed(1)}% of the frame: costs bits and turns blotchy after compression (ART_GUIDE E3)`,
			measured: {framePercent: Number((frac * 100).toFixed(2))},
			score: frac,
		};
	});
};
