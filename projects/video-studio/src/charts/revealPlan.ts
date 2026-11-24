// revealPlan.ts: a beat-to-frame reveal schedule for one shot (CHART_SPEC 6, A2 and A10), expressed only as
// revealAt() specs. History pops on in 'step' mode, the narrated beats form in 'live' mode, and a hold keeps the
// completed candle (the rug) on screen before the reaction beat. Pure; the composition picks the spec per frame.
import type {RevealSpec} from './chartLayout.ts';

/** Candles from..to (inclusive), revealed in one mode; holdAfter frames then show them completed with nothing forming. */
export type RevealSegment = {from: number; to: number; mode: 'step' | 'live'; framesPerCandle: number; holdAfter?: number};
export type RevealPhase = {startF: number; endF: number; spec: RevealSpec}; // frames [startF, endF)
export type RevealPlan = {phases: RevealPhase[]; endFrame: number};

export const planReveal = (segments: RevealSegment[], startFrame: number, candleCount: number): RevealPlan => {
	const phases: RevealPhase[] = [];
	let f = startFrame;
	let next = 0;
	for (const s of segments) {
		if (s.from !== next || s.to < s.from) throw new Error(`reveal segments must be contiguous from candle 0: got ${s.from}..${s.to}, expected ${next}`);
		if (s.mode === 'live' && s.framesPerCandle < 4) throw new Error('live segments need framesPerCandle >= 4 (A4)');
		const len = (s.to - s.from + 1) * s.framesPerCandle;
		// revealAt counts candles from startFrame, so shift it back: candle `from` starts exactly at frame f.
		phases.push({startF: f, endF: f + len, spec: {mode: s.mode, startFrame: f - s.from * s.framesPerCandle, framesPerCandle: s.framesPerCandle}});
		f += len;
		if (s.holdAfter) {
			// a step spec whose window for candle `to` is the whole hold: candles 0..to shown, all complete
			phases.push({startF: f, endF: f + s.holdAfter, spec: {mode: 'step', startFrame: f - s.to * s.holdAfter, framesPerCandle: s.holdAfter}});
			f += s.holdAfter;
		}
		next = s.to + 1;
	}
	if (next !== candleCount) throw new Error(`reveal segments cover ${next} of ${candleCount} candles`);
	return {phases, endFrame: f};
};

/** The revealAt spec for frame f: before the plan, the first (nothing shown); after it, the last (everything shown). */
export const revealSpecAt = (plan: RevealPlan, f: number): RevealSpec => {
	const p = plan.phases.find((x) => f >= x.startF && f < x.endF);
	if (p) return p.spec;
	return f < plan.phases[0].startF ? plan.phases[0].spec : plan.phases[plan.phases.length - 1].spec;
};
