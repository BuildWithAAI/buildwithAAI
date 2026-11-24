// chartLayout.ts: the pure model behind CandlestickChart (CHART_SPEC 4-7). Every rect, label and colour the component
// draws is computed here in absolute output pixels, so node scripts can check exactly what renders without a browser.
// Number text comes from chartFormat.ts, not from chartGeometry's verbatim fmtUsd/fmtPct (see chartFormat.ts header).
import {direction, type Candle, type Dir} from './ohlc.ts';
import {candleRects, priceScale, revealAt, slots, type Rect, type ScaleMode} from './chartGeometry.ts';
import {fmtPctDisplay, fmtUsdSig, labelSig, linearTicks, parseUsd, SUBSCRIPTS} from './chartFormat.ts';
import {CHART_DARK, CHART_LIGHT, type ChartTokens} from './tokens.ts';
import {checkRefLabel, intervalLabel, unitLabel, type ChartData} from './chartData.ts';
import {BRAND} from '../characters/palette.ts';

export type Box = {x: number; y: number; w: number; h: number};
export type RevealSpec = {mode: 'step' | 'live'; startFrame: number; framesPerCandle: number};
export type ChartOptions = {
	data: ChartData;
	box: Box; // integer px, screen space (L1)
	surface?: 'dark' | 'light';
	scale?: 'auto' | 'linear' | 'log';
	reveal?: RevealSpec | null;
	showVolume?: boolean;
	lastPrice?: boolean;
	callout?: {candlesBack: number; label: string} | null;
	// false hides the callout on this frame but keeps its footer space, so nothing moves when it returns. A shot hides
	// it while history pops on in 'step' mode, where a new value every 2 f would read as a slot machine (A8, P5).
	calloutVisible?: boolean;
	hollowUp?: boolean;
	draft?: boolean; // prints `seed N` in the footer (CHART_SPEC 8: draft renders only)
};

// ---------- layout constants (CHART_SPEC 4; output px) ----------
export const HOUSE_OUTLINE = BRAND.nearBlack; // panel frame: 4 px near-black, radius 16 (CHART_SPEC 3; CV1 tokens only)
const OUTLINE = 4;
const PAD = 32; // inner padding inside the outline
const INSET = OUTLINE + PAD;
const PANEL_R = 16;
const AXIS_COL = 140; // price labels column right of the plot (L2)
const LABEL_DX = 16; // labels sit 16 px right of the plot (L7)
const HEADER_ROW = 56; // one header row (L2); a split header (L3) takes two text lines
const HEADER_LINE = 40;
const FOOTER_ROW = 48; // (L2)
const PANE_GAP = 24; // between price and volume panes
const VOL_FRAC = 0.18; // volume pane 15-20% of the inner height
const MIN_PRICE_FRAC = 0.55;
const SPLIT_HEADER_BELOW = 1000; // L3: split the header when the panel is narrower
const PILL_H = 40, PILL_R = 8, PILL_DX = 8, PILL_W = 124, PILL_W_MAX = AXIS_COL - PILL_DX;
const PILL_CLEAR = 32; // hide a tick label whose tick is within 32 px of the pill's EDGE (L8): |tickY - pillY| < 20 + 32
const LAST_LINE_SKIP = 6; // no dashed last-price line within 6 px of a gridline: the two would read as a double line
const LABEL_MIN_GAP = 28; // static de-cluttering of tick labels (24 px text)
const DASH = 8; // last-price line: 2 px, neutral, dashed 8/8 (L8)
const GLYPH_W = 24, GLYPH_H = 20, GLYPH_GAP = 10; // the up/down triangle before the callout (CD7)
const FOOTER_GAP = 32; // min gap between callout and the right footer label
export const TEXT = {
	header: {size: 28, weight: 600},
	axis: {size: 24, weight: 600},
	pill: {size: 24, weight: 700},
	callout: {size: 32, weight: 700},
	footer: {size: 24, weight: 600},
} as const;

// ---------- Inter advance widths (per-mille em), measured in this repo's headless Chrome from the bundled
// @fontsource/inter latin woff2 files: U+0020..U+007E, then U+00B7 (·) and U+2212 (−). Kerning is ignored. ----------
const W600 = [252, 321, 523, 644, 650, 1004, 663, 326, 373, 373, 540, 673, 319, 465, 319, 379, 660, 423, 623, 636, 666, 612, 640, 576, 640, 640, 319, 329, 673, 673, 673, 543, 999, 728, 659, 737, 722, 605, 588, 749, 746, 277, 580, 703, 565, 922, 759, 769, 645, 773, 652, 650, 660, 736, 728, 1020, 720, 713, 652, 373, 379, 373, 481, 469, 351, 574, 624, 583, 624, 591, 389, 625, 612, 262, 262, 569, 262, 900, 612, 609, 624, 624, 397, 549, 353, 612, 587, 839, 569, 588, 566, 455, 359, 455, 673, 319, 673];
const W700 = [237, 338, 552, 649, 655, 1016, 672, 339, 377, 377, 559, 679, 334, 468, 334, 388, 674, 431, 630, 646, 676, 622, 649, 582, 651, 649, 334, 343, 679, 679, 679, 560, 1016, 747, 662, 740, 722, 607, 587, 750, 747, 281, 584, 719, 565, 932, 762, 771, 648, 777, 657, 655, 667, 732, 747, 1038, 738, 731, 664, 377, 388, 377, 487, 476, 365, 581, 630, 588, 630, 596, 398, 632, 623, 271, 271, 580, 271, 913, 623, 613, 630, 630, 407, 560, 366, 623, 600, 850, 580, 602, 573, 469, 372, 469, 679, 334, 679];
export const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
export const SUB_SCALE = 0.7; // subscript digits are drawn as smaller Inter digits (the latin subset has no U+2080..2089)
/** Estimated advance width in px (+2% margin). Unknown glyphs count as 1 em, so the estimate errs wide. */
export const textWidth = (s: string, size: number, weight: 600 | 700): number => {
	const tbl = weight === 700 ? W700 : W600;
	let w = 0;
	for (const ch of s) {
		const code = ch.codePointAt(0) ?? 0;
		const sub = SUBSCRIPTS.indexOf(ch);
		if (sub >= 0) w += tbl[16 + sub] * SUB_SCALE;
		else if (code >= 32 && code <= 126) w += tbl[code - 32];
		else if (code === 0xb7) w += tbl[95];
		else if (code === 0x2212) w += tbl[96];
		else w += 1000;
	}
	return ((w * size) / 1000) * 1.02;
};

// ---------- the model ----------
export type Text = {text: string; x: number; y: number}; // y = baseline
export type CandleMark = {i: number; dir: Dir; fill: string; wick: Rect; body: Rect; inner: Rect | null; candle: Candle};
export type ChartModel = {
	T: ChartTokens;
	box: Box;
	panel: Rect & {r: number};
	outline: Rect & {r: number; width: number}; // stroke geometry: centred on the path, so it covers the box edge exactly
	header: Text[];
	plot: Rect; // price pane
	volPane: Rect | null;
	scale: {mode: ScaleMode; min: number; max: number};
	layout: {slot: number; bodyW: number; x0: number; plotW: number};
	grid: Rect[];
	tickLabels: Text[];
	lastLine: Rect[];
	volume: Array<Rect & {fill: string}>;
	volBaseline: Rect | null;
	candles: CandleMark[];
	pill: {rect: Rect; r: number; fill: string; label: Text} | null;
	callout: {dir: Dir; fill: string; glyph: string; label: Text} | null;
	footerLabel: Text & {anchor: 'end'};
	shown: number;
	completed: number;
};

const fillFor = (T: ChartTokens, d: Dir) => (d === 'up' ? T.up : d === 'down' ? T.down : T.flat);
const volumeFillFor = (T: ChartTokens, d: Dir) => (d === 'up' ? T.volumeUp : d === 'down' ? T.volumeDown : T.flat);

/** How many candles are shown, and how many of those are complete (A8), at frame f. */
export const revealCounts = (n: number, f: number, reveal: RevealSpec | null | undefined): {completed: number} => {
	if (!reveal) return {completed: n};
	const k = (f - reveal.startFrame) / reveal.framesPerCandle;
	if (k < 0) return {completed: 0};
	const done = Math.min(n, Math.floor(k));
	return {completed: reveal.mode === 'step' ? Math.min(n, done + 1) : done};
};

/** The change callout of the last completed candle vs `candlesBack` candles earlier, or null if there are too few. */
export const calloutValue = (cs: Candle[], completed: number, candlesBack: number): number | null =>
	completed > candlesBack ? cs[completed - 1].c / cs[completed - 1 - candlesBack].c - 1 : null;

const calloutText = (r: number, label: string) => `${fmtPct(r)} ${label}`;

/** The right footer label: the fictional-data label (required when illustrative) or the data attribution. */
export const footerText = (d: ChartData, draft: boolean): string => {
	if (d.illustrative) return `Illustrative · fictional token${draft && d.source.kind === 'synthetic' ? ` · seed ${d.source.seed}` : ''}`;
	if (d.source.kind === 'synthetic') throw new Error('synthetic data must be illustrative');
	return `${d.source.attribution} · ${d.source.fetchedAt.slice(0, 10)}`;
};

export const layoutChart = (o: ChartOptions, frame: number): ChartModel => {
	const {data, box} = o;
	const T: ChartTokens = (o.surface ?? 'dark') === 'light' ? CHART_LIGHT : CHART_DARK;
	const showVolume = o.showVolume ?? true;
	const lastPrice = o.lastPrice ?? true;
	const cs = data.candles;
	const n = cs.length;
	if (![box.x, box.y, box.w, box.h].every(Number.isInteger)) throw new Error(`box must be integer px (L1): ${JSON.stringify(box)}`);
	if (o.reveal && !(Number.isInteger(o.reveal.framesPerCandle) && o.reveal.framesPerCandle >= 1)) throw new Error('reveal.framesPerCandle must be an integer >= 1');
	if (o.reveal?.mode === 'live' && o.reveal.framesPerCandle < 4) throw new Error('live reveal needs framesPerCandle >= 4 (A4)');
	if (o.callout) checkRefLabel(o.callout.label, o.callout.candlesBack, data.intervalSec);

	const innerX = box.x + INSET, innerY = box.y + INSET;
	const innerW = box.w - 2 * INSET, innerH = box.h - 2 * INSET;

	// ---- header (L3): one row, or two when the panel is narrower than 1000 px or the line does not fit. Never truncate.
	const modeFor = o.scale && o.scale !== 'auto' ? o.scale : undefined;
	const sc0 = priceScale(cs, 0, 1, modeFor); // mode only; the real scale is built below with the pane geometry
	const rest = `${intervalLabel(data.intervalSec)} · ${unitLabel(data.unit)} · ${sc0.mode} scale`;
	const one = `${data.pair} · ${rest}`;
	const split = box.w < SPLIT_HEADER_BELOW || textWidth(one, TEXT.header.size, TEXT.header.weight) > innerW;
	const headerLines = split ? [data.pair, rest] : [one];
	for (const l of headerLines) if (textWidth(l, TEXT.header.size, TEXT.header.weight) > innerW) throw new Error(`header "${l}" does not fit a ${box.w} px panel`);
	const headerH = split ? HEADER_ROW + HEADER_LINE : HEADER_ROW;
	const header = headerLines.map((text, k) => ({text, x: innerX, y: innerY + 28 + k * HEADER_LINE}));

	// ---- footer (L4): callout left, label right; two rows if the widest callout of the shot cannot sit beside the label.
	const draft = o.draft ?? false;
	const label = footerText(data, draft);
	const labelW = textWidth(label, TEXT.footer.size, TEXT.footer.weight);
	let calloutW = 0;
	if (o.callout) {
		for (let c = o.callout.candlesBack + 1; c <= n; c++) {
			const r = calloutValue(cs, c, o.callout.candlesBack);
			if (r !== null) calloutW = Math.max(calloutW, GLYPH_W + GLYPH_GAP + textWidth(calloutText(r, o.callout.label), TEXT.callout.size, TEXT.callout.weight));
		}
	}
	const footerRows = calloutW > 0 && calloutW + FOOTER_GAP + labelW > innerW ? 2 : 1;
	if (Math.max(calloutW, labelW) > innerW) throw new Error(`footer text does not fit a ${box.w} px panel`);
	const footerH = footerRows * FOOTER_ROW;

	// ---- panes (L2)
	const volH = showVolume ? Math.round(innerH * VOL_FRAC) : 0;
	const priceTop = innerY + headerH;
	const priceH = innerH - headerH - footerH - (showVolume ? PANE_GAP + volH : 0);
	if (priceH < MIN_PRICE_FRAC * innerH) throw new Error(`price pane ${priceH}px < 55% of the inner height ${innerH}px: use a taller box`);
	const volTop = priceTop + priceH + PANE_GAP;
	const footerTop = innerY + innerH - footerH;

	// ---- slots (L5, A1: from the shot's final count) and scale (L6: one scale from every candle the shot shows)
	const L = slots(n, innerX, innerW - AXIS_COL);
	if (L.bodyW < 7) throw new Error(`body ${L.bodyW}px < 7px (G3): show fewer candles (longer interval) or widen the box`);
	const plotRight = L.x0 + L.plotW;
	const sc = priceScale(cs, priceTop, priceH, modeFor);

	// ---- what is visible now (A2-A5)
	const shown = o.reveal ? revealAt(cs, frame, o.reveal.startFrame, o.reveal.framesPerCandle, o.reveal.mode) : cs;
	const {completed} = revealCounts(n, frame, o.reveal);

	// ---- candles (G1-G4, R1, R3, L10)
	const hollowOk = (o.hollowUp ?? false) && L.bodyW >= 15;
	const candles: CandleMark[] = shown.map((c, i) => {
		const r = candleRects(c, L.cx(i), L.bodyW, sc.y);
		if (r.wick.y < priceTop || r.wick.y + r.wick.h > priceTop + priceH) throw new Error(`candle ${i}: wick leaves the plot (R3)`);
		const inner = hollowOk && r.dir === 'up' && r.body.h >= 12 ? {x: r.body.x + 4, y: r.body.y + 4, w: r.body.w - 8, h: r.body.h - 8} : null;
		return {i, dir: r.dir, fill: fillFor(T, r.dir), wick: r.wick, body: r.body, inner, candle: c};
	});

	// ---- volume (L6: always from zero; flat colours; body width; price-direction proxy only)
	let volume: ChartModel['volume'] = [];
	let volBaseline: Rect | null = null;
	if (showVolume) {
		const usable = volH - 2;
		const vmax = Math.max(...cs.map((c) => c.v));
		volume = candles
			.map((m) => {
				const v = m.candle.v;
				const h = v > 0 && vmax > 0 ? Math.max(2, Math.round((v / vmax) * usable)) : 0;
				return {x: m.body.x, y: volTop + usable - h, w: m.body.w, h, fill: volumeFillFor(T, direction(m.candle))};
			})
			.filter((r) => r.h > 0);
		volBaseline = {x: L.x0, y: volTop + usable, w: L.plotW, h: 2};
	}

	// ---- last-price pill and line (L8, A7)
	const last = shown.length ? shown[shown.length - 1] : null;
	let pill: ChartModel['pill'] = null;
	let lastLine: Rect[] = [];
	let pillY: number | null = null;
	if (lastPrice && last) {
		pillY = Math.round(sc.y(last.c));
		const text = fmtUsd(last.c);
		const w = Math.min(PILL_W_MAX, Math.max(PILL_W, Math.ceil(textWidth(text, TEXT.pill.size, TEXT.pill.weight)) + 2 * (LABEL_DX - PILL_DX) + 8));
		pill = {
			rect: {x: plotRight + PILL_DX, y: pillY - PILL_H / 2, w, h: PILL_H},
			r: PILL_R,
			fill: fillFor(T, direction(last)),
			label: {text, x: plotRight + LABEL_DX, y: pillY + 9},
		};
		for (let x = L.x0; x < plotRight; x += 2 * DASH) lastLine.push({x, y: pillY - 1, w: Math.min(DASH, plotRight - x), h: 2});
	}

	// ---- gridlines and tick labels (L7): 2 px rects at round(y) - 1; labels de-cluttered once per shot, then hidden near the pill
	const ticks = sc.ticks.map((t) => ({t, y: Math.round(sc.y(t))})).sort((a, b) => a.y - b.y);
	const grid = ticks.map((k) => ({x: L.x0, y: k.y - 1, w: L.plotW, h: 2}));
	const kept: typeof ticks = [];
	for (const k of ticks) if (!kept.length || k.y - kept[kept.length - 1].y >= LABEL_MIN_GAP) kept.push(k);
	const tickLabels = kept.filter((k) => pillY === null || Math.abs(k.y - pillY) > PILL_CLEAR).map((k) => ({text: fmtUsd(k.t), x: plotRight + LABEL_DX, y: k.y + 9}));

	// ---- footer (L4, A8: the callout uses completed candles only)
	const calloutBase = footerTop + 38;
	let callout: ChartModel['callout'] = null;
	if (o.callout) {
		const r = calloutValue(shown, completed, o.callout.candlesBack);
		if (r !== null) {
			const dir: Dir = r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
			const gx = innerX, gb = calloutBase - 1;
			const glyph =
				dir === 'down'
					? `M${gx} ${gb - GLYPH_H}H${gx + GLYPH_W}L${gx + GLYPH_W / 2} ${gb}Z` // ▼
					: dir === 'up'
						? `M${gx} ${gb}H${gx + GLYPH_W}L${gx + GLYPH_W / 2} ${gb - GLYPH_H}Z` // ▲
						: `M${gx + 4} ${gb - GLYPH_H + 4}H${gx + GLYPH_W - 4}V${gb - 4}H${gx + 4}Z`; // ■ unchanged
			callout = {dir, fill: fillFor(T, dir), glyph, label: {text: calloutText(r, o.callout.label), x: innerX + GLYPH_W + GLYPH_GAP, y: calloutBase}};
		}
	}
	const footerLabel = {text: label, x: innerX + innerW, y: footerRows === 2 ? calloutBase + FOOTER_ROW : calloutBase, anchor: 'end' as const};

	return {
		T,
		box,
		panel: {x: box.x + OUTLINE / 2, y: box.y + OUTLINE / 2, w: box.w - OUTLINE, h: box.h - OUTLINE, r: PANEL_R - OUTLINE / 2},
		outline: {x: box.x + OUTLINE / 2, y: box.y + OUTLINE / 2, w: box.w - OUTLINE, h: box.h - OUTLINE, r: PANEL_R - OUTLINE / 2, width: OUTLINE},
		header,
		plot: {x: L.x0, y: priceTop, w: L.plotW, h: priceH},
		volPane: showVolume ? {x: L.x0, y: volTop, w: L.plotW, h: volH} : null,
		scale: {mode: sc.mode, min: sc.min, max: sc.max},
		layout: {slot: L.slot, bodyW: L.bodyW, x0: L.x0, plotW: L.plotW},
		grid,
		tickLabels,
		lastLine,
		volume,
		volBaseline,
		candles,
		pill,
		callout,
		footerLabel,
		shown: shown.length,
		completed,
	};
};
