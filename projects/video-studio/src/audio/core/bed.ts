/**
 * The gain law of a music bed under narration, from a few musical settings. Pure (no Remotion import);
 * <MusicBed> calls it with its absolute start and end.
 *
 * Defaults:
 *  - depthDb 12, attackMs 120, releaseMs 450 (the brief's), lookahead = attack (the duck is complete on
 *    the first word), pauses under 0.8 s stay ducked (the engine's split-duck value: critic round 2
 *    measured that filling them halves the mid-band blooms at the same intelligibility).
 *  - split: true. depthDb applies to Zoo's consonant band (700 Hz-5 kHz); the lows duck depthDb / 6 and
 *    the air depthDb / 3, i.e. 2 / 12 / 4 dB at the default: the engine's VOICE_DEPTHS, which the
 *    music critic measured as keeping the bed 2-3 LU more present than a broadband duck at a better
 *    band-audibility index. split: false is a plain broadband duck of depthDb.
 */
import {BedGain, DuckCurve, type DuckSource, type FadeCurve, type Rest, type Span} from './envelope.ts';
import {VOICE_CROSSOVERS} from './bands.ts';

export const SPLIT_DEPTH_RATIOS: readonly [number, number, number] = [1 / 6, 1, 1 / 3];

export type DuckSpec = {
	/** where Zoo speaks: absolute composition seconds */
	speech: readonly Span[];
	depthDb?: number;
	attackMs?: number;
	releaseMs?: number;
	lookaheadMs?: number;
	holdMs?: number;
	minGapMs?: number;
	/** band-split duck (default true) */
	split?: boolean;
	/** explicit per-band depths [low, mid, high] in dB (split only) */
	depthsDb?: readonly [number, number, number];
};

export const DUCK_DEFAULTS = {depthDb: 12, attackMs: 120, releaseMs: 450, minGapMs: 800, split: true} as const;

/**
 * "Music up" in long stretches without speech: the bed rises `db` (all bands) once a pause lasts at least
 * `minGapMs`, starting `delayMs` after the duck has released, and is back down before the next phrase's duck
 * starts. Off by default: a lift raises the bed's true peak by `db`, so use it with the master step
 * (src/audio/tools/master_mix.py), which holds the delivered mix under -1 dBTP.
 */
export type LiftSpec = {db: number; minGapMs?: number; delayMs?: number; rampMs?: number};
export const LIFT_DEFAULTS = {minGapMs: 1800, delayMs: 250, rampMs: 600} as const;

export type BedPlan = {
	gain: BedGain;
	/** band crossovers for the source split, or undefined for a broadband bed */
	crossovers: readonly number[] | undefined;
	/** the per-band depths actually used (dB), for cue sheets and checks */
	depthsDb: readonly number[];
	/** where the bed lifts (absolute seconds; empty without `lift`) */
	lifts: readonly Span[];
};

/** The spans where the bed lifts: pauses between ducks (and rests) at least minGapMs long, inside the bed. */
export const liftSpans = (o: {start: number; end: number; fadeInMs?: number; fadeOutMs?: number; duck: DuckCurve | null; rests?: readonly Rest[]; lift: LiftSpec}): Span[] => {
	const lf = {...LIFT_DEFAULTS, ...o.lift};
	const busy: Span[] = [];
	if (o.duck) {
		const look = (o.duck.timing.lookaheadMs ?? o.duck.timing.attackMs) / 1000;
		const tail = (o.duck.timing.holdMs + o.duck.timing.releaseMs) / 1000;
		for (const s of o.duck.spans) busy.push({start: s.start - look, end: s.end + tail});
	}
	for (const r of o.rests ?? []) busy.push({start: r.start - r.fadeOutMs / 1000, end: r.end + r.fadeInMs / 1000});
	busy.sort((a, b) => a.start - b.start);
	const lo = o.start + (o.fadeInMs ?? 0) / 1000;
	const hi = o.end - (o.fadeOutMs ?? 0) / 1000;
	const out: Span[] = [];
	let cur = lo;
	const ramp = lf.rampMs / 1000;
	const consider = (a: number, b: number) => {
		if (b - a < lf.minGapMs / 1000) return;
		const s = a + lf.delayMs / 1000;
		const e = b - ramp; // fully back down when the next duck (or rest, or the bed's fade-out) begins
		if (e - s > ramp) out.push({start: s, end: e});
	};
	for (const b of busy) {
		if (b.end <= cur) continue;
		if (b.start > cur) consider(cur, Math.min(b.start, hi));
		cur = Math.max(cur, b.end);
		if (cur >= hi) break;
	}
	if (cur < hi) consider(cur, hi);
	return out;
};

export const planBed = (o: {
	start: number;
	end: number;
	duck?: DuckSpec | null;
	lift?: LiftSpec | null;
	rests?: readonly Rest[];
	fadeInMs?: number;
	fadeOutMs?: number;
	/** the shape of the bed's own fades: 'raisedCosine' (default) or 'equalPower' (crossfades between different beds) */
	fadeCurve?: FadeCurve;
	/** the fade-out's shape, when it differs from the fade-in's */
	fadeOutCurve?: FadeCurve;
}): BedPlan => {
	const d = o.duck ?? null;
	const split = d ? d.split ?? DUCK_DEFAULTS.split : false;
	const depth = d?.depthDb ?? DUCK_DEFAULTS.depthDb;
	const depthsDb = !d ? [0] : split ? (d.depthsDb ? [...d.depthsDb] : SPLIT_DEPTH_RATIOS.map((r) => depth * r)) : [depth];
	const sources: DuckSource[] = d
		? [
				{
					curve: new DuckCurve(d.speech, {
						attackMs: d.attackMs ?? DUCK_DEFAULTS.attackMs,
						releaseMs: d.releaseMs ?? DUCK_DEFAULTS.releaseMs,
						lookaheadMs: d.lookaheadMs,
						holdMs: d.holdMs,
						minGapMs: d.minGapMs ?? DUCK_DEFAULTS.minGapMs,
					}),
					depthsDb,
				},
			]
		: [];
	const boosts: DuckSource[] = [];
	let lifts: Span[] = [];
	if (o.lift && o.lift.db > 0) {
		lifts = liftSpans({start: o.start, end: o.end, fadeInMs: o.fadeInMs, fadeOutMs: o.fadeOutMs, duck: sources[0]?.curve ?? null, rests: o.rests, lift: o.lift});
		const ramp = o.lift.rampMs ?? LIFT_DEFAULTS.rampMs;
		boosts.push({curve: new DuckCurve(lifts, {attackMs: ramp, releaseMs: ramp, lookaheadMs: 0, minGapMs: 0}), depthsDb: [o.lift.db]});
	}
	const gain = new BedGain({bands: split ? 3 : 1, sources, boosts, rests: o.rests, start: o.start, end: o.end, fadeInMs: o.fadeInMs, fadeOutMs: o.fadeOutMs, fadeCurve: o.fadeCurve, fadeOutCurve: o.fadeOutCurve});
	return {gain, crossovers: split ? VOICE_CROSSOVERS : undefined, depthsDb, lifts};
};
