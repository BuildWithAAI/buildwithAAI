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

/** The cubic segments `smooth` builds (same tangent rules), as [p0, c1, c2, p3] tuples. */
const segments = (pts: readonly Pt[], closed: boolean, k = 1): [Vec, Vec, Vec, Vec][] => {
	const n = pts.length;
	const P = (i: number): Pt => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
	const isCorner = (p: Pt) => p.length === 3;
	const out: [Vec, Vec, Vec, Vec][] = [];
	const segs = closed ? n : n - 1;
	for (let i = 0; i < segs; i++) {
		const p0 = P(i - 1);
		const p1 = P(i);
		const p2 = P(i + 1);
		const p3 = P(i + 2);
		const t1: Vec = isCorner(p1) || (!closed && i === 0) ? [(p2[0] - p1[0]) / 3, (p2[1] - p1[1]) / 3] : [((p2[0] - p0[0]) / 6) * k, ((p2[1] - p0[1]) / 6) * k];
		const t2: Vec = isCorner(p2) || (!closed && i === n - 2) ? [(p2[0] - p1[0]) / 3, (p2[1] - p1[1]) / 3] : [((p3[0] - p1[0]) / 6) * k, ((p3[1] - p1[1]) / 6) * k];
		const c1: Vec = isCorner(p1) ? [p1[0] + t1[0] * 0.6, p1[1] + t1[1] * 0.6] : [p1[0] + t1[0], p1[1] + t1[1]];
		const c2: Vec = isCorner(p2) ? [p2[0] - t2[0] * 0.6, p2[1] - t2[1] * 0.6] : [p2[0] - t2[0], p2[1] - t2[1]];
		out.push([[p1[0], p1[1]], c1, c2, [p2[0], p2[1]]]);
	}
	return out;
};

const bez = (s: [Vec, Vec, Vec, Vec], t: number): Vec => {
	const u = 1 - t;
	const [a, b, c, d] = s;
	return [
		u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
		u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
	];
};

/** Points sampled along the open smooth curve through `pts` (`per` samples per segment). */
export const sampleLine = (pts: readonly Pt[], per = 8): Vec[] => {
	const segs = segments(pts, false);
	const out: Vec[] = [];
	segs.forEach((s, i) => {
		for (let j = 0; j < per; j++) out.push(bez(s, j / per));
		if (i === segs.length - 1) out.push(bez(s, 1));
	});
	return out;
};

/**
 * A tapered line as a FILLED outline (ART_GUIDE SL7: SVG has no variable-width stroke). The centreline is the
 * smooth curve through `pts`; `width(t)` gives the full width at arc fraction t (0 = first point, 1 = last).
 * The ends are rounded with a short cap so the shape reads like an inked brush line.
 */
export const tapered = (pts: readonly Pt[], width: (t: number) => number, per = 8): string => {
	const c = sampleLine(pts, per);
	const n = c.length;
	const lens = [0];
	for (let i = 1; i < n; i++) lens.push(lens[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
	const total = lens[n - 1] || 1;
	const L: Vec[] = [];
	const R: Vec[] = [];
	for (let i = 0; i < n; i++) {
		const a = c[Math.max(0, i - 1)];
		const b = c[Math.min(n - 1, i + 1)];
		let nx = -(b[1] - a[1]);
		let ny = b[0] - a[0];
		const len = Math.hypot(nx, ny) || 1;
		nx /= len;
		ny /= len;
		const w = Math.max(0.05, width(lens[i] / total)) / 2;
		L.push([c[i][0] + nx * w, c[i][1] + ny * w]);
		R.push([c[i][0] - nx * w, c[i][1] - ny * w]);
	}
	const fmt = (p: Vec) => `${f(p[0])} ${f(p[1])}`;
	const d0 = [c[0][0] - c[1][0], c[0][1] - c[1][1]];
	const d0l = Math.hypot(d0[0], d0[1]) || 1;
	const d1 = [c[n - 1][0] - c[n - 2][0], c[n - 1][1] - c[n - 2][1]];
	const d1l = Math.hypot(d1[0], d1[1]) || 1;
	const w0 = Math.max(0.05, width(0)) / 2;
	const w1 = Math.max(0.05, width(1)) / 2;
	const cap0: Vec = [c[0][0] + (d0[0] / d0l) * w0, c[0][1] + (d0[1] / d0l) * w0];
	const cap1: Vec = [c[n - 1][0] + (d1[0] / d1l) * w1, c[n - 1][1] + (d1[1] / d1l) * w1];
	// Both edges are smooth cubic splines through the offset samples; the ends are quadratic caps.
	const left = smooth(L, false);
	const right = smooth(R.slice().reverse(), false).replace(/^M[^C]*/, '');
	return `${left} Q${fmt(cap1)} ${fmt(R[n - 1])}${right} Q${fmt(cap0)} ${fmt(L[0])} Z`;
};

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
