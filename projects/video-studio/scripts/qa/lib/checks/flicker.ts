/**
 * Mid-scene flicker from frame-to-frame differences.
 *  - Full size (consecutive sampled frames t-1, t, t+1): a pixel "pops" when frame t differs from both
 *    neighbours while the neighbours agree, i.e. a one-frame state. Pop regions over `minArea` px are errors.
 *    A whole-frame mean-luma A-B-A is a flash.
 *  - Scout (1/8 scale, every frame): the same test, coarse, to pick the triplets worth rendering at full size,
 *    plus cut detection (a large share of the frame changes at once) so scene boundaries get sampled and cuts
 *    are never mistaken for flicker.
 */
import type {FrameFacts} from '../../../../src/qa/protocol.ts';
import {components, type Image} from '../image.ts';
import type {Finding} from '../issues.ts';
import {THRESHOLDS as T} from '../thresholds.ts';

export type LumaFrame = {w: number; h: number; y: Uint8Array};

/** Luma of an RGBA image (8-bit). */
export const lumaFrame = (img: Image): LumaFrame => {
	const n = img.width * img.height;
	const y = new Uint8Array(n);
	for (let i = 0; i < n; i++) y[i] = Math.round(0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2]);
	return {w: img.width, h: img.height, y};
};

const meanLuma = (img: Image): number => {
	let s = 0;
	const n = img.width * img.height;
	for (let i = 0; i < n; i++) s += 0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2];
	return s / n;
};

export const flickerFindings = (t: number, prev: Image, cur: Image, next: Image, facts: FrameFacts | undefined): Finding[] => {
	const out: Finding[] = [];
	const {width: w, height: h} = cur;
	const pop = new Uint8Array(w * h);
	let any = 0;
	for (let i = 0; i < w * h; i++) {
		const o = i * 4;
		let d1 = 0;
		let d2 = 0;
		let d0 = 0;
		for (let k = 0; k < 3; k++) {
			d1 = Math.max(d1, Math.abs(cur.data[o + k] - prev.data[o + k]));
			d2 = Math.max(d2, Math.abs(cur.data[o + k] - next.data[o + k]));
			d0 = Math.max(d0, Math.abs(next.data[o + k] - prev.data[o + k]));
		}
		if (d1 > T.flicker.diff && d2 > T.flicker.diff && d0 <= T.flicker.back) {
			pop[i] = 1;
			any++;
		}
	}
	if (any >= T.flicker.minArea) {
		// merge nearby pixels: components on a 4x4-downsampled grid
		const gw = Math.ceil(w / 4);
		const gh = Math.ceil(h / 4);
		const grid = new Uint8Array(gw * gh);
		const count = new Uint32Array(gw * gh);
		for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pop[y * w + x]) count[Math.floor(y / 4) * gw + Math.floor(x / 4)]++;
		for (let i = 0; i < gw * gh; i++) grid[i] = count[i] > 0 ? 1 : 0;
		const {comps} = components(grid, gw, gh, 1);
		// one finding per frame: the pop regions that are not motion, merged
		let total = 0;
		const boxes: Array<{x: number; y: number; w: number; h: number}> = [];
		for (const c of comps) {
			let area = 0;
			for (let y = c.y0; y < c.y1; y++) for (let x = c.x0; x < c.x1; x++) area += count[y * gw + x];
			if (area < T.flicker.minArea) continue;
			const box = {x: c.x0 * 4, y: c.y0 * 4, w: (c.x1 - c.x0) * 4, h: (c.y1 - c.y0) * 4};
			// motion, not flicker: around the pop, the neighbours differ from each other too (something moved
			// through: an arm swing, a head turn). A true one-frame state sits on an otherwise unchanged area.
			const m = motionAround(box, prev, next, w, h);
			if (m.moving >= T.flicker.motionRatio * area) continue;
			total += area;
			boxes.push(box);
		}
		if (boxes.length) {
			const x0 = Math.min(...boxes.map((b) => b.x));
			const y0 = Math.min(...boxes.map((b) => b.y));
			const box = {x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0};
			const what = facts ? describe(box, facts) : '';
			out.push({
				check: 'flicker',
				severity: 'error',
				frame: t,
				box,
				subject: `frame ${t}${what ? ` (${what})` : ''}`,
				key: `${Math.round(box.x / 48)}:${Math.round(box.y / 48)}`,
				message: `${total} px in ${boxes.length} region${boxes.length === 1 ? '' : 's'} differ in frame ${t} from both frame ${t - 1} and frame ${t + 1}, which match each other: a one-frame state${what ? ` on ${what}` : ''}`,
				measured: {px: total, regions: boxes.length},
				score: total,
				thumb: {kind: 'triplet'},
			});
		}
	}
	const [m0, m1, m2] = [meanLuma(prev), meanLuma(cur), meanLuma(next)];
	if (Math.abs(m1 - m0) > T.flicker.flashLuma && Math.abs(m1 - m2) > T.flicker.flashLuma && Math.abs(m2 - m0) < T.flicker.flashLuma / 3) {
		// the flash is the defect: drop the pop finding of the same frame
		out.length = 0;
		out.push({
			check: 'flash',
			severity: 'error',
			frame: t,
			box: {x: 0, y: 0, w, h},
			subject: `frame ${t}`,
			key: `flash`,
			message: `mean brightness jumps ${(m1 - m0).toFixed(1)} levels for one frame (neighbours ${m0.toFixed(1)} / ${m2.toFixed(1)})`,
			measured: {mean: Number(m1.toFixed(1)), prev: Number(m0.toFixed(1)), next: Number(m2.toFixed(1))},
			score: Math.abs(m1 - m0),
			thumb: {kind: 'triplet'},
		});
	}
	return out;
};

/** Pixels around `box` (inflated by half its size, at least 16 px) where the two neighbours differ. */
export const motionAround = (box: {x: number; y: number; w: number; h: number}, prev: Image, next: Image, w: number, h: number): {moving: number; area: number} => {
	const pad = Math.max(16, Math.round(0.5 * Math.max(box.w, box.h)));
	const x0 = Math.max(0, box.x - pad);
	const y0 = Math.max(0, box.y - pad);
	const x1 = Math.min(w, box.x + box.w + pad);
	const y1 = Math.min(h, box.y + box.h + pad);
	let moving = 0;
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			const o = (y * w + x) * 4;
			if (Math.max(Math.abs(prev.data[o] - next.data[o]), Math.abs(prev.data[o + 1] - next.data[o + 1]), Math.abs(prev.data[o + 2] - next.data[o + 2])) > T.flicker.diff) moving++;
		}
	return {moving, area: (x1 - x0) * (y1 - y0)};
};

/** What a box overlaps, from the frame's DOM facts (for messages). */
const describe = (box: {x: number; y: number; w: number; h: number}, f: FrameFacts): string => {
	const hits: string[] = [];
	const over = (r: {x: number; y: number; w: number; h: number}) => r.x < box.x + box.w && box.x < r.x + r.w && r.y < box.y + box.h && box.y < r.y + r.h;
	f.chars.forEach((c, i) => {
		if (c.headBox && over(c.headBox)) hits.push(`${c.kind === 'zoo' ? 'Zoo' : 'Badger'} #${i + 1} head`);
		else if (over(c.box)) hits.push(`${c.kind === 'zoo' ? 'Zoo' : 'Badger'} #${i + 1}`);
	});
	for (const t of f.texts) if (over(t.box) && hits.length < 3) hits.push(`text "${t.text.slice(0, 24)}"`);
	return hits.slice(0, 3).join(', ');
};

export type ScoutAnalysis = {
	/** Frames that differ from the previous scouted frame in a large share of pixels. */
	changed: number[];
	/**
	 * Boundaries as [s, e]: a hard cut is [t, t] (frame t starts the next scene); a transition (cross-fade,
	 * wipe, slide) is a run of changed frames [s, e]: s..e-1 are in between, e is the first frame of the next scene.
	 */
	boundaries: Array<[number, number]>;
	/** Coarse one-frame pop candidates, strongest first. */
	popCandidates: number[];
	meanDiff: Map<number, number>;
	/** Fraction of pixels changing by more than 16 levels vs the previous frame. */
	changedFrac: Map<number, number>;
};

/** Cuts, transitions and coarse pop candidates from the low-resolution scout frames (consecutive frames only). */
export const analyseScout = (frames: Map<number, LumaFrame>, maxPops = 12): ScoutAnalysis => {
	const keys = [...frames.keys()].sort((a, b) => a - b);
	const changed: number[] = [];
	const pops: Array<{t: number; n: number}> = [];
	const meanDiff = new Map<number, number>();
	const changedFrac = new Map<number, number>();
	for (const t of keys) {
		const a = frames.get(t - 1);
		const b = frames.get(t) as LumaFrame;
		if (!a || a.w !== b.w || a.h !== b.h) continue;
		let ch = 0;
		let sum = 0;
		for (let i = 0; i < b.y.length; i++) {
			const d = Math.abs(b.y[i] - a.y[i]);
			sum += d;
			if (d > 16) ch++;
		}
		meanDiff.set(t, sum / b.y.length);
		changedFrac.set(t, ch / b.y.length);
		if (ch / b.y.length >= T.scout.cutChanged) changed.push(t);
	}
	const boundaries: Array<[number, number]> = [];
	for (const t of changed) {
		const last = boundaries[boundaries.length - 1];
		if (last && t === last[1] + 1) last[1] = t;
		else boundaries.push([t, t]);
	}
	// a multi-frame run is a cross-fade or wipe: its last changed frame can still be blending, so the next
	// scene is taken to start one frame later (a hard cut stays [t, t])
	for (const b of boundaries) if (b[1] > b[0]) b[1] += 1;
	// slides and pushes move whole scenes over flat backgrounds: a sustained run of moderate change. Hysteresis:
	// a span starts at motionSpanChanged and continues while the change stays above motionSpanHold (an eased
	// slide dips for a frame or two), and needs at least motionSpanFrames frames.
	let run: number[] = [];
	let strong = 0;
	const flush = () => {
		if (run.length >= T.scout.motionSpanFrames && strong >= 3) {
			const s0 = run[0];
			const e0 = run[run.length - 1] + 2; // one settling frame after the last moving one
			// a slide that starts or ends with a cut extends that boundary instead of being dropped
			const hit = boundaries.find(([a, b]) => a <= e0 && s0 <= b);
			if (hit) {
				hit[0] = Math.min(hit[0], s0);
				hit[1] = Math.max(hit[1], e0);
			} else boundaries.push([s0, e0]);
		}
		run = [];
		strong = 0;
	};
	for (const t of keys) {
		const cf = changedFrac.get(t);
		const contiguous = run.length > 0 && run[run.length - 1] === t - 1;
		if (cf !== undefined && contiguous && cf >= T.scout.motionSpanHold) {
			run.push(t);
			if (cf >= T.scout.motionSpanChanged) strong++;
			continue;
		}
		flush();
		if (cf !== undefined && cf >= T.scout.motionSpanChanged) {
			run.push(t);
			strong = 1;
		}
	}
	flush();
	boundaries.sort((a, b) => a[0] - b[0]);
	for (const t of keys) {
		const a = frames.get(t - 1);
		const b = frames.get(t) as LumaFrame;
		const c = frames.get(t + 1);
		if (!a || !c) continue;
		let n = 0;
		const W = b.w;
		for (let i = 0; i < b.y.length; i++) {
			if (!(Math.abs(b.y[i] - a.y[i]) > T.scout.popDiff && Math.abs(b.y[i] - c.y[i]) > T.scout.popDiff && Math.abs(c.y[i] - a.y[i]) < T.scout.popBack)) continue;
			// skip pops next to motion (the neighbours differ within 2 px at this scale)
			const x = i % W;
			const y = (i - x) / W;
			let moving = false;
			for (let dy = -2; dy <= 2 && !moving; dy++)
				for (let dx = -2; dx <= 2; dx++) {
					const xx = x + dx;
					const yy = y + dy;
					if (xx < 0 || yy < 0 || xx >= W || yy >= b.h) continue;
					const k = yy * W + xx;
					if (Math.abs(c.y[k] - a.y[k]) > T.scout.popDiff) {
						moving = true;
						break;
					}
				}
			if (!moving) n++;
		}
		if (n >= T.scout.popMinPx) pops.push({t, n});
	}
	pops.sort((p, q) => q.n - p.n);
	return {changed, boundaries, popCandidates: pops.slice(0, maxPops).map((p) => p.t), meanDiff, changedFrac};
};

/** Frames inside transitions (between two scenes), from the scout boundaries. */
export const transitionFrames = (boundaries: Array<[number, number]>): Set<number> => {
	const s = new Set<number>();
	for (const [a, b] of boundaries) for (let f = a; f < b; f++) s.add(f);
	return s;
};
