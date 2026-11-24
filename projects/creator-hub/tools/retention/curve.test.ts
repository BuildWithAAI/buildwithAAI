import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {BUCKETS, bucketOverlap, densify, meanOver, medianCurve, nullableValueAt, sumOver, valueAt} from './curve.ts';
import type {CurvePoint} from './types.ts';

const point = (k: number, watch: number, extra: Partial<CurvePoint> = {}): CurvePoint => ({ratio: k / 100, watch, relative: 0.5, started: null, stopped: null, impressions: null, ...extra});
const line = (from = 1, to = 0.5): CurvePoint[] => Array.from({length: BUCKETS}, (_, i) => point(i + 1, from + ((to - from) * i) / (BUCKETS - 1)));

describe('densify', () => {
	it('places 100 rows in their buckets, snapping float ratios', () => {
		const rows = line().map((p, i) => (i === 29 ? {...p, ratio: 0.30000000000000004} : p));
		const dense = densify(rows)!;
		assert.equal(dense.presentCount, 100);
		assert.equal(dense.issues.length, 0);
		assert.equal(dense.watch[29], rows[29]!.watch);
	});
	it('fills missing buckets from their neighbours and reports them', () => {
		const rows = line().filter((_, i) => i < 40 || i > 49);
		const dense = densify(rows)!;
		assert.equal(dense.presentCount, 90);
		assert.match(dense.issues[0]!, /10 of 100 buckets missing/);
		const expected = rows[39]!.watch + ((rows[40]!.watch - rows[39]!.watch) * 5) / 11;
		assert.ok(Math.abs(dense.watch[44]! - expected) < 1e-12);
		assert.equal(dense.present[44], false);
	});
	it('drops off-grid, duplicate and negative rows with an issue', () => {
		const rows = [...line(), point(5, 0.9), {...point(1, 1), ratio: 0.015}, {...point(1, 1), ratio: 1.5}];
		rows[10] = {...rows[10]!, watch: -1};
		const dense = densify(rows)!;
		assert.equal(dense.issues.filter((i) => /duplicate/.test(i)).length, 1);
		assert.equal(dense.issues.filter((i) => /not on the 0\.01 grid/.test(i)).length, 2);
		assert.equal(dense.issues.filter((i) => /not a number of 0 or more/.test(i)).length, 1);
		assert.equal(dense.presentCount, 99);
	});
	it('returns null when YouTube sent no rows', () => {
		assert.equal(densify([]), null);
	});
	it('keeps values above 1 (rewatches, Shorts loops)', () => {
		assert.equal(densify(line(1.3, 1.1))!.watch[0], 1.3);
	});
});

describe('interpolation between bucket midpoints', () => {
	const series = Array.from({length: BUCKETS}, (_, k) => k); // bucket k has value k at its midpoint (k + 0.5) / 100
	it('hits each midpoint exactly and is linear between them', () => {
		assert.equal(valueAt(series, 0.105), 10);
		assert.ok(Math.abs(valueAt(series, 0.11) - 10.5) < 1e-9);
	});
	it('is flat before the first and after the last midpoint', () => {
		assert.equal(valueAt(series, 0), 0);
		assert.equal(valueAt(series, 1), 99);
	});
	it('nullable series give null next to a missing value', () => {
		const s = series.map((v, k) => (k === 50 ? null : v));
		assert.equal(nullableValueAt(s, 0.505), null);
		assert.equal(nullableValueAt(s, 0.305), 30);
	});
});

describe('bucket overlap', () => {
	it('covers whole and partial buckets of a span', () => {
		const w = bucketOverlap(0.015, 0.035);
		assert.ok(Math.abs(w[1]! - 0.5) < 1e-9);
		assert.ok(Math.abs(w[2]! - 1) < 1e-9);
		assert.ok(Math.abs(w[3]! - 0.5) < 1e-9);
		assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 2) < 1e-9);
	});
	it('weighted mean and sum over a span', () => {
		const s = Array.from({length: BUCKETS}, (_, k) => k);
		assert.ok(Math.abs(meanOver(s, 0.015, 0.035)! - 2) < 1e-9);
		assert.ok(Math.abs(sumOver(s, 0.015, 0.035)! - (0.5 * 1 + 2 + 0.5 * 3)) < 1e-9);
		assert.equal(meanOver(new Array(BUCKETS).fill(null), 0, 1), null);
	});
	it('median curve bucket by bucket', () => {
		const a = new Array(BUCKETS).fill(1);
		const b = new Array(BUCKETS).fill(3);
		const c = new Array(BUCKETS).fill(2);
		assert.deepEqual(medianCurve([a, b, c])!.slice(0, 2), [2, 2]);
		assert.deepEqual(medianCurve([a, b])!.slice(0, 1), [2]);
		assert.equal(medianCurve([]), null);
	});
});
