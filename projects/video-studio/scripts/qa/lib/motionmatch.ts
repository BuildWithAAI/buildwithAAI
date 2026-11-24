/**
 * Motion-compensated matching for the flicker check. A pop region is a patch of frame t that differs from both
 * neighbours while they agree with each other. That is a one-frame state only if the patch's content is in neither
 * neighbour. A card dropping in fast, or a layer sliding over a background of the same colour, produces the same
 * pixel pattern, but its content is in a neighbour, displaced. This module finds that displacement.
 *
 * Search: a luma pyramid (2x2 box averages), an exhaustive search at the coarsest level that keeps the best few
 * candidates, a +-1 refinement on every finer level, then a full-resolution test that tolerates sub-pixel motion:
 * a pixel matches when it lies within the min-max envelope of the other frame's 3x3 neighbourhood (plus a small
 * tolerance), so anti-aliased edges at fractional positions still match.
 */
import type {Image} from './png.ts';

export type Plane = {w: number; h: number; v: Float32Array};

/** Luma plane (Rec. 709 weights) of an RGBA image. */
export const planeOf = (img: Image): Plane => {
	const n = img.width * img.height;
	const v = new Float32Array(n);
	for (let i = 0; i < n; i++) v[i] = 0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2];
	return {w: img.width, h: img.height, v};
};

/** Half size by 2x2 box averages (the last odd row or column is dropped). */
export const down2 = (p: Plane): Plane => {
	const w = Math.max(1, p.w >> 1);
	const h = Math.max(1, p.h >> 1);
	const v = new Float32Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = 2 * y * p.w + 2 * x;
			const right = 2 * x + 1 < p.w ? 1 : 0;
			const down = 2 * y + 1 < p.h ? p.w : 0;
			v[y * w + x] = (p.v[i] + p.v[i + right] + p.v[i + down] + p.v[i + down + right]) / 4;
		}
	return {w, h, v};
};

/** Per-pixel minimum and maximum over the 3x3 neighbourhood. */
export const envelope3 = (p: Plane): {lo: Float32Array; hi: Float32Array} => {
	const {w, h, v} = p;
	const lo = new Float32Array(w * h);
	const hi = new Float32Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let a = Infinity;
			let b = -Infinity;
			for (let dy = -1; dy <= 1; dy++) {
				const yy = y + dy;
				if (yy < 0 || yy >= h) continue;
				for (let dx = -1; dx <= 1; dx++) {
					const xx = x + dx;
					if (xx < 0 || xx >= w) continue;
					const s = v[yy * w + xx];
					if (s < a) a = s;
					if (s > b) b = s;
				}
			}
			lo[y * w + x] = a;
			hi[y * w + x] = b;
		}
	return {lo, hi};
};

/** A frame prepared for searching: its pyramid (level 0 = full size) and, lazily, its 3x3 envelope. */
export class Searchable {
	readonly levels: Plane[];
	private env: {lo: Float32Array; hi: Float32Array} | null = null;
	constructor(img: Image, maxLevels = 6) {
		this.levels = [planeOf(img)];
		while (this.levels.length < maxLevels) {
			const top = this.levels[this.levels.length - 1];
			if (top.w < 16 || top.h < 16) break;
			this.levels.push(down2(top));
		}
	}
	envelope(): {lo: Float32Array; hi: Float32Array} {
		if (!this.env) this.env = envelope3(this.levels[0]);
		return this.env;
	}
}

/** Integer box in full-resolution pixels, [x0, x1) x [y0, y1). */
export type Box = {x0: number; y0: number; x1: number; y1: number};

/** The mask at level `l`: a level pixel is set when any full-resolution pixel under it is set. */
const maskAt = (mask: Uint8Array, box: Box, l: number): {m: Uint8Array; x0: number; y0: number; w: number; h: number; n: number} => {
	const s = 1 << l;
	const x0 = Math.floor(box.x0 / s);
	const y0 = Math.floor(box.y0 / s);
	const x1 = Math.ceil(box.x1 / s);
	const y1 = Math.ceil(box.y1 / s);
	const w = Math.max(1, x1 - x0);
	const h = Math.max(1, y1 - y0);
	const m = new Uint8Array(w * h);
	const bw = box.x1 - box.x0;
	for (let y = box.y0; y < box.y1; y++)
		for (let x = box.x0; x < box.x1; x++) if (mask[(y - box.y0) * bw + (x - box.x0)]) m[(Math.floor(y / s) - y0) * w + (Math.floor(x / s) - x0)] = 1;
	let n = 0;
	for (let i = 0; i < m.length; i++) n += m[i];
	return {m, x0, y0, w, h, n};
};

/** Mean |a - b| over the masked pixels with b displaced by (dx, dy); Infinity when the window leaves the frame. */
const madAt = (a: Plane, b: Plane, mk: ReturnType<typeof maskAt>, dx: number, dy: number, cap: number): number => {
	if (mk.x0 + dx < 0 || mk.y0 + dy < 0 || mk.x0 + mk.w + dx > b.w || mk.y0 + mk.h + dy > b.h) return Infinity;
	if (mk.x0 < 0 || mk.y0 < 0 || mk.x0 + mk.w > a.w || mk.y0 + mk.h > a.h) return Infinity;
	let s = 0;
	const limit = cap * mk.n;
	for (let y = 0; y < mk.h; y++) {
		const ra = (mk.y0 + y) * a.w + mk.x0;
		const rb = (mk.y0 + y + dy) * b.w + mk.x0 + dx;
		for (let x = 0; x < mk.w; x++) {
			if (!mk.m[y * mk.w + x]) continue;
			s += Math.abs(a.v[ra + x] - b.v[rb + x]);
		}
		if (s > limit) return Infinity;
	}
	return mk.n ? s / mk.n : Infinity;
};

export type DisplacedMatch = {dx: number; dy: number; share: number};

/**
 * Where, if anywhere, the masked content of `cur` inside `box` appears in `other`, displaced by at most `range` px
 * (the zero displacement included). Returns the displacement with the highest share of masked pixels that lie
 * inside `other`'s 3x3 envelope at that displacement (+-tol levels), or null when no candidate stays in the frame.
 */
export const findDisplaced = (cur: Searchable, other: Searchable, box: Box, mask: Uint8Array, range: number, tol = 12, keep = 12): DisplacedMatch | null => {
	const maxL = Math.min(cur.levels.length, other.levels.length) - 1;
	let L = 0;
	while (L < maxL && range / (1 << L) > 24) L++;
	const R = Math.ceil(range / (1 << L));
	const mkL = maskAt(mask, box, L);
	if (!mkL.n) return null;
	// coarse: exhaustive, keep the best `keep` candidates at least 2 level-pixels apart
	const cands: Array<{dx: number; dy: number; mad: number}> = [];
	for (let dy = -R; dy <= R; dy++)
		for (let dx = -R; dx <= R; dx++) {
			const worst = cands.length >= keep * 4 ? cands[cands.length - 1].mad : Infinity;
			const m = madAt(cur.levels[L], other.levels[L], mkL, dx, dy, Math.min(worst, 255));
			if (!Number.isFinite(m)) continue;
			cands.push({dx, dy, mad: m});
			if (cands.length > keep * 8) {
				cands.sort((p, q) => p.mad - q.mad);
				cands.length = keep * 4;
			}
		}
	cands.sort((p, q) => p.mad - q.mad);
	const seeds: Array<{dx: number; dy: number}> = [];
	for (const c of cands) {
		if (seeds.length >= keep) break;
		if (seeds.some((s) => Math.abs(s.dx - c.dx) <= 1 && Math.abs(s.dy - c.dy) <= 1)) continue;
		seeds.push({dx: c.dx, dy: c.dy});
	}
	if (!seeds.length) return null;
	// refine every seed down the pyramid (+-1 at each level)
	const masks = new Map<number, ReturnType<typeof maskAt>>();
	const mk = (l: number) => {
		let m = masks.get(l);
		if (!m) {
			m = maskAt(mask, box, l);
			masks.set(l, m);
		}
		return m;
	};
	const refined: Array<{dx: number; dy: number}> = [];
	for (const s of seeds) {
		let {dx, dy} = s;
		for (let l = L - 1; l >= 0; l--) {
			dx *= 2;
			dy *= 2;
			let best = {dx, dy, mad: Infinity};
			for (let ey = -1; ey <= 1; ey++)
				for (let ex = -1; ex <= 1; ex++) {
					const m = madAt(cur.levels[l], other.levels[l], mk(l), dx + ex, dy + ey, Math.min(best.mad, 255));
					if (m < best.mad) best = {dx: dx + ex, dy: dy + ey, mad: m};
				}
			dx = best.dx;
			dy = best.dy;
		}
		if (!refined.some((r) => r.dx === dx && r.dy === dy)) refined.push({dx, dy});
	}
	// full resolution: envelope share at each refined candidate
	const a = cur.levels[0];
	const b = other.levels[0];
	const {lo, hi} = other.envelope();
	const bw = box.x1 - box.x0;
	let best: DisplacedMatch | null = null;
	for (const {dx, dy} of refined) {
		let n = 0;
		let ok = 0;
		for (let y = box.y0; y < box.y1; y++)
			for (let x = box.x0; x < box.x1; x++) {
				if (!mask[(y - box.y0) * bw + (x - box.x0)]) continue;
				n++;
				const xx = x + dx;
				const yy = y + dy;
				if (xx < 0 || yy < 0 || xx >= b.w || yy >= b.h) continue;
				const v = a.v[y * a.w + x];
				const k = yy * b.w + xx;
				if (v >= lo[k] - tol && v <= hi[k] + tol) ok++;
			}
		const share = n ? ok / n : 0;
		if (!best || share > best.share) best = {dx, dy, share};
	}
	return best;
};
