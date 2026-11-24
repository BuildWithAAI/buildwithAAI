/**
 * Binding rule (docs/PROJECT_INSTRUCTIONS.md): never horizontally flip Badger or his markings to make another view.
 * Every marking record in spots.ts (body spots of every view and pose, front-neck spots and every head view's marking
 * paths) is compared with the x-mirror (x -> -x in the record's own space) of every other record. The test FAILS when a
 * record's outline lies within TOLERANCE units of another record's mirrored outline (symmetric Hausdorff distance of the
 * densely sampled outlines, so point order, direction and number formatting cannot hide a copy).
 * The only allowed mirror pairs are midline M-* records with the same id in the two facings of one pose
 * (e.g. SIT_SPOTS M-CHEST and SIT_LEFT_SPOTS M-CHEST): a midline mark is symmetric anatomy.
 * Run: cd projects/video-studio && node --test src/characters/badger/tests/spotsNoMirror.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as SPOTS from '../spots.ts';

const TOLERANCE = 0.25;

type Pt = readonly [number, number];
type Rec = {collection: string; id: string; side: string; label: string; d: string};

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
		for (const r of value as {id?: string; side?: string; path?: string; paths?: Record<string, string | undefined>}[]) {
			if (typeof r?.path === 'string') {
				out.push({collection: name, id: String(r.id), side: String(r.side), label: `${name} ${r.id}`, d: r.path});
			} else if (r?.paths && typeof r.paths === 'object') {
				for (const [view, d] of Object.entries(r.paths)) {
					if (typeof d === 'string') out.push({collection: `${name}.${view}`, id: String(r.id), side: String(r.side), label: `${name} ${r.id} [${view}]`, d});
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
	const planted: Rec = {collection: 'SIT_LEFT_SPOTS', id: 'R-99', side: 'right', label: 'planted', d: flip(src.d)};
	const plantedMidline: Rec = {collection: 'SIT_LEFT_SPOTS', id: 'M-CHEST', side: 'midline', label: 'planted midline', d: flip(src.d)};
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
