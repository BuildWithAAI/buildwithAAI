// chartGeometry.ts: price scale, ticks, formatting and pixel-exact candle rects for 1920x1080 output.
// Pixel rules measured through Remotion 4.0.541's own x264 chain (E8): vertical colour marks keep 100% chroma
// at 3 px centred on an EVEN column, or >= 4 px wide; 2 px keeps only 76-81%; 1 px 18-57%.
import {direction, formingCandle, type Candle, type Dir} from './ohlc.ts';

/**
 * What the chart shows at frame f (pure). Candles appear left to right, whole.
 * 'step': completed candles pop on. 'live': the newest candle forms from its ticks; p moves in 2-frame
 * steps so no intermediate level or colour lasts a single frame, and p reaches 1 inside the candle's window.
 * Integer frames; framesPerCandle >= 4 for a visible 'live' animation.
 */
export const revealAt = (cs: Candle[], f: number, startFrame: number, framesPerCandle: number, mode: 'step' | 'live'): Candle[] => {
	const k = (f - startFrame) / framesPerCandle;
	if (k < 0) return [];
	const done = Math.min(cs.length, Math.floor(k));
	if (mode === 'step' || done === cs.length) return cs.slice(0, Math.min(cs.length, done + 1));
	const local = f - startFrame - done * framesPerCandle; // 0 .. framesPerCandle-1
	const steps = Math.floor((framesPerCandle - 1) / 2);
	const p = steps === 0 ? 1 : Math.min(1, Math.floor(local / 2) / steps);
	return [...cs.slice(0, done), formingCandle(cs[done], p)];
};

export type ScaleMode = 'linear' | 'log';
export type PriceScale = {mode: ScaleMode; min: number; max: number; y: (p: number) => number; ticks: number[]};

/** log when max/min > 10, linear when <= 3; in between the caller chooses (default linear). */
export const chooseMode = (lo: number, hi: number, prefer: ScaleMode = 'linear'): ScaleMode =>
	hi / lo > 10 ? 'log' : hi / lo <= 3 ? 'linear' : prefer;

const niceLinearTicks = (min: number, max: number, target = 5): number[] => {
	const raw = (max - min) / target;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
	const out: number[] = [];
	for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
	return out;
};
const logTicks = (min: number, max: number): number[] => {
	const out: number[] = [];
	for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++)
		for (const m of [1, 2, 5]) {
			const v = m * 10 ** e;
			if (v >= min && v <= max) out.push(Number(v.toPrecision(12)));
		}
	return out.length > 8 ? out.filter((v) => Math.abs(Math.log10(v) % 1) < 1e-9) : out; // too dense: decades only
};

/** ONE scale per chart, built from the data (highs/lows) with 8% padding. top/height in px. */
export const priceScale = (cs: Candle[], top: number, height: number, mode?: ScaleMode, pad = 0.08): PriceScale => {
	const hi = Math.max(...cs.map((c) => c.h));
	const lo = Math.min(...cs.map((c) => c.l));
	const m = mode ?? chooseMode(lo, hi);
	if (m === 'log') {
		const a = Math.log(lo), b = Math.log(hi), span = b - a || 1;
		const min = Math.exp(a - span * pad), max = Math.exp(b + span * pad);
		const y = (p: number) => top + ((Math.log(max) - Math.log(p)) / (Math.log(max) - Math.log(min))) * height;
		return {mode: m, min, max, y, ticks: logTicks(min, max)};
	}
	const span = hi - lo || hi * 0.01;
	const min = Math.max(lo - span * pad, Number.MIN_VALUE), max = hi + span * pad;
	const y = (p: number) => top + ((max - p) / (max - min)) * height;
	return {mode: m, min, max, y, ticks: niceLinearTicks(min, max)};
};

/** Even-integer slot width; plot width = n * slot, centred in the available width; cx(i) is even. */
export const slots = (n: number, x: number, availW: number) => {
	const slot = 2 * Math.floor(availW / n / 2);
	if (slot < 8) throw new Error(`slot ${slot}px < 8px: show fewer candles (longer interval) or widen the plot`);
	const x0 = 2 * Math.round((x + (availW - n * slot) / 2) / 2);
	let bodyW = Math.floor(slot * 0.78);
	if (bodyW % 2 === 0) bodyW -= 1; // odd, so the body centres on the wick's middle column
	return {slot, x0, plotW: n * slot, bodyW, cx: (i: number) => x0 + slot * i + slot / 2};
};

export const WICK_W = 3; // px, centred on the even column cx (x = cx-1 .. cx+1)
export const MIN_BODY_H = 3; // px

export type Rect = {x: number; y: number; w: number; h: number};
export type CandleRects = {dir: Dir; cx: number; wick: Rect; body: Rect};

/**
 * Pixel-snapped rects. Math.round is monotone, so high >= body >= low survives snapping.
 * Minimum size: every candle also covers the 3-row box centred on its OPEN row (rows a-1..a+1).
 * The open never moves while a candle forms, so this box is fixed and the drawn wick can only grow.
 * A doji is exactly that box: centred on its level to within 0.5 px.
 */
export const candleRects = (c: Candle, cx: number, bodyW: number, y: (p: number) => number): CandleRects => {
	const a = Math.floor(y(c.o)); // the pixel row that contains the open
	const boxTop = a - 1, boxBot = a + 2; // MIN_BODY_H = 3 rows
	const top = Math.min(Math.round(y(Math.max(c.o, c.c))), boxTop);
	const bot = Math.max(Math.round(y(Math.min(c.o, c.c))), boxBot);
	const wTop = Math.min(Math.round(y(c.h)), top);
	const wBot = Math.max(Math.round(y(c.l)), bot);
	return {
		dir: direction(c),
		cx,
		wick: {x: cx - 1, y: wTop, w: WICK_W, h: wBot - wTop},
		body: {x: cx - (bodyW - 1) / 2, y: top, w: bodyW, h: bot - top},
	};
};

/** $4.23K / $61.7K / $1.2M / $5K for market caps; subscript zeros for tiny prices ($0.0₅32 = $0.0000032). */
const SUB = '₀₁₂₃₄₅₆₇₈₉';
export const fmtUsd = (v: number): string => {
	const p3 = (x: number) => Number(x.toPrecision(3)); // 3 significant digits, no trailing zeros
	if (v >= 1e9) return `$${p3(v / 1e9)}B`;
	if (v >= 1e6) return `$${p3(v / 1e6)}M`;
	if (v >= 1e3) return `$${p3(v / 1e3)}K`;
	if (v >= 0.001) return `$${Number(v.toPrecision(3))}`;
	const z = -Math.floor(Math.log10(v)) - 1; // zeros after "0."
	const digits = Math.round(v * 10 ** (z + 2)).toString(); // 2 significant digits
	return `$0.0${String(z).split('').map((d) => SUB[+d]).join('')}${digits}`;
};
/** Signed percentage with a real minus sign: +402%, −84%, +24.3%. */
export const fmtPct = (r: number): string => `${r >= 0 ? '+' : '−'}${Math.abs(r * 100).toFixed(Math.abs(r) >= 0.1 ? 0 : 1)}%`;
