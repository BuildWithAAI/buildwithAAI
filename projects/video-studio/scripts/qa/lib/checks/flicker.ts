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
import {components, dilate, type Image} from '../image.ts';
import type {Finding} from '../issues.ts';
import {findDisplaced, matchAt, Searchable, type Box, type DisplacedMatch} from '../motionmatch.ts';
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

/** The probe's facts for the neighbouring frames: their text and character boxes give exact motion hypotheses. */
export type NeighbourFacts = {prev?: FrameFacts; next?: FrameFacts};

export const flickerFindings = (t: number, prev: Image, cur: Image, next: Image, facts: FrameFacts | undefined, around: NeighbourFacts = {}): Finding[] => {
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
		// fragments within a few cells (glyph pieces, edge slivers) form one region: a word or a line can be found
		// again in a neighbour, a 20 x 8 px sliver cannot
		const regions = popRegions(grid, count, gw, gh, T.flicker.mergeCells);
		// motion, not flicker: around the pop, the neighbours differ from each other too (something moved through:
		// an arm swing, a head turn). A true one-frame state sits on an otherwise unchanged area.
		// A region on a character's head or hand that the probe saw move (an arm swing, a head turn) is animation:
		// a fast, turning hand is somewhere else on every frame, so neither test above can see it as motion.
		const live = regions.filter((r) => r.area >= T.flicker.minArea && motionAround(r.box, prev, next, w, h).moving < T.flicker.motionRatio * r.area && !onMovingPart(r.box, facts, around));
		// one finding per frame: the pop regions that are not motion, merged
		let total = 0;
		const boxes: Array<{x: number; y: number; w: number; h: number}> = [];
		const jumps: number[] = [];
		if (live.length) {
			// fast motion over a background of the same colour (a card dropping in, a slide): the content of frame t is
			// in a neighbour, displaced. A card moves as one, so the motion of all the popped content together, and the
			// probe's own text and character boxes, are tested on every region before its own search.
			const search = new LazyTriplet(prev, cur, next);
			const seeds = motionSeeds(search, pop, w, h, live.map((r) => r.box), facts, around);
			for (const r of live) {
				const v = popVerdict(search, pop, w, h, r.box, seeds);
				if (v.kind === 'motion') continue;
				if (v.kind === 'jump') jumps.push(v.px);
				total += r.area;
				boxes.push(r.box);
			}
		}
		if (boxes.length) {
			const x0 = Math.min(...boxes.map((b) => b.x));
			const y0 = Math.min(...boxes.map((b) => b.y));
			const box = {x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0};
			const what = facts ? describe(box, facts) : '';
			const jumpPx = jumps.length ? [...jumps].sort((a, b) => a - b)[Math.floor(jumps.length / 2)] : 0;
			const jumpNote = jumps.length ? `; ${jumps.length === boxes.length ? 'it is' : `${jumps.length} of them are`} the same content displaced about ${jumpPx} px for one frame (a jump and return)` : '';
			out.push({
				check: 'flicker',
				severity: 'error',
				frame: t,
				box,
				subject: `frame ${t}${what ? ` (${what})` : ''}`,
				key: `${Math.round(box.x / 48)}:${Math.round(box.y / 48)}`,
				message: `${total} px in ${boxes.length} region${boxes.length === 1 ? '' : 's'} differ in frame ${t} from both frame ${t - 1} and frame ${t + 1}, which match each other: a one-frame state${what ? ` on ${what}` : ''}${jumpNote}`,
				measured: {px: total, regions: boxes.length, ...(jumpPx ? {jumpPx} : {})},
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

type R4 = {x: number; y: number; w: number; h: number};
const overlaps = (a: R4, b: R4) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const shift = (a: R4, b: R4) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));

/**
 * True when `box` lies on a head or hand that moves across the triplet (its box at t-1, t and t+1 differs by at
 * least `partMovePx`), from the probe's facts. Whole-body boxes are not used: an arm swing changes Zoo's box, and a
 * glitch on his face must still be seen.
 */
export const onMovingPart = (box: R4, f: FrameFacts | undefined, around: NeighbourFacts): boolean => {
	if (!f || !around.prev || !around.next) return false;
	for (const c of f.chars) {
		const p = around.prev.chars.find((x) => x.key === c.key);
		const n = around.next.chars.find((x) => x.key === c.key);
		if (!p || !n) continue;
		const parts: Array<[R4, R4, R4]> = [];
		if (c.headBox && p.headBox && n.headBox) parts.push([c.headBox, p.headBox, n.headBox]);
		if (c.hands.length === p.hands.length && c.hands.length === n.hands.length) c.hands.forEach((hb, k) => parts.push([hb, p.hands[k], n.hands[k]]));
		for (const [at, before, after] of parts) if (overlaps(at, box) && Math.max(shift(at, before), shift(at, after)) >= T.flicker.partMovePx) return true;
	}
	return false;
};

/** Search pyramids of a frame triplet, built on first use (most frames have no pop region at all). */
export class LazyTriplet {
	private s: [Searchable, Searchable, Searchable] | null = null;
	private readonly frames: [Image, Image, Image];
	constructor(prev: Image, cur: Image, next: Image) {
		this.frames = [prev, cur, next];
	}
	get(): [Searchable, Searchable, Searchable] {
		if (!this.s) this.s = [new Searchable(this.frames[0]), new Searchable(this.frames[1]), new Searchable(this.frames[2])];
		return this.s;
	}
}

export type PopVerdict = {kind: 'state'} | {kind: 'motion'} | {kind: 'jump'; px: number};

type Seed = {dx: number; dy: number};
export type Seeds = {prev: Seed[]; next: Seed[]};

type PopRegion = {box: {x: number; y: number; w: number; h: number}; area: number};

/** Pop regions: connected cells of the 4 px grid after joining cells up to `merge` apart; area = popped pixels. */
export const popRegions = (grid: Uint8Array, count: Uint32Array, gw: number, gh: number, merge: number): PopRegion[] => {
	const joined = merge > 0 ? dilate(grid, gw, gh, merge) : grid;
	const {labels} = components(joined, gw, gh, 1);
	const acc = new Map<number, {x0: number; y0: number; x1: number; y1: number; area: number}>();
	for (let y = 0; y < gh; y++)
		for (let x = 0; x < gw; x++) {
			const i = y * gw + x;
			if (!count[i]) continue;
			const l = labels[i];
			const a = acc.get(l);
			if (a) {
				a.x0 = Math.min(a.x0, x);
				a.y0 = Math.min(a.y0, y);
				a.x1 = Math.max(a.x1, x + 1);
				a.y1 = Math.max(a.y1, y + 1);
				a.area += count[i];
			} else acc.set(l, {x0: x, y0: y, x1: x + 1, y1: y + 1, area: count[i]});
		}
	return [...acc.values()].map((a) => ({box: {x: a.x0 * 4, y: a.y0 * 4, w: (a.x1 - a.x0) * 4, h: (a.y1 - a.y0) * 4}, area: a.area}));
};

/** Box-local masks of a region: the popped pixels (core) and the core plus `contextPx` around it. */
const regionMasks = (pop: Uint8Array, w: number, h: number, box: {x: number; y: number; w: number; h: number}) => {
	const F = T.flicker;
	const b: Box = {x0: Math.max(0, box.x - F.contextPx), y0: Math.max(0, box.y - F.contextPx), x1: Math.min(w, box.x + box.w + F.contextPx), y1: Math.min(h, box.y + box.h + F.contextPx)};
	const bw = Math.max(0, b.x1 - b.x0);
	const bh = Math.max(0, b.y1 - b.y0);
	const core = new Uint8Array(bw * bh);
	for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (pop[y * w + x]) core[(y - b.y0) * bw + (x - b.x0)] = 1;
	return {b, bw, bh, core, mask: dilate(core, bw, bh, F.contextPx)};
};

/**
 * Motion hypotheses shared by every region of the frame: where the probe saw each text and character in the
 * neighbouring frames (exact for anything the DOM tracks), and where the popped content as a whole is found in
 * each neighbour (one large, distinctive patch: a card's text and edges move together).
 */
export const motionSeeds = (search: LazyTriplet, pop: Uint8Array, w: number, h: number, boxes: Array<{x: number; y: number; w: number; h: number}>, facts: FrameFacts | undefined, around: NeighbourFacts): Seeds => {
	const seeds: Seeds = {prev: [], next: []};
	const add = (list: Seed[], dx: number, dy: number) => {
		if (Math.hypot(dx, dy) < 1 || list.some((s) => Math.abs(s.dx - dx) <= 1 && Math.abs(s.dy - dy) <= 1)) return;
		list.push({dx: Math.round(dx), dy: Math.round(dy)});
	};
	if (facts)
		for (const [side, nf] of [['prev', around.prev], ['next', around.next]] as const) {
			if (!nf) continue;
			const texts = new Map(nf.texts.map((x) => [`${x.path}|${x.text}`, x.box] as const));
			for (const x of facts.texts) {
				const o = texts.get(`${x.path}|${x.text}`);
				if (o) add(seeds[side], o.x - x.box.x, o.y - x.box.y);
			}
			const chars = new Map(nf.chars.map((c) => [c.key, c.box] as const));
			for (const c of facts.chars) {
				const o = chars.get(c.key);
				if (o) add(seeds[side], o.x - c.box.x, o.y - c.box.y);
			}
			if (seeds[side].length > 24) seeds[side].length = 24;
		}
	if (boxes.length > 1) {
		const x0 = Math.min(...boxes.map((b) => b.x));
		const y0 = Math.min(...boxes.map((b) => b.y));
		const all = {x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0};
		const {b, core, mask} = regionMasks(pop, w, h, all);
		const [sp, sc, sn] = search.get();
		const range = Math.round(T.flicker.searchFrac * Math.max(w, h));
		for (const [side, other] of [['prev', sp], ['next', sn]] as const) {
			const m = findDisplaced(sc, other, b, mask, core, {range, accept: T.flicker.matchShare});
			if (m) add(seeds[side], m.dx, m.dy);
		}
	}
	return seeds;
};

/**
 * Is a pop region (its pixels marked in `pop`, w x h, inside `box`) a one-frame state? Its changed pixels plus
 * `contextPx` around them are searched for in both neighbours:
 *  - found in neither: a one-frame state;
 *  - found in both at the same displacement of at least `jumpPx`: the element jumps away for one frame and returns
 *    (reported, as a jump);
 *  - otherwise (found in one, or in both along a path): motion.
 */
export const popVerdict = (search: LazyTriplet, pop: Uint8Array, w: number, h: number, box: {x: number; y: number; w: number; h: number}, seeds: Seeds = {prev: [], next: []}): PopVerdict => {
	const F = T.flicker;
	const {b, bw, bh, core, mask} = regionMasks(pop, w, h, box);
	if (bw <= 0 || bh <= 0) return {kind: 'state'};
	const [sp, sc, sn] = search.get();
	const range = Math.round(F.searchFrac * Math.max(w, h));
	const good = (m: DisplacedMatch | null, bar: number) => !!m && m.share >= bar && m.core >= bar;
	/**
	 * Where the region's content is in one neighbour: its own best match at the strict bar, or a corroborated
	 * displacement (a text or character the probe saw move by it, or the motion of the frame's popped content as a
	 * whole) at a lower bar: moving content often passes under a static overlay (a segment tag, a badge) there.
	 */
	const locate = (other: typeof sp, list: Seed[]): DisplacedMatch | null => {
		const own = findDisplaced(sc, other, b, mask, core, {range, accept: F.matchShare, seeds: list});
		if (good(own, F.matchShare)) return own;
		for (const d of list) {
			const m = matchAt(sc, other, b, mask, core, d);
			if (good(m, F.corroboratedShare)) return m;
		}
		return null;
	};
	const mp = locate(sp, seeds.prev);
	const mn = locate(sn, seeds.next);
	const inPrev = !!mp;
	const inNext = !!mn;
	if (!inPrev && !inNext) return {kind: 'state'};
	if (mp && mn) {
		// a jump: the neighbours are the same picture around the region (the element sits in one place before
		// and after) and frame t shows it displaced. Motion along a path changes the neighbourhood between them.
		const same = Math.hypot(mp.dx - mn.dx, mp.dy - mn.dy) <= 1.5;
		const px = Math.round(Math.hypot(mp.dx, mp.dy));
		if (same && px >= F.jumpPx && neighboursAgree(search, b, px, w, h) >= F.jumpAgree) return {kind: 'jump', px};
	}
	return {kind: 'motion'};
};

/** Share of pixels in `b` inflated by `pad` where the two neighbours agree (max channel difference <= flicker.back). */
const neighboursAgree = (search: LazyTriplet, b: Box, pad: number, w: number, h: number): number => {
	const [sp, , sn] = search.get();
	const p = sp.levels[0];
	const n = sn.levels[0];
	let same = 0;
	let all = 0;
	for (let y = Math.max(0, b.y0 - pad); y < Math.min(h, b.y1 + pad); y++)
		for (let x = Math.max(0, b.x0 - pad); x < Math.min(w, b.x1 + pad); x++) {
			all++;
			if (Math.abs(p.v[y * w + x] - n.v[y * w + x]) <= T.flicker.back) same++;
		}
	return all ? same / all : 0;
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
