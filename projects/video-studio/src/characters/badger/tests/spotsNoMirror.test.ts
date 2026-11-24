/**
 * Binding rule (docs/PROJECT_INSTRUCTIONS.md): never horizontally flip Badger or his markings to make another view.
 * Every marking record in spots.ts (body spots of every view and pose, front-neck spots and every head view's marking
 * paths) is compared with the x-mirror of every other record, twice:
 *  1. IN PLACE (x -> -x in the record's own space): the test FAILS when a record's outline lies within TOLERANCE (0.25)
 *     units of another record's mirrored outline (symmetric Hausdorff distance of the densely sampled outlines, so point
 *     order, direction and number formatting cannot hide a copy).
 *  2. RESHAPED, MOVED OR RESCALED COPIES (round 4, R3 review): for two records of one body that can show mirror anatomy
 *     (the same collection, or the two facings of one pose or head view: SIT / SIT_LEFT, LIE / LIE_LEFT, LEFT / RIGHT side
 *     rigs, the 3/4, profile and look-up head pairs), on the same or the mirror part, whose centres lie within
 *     POS_TOLERANCE (20) units of mirror places, the test FAILS when EITHER
 *       - the outline lies within NEAR_TOLERANCE (1.0) units of the other's x-mirror in place (a copy kept where it was
 *         but re-proportioned, e.g. round 3's SIT_LEFT L-09 on the right sit's R-08 centre, 0.6 units), OR
 *       - after each outline is moved to its own centroid and divided by its RMS radius (so a flipped copy that was also
 *         moved, or rescaled by up to 30%, still matches), the outlines lie within NEAR_TOLERANCE units of each other's
 *         mirror (normalised Hausdorff distance times the pair's mean RMS radius),
 *     unless the pair is in COAT_MAP_SYMMETRIC with the evidence that the approved sheet draws those two marks that way.
 *     Every allow-list entry must still match (stale entries fail too), so the list stays exact.
 * The only other allowed mirror pairs are midline M-* records with the same id in the two facings of one pose
 * (e.g. SIT_SPOTS M-CHEST and SIT_LEFT_SPOTS M-CHEST): a midline mark is symmetric anatomy.
 * Run: cd projects/video-studio && node --test src/characters/badger/tests/spotsNoMirror.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as SPOTS from '../spots.ts';

const TOLERANCE = 0.25;
/** Near-mirror check (in place, and centre- and scale-normalised at the pair's mean RMS radius), in units. */
const NEAR_TOLERANCE = 1.0;
/** Normalised check: largest distance (units) between one centre and the mirror of the other. */
const POS_TOLERANCE = 20;

type Pt = readonly [number, number];
type Rec = {collection: string; id: string; side: string; part: string; label: string; d: string};

const TOKEN = /[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

/** Densely sampled outline of an absolute SVG path (M L H V C Q Z). */
export const samplePath = (d: string, perSegment = 24): Pt[] => {
	const toks = d.match(TOKEN) ?? [];
	const out: Pt[] = [];
	let i = 0;
	let cmd = '';
	let cur: Pt = [0, 0];
	let start: Pt = [0, 0];
	const num = (): number => {
		const v = Number(toks[i++]);
		if (!Number.isFinite(v)) throw new Error(`bad number in path: ${d}`);
		return v;
	};
	const line = (a: Pt, b: Pt) => {
		for (let k = 1; k <= perSegment; k++) out.push([a[0] + ((b[0] - a[0]) * k) / perSegment, a[1] + ((b[1] - a[1]) * k) / perSegment]);
	};
	const cubic = (a: Pt, b: Pt, c: Pt, e: Pt) => {
		for (let k = 1; k <= perSegment; k++) {
			const t = k / perSegment;
			const u = 1 - t;
			out.push([
				u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * e[0],
				u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * e[1],
			]);
		}
	};
	while (i < toks.length) {
		const t = toks[i];
		if (/[A-Za-z]/.test(t)) {
			if (t !== t.toUpperCase()) throw new Error(`relative path command '${t}' is not supported: ${d}`);
			cmd = t;
			i++;
			if (cmd === 'Z') {
				line(cur, start);
				cur = start;
			}
			continue;
		}
		if (cmd === 'M') {
			cur = [num(), num()];
			start = cur;
			out.push(cur);
			cmd = 'L';
		} else if (cmd === 'L') {
			const p: Pt = [num(), num()];
			line(cur, p);
			cur = p;
		} else if (cmd === 'H') {
			const p: Pt = [num(), cur[1]];
			line(cur, p);
			cur = p;
		} else if (cmd === 'V') {
			const p: Pt = [cur[0], num()];
			line(cur, p);
			cur = p;
		} else if (cmd === 'C') {
			const b: Pt = [num(), num()];
			const c: Pt = [num(), num()];
			const e: Pt = [num(), num()];
			cubic(cur, b, c, e);
			cur = e;
		} else if (cmd === 'Q') {
			const q: Pt = [num(), num()];
			const e: Pt = [num(), num()];
			cubic(cur, [cur[0] + ((q[0] - cur[0]) * 2) / 3, cur[1] + ((q[1] - cur[1]) * 2) / 3], [e[0] + ((q[0] - e[0]) * 2) / 3, e[1] + ((q[1] - e[1]) * 2) / 3], e);
			cur = e;
		} else {
			throw new Error(`unsupported path command '${cmd}': ${d}`);
		}
	}
	if (out.length < 2) throw new Error(`empty path: ${d}`);
	return out;
};

const mirrorX = (ps: readonly Pt[]): Pt[] => ps.map(([x, y]) => [-x, y] as const);

const segDist = (p: Pt, a: Pt, b: Pt): number => {
	const vx = b[0] - a[0];
	const vy = b[1] - a[1];
	const L = vx * vx + vy * vy;
	const t = L > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L)) : 0;
	return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
};

/** Directed Hausdorff distance from the samples of A to the polyline B. */
const directed = (A: readonly Pt[], B: readonly Pt[]): number => {
	let worst = 0;
	for (const p of A) {
		let best = Infinity;
		for (let k = 0; k + 1 < B.length && best > worst; k++) best = Math.min(best, segDist(p, B[k], B[k + 1]));
		worst = Math.max(worst, best);
	}
	return worst;
};

type Box = {x0: number; x1: number; y0: number; y1: number};
const box = (ps: readonly Pt[]): Box => ({
	x0: Math.min(...ps.map((p) => p[0])),
	x1: Math.max(...ps.map((p) => p[0])),
	y0: Math.min(...ps.map((p) => p[1])),
	y1: Math.max(...ps.map((p) => p[1])),
});

/** Symmetric Hausdorff distance between outline A and the x-mirror of outline B (Infinity when the boxes rule it out). */
export const mirrorDistance = (A: readonly Pt[], B: readonly Pt[], cutoff = 1): number => {
	const M = mirrorX(B);
	const a = box(A);
	const m = box(M);
	if (Math.abs(a.x0 - m.x0) > cutoff || Math.abs(a.x1 - m.x1) > cutoff || Math.abs(a.y0 - m.y0) > cutoff || Math.abs(a.y1 - m.y1) > cutoff) return Infinity;
	return Math.max(directed(A, M), directed(M, A));
};

/** Every marking record exported by spots.ts: arrays of {id, side, path} and head markings {id, side, paths: {view: d}}. */
export const collectRecords = (mod: Record<string, unknown>): Rec[] => {
	const out: Rec[] = [];
	for (const [name, value] of Object.entries(mod)) {
		if (!Array.isArray(value)) continue;
		for (const r of value as {id?: string; side?: string; part?: string; path?: string; paths?: Record<string, string | undefined>}[]) {
			if (typeof r?.path === 'string') {
				out.push({collection: name, id: String(r.id), side: String(r.side), part: String(r.part ?? ''), label: `${name} ${r.id}`, d: r.path});
			} else if (r?.paths && typeof r.paths === 'object') {
				for (const [view, d] of Object.entries(r.paths)) {
					if (typeof d === 'string')
						out.push({collection: `${name}.${view}`, id: String(r.id), side: String(r.side), part: 'head', label: `${name} ${r.id} [${view}]`, d});
				}
			}
		}
	}
	return out;
};

/** The two facings of one pose (SIT_SPOTS / SIT_LEFT_SPOTS, LIE_SPOTS / LIE_LEFT_SPOTS, RIGHT_SPOTS / LEFT_SPOTS). */
const facingPairKey = (collection: string): string =>
	collection.replace(/^(LEFT|RIGHT)_SPOTS$/, 'SIDE_SPOTS').replace(/_LEFT_SPOTS$/, '_SPOTS');

const allowedMirror = (a: Rec, b: Rec): boolean =>
	a.side === 'midline' &&
	b.side === 'midline' &&
	a.id === b.id &&
	a.id.startsWith('M-') &&
	a.collection !== b.collection &&
	facingPairKey(a.collection) === facingPairKey(b.collection);

export type MirrorHit = {a: string; b: string; distance: number; allowed: boolean};

export const findMirrors = (recs: readonly Rec[], tolerance = TOLERANCE): MirrorHit[] => {
	const pts = recs.map((r) => samplePath(r.d));
	const hits: MirrorHit[] = [];
	for (let i = 0; i < recs.length; i++) {
		for (let j = i + 1; j < recs.length; j++) {
			const dist = mirrorDistance(pts[i], pts[j], Math.max(1, tolerance * 2));
			if (dist <= tolerance) hits.push({a: recs[i].label, b: recs[j].label, distance: Math.round(dist * 1000) / 1000, allowed: allowedMirror(recs[i], recs[j])});
		}
	}
	return hits;
};

/** Centroid and RMS radius of a sampled outline. */
const frame = (ps: readonly Pt[]): {cx: number; cy: number; r: number} => {
	const cx = ps.reduce((a, p) => a + p[0], 0) / ps.length;
	const cy = ps.reduce((a, p) => a + p[1], 0) / ps.length;
	const r = Math.sqrt(ps.reduce((a, p) => a + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / ps.length);
	return {cx, cy, r};
};
const normalise = (ps: readonly Pt[]): {pts: Pt[]; r: number} => {
	const f = frame(ps);
	return {pts: ps.map(([x, y]) => [(x - f.cx) / f.r, (y - f.cy) / f.r] as const), r: f.r};
};

/** Largest accepted scale ratio between a record and a rescaled mirror copy. */
const MAX_SCALE_RATIO = 1.3;

/**
 * Centre- and scale-normalised mirror distance in units: the symmetric Hausdorff distance between A and the x-mirror of B
 * after both are moved to their centroids and divided by their RMS radii, times the mean RMS radius. Infinity when the
 * scales differ by more than MAX_SCALE_RATIO or the normalised boxes rule a match out.
 */
export const normalisedMirrorDistance = (A: readonly Pt[], B: readonly Pt[], cutoffUnits = 2): number => {
	const a = normalise(A);
	const b = normalise(B);
	if (Math.max(a.r, b.r) / Math.min(a.r, b.r) > MAX_SCALE_RATIO) return Infinity;
	const mean = (a.r + b.r) / 2;
	const M = mirrorX(b.pts);
	const ba = box(a.pts);
	const bm = box(M);
	const c = cutoffUnits / mean;
	if (Math.abs(ba.x0 - bm.x0) > c || Math.abs(ba.x1 - bm.x1) > c || Math.abs(ba.y0 - bm.y0) > c || Math.abs(ba.y1 - bm.y1) > c) return Infinity;
	return Math.max(directed(a.pts, M), directed(M, a.pts)) * mean;
};

/**
 * Pairs the approved sheet itself draws as near mirror images (centre- and scale-normalised within NORM_TOLERANCE), each
 * authored from its own map. Labels are '<collection> <id>' or '<collection> <id> [<head view>]', as findMirrors prints
 * them; order does not matter. Keep this list exact: an entry that no longer matches fails the test.
 */
export const COAT_MAP_SYMMETRIC: readonly {readonly a: string; readonly b: string; readonly reason: string}[] = [
	{
		a: 'SIT_LEFT_SPOTS L-01',
		b: 'SIT_SPOTS R-02',
		reason:
			'the mid-back spot behind the withers: badger_coat_left.png draws L-01 as a 13 x 7.2 px oval tilted -4 deg and badger_coat_right.png draws R-02 as a 15 x 8.4 px oval tilted +4.5 deg (aspect 0.55 / 0.56, mirror tilts 0.5 deg apart); each sit takes its own map\'s shape turned by the sit\'s back slope (gen_poses.py), so they match once centred and scaled (sizes 13% apart, centres 17 units from mirror places)',
	},
	{
		a: 'SIT_LEFT_SPOTS L-09',
		b: 'SIT_SPOTS R-08',
		reason:
			'the forearm spot: badger_coat_left.png puts L-09 37.2% down the forearm and 38.5% across from its front contour, badger_coat_right.png puts R-08 35.7% down and 41% across (dev/trace/coatmaps.py); the left sit places L-09 from coat_left\'s numbers on the same (mirrored) forearm, 4 units from R-08\'s mirror place, with coat_left\'s 7.6 x 12.2 px oval against coat_right\'s 8.0 x 12.2',
	},
];

const pairKey = (a: string, b: string) => [a, b].sort().join(' <-> ');

/**
 * The body a record belongs to and, for a body drawn in two facings, which one. Records of one family share one space in
 * which x -> -x maps one side's anatomy onto the other's (pose roots, part pivots, head pivots).
 */
const family = (collection: string): string => {
	const [name, view] = collection.split('.');
	if (name === 'HEAD_MARKINGS') return `HEAD.${(view ?? '').replace(/(Left|Right)Screen$/, '')}`;
	return name.replace(/^(LEFT|RIGHT)_SPOTS$/, 'SIDE_SPOTS').replace(/_LEFT_SPOTS$/, '_SPOTS');
};
/** Parts that are each other's mirror (front / back views); every other part pairs only with itself. */
const MIRROR_PART: Record<string, string> = {legFrontLeft: 'legFrontRight', legFrontRight: 'legFrontLeft', legHindLeft: 'legHindRight', legHindRight: 'legHindLeft'};
const partsMatch = (a: Rec, b: Rec) => a.part === b.part || MIRROR_PART[a.part] === b.part;

export type NearMirrorHit = {a: string; b: string; distance: number; allowed: boolean; reason?: string};

export const findNearMirrors = (recs: readonly Rec[], tolerance = NEAR_TOLERANCE, posTolerance = POS_TOLERANCE): NearMirrorHit[] => {
	const pts = recs.map((r) => samplePath(r.d));
	const centres = pts.map(frame);
	const allow = new Map(COAT_MAP_SYMMETRIC.map((e) => [pairKey(e.a, e.b), e.reason] as const));
	const hits: NearMirrorHit[] = [];
	for (let i = 0; i < recs.length; i++) {
		for (let j = i + 1; j < recs.length; j++) {
			if (family(recs[i].collection) !== family(recs[j].collection) || !partsMatch(recs[i], recs[j])) continue;
			if (Math.hypot(centres[i].cx + centres[j].cx, centres[i].cy - centres[j].cy) > posTolerance) continue;
			const dist = Math.min(mirrorDistance(pts[i], pts[j], Math.max(2, tolerance * 2)), normalisedMirrorDistance(pts[i], pts[j], Math.max(2, tolerance * 2)));
			if (!(dist <= tolerance)) continue;
			const reason = allow.get(pairKey(recs[i].label, recs[j].label));
			hits.push({
				a: recs[i].label,
				b: recs[j].label,
				distance: Math.round(dist * 1000) / 1000,
				allowed: allowedMirror(recs[i], recs[j]) || reason !== undefined,
				...(reason ? {reason} : {}),
			});
		}
	}
	return hits;
};

const RECORDS = collectRecords(SPOTS as unknown as Record<string, unknown>);

test('spots.ts exposes the marking records of every view and pose', () => {
	const collections = new Set(RECORDS.map((r) => r.collection.split('.')[0]));
	for (const c of ['LEFT_SPOTS', 'RIGHT_SPOTS', 'FRONT_SPOTS', 'BACK_SPOTS', 'THREE_QUARTER_SPOTS', 'SIT_SPOTS', 'LIE_SPOTS', 'SIT_LEFT_SPOTS', 'LIE_LEFT_SPOTS', 'FRONT_NECK_SPOTS', 'HEAD_MARKINGS']) {
		assert.ok(collections.has(c), `missing collection ${c}`);
	}
	assert.ok(RECORDS.length >= 100, `only ${RECORDS.length} records found`);
});

test('the detector catches a planted mirror copy and ignores a shifted one', () => {
	const src = RECORDS.find((r) => r.collection === 'SIT_SPOTS' && r.id === 'R-08');
	assert.ok(src, 'SIT_SPOTS R-08 exists');
	const flip = (d: string, dx = 0) => {
		let k = 0;
		return d.replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g, (m) => (k++ % 2 === 0 ? String(Math.round((-Number(m) + dx) * 10) / 10) : m));
	};
	// a mirrored copy, a reversed-direction mirrored copy and a copy shifted 1 unit after mirroring
	const pts = samplePath(src.d);
	const mirrored = samplePath(flip(src.d));
	const reversed = [...mirrored].reverse();
	const shifted = samplePath(flip(src.d, 1));
	assert.ok(mirrorDistance(pts, mirrored) <= TOLERANCE);
	assert.ok(mirrorDistance(pts, reversed) <= TOLERANCE);
	assert.ok(!(mirrorDistance(pts, shifted) <= TOLERANCE));
	const planted: Rec = {collection: 'SIT_LEFT_SPOTS', id: 'R-99', side: 'right', part: src.part, label: 'planted', d: flip(src.d)};
	const plantedMidline: Rec = {collection: 'SIT_LEFT_SPOTS', id: 'M-CHEST', side: 'midline', part: src.part, label: 'planted midline', d: flip(src.d)};
	assert.deepEqual(
		findMirrors([src, planted]).map((h) => h.allowed),
		[false],
	);
	// a midline record may mirror only its own id in the other facing of the same pose
	assert.deepEqual(
		findMirrors([src, plantedMidline]).map((h) => h.allowed),
		[false],
	);
});

test('no marking record is the x-mirror of another record (midline M-* pairs excepted)', () => {
	const hits = findMirrors(RECORDS);
	const bad = hits.filter((h) => !h.allowed);
	const allowed = hits.filter((h) => h.allowed);
	for (const h of allowed) console.log(`allowed midline pair: ${h.a} <-> ${h.b} (${h.distance} u)`);
	assert.deepEqual(
		bad.map((h) => `${h.a} is the x-mirror of ${h.b} within ${h.distance} u`),
		[],
		'a marking path was produced by flipping another record (binding rule: never flip asymmetric markings)',
	);
});

test('the near-mirror detector catches a flipped copy that was moved and rescaled, and ignores a different shape', () => {
	const src = RECORDS.find((r) => r.collection === 'SIT_SPOTS' && r.id === 'R-08');
	assert.ok(src, 'SIT_SPOTS R-08 exists');
	const pts = samplePath(src.d);
	const f = frame(pts);
	// x-mirror about the record's own centre, then moved 6 units and scaled 1.08 (well past the in-place tolerance)
	const moved = pts.map(([x, y]) => [f.cx + 6 - (x - f.cx) * 1.08, f.cy + 2 + (y - f.cy) * 1.08] as const);
	assert.ok(!(mirrorDistance(pts, moved) <= TOLERANCE), 'the in-place check misses a moved copy');
	assert.ok(normalisedMirrorDistance(pts, moved) <= 0.05, 'the normalised check catches it');
	// planted as a left-facing record at the mirror place (moved 6 units, rescaled 1.08): reported and not allowed
	const fmt = (ps: readonly Pt[]) => 'M ' + ps.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L ') + ' Z';
	const copy = pts.map(([x, y]) => [-(f.cx + 6) - (x - f.cx) * 1.08 + 2 * f.cx - 2 * f.cx, f.cy + 2 + (y - f.cy) * 1.08] as const);
	const plantedCopy: Rec = {collection: 'SIT_LEFT_SPOTS', id: 'L-99', side: 'left', part: src.part, label: 'planted moved copy', d: fmt(copy)};
	assert.deepEqual(
		findNearMirrors([src, plantedCopy]).map((h) => h.allowed),
		[false],
	);
	// the same mark turned 25 degrees is a different drawing, not a mirror copy
	const a = (25 * Math.PI) / 180;
	const turned = pts.map(([x, y]) => {
		const X = -(x - f.cx);
		const Y = y - f.cy;
		return [f.cx + X * Math.cos(a) - Y * Math.sin(a), f.cy + X * Math.sin(a) + Y * Math.cos(a)] as const;
	});
	assert.ok(!(normalisedMirrorDistance(pts, turned) <= NEAR_TOLERANCE), 'a turned mark is not reported');
});

test('no marking record is a moved or rescaled x-mirror of another (allow-listed sheet-symmetric pairs excepted)', () => {
	const hits = findNearMirrors(RECORDS);
	for (const h of hits.filter((x) => x.allowed)) console.log(`allowed: ${h.a} <-> ${h.b} (${h.distance} u)${h.reason ? `: ${h.reason}` : ' (midline pair)'}`);
	assert.deepEqual(
		hits.filter((h) => !h.allowed).map((h) => `${h.a} is a normalised x-mirror of ${h.b} within ${h.distance} u`),
		[],
		'a marking path looks like another record flipped and nudged: author it from its own coat map, or add the pair to COAT_MAP_SYMMETRIC with the sheet evidence',
	);
	const found = new Set(hits.map((h) => pairKey(h.a, h.b)));
	assert.deepEqual(
		COAT_MAP_SYMMETRIC.filter((e) => !found.has(pairKey(e.a, e.b))).map((e) => pairKey(e.a, e.b)),
		[],
		'stale COAT_MAP_SYMMETRIC entries (the pair no longer matches): remove them',
	);
});

// Round-3 records the R3 review measured as flipped-and-nudged (identical centres, re-proportioned ellipses): the near-mirror
// check must report every one of them, while the in-place 0.25-unit check alone missed them.
const ROUND3 = {
	sitLeftL09:
		'M -27.9 -119.2 C -28 -116.5 -27.6 -113 -26.1 -110.7 C -25 -109.2 -22.8 -107.2 -21 -107 C -19.4 -106.9 -17 -108.8 -15.7 -110.3 C -13.9 -112.3 -13.3 -115.7 -13 -118.5 C -12.9 -121.3 -13.3 -124.7 -14.8 -127 C -15.9 -128.6 -18.1 -130.6 -19.9 -130.7 C -21.5 -130.8 -23.9 -128.9 -25.2 -127.5 C -27 -125.5 -27.6 -122.1 -27.9 -119.2 Z',
	sitR08:
		'M 21.2 -106.8 C 19.5 -106.7 17.3 -108.7 16.1 -110 C 14.4 -112.2 13.8 -115.7 13.6 -118.5 C 13.5 -121.3 13.6 -124.9 15.2 -127.1 C 16.1 -128.7 18.2 -130.8 19.7 -131 C 21.4 -131.1 23.6 -129 24.8 -127.7 C 26.6 -125.6 27.1 -122.1 27.3 -119.2 C 27.4 -116.5 27.3 -112.9 25.7 -110.6 C 24.8 -109.1 22.7 -106.9 21.2 -106.8 Z',
	lieLeftL09:
		'M -119.7 -16.7 C -119.8 -15.1 -118.1 -12.6 -116.6 -11.2 C -114.7 -9.4 -111.2 -8.7 -108.5 -8.4 C -105.7 -8.1 -102.2 -8.3 -100 -9.8 C -98.3 -10.9 -96.2 -12.9 -96.1 -14.7 C -95.9 -16.4 -97.6 -18.9 -99.1 -20.2 C -101 -22 -104.5 -22.8 -107.2 -23 C -110 -23.4 -113.5 -23.1 -115.7 -21.7 C -117.4 -20.6 -119.5 -18.5 -119.7 -16.7 Z',
	lieR08:
		'M 120.2 -16.9 C 120.4 -14.9 118.6 -12.2 117.1 -10.8 C 115 -8.8 111.4 -7.9 108.5 -7.6 C 105.6 -7.4 101.9 -7.6 99.7 -9.2 C 97.9 -10.4 95.6 -12.7 95.5 -14.6 C 95.3 -16.5 97.1 -19.2 98.6 -20.7 C 100.7 -22.7 104.3 -23.6 107.2 -23.8 C 110.1 -24 113.8 -23.8 116.1 -22.2 C 117.9 -21 120.1 -18.8 120.2 -16.9 Z',
	sitLeftL04:
		'M 51.8 -140.8 C 50.5 -139.6 49.8 -136.8 49.9 -134.9 C 50 -132.6 51.5 -130.1 53.1 -128.5 C 54.8 -126.9 57.3 -125.3 59.6 -125.2 C 61.5 -125.1 64.2 -125.8 65.4 -127.1 C 66.7 -128.3 67.5 -131.1 67.3 -133 C 67.2 -135.3 65.7 -137.8 64.1 -139.5 C 62.4 -141 59.9 -142.6 57.6 -142.7 C 55.7 -142.8 53 -142.1 51.8 -140.8 Z',
	sitR03:
		'M -44 -154.5 C -42.8 -153 -42.3 -150.2 -42.6 -148.3 C -42.8 -146.2 -44.5 -143.6 -46.3 -142.1 C -48 -140.6 -50.7 -139.5 -53 -139.6 C -54.9 -139.7 -57.5 -140.6 -58.8 -142.1 C -60 -143.6 -60.5 -146.4 -60.3 -148.3 C -60 -150.5 -58.4 -153 -56.6 -154.5 C -54.9 -156 -52.1 -157.2 -49.9 -157 C -48 -156.9 -45.3 -156 -44 -154.5 Z',
};

test('the near-mirror check reports the round-3 flipped-and-nudged records the R3 review found', () => {
	const r = (collection: string, id: string, side: string, part: string, d: string): Rec => ({collection, id, side, part, label: `round3 ${collection} ${id}`, d});
	const pairs: [Rec, Rec][] = [
		[r('SIT_LEFT_SPOTS', 'L-09', 'left', 'legFrontNear', ROUND3.sitLeftL09), r('SIT_SPOTS', 'R-08', 'right', 'legFrontNear', ROUND3.sitR08)],
		[r('LIE_LEFT_SPOTS', 'L-09', 'left', 'legFrontNear', ROUND3.lieLeftL09), r('LIE_SPOTS', 'R-08', 'right', 'legFrontNear', ROUND3.lieR08)],
		[r('SIT_LEFT_SPOTS', 'L-04', 'left', 'torso', ROUND3.sitLeftL04), r('SIT_SPOTS', 'R-03', 'right', 'torso', ROUND3.sitR03)],
	];
	for (const [a, b] of pairs) {
		assert.ok(!(mirrorDistance(samplePath(a.d), samplePath(b.d)) <= TOLERANCE), `${a.label}: the in-place 0.25 check alone misses it`);
		const hits = findNearMirrors([a, b]);
		assert.deepEqual(
			hits.map((h) => h.allowed),
			[false],
			`${a.label} vs ${b.label} must be reported`,
		);
	}
});
