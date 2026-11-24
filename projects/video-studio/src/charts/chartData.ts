// chartData.ts: the ChartData contract (CHART_SPEC 1), its validation entry point, the synthetic builder,
// candle aggregation (L5: "aggregate to a longer interval") and the label helpers every chart text comes from (R2).
import {DEFAULT_STORY, generate, toMarketCap, type Beat, type Candle, type Series} from './ohlc.ts';
import {assertValid} from './validate.ts';

/** Everything a chart needs. Lives in storyboard props or a JSON file; never fetched at render time. */
export type ChartData = {
	pair: string; // '$ZOO / SOL' (text only, no third-party logos)
	intervalSec: number; // 60 | 300 | 900 | 3600 | 14400 | 86400
	unit: 'price' | 'mcap'; // memecoins: 'mcap' (USD)
	candles: Candle[]; // already in the plotted unit (toMarketCap for mcap)
	illustrative: boolean; // true for every synthetic or fictional series
	source:
		// aggregate (optional): the series was generated at intervalSec / aggregate and merged `aggregate` candles at a
		// time (aggregateCandles); `story` stays in generated bars, so generate(seed, story) still reproduces it.
		| {kind: 'synthetic'; seed: number; story: Beat[]; aggregate?: number}
		| {kind: 'geckoterminal' | 'coingecko'; url: string; fetchedAt: string; attribution: string};
};

const SUPPLY = 1_000_000_000; // pump.fun supply (ohlc.ts); validateStory does not read it

/**
 * Merge every k consecutive candles into one: o = first open, h = max high, l = min low, c = last close,
 * v = summed volume, ticks concatenated (so a merged candle can still form, and V8 holds exactly).
 */
export const aggregateCandles = (cs: Candle[], k: number): Candle[] => {
	if (!Number.isInteger(k) || k < 1 || cs.length % k !== 0) throw new Error(`aggregateCandles: ${cs.length} candles do not split into whole groups of ${k}`);
	const out: Candle[] = [];
	for (let i = 0; i < cs.length; i += k) {
		const g = cs.slice(i, i + k);
		const merged: Candle = {
			t: g[0].t,
			o: g[0].o,
			h: Math.max(...g.map((c) => c.h)),
			l: Math.min(...g.map((c) => c.l)),
			c: g[k - 1].c,
			v: g.reduce((s, c) => s + c.v, 0),
		};
		out.push(g.every((c) => c.ticks) ? {...merged, ticks: g.flatMap((c) => c.ticks ?? [])} : merged);
	}
	return out;
};

/** The story beats of a synthetic ChartData, mapped onto its (possibly aggregated) candle indices. */
export const storySeries = (d: ChartData): Series => {
	if (d.source.kind !== 'synthetic') throw new Error('storySeries: not a synthetic series');
	const k = d.source.aggregate ?? 1;
	let i = 0;
	const beats = d.source.story.map((b) => {
		const start = i;
		i += b.bars;
		return {...b, start: Math.floor(start / k), end: Math.floor((i - 1) / k)};
	});
	if (i % k !== 0 || i / k !== d.candles.length) throw new Error(`story has ${i} bars (aggregate ${k}) but the series has ${d.candles.length} candles`);
	return {candles: d.candles, beats, supply: SUPPLY};
};

/**
 * Validate a ChartData and throw on any issue (CHART_SPEC 2). Synthetic data: exact continuity, story checks, and it
 * must be marked illustrative (CD3). Real DEX data: 0.5% open-vs-previous-close tolerance.
 */
export const assertChartData = (d: ChartData): ChartData => {
	const synthetic = d.source.kind === 'synthetic';
	if (synthetic && !d.illustrative) throw new Error('A synthetic series must be marked illustrative (CD3; PROJECT_INSTRUCTIONS: fictional examples are clearly identified)');
	assertValid(d.candles, d.intervalSec, {gapTolerance: synthetic ? 0 : 0.005, story: synthetic ? storySeries(d) : undefined});
	return d;
};

/** A fictional memecoin series in market cap (USD): seeded, validated, labelled illustrative. */
export const syntheticChartData = (o: {seed: number; pair: string; story?: Beat[]; aggregate?: number; intervalSec?: number}): ChartData => {
	const story = o.story ?? DEFAULT_STORY;
	const k = o.aggregate ?? 1;
	const baseInterval = o.intervalSec ?? 300;
	const s = generate(o.seed, story, {keepTicks: true, intervalSec: baseInterval});
	const mc = toMarketCap(s.candles, s.supply);
	return assertChartData({
		pair: o.pair,
		intervalSec: baseInterval * k,
		unit: 'mcap',
		candles: k === 1 ? mc : aggregateCandles(mc, k),
		illustrative: true,
		source: k === 1 ? {kind: 'synthetic', seed: o.seed, story} : {kind: 'synthetic', seed: o.seed, story, aggregate: k},
	});
};

// ---------- labels (R2: every on-screen text is computed from the data by a named function) ----------
const INTERVALS: Record<number, string> = {60: '1m', 300: '5m', 600: '10m', 900: '15m', 1800: '30m', 3600: '1h', 14400: '4h', 86400: '1D'};
export const intervalLabel = (sec: number): string => INTERVALS[sec] ?? (sec % 3600 === 0 ? `${sec / 3600}h` : sec % 60 === 0 ? `${sec / 60}m` : `${sec}s`);
export const unitLabel = (u: ChartData['unit']): string => (u === 'mcap' ? 'Market cap (USD)' : 'Price (USD)');
export const durationLabel = (sec: number): string =>
	sec % 86400 === 0 ? `${sec / 86400} d` : sec % 3600 === 0 ? `${sec / 3600} h` : sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`;
/** The reference of a change callout: 12 candles back on 5m data is 'vs 1 h ago'. */
export const refLabel = (candlesBack: number, intervalSec: number): string => `vs ${durationLabel(candlesBack * intervalSec)} ago`;

/** Throw if a callout label names a duration that is not candlesBack x interval (R2: the stated reference must be true). */
export const checkRefLabel = (label: string, candlesBack: number, intervalSec: number): void => {
	const m = /(\d+(?:\.\d+)?)\s*(min|m|h|d|s)\b/.exec(label);
	if (!m) return;
	const sec = Number(m[1]) * {s: 1, m: 60, min: 60, h: 3600, d: 86400}[m[2] as 's' | 'm' | 'min' | 'h' | 'd'];
	if (sec !== candlesBack * intervalSec) throw new Error(`callout label "${label}" says ${sec}s but ${candlesBack} candles x ${intervalSec}s = ${candlesBack * intervalSec}s`);
};
