// revealPlan.ts: a beat-to-frame reveal schedule for one shot (CHART_SPEC 6, A2 and A10), expressed only as
// revealAt() specs. History pops on in 'step' mode, the narrated beats form in 'live' mode, and a hold keeps the
// completed candle (the rug) on screen before the reaction beat. Pure; the composition picks the spec per frame.
import type {ChartModel, RevealSpec} from './chartLayout.ts';

/** Candles from..to (inclusive), revealed in one mode; holdAfter frames then show them completed with nothing forming. */
export type RevealSegment = {from: number; to: number; mode: 'step' | 'live'; framesPerCandle: number; holdAfter?: number};
// frames [startF, endF). calloutVisible: the change callout shows during live candles and holds only. In a step segment a
// new candle completes every 2 f, so the callout would change every 2 f (a slot machine, against A8 and P5).
export type RevealPhase = {startF: number; endF: number; spec: RevealSpec; calloutVisible: boolean};
export type RevealPlan = {phases: RevealPhase[]; endFrame: number};
export type RevealState = {spec: RevealSpec; calloutVisible: boolean};

/**
 * Step segments need >= 2 f per candle: at 1 f the pill's colour, price and position, and the tick labels it hides,
 * change on every frame (1-frame states, against A4). Live segments need >= 4 f (A4).
 */
export const MIN_STEP_FRAMES = 2;

export const planReveal = (segments: RevealSegment[], startFrame: number, candleCount: number): RevealPlan => {
	const phases: RevealPhase[] = [];
	let f = startFrame;
	let next = 0;
	for (const s of segments) {
		if (s.from !== next || s.to < s.from) throw new Error(`reveal segments must be contiguous from candle 0: got ${s.from}..${s.to}, expected ${next}`);
		if (s.mode === 'live' && s.framesPerCandle < 4) throw new Error('live segments need framesPerCandle >= 4 (A4)');
		if (s.mode === 'step' && s.framesPerCandle < MIN_STEP_FRAMES) throw new Error(`step segments need framesPerCandle >= ${MIN_STEP_FRAMES}: at 1 f/candle the pill and labels change every frame`);
		if (s.holdAfter !== undefined && s.holdAfter < 2) throw new Error('a hold needs >= 2 frames');
		const len = (s.to - s.from + 1) * s.framesPerCandle;
		// revealAt counts candles from startFrame, so shift it back: candle `from` starts exactly at frame f.
		phases.push({startF: f, endF: f + len, spec: {mode: s.mode, startFrame: f - s.from * s.framesPerCandle, framesPerCandle: s.framesPerCandle}, calloutVisible: s.mode === 'live'});
		f += len;
		if (s.holdAfter) {
			// a step spec whose window for candle `to` is the whole hold: candles 0..to shown, all complete
			phases.push({startF: f, endF: f + s.holdAfter, spec: {mode: 'step', startFrame: f - s.to * s.holdAfter, framesPerCandle: s.holdAfter}, calloutVisible: true});
			f += s.holdAfter;
		}
		next = s.to + 1;
	}
	if (next !== candleCount) throw new Error(`reveal segments cover ${next} of ${candleCount} candles`);
	return {phases, endFrame: f};
};

/** The reveal state at frame f: before the plan, the first phase (nothing shown); after it, every candle and the callout. */
export const revealStateAt = (plan: RevealPlan, f: number): RevealState => {
	const p = plan.phases.find((x) => f >= x.startF && f < x.endF);
	if (p) return {spec: p.spec, calloutVisible: p.calloutVisible};
	if (f < plan.phases[0].startF) return {spec: plan.phases[0].spec, calloutVisible: false};
	return {spec: plan.phases[plan.phases.length - 1].spec, calloutVisible: true};
};
export const revealSpecAt = (plan: RevealPlan, f: number): RevealSpec => revealStateAt(plan, f).spec;

/**
 * 1-frame states over a shot's consecutive frames: for every element the viewer reads (the candles, volume bars, pill,
 * dashed last-price line, tick labels, callout), each state must last >= 2 frames (A4: no intermediate colour or level
 * lasts a single frame; A8: a number never flickers). Returns one message per violation; empty means none.
 */
export const flickerIssues = (models: ChartModel[]): string[] => {
	const parts: Record<string, (m: ChartModel) => unknown> = {
		candles: (m) => m.candles.map((c) => [c.fill, c.wick, c.body]),
		volume: (m) => m.volume,
		pill: (m) => m.pill,
		lastLine: (m) => m.lastLine.length && m.lastLine[0].y,
		tickLabels: (m) => m.tickLabels.map((t) => t.text),
		callout: (m) => m.callout && [m.callout.dir, m.callout.label.text],
	};
	const out: string[] = [];
	for (const [name, sig] of Object.entries(parts)) {
		const keys = models.map((m) => JSON.stringify(sig(m)));
		let start = 0;
		for (let f = 1; f <= keys.length; f++) {
			if (f < keys.length && keys[f] === keys[start]) continue;
			if (f - start < 2) out.push(`${name}: 1-frame state at frame ${start}`);
			start = f;
		}
	}
	return out;
};
