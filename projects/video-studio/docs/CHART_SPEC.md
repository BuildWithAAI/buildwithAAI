# CHART_SPEC: CandlestickChart and OHLC data (binding)

Version 1, 2026-11-24. This spec implements `docs/ART_GUIDE.md` section 8 and the owner's rule in CLAUDE.md: **green candles go up (close > open), red candles go down (close < open), and every series passes validation.**

**Status.**
- The four code modules below were validated in the study scratchpad (experiments E9 and C1 in ART_GUIDE Evidence):
  - 10,000 seeds and 1,160,000 candles, with 0 invariant or geometry failures;
  - 1,078,800 forming-candle frames with 0 shrinking wicks; every last frame equals the stored candle;
  - the validator catches 9 of 9 injected faults;
  - the code is deterministic per seed;
  - `tsc --strict` passes with TypeScript 5.9.3.
- The React component (section 7) is specified but not built yet.
- A reference render was checked by eye, including a deuteranopia simulation.

**Files to create** (Phase 1, in `src/charts/`):

| File | Contents |
| --- | --- |
| `ohlc.ts` | Types, seeded generator, forming candle, gap fill, direction (section 8) |
| `validate.ts` | Invariants and story checks; `assertValid` throws (section 2) |
| `chartGeometry.ts` | Scale, ticks, slots, pixel-exact candle rects, reveal animation, formatters (section 5) |
| `tokens.ts` | Colour tokens (section 3) |
| `CandlestickChart.tsx` | The component (section 7) |
| `scripts/test-charts.ts` | The acceptance sweep (section 10) |

The imports use explicit `.ts` extensions, so Node 22 can run the tests directly (type stripping). Add `"allowImportingTsExtensions": true` to `tsconfig.json`; this is valid because `noEmit` is already true. The modules pass `tsc` with the project's options (`strict`, `noUnusedLocals`, `moduleResolution: bundler`).

---

## 1. Data types

```ts
import type {Beat, Candle} from './ohlc';

/** Everything a chart needs. Lives in storyboard props or a JSON file; never fetched at render time. */
export type ChartData = {
	pair: string; // '$ZOO / SOL' (text only, no third-party logos)
	intervalSec: number; // 60 | 300 | 900 | 3600 | 14400 | 86400
	unit: 'price' | 'mcap'; // memecoins: 'mcap' (USD)
	candles: Candle[]; // already in the plotted unit (toMarketCap for mcap)
	illustrative: boolean; // true for every synthetic or fictional series
	source:
		| {kind: 'synthetic'; seed: number; story: Beat[]}
		| {kind: 'geckoterminal' | 'coingecko'; url: string; fetchedAt: string; attribution: string};
};
```

- `Candle.t` is the candle's **open** time in Unix seconds. CoinGecko `/ohlc` returns **close** time: subtract one interval before storing.
- `Candle.v` is quote volume in USD.
- `Candle.ticks` (synthetic only) is the intra-candle price path used to animate a forming candle.

## 2. Invariants (validator; throws before any frame renders)

| ID | Rule | Applies to |
| --- | --- | --- |
| V1 | At least one candle | all |
| V2 | o, h, l, c finite and > 0 | all |
| V3 | v finite and ≥ 0 | all |
| V4 | h ≥ max(o, c) | all |
| V5 | l ≤ min(o, c) | all |
| V6 | t[i] − t[i−1] = intervalSec (run `fillGaps` first on real data) | all |
| V7 | \|o[i] / c[i−1] − 1\| ≤ tolerance: **0** for synthetic 24/7 data, **0.005** for real DEX data | all |
| V8 | If `ticks` is present: max(o, …ticks) = h, min(o, …ticks) = l, last tick = c | synthetic |
| S1–S6 | Story checks for the beats present: pump ≥ 2×; pump volume ≥ 5× chop median; rug candle is red; rug drop ≥ 70%; rug has the longest body; rug has a lower wick | synthetic |
| R1 | Each candle's fill = `tokens[direction(c)]`, nothing else | render |
| R2 | Every number on screen is computed from `candles` by a named function, with its reference stated ("vs 1 h ago") | render |
| R3 | No wick leaves the plot rect (8% padding guarantees it) | render |

Call `assertValid` in the composition's `calculateMetadata` (the render fails before frame 0) and again in the data-build script. Volume colour is a price-direction proxy only. It is never presented as buys vs sells.

`src/charts/validate.ts` (tested source, verbatim):

```ts
// validate.ts: OHLCV invariants and story checks. assertValid() throws, so a bad series never reaches a render.
import {direction, type Candle, type Series} from './ohlc.ts';

export type Issue = {i: number; rule: string; detail: string};

export const validateCandles = (cs: Candle[], intervalSec: number, opts: {gapTolerance?: number} = {}): Issue[] => {
	const tol = opts.gapTolerance ?? 0; // synthetic: exact continuity; real DEX data: 0.005
	const out: Issue[] = [];
	if (cs.length === 0) out.push({i: -1, rule: 'non-empty', detail: 'no candles'});
	cs.forEach((c, i) => {
		if (![c.o, c.h, c.l, c.c].every((x) => Number.isFinite(x) && x > 0)) out.push({i, rule: 'positive-finite', detail: JSON.stringify(c)});
		if (!(Number.isFinite(c.v) && c.v >= 0)) out.push({i, rule: 'volume>=0', detail: String(c.v)});
		if (c.h < Math.max(c.o, c.c)) out.push({i, rule: 'high>=max(o,c)', detail: `${c.h} < ${Math.max(c.o, c.c)}`});
		if (c.l > Math.min(c.o, c.c)) out.push({i, rule: 'low<=min(o,c)', detail: `${c.l} > ${Math.min(c.o, c.c)}`});
		if (c.ticks) {
			// the tick path that animates a forming candle must end exactly at the stored candle
			const ok = c.ticks.length > 0 && Math.max(c.o, ...c.ticks) === c.h && Math.min(c.o, ...c.ticks) === c.l && c.ticks[c.ticks.length - 1] === c.c;
			if (!ok) out.push({i, rule: 'ticks-match-ohlc', detail: ''});
		}
		if (i > 0) {
			const p = cs[i - 1];
			if (c.t - p.t !== intervalSec) out.push({i, rule: 'constant-interval', detail: `${c.t - p.t}s`});
			const gap = Math.abs(c.o / p.c - 1);
			if (gap > tol) out.push({i, rule: 'open~prev-close', detail: `gap ${(gap * 100).toFixed(3)}%`});
		}
	});
	return out;
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Story checks: the chart must say what the narration says. Only beats present in the story are checked. */
export const validateStory = (s: Series): Issue[] => {
	const out: Issue[] = [];
	const cs = s.candles;
	const beat = (k: string) => s.beats.find((b) => b.kind === k);
	const chop = beat('chop'), pump = beat('pump'), rug = beat('rug');
	if (pump) {
		if (cs[pump.end].c / cs[pump.start].o < 2) out.push({i: pump.end, rule: 'pump>=2x', detail: ''});
		if (chop) {
			const chopMedVol = median(cs.slice(chop.start, chop.end + 1).map((c) => c.v));
			const pumpMaxVol = Math.max(...cs.slice(pump.start, pump.end + 1).map((c) => c.v));
			if (pumpMaxVol < 5 * chopMedVol) out.push({i: pump.start, rule: 'pump-volume-spike>=5x', detail: `${(pumpMaxVol / chopMedVol).toFixed(1)}x`});
		}
	}
	if (rug) {
		const r = cs[rug.start];
		if (direction(r) !== 'down') out.push({i: rug.start, rule: 'rug-candle-is-red', detail: ''});
		if (r.c / r.o > 0.3) out.push({i: rug.start, rule: 'rug-drop>=70%', detail: `${((1 - r.c / r.o) * 100).toFixed(1)}%`});
		const bodies = cs.map((c) => Math.abs(Math.log(c.c / c.o)));
		if (bodies.indexOf(Math.max(...bodies)) !== rug.start) out.push({i: rug.start, rule: 'rug-is-longest-body', detail: ''});
		if (r.l >= r.c) out.push({i: rug.start, rule: 'rug-has-lower-wick', detail: ''});
	}
	return out;
};

/** Throw on any issue. Call in calculateMetadata (or the data build script) so a render cannot start with bad data. */
export const assertValid = (cs: Candle[], intervalSec: number, opts: {gapTolerance?: number; story?: Series} = {}): Candle[] => {
	const issues = [...validateCandles(cs, intervalSec, opts), ...(opts.story ? validateStory(opts.story) : [])];
	if (issues.length) throw new Error(`OHLC validation failed (${issues.length}): ${issues.slice(0, 5).map((x) => `#${x.i} ${x.rule} ${x.detail}`).join('; ')}`);
	return cs;
};
```

## 3. Colour tokens (measured E7)

Candle colour comes only from `direction(c)`: `up` when c > o, `down` when c < o, `flat` when c = o. Wicks use the body colour.

| Token | Dark (default): slate panel | Light: card on `#E6E8EB` | Measured |
| --- | --- | --- | --- |
| surface | `#161A21` | `#F4F6F8` | brand slate / brand off-white |
| up | `#45E08F` | `#17914F` | vs surface 10.2:1 / 3.7:1; ΔE76 to brand teal 40.5 / 35.6 |
| down | `#F0443A` | `#B71C1C` | vs surface 4.7:1 / 6.1:1 |
| up ↔ down, deuteranopia / protanopia ΔE76 | 31.9 / 37.8 | 24.6 / 25.1 | Tailwind `#22C55E`/`#EF4444`: 12.7 deutan |
| flat (doji) | `#8B949E` | `#5B6470` | neutral: no chroma to lose |
| grid | `#2A313B` | `#C4C9D0` | 2 px solid, no opacity |
| axisText | `#9AA3AD` (6.8:1) | `#4A525E` | |
| ink (header, numbers) | `#F4F6F8` | `#0B0C0F` | |
| pillText | `#0B0C0F` (11.5:1 on up, 5.2:1 on down) | `#F4F6F8` (3.7:1 / 6.1:1; ≥ 24 px bold) | |
| volumeUp / volumeDown | `#2B7353` / `#782D2C` | `#91C9AC` / `#D99495` | 45% mixes over the surface, precomputed as flat colours |

- Use the **dark panel** for every candle chart. Use the light card only for small inline diagrams. *Why:* with true green and red, the best possible colour-blind separation on a light surface is ΔE about 28, against about 52 on slate (E7 grid search). The deuteranopia render showed the light-surface volume bars nearly merging.
- **Never use these for data:** teal-family greens (`#089981` TradingView, `#26A69A` Lightweight Charts, `#00AA95`), which are ΔE 7–14 from the brand teal `#29B8AD`; amber, cyan, silver or accent colours; glow; gradient area fills.
- Chart marks have **no outline**. The panel frame carries the house outline (4 px `#0B0C0F`, radius 16).

`src/charts/tokens.ts` (tested source, verbatim):

```ts
// tokens.ts: chart colour tokens (E7). Two surfaces; the dark slate panel is the default.
export const CHART_DARK = {
	surface: '#161A21', // brand slate
	up: '#45E08F',
	down: '#F0443A',
	flat: '#8B949E', // doji
	grid: '#2A313B',
	axisText: '#9AA3AD',
	ink: '#F4F6F8', // brand off-white: header, glyph labels, signed numbers
	pillText: '#0B0C0F', // text on up/down pills
	volumeUp: '#2B7353', // 45% up mixed over surface, as a flat colour (no opacity)
	volumeDown: '#782D2C', // 45% down mixed over surface
} as const;
export const CHART_LIGHT = {
	surface: '#F4F6F8', // card on the #E6E8EB background
	up: '#17914F',
	down: '#B71C1C',
	flat: '#5B6470',
	grid: '#C4C9D0',
	axisText: '#4A525E',
	ink: '#0B0C0F',
	pillText: '#F4F6F8',
	volumeUp: '#91C9AC',
	volumeDown: '#D99495',
} as const;
export type ChartTokens = typeof CHART_DARK | typeof CHART_LIGHT;
```

## 4. Layout and axis rules (1920×1080; all values in output px)

- **L1 Screen space.** Compute the chart at its final on-screen size. Its group may carry an integer `translate` only, never a fractional scale to make it fit. A chart shown on a monitor prop is laid out directly in the monitor's screen rect. Camera push-ins on the whole scene are the only exception.
- **L2 Panel.** A rect of radius 16 in the `surface` colour with a 4 px near-black outline and 32 px inner padding. Rows from top to bottom:
  - header, 56 px;
  - price pane, ≥ 55% of the inner height;
  - 24 px gap;
  - volume pane, 15–20% of the inner height;
  - footer, 48 px.

  The price axis labels sit in a 140 px column to the right of the plot.
- **L3 Header.** `$PAIR · interval · unit · scale`, for example `$ZOO / SOL · 5m · Market cap (USD) · log scale`, in Inter 600 at 28 px in the `ink` colour. If the panel is narrower than 1000 px, split the header into two rows. Do not truncate it.
- **L4 Footer.**
  - Left: the change callout, a ▲ or ▼ glyph in the direction colour followed by the signed `fmtPct` value and its reference in `ink`, for example `▼ −35% vs 1 h ago`, in Inter 700 at 32 px.
  - Right: `Illustrative · fictional token` (required when `illustrative`) or the data attribution (section 9), in Inter 600 at 24 px in `axisText`.
- **L5 Slots.** Each candle gets an even integer slot. The plot width is n × slot, centred in the available width, so candles are evenly spaced with no 1 px jitter. A slot under 8 px is an error: aggregate to a longer interval or show fewer candles. A full-width plot holds about 60–150 candles at 10–16 px slots.
- **L6 Scale.** Use one scale per chart, built from the highs and lows of **all candles the shot will show** (so the axis does not jump), with 8% padding (in log space for log).
  - The mode is `auto`: log when max/min > 10, linear when ≤ 3, and the storyboard chooses in between.
  - The header always names the mode.
  - Never switch mode inside a shot.
  - A price axis need not start at zero. The **volume pane always starts at zero**, with a 2 px baseline in `axisText`.
- **L7 Ticks.** Linear: "nice" 1-2-5 steps, 4–7 ticks. Log: 1-2-5 per decade, or decades only above 8 ticks. Gridlines are 2 px rects at `round(y(t)) − 1`. There are no vertical gridlines. Labels use `fmtUsd` (`$4.23K`, `$61.7K`, `$1.2M`, `$5K`, `$0.0₅32`) in Inter 600 at 24 px in `axisText`, 16 px right of the plot. **Never use exponent notation.**
- **L8 Last-price pill.** Place it at `round(y(last.c))` to the right of the plot: 40 px tall, radius 8, filled with the last candle's direction colour, text in `pillText`, Inter 700 at 24 px. It shows the axis unit (price or market cap), never a percentage. Hide any tick label within 32 px of the pill; keep its gridline. An optional last-price line is 2 px, **neutral** (`axisText`), dashed 8/8, and never coloured. *Why:* a coloured horizontal line under 4 px keeps only 50–81% of its chroma (E8).
- **L9 Time axis.** Optional. Show 3–5 labels at round times from `t` (UTC, `HH:MM`) in Inter 600 at 24 px. Never label every candle.
- **L10 Hollow-up close-ups.** Optional, and only when bodyW ≥ 15. An up body is the full rect in `up` with an inner rect in `surface` inset by 4 px. Down bodies stay filled. Fall back to filled when the body is under 12 px tall. *Why:* 4 px sides keep full chroma (E8). Thin hollow bodies broke into a "!" glyph in the chart study.

## 5. Geometry (pixel-exact; measured E8 and E9)

- **G1** `slot` is an even integer; `x0` is even; the centre column `cx(i) = x0 + slot·i + slot/2` is even.
- **G2** The wick is `x = cx − 1`, width **3** px (centred on the even column cx), from `round(y(h))` to `round(y(l))`, extended to cover the body. *Why:* through Remotion's own x264 chain, a 3 px coloured line centred on an even column keeps 100% of its chroma; 2 px keeps 76–81% and 1 px 18–57%.
- **G3** The body width is the largest **odd** number ≤ 0.78 × slot (at least 7), at `x = cx − (bodyW − 1)/2`, so it is centred on the wick. Its y edges are `round(y(max(o, c)))` and `round(y(min(o, c)))`, joined with the 3-row box on the open's pixel row (`a = floor(y(o))`, rows a−1…a+1). Consequences:
  - a doji is exactly that box, centred on its level to within 0.5 px;
  - the minimum-size padding is never more than 2 px;
  - a forming candle's drawn wick never shrinks, because its open never moves.
- **G4** `Math.round` is monotone, so high ≥ body ≥ low survives snapping (0 failures in 1.16M candles).
- **G5** Draw order: grid → volume bars (body width, flat volume colours, from the zero baseline) → wick → body → last-price pill → text. All marks are `<rect>` elements with integer attributes under `shapeRendering="crispEdges"`. No strokes, no filters, no opacity.

`src/charts/chartGeometry.ts` (tested source, verbatim):

```ts
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
```

## 6. Animation rules

Everything is a pure function of the frame. Storyboard props give `startFrame`, `framesPerCandle` and the beat-to-frame mapping. Nothing is stateful.

- **A1 Fixed layout.** Slots and x positions come from the shot's **final** candle count. Candles never slide sideways as new ones appear.
- **A2 Left to right, whole candles only.** Candle i appears at `startFrame + i·framesPerCandle`. Never clip a candle part-way. There are two modes:
  - `step`: completed candles pop on whole, 1–3 f per candle, for history;
  - `live`: each new candle forms over `framesPerCandle`, for the narrated moment.
- **A3 Only the rightmost visible candle may be forming.** Every candle to its left is final and never changes.
- **A4 Forming candle** = `formingCandle(c, p)`:
  - the open is fixed;
  - the close follows the stored ticks;
  - the high and low are the running max and min, so they **only expand** and the drawn wick never shrinks (G3);
  - volume grows in proportion;
  - its colour is `direction(partial)` on every frame. It may flip when the close crosses the open; that is accurate.
  - p advances in 2-frame steps: `p = min(1, floor(local / 2) / floor((framesPerCandle − 1) / 2))`, where local is the frame within the candle's window. So no intermediate colour or level lasts a single frame, and p reaches 1 inside the window. Use `framesPerCandle ≥ 4` for `live`.
- **A5 The last frame of a forming candle equals the stored candle exactly** (verified in E9).
- **A6 Scale.** The default scale is fixed for the whole shot (L6). If the story needs the axis to grow, interpolate `min`/`max` (in log space for log) with the `settle` spring (`{stiffness:100, damping:20}`, settled by f23). Start it when a high or low comes within 4% of the plot edge. Every candle, gridline, label and the pill use that frame's interpolated scale. Never clip a wick, and never squash history into a sliver: cut to a log view instead.
- **A7 Labels follow their gridlines.** A tick label appears or disappears when its gridline enters or leaves the plot. The pill follows `round(y(last.c))` every frame and takes the forming candle's colour.
- **A8 Callouts are computed from completed candles only.** A number never flickers while a candle forms. It updates when the referenced candle completes.
- **A9 Camera.** Push-ins and moves are a float transform on the whole panel, at most 1.03–1.08× (ART_GUIDE MO13). At rest the transform is the identity or an integer translate.
- **A10 Narration sync.** The candle the narration names (the pump, the rug) completes on or just before the word, using `Series.beats[k].start/end` to place keyframes. Hold 12–24 f on the completed rug candle before the reaction beat (ART_GUIDE MO17).

`revealAt(cs, frame, startFrame, framesPerCandle, mode)` in `chartGeometry.ts` (section 5) implements A1–A5. Over 100 seeds × 8 values of framesPerCandle × 2 modes (1,128,000 frames), it was tested for:
- a shown count that never decreases;
- history that never changes;
- each candle exact at the end of its window;
- no 1-frame intermediate states at `framesPerCandle ≥ 4`.

All checks passed.

## 7. `CandlestickChart` component (to build)

```ts
export type CandlestickChartProps = {
	data: ChartData; // validated again on mount with assertValid (cheap); calculateMetadata validates first
	box: {x: number; y: number; w: number; h: number}; // integer px, screen space (L1)
	surface?: 'dark' | 'light'; // default 'dark'
	scale?: 'auto' | 'linear' | 'log'; // default 'auto' (L6)
	reveal?: {mode: 'step' | 'live'; startFrame: number; framesPerCandle: number} | null; // null = all shown
	showVolume?: boolean; // default true
	lastPrice?: boolean; // default true (L8)
	callout?: {candlesBack: number; label: string} | null; // e.g. {candlesBack: 12, label: 'vs 1 h ago'} on 5m data
	hollowUp?: boolean; // close-ups only (L10)
};
```

Behaviour, in order:
1. Run `assertValid`.
2. Build the scale from all candles the shot will show (L6).
3. Compute the slots for the final count (A1).
4. Run `revealAt` for the current frame.
5. Run `candleRects` for each visible candle.
6. Render in the G5 order with tokens from `tokens.ts`.
7. Compute the header, footer, pill and callout text from the data (R2).

No `Math.random`, no filters, no gradients, no strokes on marks, no CSS transforms except the parent translate. The component must also work at 1080×1920 (Shorts): lay it out again for that box; never scale the landscape chart.

## 8. Synthetic data model (fictional memecoins)

Candles are **aggregated from simulated tick paths**: o = first price, h = running max, l = running min, c = last tick, v = summed volume. The invariants hold by construction, and the validator still checks them.

| Beat | Model, per 5 m bar (24 ticks) | Assertion; re-sample with a derived seed until it holds |
| --- | --- | --- |
| `launch` | pump.fun-style constant-product bonding curve: price = vSol² / k, k = 30 × 1.073e9. SOL raised is a random walk (buys Exp mean 0.65, sells Exp mean 0.55), vSol clamped to [30, 115] (graduation at about 85 SOL raised). Volume = (buys + sells) × SOL/USD | end/start ≥ 3 |
| `chop` | GBM, μ 0, σ 0.06, volume scale $4k | 0.7 < ratio < 1.4 |
| `pump` | GBM, μ 0.28, σ 0.16, volume scale $60k (a caller posts) | ratio ≥ 2 |
| `distribution` | GBM, μ −0.02, σ 0.10, volume scale $18k | 0.5 < ratio < 1.05 |
| `rug` | One scripted candle: pop 0–6%, drop 75–95% to the low, 5–30% bounce to the close (lower wick) | ratio ≤ 0.3 |
| `bleed` | GBM, μ −0.03, σ 0.05, volume scale $2.5k | ratio < 1 |

- **Volume per GBM tick:** `(vol / 24) × (0.4 + |z|) × lognormal(0, 0.35)`. It correlates with range (median Spearman ρ 0.39 across seeds) and is never negative.
- **Default story:** launch 30, chop 40, pump 6, distribution 14, rug 1, bleed 25 = 116 candles at 5 m.
  - Across 10,000 seeds (C1): launch 3.83–14.69× (p1–p99); pump 2.24–12.67×; pump volume spike 14.5–22×; rug drop 72–95%; whole-series span 19.7–206× (median 65×), so the axis is always log.
  - On a linear axis the 70 pre-pump candles get a median 21.5% of the plot height, against 63.5% on log (C2).
- **Units:** SOL/USD defaults to 150, supply 1e9 (pump.fun), so launch market cap is about $4.2K and graduation about $62K. Plot `toMarketCap` and say "Market cap (USD)" in the header.
- **Seeds:** the seed is stored in `ChartData.source` and printed as `seed N` in draft renders only. `generate(seed)` is byte-identical on every call.
- **Scope:** the beat lengths come from the narration: a "30-minute caller pump" is 6 × 5 m candles. The pump.fun constants are approximate (public analyses disagree: about 85 SOL vs about $69K at graduation). The data is fictional and labelled so (L4).

*Sources* (search extracts): deepwiki.com/pump-fun/pump-public-docs, "bonding curve mechanism"; bybit.com/wiki bonding-curve guide; madeonsol.com "Solana bonding curves explained".

`src/charts/ohlc.ts` (tested source, verbatim):

```ts
// Reference synthetic OHLCV generator for fictional memecoin stories.
// Deterministic per seed. Every candle is aggregated from simulated ticks, so
// high/low/open/close relationships hold by construction (the validator still checks).
//
// Model:
//   - launch:   pump.fun-style constant-product bonding curve. Price = vSol^2 / k,
//               SOL raised is a random walk with positive drift. Volume = gross SOL flow.
//   - other beats: geometric Brownian motion on log price per tick, with per-beat
//               drift/volatility (regime changes). Volume per tick scales with |return|.
//   - each beat carries a direction assertion; a beat is re-sampled with a derived
//     seed until its assertion holds, so the chart always matches the narration.

export type Candle = {t: number; o: number; h: number; l: number; c: number; v: number; ticks?: number[]};
export type BeatKind = 'launch' | 'chop' | 'pump' | 'distribution' | 'rug' | 'bleed';
export type Beat = {kind: BeatKind; bars: number};
export type Series = {candles: Candle[]; beats: Array<Beat & {start: number; end: number}>; supply: number};

// ---------- seeded RNG ----------
export const mulberry32 = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};
const normal = (r: () => number) => {
	const u = 1 - r(); // (0,1]
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};

// ---------- regime table (per BAR; converted to per tick) ----------
// mu = expected log return per bar, sigma = log vol per bar, vol = USD volume scale per bar
const REGIME: Record<Exclude<BeatKind, 'launch' | 'rug'>, {mu: number; sigma: number; vol: number}> = {
	chop: {mu: 0.0, sigma: 0.06, vol: 4_000},
	pump: {mu: 0.28, sigma: 0.16, vol: 60_000}, // a caller posts: strong drift, volume spike
	distribution: {mu: -0.02, sigma: 0.1, vol: 18_000},
	bleed: {mu: -0.03, sigma: 0.05, vol: 2_500},
};

const TICKS = 24; // ticks per candle
const SUPPLY = 1_000_000_000; // pump.fun tokens have a 1B supply
const V_SOL0 = 30; // virtual SOL reserve at launch (pump.fun, per public analyses)
const V_TOK0 = 1_073_000_000; // virtual token reserve at launch
const K = V_SOL0 * V_TOK0;
const V_SOL_GRAD = V_SOL0 + 85; // graduation (approximate; check current pump.fun docs)

type Ctx = {price: number; vSol: number; t: number};

// Simulate one beat into candles. Returns null if the beat's story assertion fails.
const simulateBeat = (beat: Beat, ctx: Ctx, r: () => number, solUsd: number, interval: number, keepTicks: boolean): {candles: Candle[]; ctx: Ctx} | null => {
	const out: Candle[] = [];
	let {price, vSol, t} = ctx;
	const startPrice = price;
	for (let b = 0; b < beat.bars; b++) {
		const o = price;
		let h = o;
		let l = o;
		let v = 0;
		const ticks: number[] = [];
		if (beat.kind === 'launch') {
			// SOL raised: random walk with positive drift; vSol can never drop below 30 (nothing left to sell).
			for (let k = 0; k < TICKS; k++) {
				const buys = -Math.log(1 - r()) * 0.65; // SOL, exponential order sizes
				const sells = -Math.log(1 - r()) * 0.55;
				// floor: nothing left to sell below launch; cap: the curve graduates at ~85 SOL raised
				vSol = Math.min(V_SOL_GRAD, Math.max(V_SOL0, vSol + buys - sells));
				price = ((vSol * vSol) / K) * solUsd; // USD per token
				v += (buys + sells) * solUsd;
				ticks.push(price);
				h = Math.max(h, price);
				l = Math.min(l, price);
			}
		} else if (beat.kind === 'rug') {
			// One candle: a small pop, then a dev/insider dump of 75-95%, then a dead-cat bounce.
			const drop = 0.75 + r() * 0.2;
			const bottom = o * (1 - drop) * (0.85 + r() * 0.1); // the low, below the close
			const close = bottom * (1.05 + r() * 0.25); // partial bounce -> lower wick
			const pop = o * (1 + r() * 0.06); // upper wick from the last buyers
			const path = [pop, (o + bottom) / 2, bottom, close];
			for (const p of path) {
				v += Math.abs(p - price) / o * REGIME.distribution.vol * 6 * (0.8 + r() * 0.4);
				price = p;
				ticks.push(price);
				h = Math.max(h, price);
				l = Math.min(l, price);
			}
		} else {
			const g = REGIME[beat.kind];
			const muT = g.mu / TICKS;
			const sdT = g.sigma / Math.sqrt(TICKS);
			for (let k = 0; k < TICKS; k++) {
				const z = normal(r);
				const ret = muT - 0.5 * sdT * sdT + sdT * z; // GBM log-return step
				price *= Math.exp(ret);
				// volume ~ base * (0.4 + |z|) * lognormal noise  => correlated with range, never negative
				v += (g.vol / TICKS) * (0.4 + Math.abs(z)) * Math.exp(0.35 * normal(r));
				ticks.push(price);
				h = Math.max(h, price);
				l = Math.min(l, price);
			}
		}
		out.push(keepTicks ? {t, o, h, l, c: price, v, ticks} : {t, o, h, l, c: price, v});
		t += interval;
	}
	const end = price;
	const ratio = end / startPrice;
	const ok = {
		launch: ratio >= 3, // bonding-curve climb: at least 3x
		chop: ratio > 0.7 && ratio < 1.4,
		pump: ratio >= 2, // the caller's pump at least doubles
		distribution: ratio < 1.05 && ratio > 0.5,
		rug: ratio <= 0.3,
		bleed: ratio < 1,
	}[beat.kind];
	return ok ? {candles: out, ctx: {price, vSol, t}} : null;
};

export const DEFAULT_STORY: Beat[] = [
	{kind: 'launch', bars: 30},
	{kind: 'chop', bars: 40},
	{kind: 'pump', bars: 6},
	{kind: 'distribution', bars: 14},
	{kind: 'rug', bars: 1},
	{kind: 'bleed', bars: 25},
];

export const generate = (seed: number, story: Beat[] = DEFAULT_STORY, opts: {intervalSec?: number; t0?: number; solUsd?: number; keepTicks?: boolean} = {}): Series => {
	const interval = opts.intervalSec ?? 300; // 5-minute candles
	const solUsd = opts.solUsd ?? 150;
	let ctx: Ctx = {price: ((V_SOL0 * V_SOL0) / K) * solUsd, vSol: V_SOL0, t: opts.t0 ?? 1_767_225_600};
	const candles: Candle[] = [];
	const beats: Series['beats'] = [];
	story.forEach((beat, bi) => {
		for (let attempt = 0; attempt < 200; attempt++) {
			const r = mulberry32((seed * 1_000_003 + bi * 7919 + attempt * 104_729) >>> 0);
			const res = simulateBeat(beat, ctx, r, solUsd, interval, opts.keepTicks ?? false);
			if (res) {
				beats.push({...beat, start: candles.length, end: candles.length + res.candles.length - 1});
				candles.push(...res.candles);
				ctx = res.ctx;
				return;
			}
		}
		throw new Error(`seed ${seed}: beat ${bi} (${beat.kind}) could not satisfy its assertion`);
	});
	return {candles, beats, supply: SUPPLY};
};

// ---------- animation: the candle that is still forming at progress p in [0,1] ----------
// Open is fixed, close follows the tick path, high/low are running max/min: wicks only ever grow.
export const formingCandle = (c: Candle, p: number): Candle => {
	const ticks = c.ticks ?? [c.c];
	const n = Math.max(0, Math.min(ticks.length, Math.floor(p * ticks.length)));
	let h = c.o, l = c.o, close = c.o;
	for (let k = 0; k < n; k++) {
		close = ticks[k];
		h = Math.max(h, close);
		l = Math.min(l, close);
	}
	return {t: c.t, o: c.o, h, l, c: close, v: c.v * (n / ticks.length)};
};

// ---------- real-data helper: pad missing intervals (GeckoTerminal drops empty ones by default) ----------
export const fillGaps = (cs: Candle[], interval: number): Candle[] => {
	const out: Candle[] = [];
	for (const c of cs) {
		const prev = out[out.length - 1];
		if (prev) for (let t = prev.t + interval; t < c.t; t += interval) out.push({t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0});
		out.push(c);
	}
	return out;
};

// ---------- direction: the ONLY source of candle colour ----------
export type Dir = 'up' | 'down' | 'flat';
export const direction = (c: Candle): Dir => (c.c > c.o ? 'up' : c.c < c.o ? 'down' : 'flat');

/** Market cap in USD (pump.fun tokens: supply = 1e9). Charts of memecoins plot this, not price. */
export const toMarketCap = (cs: Candle[], supply: number): Candle[] =>
	cs.map((c) => ({...c, o: c.o * supply, h: c.h * supply, l: c.l * supply, c: c.c * supply, ticks: c.ticks?.map((p) => p * supply)}));
```

## 9. Real-data sourcing plan

- **Status:** this session cannot reach `api.geckoterminal.com`, `api.coingecko.com` or `api.dexscreener.com`. The owner must approve the exact hosts through the environment tools before any real chart. The Crypto.com connector is installed but not connected (CLAUDE.md); evaluate its OHLC coverage once it is connected.
- **Primary source: GeckoTerminal pool OHLCV.** Keyless and free; 30 calls/min.
  - Endpoint: `GET https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/{day|hour|minute}?aggregate={1 | 1,4,12 | 1,5,15}&limit=1000&before_timestamp={unix s}&currency=usd&include_empty_intervals=true`.
  - It returns `[t, o, h, l, c, v]`. Page backwards with `before_timestamp = oldest − 1`; one call covers at most 6 months.
  - Then run `fillGaps`, then `validateCandles(…, {gapTolerance: 0.005})`, and report the gaps.
  - On screen and in the description: "On-chain data provided by GeckoTerminal", with a link. CoinGecko's keyless API terms require attribution where data is displayed.
  - *Sources* (search extracts): docs.coingecko.com/reference/pool-ohlcv-contract-address; apiguide.geckoterminal.com/faq; docs.coingecko.com/docs/keyless-public-api; brand.coingecko.com/resources/attribution-guide.
- **Coin level: CoinGecko** `/api/v3/coins/{id}/ohlc?vs_currency=usd&days=N`.
  - It returns `[t, o, h, l, c]`, where t is the **close** time: shift it back one interval.
  - It has no volume; take volume from `/coins/{id}/market_chart`.
  - Candle size is automatic: 1–2 days → 30 m, 3–30 days → 4 h, 31+ days → 4 d.
  - Attribute "Data provided by CoinGecko".
  - *Source* (search extract): docs.coingecko.com/v3.0.1/reference/coins-id-ohlc.
- **DEX Screener has no OHLCV endpoint.** Use it for pair metadata only, and read its API terms in a browser before showing its numbers. *Source* (search extract): docs.dexscreener.com/api/reference.
- **Caching.** Store the raw response as `content/<channel>/<slug>/data/<pool>-<interval>.json` together with `url` and `fetchedAt`, then convert it to `ChartData`. Renders read only the cached file and never fetch.
- **Labelling.** Never mix real and synthetic candles in one chart. Real charts state the source and date. Factual claims need current sources (PROJECT_INSTRUCTIONS). Show no real users' wallets or handles (CLAUDE.md).
- **Draw our own charts.** Never screen-capture TradingView, DEX Screener or pump.fun. If a TradingView chart is ever shown, keep its attribution visible the whole time it is on screen. *Source* (search extract): tradingview.com/policies.

## 10. Acceptance tests

`node scripts/test-charts.ts` must print exactly these results (reference run E9):

```
seedsWithIssues: 0          (10,000 seeds; price and market cap)
rects: 1160000, geometryFailures: 0
formFrames: 1078800         (300 seeds × 116 candles × 31 frames; wick never shrinks; end frame = stored)
revealFrames: 1128000       (revealAt: left to right, history fixed, exact at window end, no 1-frame states)
negativesCaught: 9/9        (high<close, low>open, negative, NaN, gap open, irregular interval, negative volume, ticks≠OHLC, empty)
assertValidThrows: true, customStoryNoRugPasses: true, fillGaps: 4 candles valid, deterministic: true
```

Also required:
- `npm run typecheck` is clean.
- One still of a `ChartTest` composition, inspected at 200% for colour (each candle's colour matches close vs open), label collisions, pill placement and footer labels.
- The same frame extracted from the encoded MP4, with no grey wicks (ART_GUIDE QA 9).
