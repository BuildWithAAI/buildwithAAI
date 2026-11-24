/**
 * Small, tested statistics for the retention report: descriptive helpers, Student's t (CDF and quantile through the
 * regularized incomplete beta function), one-sample/paired and Welch t intervals, a least-squares slope, and the
 * Benjamini-Hochberg false discovery rate adjustment. No dependencies.
 */

export const finite = (values: readonly (number | null | undefined)[]): number[] =>
	values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

export const mean = (values: readonly number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/** Sample variance (n - 1); null below 2 values. */
export const variance = (values: readonly number[]): number | null => {
	if (values.length < 2) return null;
	const m = mean(values) as number;
	return values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
};

export const sd = (values: readonly number[]): number | null => {
	const v = variance(values);
	return v === null ? null : Math.sqrt(v);
};

/** Linear-interpolation quantile (type 7, the R and NumPy default). */
export const quantile = (values: readonly number[], p: number): number | null => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const h = (sorted.length - 1) * Math.min(1, Math.max(0, p));
	const lo = Math.floor(h);
	const hi = Math.ceil(h);
	return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
};

export const median = (values: readonly number[]): number | null => quantile(values, 0.5);

/* ------------------------------------------------------------------ Student's t */

const LANCZOS = [
	0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
	9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) (Lanczos approximation, g = 7), accurate to about 1e-13 for x > 0. */
export const logGamma = (x: number): number => {
	if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
	const z = x - 1;
	let a = LANCZOS[0]!;
	const t = z + 7.5;
	for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i]! / (z + i);
	return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
};

/** Continued fraction for the incomplete beta function (modified Lentz). */
const betaContinuedFraction = (a: number, b: number, x: number): number => {
	const tiny = 1e-300;
	const qab = a + b;
	const qap = a + 1;
	const qam = a - 1;
	let c = 1;
	let d = 1 - (qab * x) / qap;
	if (Math.abs(d) < tiny) d = tiny;
	d = 1 / d;
	let h = d;
	for (let m = 1; m <= 500; m++) {
		const m2 = 2 * m;
		let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < tiny) d = tiny;
		c = 1 + aa / c;
		if (Math.abs(c) < tiny) c = tiny;
		d = 1 / d;
		h *= d * c;
		aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < tiny) d = tiny;
		c = 1 + aa / c;
		if (Math.abs(c) < tiny) c = tiny;
		d = 1 / d;
		const delta = d * c;
		h *= delta;
		if (Math.abs(delta - 1) < 1e-15) break;
	}
	return h;
};

/** Regularized incomplete beta I_x(a, b). */
export const betaIncReg = (a: number, b: number, x: number): number => {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
	return x < (a + 1) / (a + b + 2) ? (front * betaContinuedFraction(a, b, x)) / a : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
};

/** Two-sided p-value of a t statistic. */
export const tTwoSidedP = (t: number, df: number): number => {
	if (!Number.isFinite(t)) return 0;
	return Math.min(1, betaIncReg(df / 2, 0.5, df / (df + t * t)));
};

export const tCdf = (t: number, df: number): number => {
	const tail = 0.5 * tTwoSidedP(t, df);
	return t >= 0 ? 1 - tail : tail;
};

/** Quantile of Student's t (bisection on the CDF; 200 halvings is far below double precision). */
export const tQuantile = (p: number, df: number): number => {
	if (p <= 0 || p >= 1) throw new Error('tQuantile needs 0 < p < 1');
	let lo = -1;
	let hi = 1;
	while (tCdf(lo, df) > p) lo *= 2;
	while (tCdf(hi, df) < p) hi *= 2;
	for (let i = 0; i < 200; i++) {
		const mid = (lo + hi) / 2;
		if (tCdf(mid, df) < p) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
};

/* ------------------------------------------------------------------ tests */

export type TResult = {
	n: number;
	estimate: number;
	se: number;
	df: number;
	t: number;
	p: number;
	ci95: [number, number];
};

const fromEstimate = (n: number, estimate: number, se: number, df: number): TResult => {
	if (se === 0) {
		// every observation identical: no sampling spread to test against
		return {n, estimate, se, df, t: estimate === 0 ? 0 : Math.sign(estimate) * Infinity, p: estimate === 0 ? 1 : 0, ci95: [estimate, estimate]};
	}
	const t = estimate / se;
	const crit = tQuantile(0.975, df);
	return {n, estimate, se, df, t, p: tTwoSidedP(t, df), ci95: [estimate - crit * se, estimate + crit * se]};
};

/** One-sample t on the values (use with per-unit paired differences). Null below 2 values. */
export const oneSampleT = (values: readonly number[]): (TResult & {sd: number; dz: number | null}) | null => {
	if (values.length < 2) return null;
	const m = mean(values) as number;
	const s = sd(values) as number;
	const result = fromEstimate(values.length, m, s / Math.sqrt(values.length), values.length - 1);
	return {...result, sd: s, dz: s > 0 ? m / s : null};
};

/** Welch's two-sample t on a - b. Null unless both groups have at least 2 values. */
export const welchT = (a: readonly number[], b: readonly number[]): (TResult & {meanA: number; meanB: number; g: number | null}) | null => {
	if (a.length < 2 || b.length < 2) return null;
	const ma = mean(a) as number;
	const mb = mean(b) as number;
	const va = variance(a) as number;
	const vb = variance(b) as number;
	const sa = va / a.length;
	const sb = vb / b.length;
	const se = Math.sqrt(sa + sb);
	const df = se === 0 ? a.length + b.length - 2 : (sa + sb) ** 2 / (sa ** 2 / (a.length - 1) + sb ** 2 / (b.length - 1));
	const result = fromEstimate(a.length + b.length, ma - mb, se, df);
	// Hedges' g: pooled SD with the small-sample correction
	const pooled = Math.sqrt(((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2));
	const correction = 1 - 3 / (4 * (a.length + b.length) - 9);
	return {...result, meanA: ma, meanB: mb, g: pooled > 0 ? ((ma - mb) / pooled) * correction : null};
};

/** Least-squares slope of y on x with its t interval. Null below 3 points or when x does not vary. */
export const olsSlope = (x: readonly number[], y: readonly number[]): (TResult & {intercept: number; r2: number}) | null => {
	const n = Math.min(x.length, y.length);
	if (n < 3) return null;
	const mx = mean(x.slice(0, n)) as number;
	const my = mean(y.slice(0, n)) as number;
	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	for (let i = 0; i < n; i++) {
		sxx += (x[i]! - mx) ** 2;
		sxy += (x[i]! - mx) * (y[i]! - my);
		syy += (y[i]! - my) ** 2;
	}
	if (sxx === 0) return null;
	const slope = sxy / sxx;
	const intercept = my - slope * mx;
	const sse = Math.max(0, syy - slope * sxy);
	const se = Math.sqrt(sse / (n - 2) / sxx);
	return {...fromEstimate(n, slope, se, n - 2), intercept, r2: syy > 0 ? 1 - sse / syy : 0};
};

/** Benjamini-Hochberg adjusted p-values (q-values), in the input order. */
export const benjaminiHochberg = (pValues: readonly number[]): number[] => {
	const m = pValues.length;
	const order = pValues.map((p, i) => ({p, i})).sort((a, b) => a.p - b.p);
	const q = new Array<number>(m).fill(1);
	let running = 1;
	for (let rank = m; rank >= 1; rank--) {
		const item = order[rank - 1]!;
		running = Math.min(running, (item.p * m) / rank);
		q[item.i] = Math.min(1, running);
	}
	return q;
};

/* ------------------------------------------------------------------ deterministic randomness (synthetic data only) */

/** mulberry32: a small seeded PRNG, used only to make synthetic fixtures reproducible. */
export const seededRandom = (seed: number): (() => number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

/** Standard normal draw from a uniform source (Box-Muller). */
export const normalDraw = (random: () => number): number => {
	const u = Math.max(random(), 1e-12);
	const v = random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ------------------------------------------------------------------ least squares */

/** Inverse of a symmetric positive (semi)definite matrix by Gauss-Jordan with pivoting; null when singular. */
export const invert = (matrix: readonly (readonly number[])[]): number[][] | null => {
	const n = matrix.length;
	const a = matrix.map((row, i) => [...row, ...Array.from({length: n}, (_, j) => (i === j ? 1 : 0))]);
	const scale = Math.max(1e-300, ...matrix.map((row, i) => Math.abs(row[i]!)));
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
		if (Math.abs(a[pivot]![col]!) < 1e-10 * scale) return null;
		[a[col], a[pivot]] = [a[pivot]!, a[col]!];
		const p = a[col]![col]!;
		for (let j = 0; j < 2 * n; j++) a[col]![j]! /= p;
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const f = a[r]![col]!;
			if (f === 0) continue;
			for (let j = 0; j < 2 * n; j++) a[r]![j]! -= f * a[col]![j]!;
		}
	}
	return a.map((row) => row.slice(n));
};

/** Weighted least squares (weights default to 1); null when the design is singular. */
export const leastSquares = (X: readonly (readonly number[])[], y: readonly number[], w?: readonly number[]): {beta: number[]; xtxInv: number[][]} | null => {
	const p = X[0]?.length ?? 0;
	if (!p || X.length < p) return null;
	const xtx = Array.from({length: p}, () => new Array<number>(p).fill(0));
	const xty = new Array<number>(p).fill(0);
	X.forEach((row, i) => {
		const wi = w ? w[i]! : 1;
		for (let a = 0; a < p; a++) {
			xty[a]! += wi * row[a]! * y[i]!;
			for (let b = 0; b < p; b++) xtx[a]![b]! += wi * row[a]! * row[b]!;
		}
	});
	const xtxInv = invert(xtx);
	if (!xtxInv) return null;
	return {beta: xtxInv.map((row) => row.reduce((acc, v, j) => acc + v * xty[j]!, 0)), xtxInv};
};

/**
 * OLS with cluster-robust (CR1) standard errors: clusters are episodes, so the language versions and scenes of one
 * episode are not treated as independent. Intervals use Student's t with G - 1 degrees of freedom (G clusters), the
 * usual small-sample choice; with few clusters they are still approximate. Null when singular or G < 2.
 */
export const clusteredOls = (
	X: readonly (readonly number[])[],
	y: readonly number[],
	clusters: readonly string[],
): {beta: number[]; se: number[]; vcov: number[][]; df: number; clusters: number; n: number; sse: number} | null => {
	const fit = leastSquares(X, y);
	if (!fit) return null;
	const n = X.length;
	const p = X[0]!.length;
	const groups = new Map<string, number[]>();
	clusters.forEach((c, i) => groups.set(c, [...(groups.get(c) ?? []), i]));
	const G = groups.size;
	if (G < 2 || n <= p) return null;
	const meat = Array.from({length: p}, () => new Array<number>(p).fill(0));
	let sse = 0;
	for (const rows of groups.values()) {
		const u = new Array<number>(p).fill(0);
		for (const i of rows) {
			const r = y[i]! - X[i]!.reduce((acc, v, j) => acc + v * fit.beta[j]!, 0);
			sse += r * r;
			for (let a = 0; a < p; a++) u[a]! += X[i]![a]! * r;
		}
		for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) meat[a]![b]! += u[a]! * u[b]!;
	}
	const c = (G / (G - 1)) * ((n - 1) / (n - p));
	const A = fit.xtxInv;
	const vcov = A.map((_, a) =>
		A.map((__, b) => {
			let v = 0;
			for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) v += A[a]![i]! * meat[i]![j]! * A[j]![b]!;
			return c * v;
		}),
	);
	const se = vcov.map((row, a) => Math.sqrt(Math.max(0, row[a]!)));
	return {beta: fit.beta, se, vcov, df: G - 1, clusters: G, n, sse};
};

/** A coefficient as a t result (estimate, interval, p) with the given degrees of freedom. */
export const coefficientT = (estimate: number, se: number, df: number, n: number): TResult => fromEstimate(n, estimate, se, df);
