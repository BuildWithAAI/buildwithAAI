/**
 * The 100-point audience retention curve.
 *
 * YouTube returns one row per bucket: elapsedVideoTimeRatio is the EXCLUSIVE END of a bucket 1/100 of the video
 * long (0.01 covers [0, 0.01)), "equally spaced for each video" (developers.google.com/youtube/analytics/dimensions
 * #elapsedVideoTimeRatio). Each value describes its bucket, so it is placed at the bucket's midpoint, and the curve
 * between midpoints is linear (flat before the first and after the last midpoint).
 */
import type {CurvePoint} from './types.ts';

export const BUCKETS = 100;

export type DenseCurve = {
	watch: number[]; // length 100, gaps filled by linear interpolation
	relative: (number | null)[]; // length 100, null where YouTube gave none
	stopped: (number | null)[];
	started: (number | null)[];
	present: boolean[]; // which buckets YouTube returned
	presentCount: number;
	issues: string[];
};

const finiteOrNull = (value: number | null): number | null => (value !== null && Number.isFinite(value) ? value : null);

/**
 * Sorts the rows into buckets 1..100, snapping ratios such as 0.30000000000000004 to the grid. Duplicate or
 * off-grid rows are dropped with an issue. Missing buckets are filled from their neighbours (and reported).
 */
export const densify = (points: readonly CurvePoint[]): DenseCurve | null => {
	const slots: (CurvePoint | null)[] = new Array(BUCKETS).fill(null);
	const issues: string[] = [];
	for (const point of points) {
		const k = Math.round(point.ratio * BUCKETS);
		if (!Number.isFinite(point.ratio) || Math.abs(point.ratio * BUCKETS - k) > 1e-6 || k < 1 || k > BUCKETS) {
			issues.push(`ignored a row with elapsedVideoTimeRatio ${point.ratio} (not on the 0.01 grid)`);
			continue;
		}
		if (!Number.isFinite(point.watch) || point.watch < 0) {
			issues.push(`ignored bucket ${k}: audienceWatchRatio ${point.watch} is not a number of 0 or more`);
			continue;
		}
		if (slots[k - 1]) {
			issues.push(`ignored a duplicate row for bucket ${k}`);
			continue;
		}
		slots[k - 1] = point;
	}
	const present = slots.map((s) => s !== null);
	const presentCount = present.filter(Boolean).length;
	if (presentCount === 0) return null;
	const watch = new Array<number>(BUCKETS).fill(0);
	for (let k = 0; k < BUCKETS; k++) {
		const own = slots[k];
		if (own) {
			watch[k] = own.watch;
			continue;
		}
		let prev = k - 1;
		while (prev >= 0 && !slots[prev]) prev--;
		let next = k + 1;
		while (next < BUCKETS && !slots[next]) next++;
		if (prev < 0) watch[k] = slots[next]!.watch;
		else if (next >= BUCKETS) watch[k] = slots[prev]!.watch;
		else watch[k] = slots[prev]!.watch + ((slots[next]!.watch - slots[prev]!.watch) * (k - prev)) / (next - prev);
	}
	if (presentCount < BUCKETS) issues.push(`${BUCKETS - presentCount} of ${BUCKETS} buckets missing (filled from their neighbours)`);
	return {
		watch,
		relative: slots.map((s) => (s ? finiteOrNull(s.relative) : null)),
		stopped: slots.map((s) => (s ? finiteOrNull(s.stopped) : null)),
		started: slots.map((s) => (s ? finiteOrNull(s.started) : null)),
		present,
		presentCount,
		issues,
	};
};

/** Value of a 100-bucket series at time ratio x (0..1): linear between bucket midpoints. */
export const valueAt = (series: readonly number[], x: number): number => {
	const pos = x * BUCKETS - 0.5; // bucket k (0-based) has its midpoint at k + 0.5
	if (pos <= 0) return series[0]!;
	if (pos >= BUCKETS - 1) return series[BUCKETS - 1]!;
	const lo = Math.floor(pos);
	const frac = pos - lo;
	return series[lo]! + (series[lo + 1]! - series[lo]!) * frac;
};

/** Same, for a series with nulls: null if either neighbour is null. */
export const nullableValueAt = (series: readonly (number | null)[], x: number): number | null => {
	const pos = x * BUCKETS - 0.5;
	if (pos <= 0) return series[0] ?? null;
	if (pos >= BUCKETS - 1) return series[BUCKETS - 1] ?? null;
	const lo = Math.floor(pos);
	const a = series[lo];
	const b = series[lo + 1];
	if (a === null || a === undefined || b === null || b === undefined) return null;
	return a + (b - a) * (pos - lo);
};

/** For a span [a, b) of the video (ratios), the covered fraction of each bucket (0..1). */
export const bucketOverlap = (a: number, b: number): number[] => {
	const out = new Array<number>(BUCKETS).fill(0);
	if (!(b > a)) return out;
	const first = Math.max(0, Math.floor(a * BUCKETS));
	const last = Math.min(BUCKETS - 1, Math.ceil(b * BUCKETS) - 1);
	for (let k = first; k <= last; k++) {
		const lo = Math.max(a, k / BUCKETS);
		const hi = Math.min(b, (k + 1) / BUCKETS);
		if (hi > lo) out[k] = (hi - lo) * BUCKETS;
	}
	return out;
};

/** Overlap-weighted mean of a series over [a, b); null when no covered bucket has a value. */
export const meanOver = (series: readonly (number | null)[], a: number, b: number): number | null => {
	const weights = bucketOverlap(a, b);
	let total = 0;
	let weight = 0;
	for (let k = 0; k < BUCKETS; k++) {
		const v = series[k];
		if (weights[k]! > 0 && v !== null && v !== undefined) {
			total += v * weights[k]!;
			weight += weights[k]!;
		}
	}
	return weight > 0 ? total / weight : null;
};

/** Overlap-weighted sum over [a, b) (counts such as stoppedWatching); null when every covered bucket is null. */
export const sumOver = (series: readonly (number | null)[], a: number, b: number): number | null => {
	const weights = bucketOverlap(a, b);
	let total = 0;
	let any = false;
	for (let k = 0; k < BUCKETS; k++) {
		const v = series[k];
		if (weights[k]! > 0 && v !== null && v !== undefined) {
			total += v * weights[k]!;
			any = true;
		}
	}
	return any ? total : null;
};

/** Median of several dense curves, bucket by bucket (the channel's typical curve). */
export const medianCurve = (curves: readonly (readonly number[])[]): number[] | null => {
	if (!curves.length) return null;
	const out: number[] = [];
	for (let k = 0; k < BUCKETS; k++) {
		const values = curves.map((c) => c[k]!).sort((x, y) => x - y);
		const mid = Math.floor(values.length / 2);
		out.push(values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2);
	}
	return out;
};
