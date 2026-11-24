// demoData.ts: data, boxes and the reveal schedule for the chart dev compositions (src/charts/dev/index.ts).
// Pure, so node scripts (pixel checks) compute exactly the props the compositions render.
import {storySeries, refLabel, syntheticChartData, type ChartData} from '../chartData.ts';
import type {Box, ChartOptions} from '../chartLayout.ts';
import type {RevealSegment} from '../revealPlan.ts';

/** Fictional token, seeded synthetic data: launch 30, chop 40, pump 6, distribution 14, rug 1, bleed 25 (5m candles). */
export const DEMO_SEED = 51;
export const DEMO_PAIR = '$DEMO / SOL';

export const demoData = (): ChartData => syntheticChartData({seed: DEMO_SEED, pair: DEMO_PAIR});
/** Shorts: 116 candles cannot keep 10 px slots in a 1080 px wide frame (L5), so the same series is merged to 10m candles. */
export const demoShortData = (): ChartData => syntheticChartData({seed: DEMO_SEED, pair: DEMO_PAIR, aggregate: 2});

// Boxes in output px (L1), inside the MO18 shot margins.
export const BOX_TEST: Box = {x: 96, y: 60, w: 1728, h: 960}; // 1920x1080, dark monitor-style panel
export const BOX_LIGHT: Box = {x: 260, y: 140, w: 1400, h: 800}; // 1920x1080, light card (smaller)
export const BOX_SHORT: Box = {x: 54, y: 300, w: 972, h: 1200}; // 1080x1920 portrait, laid out again (never scaled)

export const REVEAL_START = 6;
export const REVEAL_FRAMES = 300; // 10 s at 30 fps

/**
 * ChartReveal schedule from the story beats (A2, A10). 116 candles cannot all form live in 10 s (live needs >= 4 f per
 * candle: 464 f), so history pops on in step mode and the narrated beats (pump, rug) form live; the completed rug
 * candle holds 18 f (12-24 f) before the bleed continues.
 */
export const revealSegments = (d: ChartData): RevealSegment[] => {
	const beats = storySeries(d).beats;
	const at = (k: string) => {
		const b = beats.find((x) => x.kind === k);
		if (!b) throw new Error(`story has no ${k} beat`);
		return b;
	};
	const launch = at('launch'), chop = at('chop'), pump = at('pump'), dist = at('distribution'), rug = at('rug'), bleed = at('bleed');
	return [
		{from: launch.start, to: launch.end, mode: 'step', framesPerCandle: 1},
		{from: chop.start, to: chop.end, mode: 'step', framesPerCandle: 2},
		{from: pump.start, to: pump.end, mode: 'live', framesPerCandle: 8},
		{from: dist.start, to: dist.end, mode: 'step', framesPerCandle: 2},
		{from: rug.start, to: rug.end, mode: 'live', framesPerCandle: 12, holdAfter: 18},
		{from: bleed.start, to: bleed.end, mode: 'step', framesPerCandle: 2},
	];
};

/** The chart options of the all-candles demos, keyed by composition id (reveal is added per frame by ChartReveal). */
export const demoOptions = (): Record<'ChartTest' | 'ChartLight' | 'ChartShort', ChartOptions> => {
	const d = demoData();
	const callout = {candlesBack: 12, label: refLabel(12, d.intervalSec)}; // 12 x 5m = 'vs 1 h ago'
	const s = demoShortData();
	return {
		ChartTest: {data: d, box: BOX_TEST, surface: 'dark', callout, draft: true},
		ChartLight: {data: d, box: BOX_LIGHT, surface: 'light', callout, draft: true},
		ChartShort: {data: s, box: BOX_SHORT, surface: 'dark', callout: {candlesBack: 6, label: refLabel(6, s.intervalSec)}, draft: true},
	};
};
