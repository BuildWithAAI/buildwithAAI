/**
 * Geometry helpers for the ZOO rig. Every outline is a cubic Bezier path (C commands) built from
 * on-curve key points measured from the approved model sheet. A Catmull-Rom spline through the
 * key points gives smooth organic curves; points flagged as corners ('c') keep a sharp tip
 * (hair tufts, brow tails, collar points).
 */
export type Pt = readonly [number, number] | readonly [number, number, 'c'];
export type Vec = readonly [number, number];

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Smooth path through key points. `closed` closes the loop. `k` scales tangent length
 * (1 = standard Catmull-Rom; lower is tighter).
 */
export const smooth = (pts: readonly Pt[], closed = true, k = 1): string => {
	const n = pts.length;
	if (n < 2) return '';
	const P = (i: number): Pt => {
		if (closed) return pts[(i + n) % n];
		return pts[Math.max(0, Math.min(n - 1, i))];
	};
	const isCorner = (p: Pt) => p.length === 3;
	let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
	const segs = closed ? n : n - 1;
	for (let i = 0; i < segs; i++) {
		const p0 = P(i - 1);
		const p1 = P(i);
		const p2 = P(i + 1);
		const p3 = P(i + 2);
		const t1: Vec = isCorner(p1) || (!closed && i === 0) ? [(p2[0] - p1[0]) / 3, (p2[1] - p1[1]) / 3] : [((p2[0] - p0[0]) / 6) * k, ((p2[1] - p0[1]) / 6) * k];
		const t2: Vec = isCorner(p2) || (!closed && i === n - 2) ? [(p2[0] - p1[0]) / 3, (p2[1] - p1[1]) / 3] : [((p3[0] - p1[0]) / 6) * k, ((p3[1] - p1[1]) / 6) * k];
		// a corner keeps its sharp tip: tangent points along the segment, shortened
		const c1: Vec = isCorner(p1) ? [p1[0] + t1[0] * 0.6, p1[1] + t1[1] * 0.6] : [p1[0] + t1[0], p1[1] + t1[1]];
		const c2: Vec = isCorner(p2) ? [p2[0] - t2[0] * 0.6, p2[1] - t2[1] * 0.6] : [p2[0] - t2[0], p2[1] - t2[1]];
		d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
	}
	return closed ? d + ' Z' : d;
};

/** Open smooth stroke (convenience). */
export const line = (pts: readonly Pt[], k = 1) => smooth(pts, false, k);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);

/** Interpolate two key-point lists of equal length (corner flags taken from `a`). */
export const lerpPts = (a: readonly Pt[], b: readonly Pt[], t: number): Pt[] =>
	a.map((p, i) => {
		const q = b[i];
		const x = lerp(p[0], q[0], t);
		const y = lerp(p[1], q[1], t);
		return p.length === 3 ? ([x, y, 'c'] as const) : ([x, y] as const);
	});

/** Mirror key points about a vertical axis x = ax (used ONLY for bilateral pairs such as ears, shoes, sleeves). */
export const mirrorX = (pts: readonly Pt[], ax = 0): Pt[] =>
	pts.map((p) => (p.length === 3 ? ([2 * ax - p[0], p[1], 'c'] as const) : ([2 * ax - p[0], p[1]] as const)));

export const translate = (pts: readonly Pt[], dx: number, dy: number): Pt[] =>
	pts.map((p) => (p.length === 3 ? ([p[0] + dx, p[1] + dy, 'c'] as const) : ([p[0] + dx, p[1] + dy] as const)));

/** Smoothstep easing for pose blends. */
export const smoothstep = (t: number) => {
	const x = clamp01(t);
	return x * x * (3 - 2 * x);
};

/** Make a React useId() value safe for url(#id) references. */
export const safeId = (raw: string, prefix: string) => `${prefix}-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
