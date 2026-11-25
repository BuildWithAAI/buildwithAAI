/**
 * Duck envelopes: how far a music bed is turned down, as a smooth function of time.
 *
 * Pure TypeScript (no Remotion import): the same maths runs in compositions, in Node scripts and in
 * tests, so what a test proves is what the render plays.
 *
 * Model (per duck source, e.g. "the narration"):
 *  - speech spans (seconds, composition time), merged when the pause between them is shorter than
 *    `minGapMs`, so the bed does not pump on every word gap;
 *  - each merged span ducks with a raised-cosine ramp: the ramp DOWN takes `attackMs` and starts
 *    `lookaheadMs` before the speech (lookahead = attack by default, so the duck is complete when the
 *    first word lands), the bed stays down for the span plus `holdMs`, then the ramp UP takes
 *    `releaseMs`;
 *  - the amount D(t) in [0, 1] of overlapping spans is their maximum (continuous, never a step);
 *  - the gain of band b is -depth[b] * D(t) dB. With one depth per band this is a broadband duck; the
 *    band-split duck (core/bands.ts) gives the speech band more depth than the lows and highs.
 *
 * Rests (a bed stepping out under a sting or a bumper) and fades are amplitude multipliers with the
 * same raised-cosine shape. Everything is C0-continuous with a continuous slope inside each ramp, so
 * when it is evaluated per sample (components/PcmTrack.tsx) there is no zipper noise and no click.
 */

export type Span = {readonly start: number; readonly end: number};

/** Raised cosine 0 -> 1 on x in [0, 1] (clamped). Zero slope at both ends. */
export const rcos = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));

/**
 * The shape of a bed's own fade-in and fade-out (added 2026-11-25 for the Episode's bed changes):
 *  - 'raisedCosine' (default): the amplitude follows rcos. A fade-in and a fade-out of the same length sum to constant
 *    AMPLITUDE (in + out = 1), right for one fade on its own or for two versions of the same, coherent recording.
 *  - 'equalPower': the amplitude follows sin(pi/2 * rcos(u)). A fade-in and a fade-out of the same length over the same
 *    frames sum to constant POWER (in^2 + out^2 = 1), so a crossfade between two UNCORRELATED beds (every measured pair
 *    of story beds has |r| < 0.15) neither dips 3 dB in the middle nor bumps.
 * Both start and end with zero slope (no corner, no click).
 */
export type FadeCurve = 'raisedCosine' | 'equalPower';

/** Fade amplitude at progress u in [0, 1] (0 = silent end, 1 = full), clamped. */
export const fadeShape = (u: number, curve: FadeCurve = 'raisedCosine'): number => (curve === 'equalPower' ? Math.sin((Math.PI / 2) * rcos(u)) : rcos(u));

export type DuckTiming = {
	/** Ramp-down time (ms). */
	attackMs: number;
	/** Ramp-up time (ms). */
	releaseMs: number;
	/** How long before the speech the ramp down STARTS (ms). Default: attackMs, so the duck is complete on the first word. */
	lookaheadMs?: number;
	/** Extra time the bed stays down after the speech ends (ms). Default 0. */
	holdMs?: number;
	/** Pauses shorter than this stay ducked (ms). Default 800 (the engine's split-duck value, critic round 2). */
	minGapMs?: number;
};

export const DEFAULT_MIN_GAP_MS = 800;

/** Sort, drop empty spans and merge spans that overlap or whose gap is shorter than `minGap` seconds. */
export const mergeSpans = (spans: readonly Span[], minGap = 0): Span[] => {
	const sorted = spans.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start).slice().sort((a, b) => a.start - b.start);
	const out: {start: number; end: number}[] = [];
	for (const s of sorted) {
		const last = out[out.length - 1];
		if (last && s.start - last.end < minGap) last.end = Math.max(last.end, s.end);
		else out.push({start: s.start, end: s.end});
	}
	return out;
};

/** Spans shifted by `offset` seconds (e.g. a narration that starts after a 4 s sting). */
export const shiftSpans = (spans: readonly Span[], offset: number): Span[] => spans.map((s) => ({start: s.start + offset, end: s.end + offset}));

type Ramp = {
	/** ramp down: starts at a0, complete at a1 */
	a0: number;
	a1: number;
	/** ramp up: starts at r0, complete at r1 */
	r0: number;
	r1: number;
};

/**
 * The duck amount D(t) in [0, 1] of one source: 1 = fully ducked. Build once, evaluate per sample.
 * Evaluation is O(log n + k) where k (overlapping ramps) is 1-3 in practice.
 */
export class DuckCurve {
	readonly spans: readonly Span[];
	readonly timing: Required<DuckTiming>;
	private readonly ramps: Ramp[];
	/** Longest distance from a ramp's a0 back to an earlier ramp still releasing: bounds the backward scan. */
	private readonly maxTail: number;

	constructor(spans: readonly Span[], timing: DuckTiming) {
		const attack = Math.max(0, timing.attackMs) / 1000;
		const release = Math.max(0, timing.releaseMs) / 1000;
		const t: Required<DuckTiming> = {
			attackMs: Math.max(0, timing.attackMs),
			releaseMs: Math.max(0, timing.releaseMs),
			lookaheadMs: Math.max(0, timing.lookaheadMs ?? timing.attackMs),
			holdMs: Math.max(0, timing.holdMs ?? 0),
			minGapMs: Math.max(0, timing.minGapMs ?? DEFAULT_MIN_GAP_MS),
		};
		for (const [k, v] of Object.entries(t)) if (!Number.isFinite(v)) throw new Error(`duck timing ${k} must be a finite number`);
		this.timing = t;
		this.spans = mergeSpans(spans, t.minGapMs / 1000);
		const look = t.lookaheadMs / 1000;
		const hold = t.holdMs / 1000;
		this.ramps = this.spans.map((s) => {
			const a0 = s.start - look;
			return {a0, a1: a0 + attack, r0: s.end + hold, r1: s.end + hold + release};
		});
		let tail = 0;
		for (const r of this.ramps) tail = Math.max(tail, r.r1 - r.a0);
		this.maxTail = tail;
	}

	/**
	 * D(t) of one ramp: the minimum of the rising attack curve and the falling release curve, so a span
	 * shorter than the attack releases from wherever the attack had got to (continuous, never a jump).
	 */
	private static one(r: Ramp, t: number): number {
		if (t <= r.a0 || t >= r.r1) return 0;
		const up = r.a1 > r.a0 ? rcos((t - r.a0) / (r.a1 - r.a0)) : 1;
		const down = t <= r.r0 ? 1 : rcos((r.r1 - t) / (r.r1 - r.r0));
		return Math.min(up, down);
	}

	/** Index of the last ramp with a0 <= t, or -1. */
	private lastStartingBefore(t: number): number {
		let lo = 0;
		let hi = this.ramps.length - 1;
		let ans = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (this.ramps[mid].a0 <= t) {
				ans = mid;
				lo = mid + 1;
			} else hi = mid - 1;
		}
		return ans;
	}

	/** The duck amount at time t (seconds). */
	at(t: number): number {
		let i = this.lastStartingBefore(t);
		let d = 0;
		while (i >= 0) {
			const r = this.ramps[i];
			if (t - r.a0 > this.maxTail) break;
			d = Math.max(d, DuckCurve.one(r, t));
			if (d >= 1) return 1;
			i--;
		}
		return d;
	}

	/** True when no ramp touches [t0, t1]: the curve is 0 there (fast path for per-frame work). */
	isIdle(t0: number, t1: number): boolean {
		const i = this.lastStartingBefore(t1);
		for (let k = i; k >= 0; k--) {
			const r = this.ramps[k];
			if (r.r1 > t0) return false;
			if (t1 - r.a0 > this.maxTail) break;
		}
		return true;
	}
}

/** One source of ducking with its per-band depth in dB (one entry = broadband). */
export type DuckSource = {curve: DuckCurve; depthsDb: readonly number[]};

/**
 * An amplitude window: the bed fades out before `start` and back in after `end` (a sting or bumper plays alone).
 * `floorDb` (optional, added 2026-11-25): the level the bed rests at, in dB (e.g. -18): a dip instead of silence, so a
 * rest under Kokoro's digital-zero pauses never drops the mix to black. Omitted: silence.
 */
export type Rest = {start: number; end: number; fadeOutMs: number; fadeInMs: number; floorDb?: number};

/**
 * The full gain law of a bed: per-band ducks, rests and the bed's own fades.
 * `bands` is the number of gain values per instant (1 broadband, 3 for the band-split duck).
 */
export class BedGain {
	readonly bands: number;
	private readonly sources: readonly DuckSource[];
	private readonly rests: readonly Rest[];
	private readonly fadeIn: number;
	private readonly fadeOut: number;
	private readonly fadeCurve: FadeCurve;
	private readonly fadeOutCurve: FadeCurve;
	private readonly start: number;
	private readonly end: number;

	private readonly boosts: readonly DuckSource[];

	/**
	 * `boosts` lift the bed instead of ducking it (dB > 0 where their curve is 1): the bed comes up in long
	 * music-only stretches (core/bed.ts lift). The gain in dB is the highest boost minus the deepest duck.
	 */
	constructor(opts: {
		bands: number;
		sources?: readonly DuckSource[];
		boosts?: readonly DuckSource[];
		rests?: readonly Rest[];
		start: number;
		end: number;
		fadeInMs?: number;
		fadeOutMs?: number;
		/** the shape of the bed's own fades (default 'raisedCosine'; rests always use the raised cosine) */
		fadeCurve?: FadeCurve;
		/** the fade-out's shape when it differs from the fade-in's (e.g. in from silence, out into another bed) */
		fadeOutCurve?: FadeCurve;
	}) {
		if (!Number.isInteger(opts.bands) || opts.bands < 1) throw new Error('bands must be a positive integer');
		for (const s of [...(opts.sources ?? []), ...(opts.boosts ?? [])]) {
			if (s.depthsDb.length !== 1 && s.depthsDb.length !== opts.bands) throw new Error(`a duck source has ${s.depthsDb.length} depths for ${opts.bands} band(s)`);
			if (s.depthsDb.some((d) => !Number.isFinite(d) || d < 0)) throw new Error('duck depths must be finite and >= 0 dB');
		}
		for (const r of opts.rests ?? []) {
			if (!(r.end >= r.start) || r.fadeOutMs < 0 || r.fadeInMs < 0) throw new Error('a rest needs end >= start and fades >= 0');
			if (r.floorDb !== undefined && !(Number.isFinite(r.floorDb) && r.floorDb <= 0)) throw new Error('a rest floorDb must be a finite number <= 0 dB');
		}
		if (!(opts.end > opts.start)) throw new Error('the bed must end after it starts');
		const curve = opts.fadeCurve ?? 'raisedCosine';
		const outCurve = opts.fadeOutCurve ?? curve;
		for (const c of [curve, outCurve]) if (c !== 'raisedCosine' && c !== 'equalPower') throw new Error(`unknown fade curve "${String(c)}"`);
		this.bands = opts.bands;
		this.sources = opts.sources ?? [];
		this.boosts = opts.boosts ?? [];
		this.rests = (opts.rests ?? []).slice().sort((a, b) => a.start - b.start);
		this.fadeIn = Math.max(0, opts.fadeInMs ?? 0) / 1000;
		this.fadeOut = Math.max(0, opts.fadeOutMs ?? 0) / 1000;
		this.fadeCurve = curve;
		this.fadeOutCurve = outCurve;
		this.start = opts.start;
		this.end = opts.end;
	}

	/** Amplitude factor of rests and fades at t (0..1), shared by every band. */
	amplitude(t: number): number {
		if (t < this.start || t >= this.end) return 0;
		let a = 1;
		if (this.fadeIn > 0 && t < this.start + this.fadeIn) a *= fadeShape((t - this.start) / this.fadeIn, this.fadeCurve);
		if (this.fadeOut > 0 && t > this.end - this.fadeOut) a *= fadeShape((this.end - t) / this.fadeOut, this.fadeOutCurve);
		for (const r of this.rests) {
			const out = r.fadeOutMs / 1000;
			const inn = r.fadeInMs / 1000;
			if (t <= r.start - out || t >= r.end + inn) continue;
			// the rest's floor (silence unless floorDb is given); the fades move between 1 and it on a raised cosine
			const fl = r.floorDb === undefined ? 0 : 10 ** (r.floorDb / 20);
			if (t < r.start) a *= fl + (1 - fl) * rcos((r.start - t) / out);
			else if (t <= r.end) a *= fl;
			else a *= fl + (1 - fl) * rcos((t - r.end) / inn);
		}
		return a;
	}

	/** Gain change in dB for band b at t: the highest boost minus the deepest duck (0 when neither acts). */
	duckDb(t: number, b = 0): number {
		const strongest = (list: readonly DuckSource[]) => {
			let top = 0;
			for (const s of list) {
				const depth = s.depthsDb.length === 1 ? s.depthsDb[0] : s.depthsDb[b];
				if (depth <= 0) continue;
				const d = depth * s.curve.at(t);
				if (d > top) top = d;
			}
			return top;
		};
		return strongest(this.boosts) - strongest(this.sources);
	}

	/** Linear gain of band b at t. */
	gain(t: number, b = 0): number {
		const a = this.amplitude(t);
		if (a === 0) return 0;
		const db = this.duckDb(t, b);
		return db === 0 ? a : a * 10 ** (db / 20);
	}

	/** Fill `out[b][i]` with the gain of band b at time t0 + i / sampleRate (per-sample automation). */
	fill(out: Float32Array[], t0: number, sampleRate: number): void {
		const n = out[0].length;
		for (let b = 0; b < this.bands; b++) if (out[b].length !== n) throw new Error('band buffers differ in length');
		const t1 = t0 + n / sampleRate;
		const idle = [...this.sources, ...this.boosts].every((s) => s.curve.isIdle(t0, t1));
		for (let i = 0; i < n; i++) {
			const t = t0 + i / sampleRate;
			const a = this.amplitude(t);
			for (let b = 0; b < this.bands; b++) out[b][i] = a === 0 ? 0 : idle ? a : a * 10 ** (this.duckDb(t, b) / 20);
		}
	}
}

/** dB <-> linear helpers. */
export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (g: number): number => (g <= 0 ? -Infinity : 20 * Math.log10(g));
