/**
 * Chart scene planning (pure). Uses src/charts (read-only) for data, validation, layout and the reveal schedule:
 *  - data: seeded synthetic memecoin series (illustrative, validated with assertChartData), or a ChartData JSON file;
 *  - aggregation: the smallest k that gives candle slots >= 10 px in the scene's box (CHART_SPEC L5);
 *  - reveal (A2, A10): history pops on in step mode (2 f per candle), the pump and the rug form live, and the rug
 *    completes on its narrated word (onScreen.cues[1], default 60% of the speech), then holds 18 f before the bleed;
 *  - every frame of the shot is laid out once here (layoutChart throws on any broken rule) and checked for 1-frame states.
 */
import type {StoryboardScene, TimelineScene} from '../types.ts';
import {assertChartData, refLabel, storySeries, syntheticChartData, type ChartData} from '../../charts/chartData.ts';
import {layoutChart, type Box} from '../../charts/chartLayout.ts';
import {DEFAULT_STORY} from '../../charts/ohlc.ts';
import {flickerIssues, planReveal, revealStateAt, type RevealSegment} from '../../charts/revealPlan.ts';
import {findCueMs} from '../cues.ts';
import {msToFrame} from '../motion.ts';

export type ChartPlan = {
	data: ChartData;
	box: Box;
	segments: RevealSegment[] | null; // null: the whole series is shown from the first frame
	startFrame: number;
	callout: {candlesBack: number; label: string} | null;
	pumpDone: number | null; // frame the last pump candle completes
	rugDone: number | null; // frame the rug candle completes (the reaction beat follows)
	/** Added 2026-11-24 (review): frames the rug candle takes to form, ending on rugDone (null: no rug beat). */
	rugFrames: number | null;
	/** Added 2026-11-24 (review): frames the finished rug holds before the bleed steps on (null: no rug beat). */
	rugHold: number | null;
	revealEnd: number;
};

const AXIS_COL = 140;
const INSET = 36; // outline 4 + padding 32 (CHART_SPEC L2)
const MIN_SLOT = 10;

/** Smallest aggregation k (dividing the bar count) whose even slot is >= MIN_SLOT px in the box. */
export const chooseAggregate = (bars: number, box: Box): number => {
	const avail = box.w - 2 * INSET - AXIS_COL;
	for (let k = 1; k <= bars; k++) {
		if (bars % k) continue;
		const n = bars / k;
		if (2 * Math.floor(avail / n / 2) >= MIN_SLOT) return k;
	}
	throw new Error(`chart box ${box.w}px is too narrow for any aggregation of ${bars} bars`);
};

export const chartDataFor = (sc: StoryboardScene, box: Box, fileData?: ChartData): ChartData => {
	if (!sc.chart) throw new Error(`scene ${sc.id}: no chart`);
	if (fileData) return assertChartData(fileData);
	const seed = sc.chart.seed as number;
	const pair = String(sc.onScreen?.pair ?? '').trim();
	const bars = DEFAULT_STORY.reduce((a, b) => a + b.bars, 0);
	return syntheticChartData({seed, pair, aggregate: chooseAggregate(bars, box)});
};

export const planChart = (sc: StoryboardScene, tl: TimelineScene, data: ChartData, box: Box, fps: number, lang: string): ChartPlan => {
	const frames = msToFrame(tl.durationMs, fps);
	const speechEnd = msToFrame(tl.speechMs, fps);
	const perHour = Math.round(3600 / data.intervalSec);
	const callout = perHour >= 1 && perHour < data.candles.length ? {candlesBack: perHour, label: refLabel(perHour, data.intervalSec)} : null;
	const n = data.candles.length;
	if (data.source.kind !== 'synthetic') {
		// real data: plain left-to-right step reveal over the first part of the speech, if it fits; else shown whole
		const fpc = 2;
		const start = 10;
		const fits = start + n * fpc <= Math.max(frames - 30, 0);
		const segments: RevealSegment[] | null = fits ? [{from: 0, to: n - 1, mode: 'step', framesPerCandle: fpc}] : null;
		return {data, box, segments, startFrame: start, callout, pumpDone: null, rugDone: null, rugFrames: null, rugHold: null, revealEnd: fits ? start + n * fpc : 0};
	}
	const beats = storySeries(data).beats;
	const beat = (k: string) => beats.find((b) => b.kind === k) ?? null;
	const pump = beat('pump');
	const rug = beat('rug');
	const cues = Array.isArray(sc.onScreen?.cues) ? (sc.onScreen?.cues as string[]) : [];
	// target frame for the rug candle to complete: its cue word, else 60% of the speech
	const rugCueMs = cues[1] ? findCueMs(tl.words, cues[1], 0, lang) : null;
	const rugTarget = rugCueMs !== null ? msToFrame(rugCueMs, fps) : Math.round(Math.max(speechEnd, 60) * 0.6);
	const STEP = 2;
	if (!pump || !rug || rug.start !== rug.end) {
		// a story without the pump-and-rug shape: step through it if that ends with a hold, else show it whole
		const start = 10;
		const fits = start + n * STEP <= frames - 12;
		return {data, box, segments: fits ? [{from: 0, to: n - 1, mode: 'step', framesPerCandle: STEP}] : null, startFrame: start, callout, pumpDone: null, rugDone: null, rugFrames: null, rugHold: null, revealEnd: fits ? start + n * STEP : 0};
	}
	// candle ranges around the live beats (aggregated beats may share a candle: clamp so they stay contiguous)
	const pumpFrom = pump.start;
	const pumpTo = Math.max(pump.start, Math.min(pump.end, rug.start - 1));
	const rugAt = rug.start;
	const histCount = pumpFrom; // candles before the pump
	const pumpCount = pumpTo - pumpFrom + 1;
	const distCount = rugAt - pumpTo - 1;
	const tailCount = n - rugAt - 1;
	// The whole reveal must end, and the finished chart hold >= 12 f, inside the scene. Try the full pacing first,
	// then faster live beats (live >= 4 f per candle, A4; rug hold 12-24 f, A10); last resort: start earlier, so the
	// rug lands before its word ("on or just before", A10).
	const budgetEnd = frames - 12;
	const PACES = [
		{PUMP: 8, RUG: 12, HOLD: 18},
		{PUMP: 6, RUG: 10, HOLD: 14},
		{PUMP: 4, RUG: 8, HOLD: 12},
	];
	let chosen: {PUMP: number; RUG: number; HOLD: number; startFrame: number; before: number} | null = null;
	for (const p of PACES) {
		const before = histCount * STEP + pumpCount * p.PUMP + distCount * STEP + p.RUG;
		const total = before + p.HOLD + tailCount * STEP;
		const startFrame = Math.max(6, rugTarget - before);
		if (startFrame + total <= budgetEnd) {
			chosen = {...p, startFrame, before};
			break;
		}
	}
	if (!chosen) {
		const p = PACES[PACES.length - 1];
		const before = histCount * STEP + pumpCount * p.PUMP + distCount * STEP + p.RUG;
		const total = before + p.HOLD + tailCount * STEP;
		const startFrame = budgetEnd - total;
		if (startFrame < 6) throw new Error(`the chart reveal needs ${total + 18} frames but the scene has ${frames}: lengthen the narration or set minDurationSec`);
		chosen = {...p, startFrame, before};
	}
	const {PUMP, RUG, HOLD, startFrame, before} = chosen;
	const segs: RevealSegment[] = [];
	if (histCount > 0) segs.push({from: 0, to: histCount - 1, mode: 'step', framesPerCandle: STEP});
	segs.push({from: pumpFrom, to: pumpTo, mode: 'live', framesPerCandle: PUMP});
	if (distCount > 0) segs.push({from: pumpTo + 1, to: rugAt - 1, mode: 'step', framesPerCandle: STEP});
	segs.push({from: rugAt, to: rugAt, mode: 'live', framesPerCandle: RUG, holdAfter: HOLD});
	if (tailCount > 0) segs.push({from: rugAt + 1, to: n - 1, mode: 'step', framesPerCandle: STEP});
	const plan = planReveal(segs, startFrame, n);
	const pumpDone = startFrame + histCount * STEP + pumpCount * PUMP;
	const rugDone = startFrame + before;
	return {data, box, segments: segs, startFrame, callout, pumpDone, rugDone, rugFrames: RUG, rugHold: HOLD, revealEnd: plan.endFrame};
};

/** Lay out every frame of the shot (throws on any chart rule) and reject 1-frame states (A4, A8). */
export const checkChartPlan = (p: ChartPlan, frames: number, surface: 'dark' | 'light'): void => {
	const rp = p.segments ? planReveal(p.segments, p.startFrame, p.data.candles.length) : null;
	const models = [];
	for (let f = 0; f < frames; f++) {
		const st = rp ? revealStateAt(rp, f) : null;
		models.push(layoutChart({data: p.data, box: p.box, surface, callout: p.callout, reveal: st ? st.spec : null, calloutVisible: st ? st.calloutVisible : true}, f));
	}
	const flicker = rp ? flickerIssues(models) : [];
	if (flicker.length) throw new Error(`chart reveal has 1-frame states: ${flicker.slice(0, 4).join('; ')}`);
};

