// Acceptance sweep for the chart modules (docs/CHART_SPEC.md section 10; reference run E9).
// Run: node scripts/test-charts.ts   (Node 22 strips the types; no build step)
// Prints the six result lines of CHART_SPEC 10 first, byte-identical to the spec, then the checks added in the fix
// round (layout, formatting and reveal defects the spec sweep cannot see). Any failure is listed on stderr and sets
// exit code 1.
import {generate, formingCandle, fillGaps, toMarketCap, direction, type Candle, type Series} from '../src/charts/ohlc.ts';
import {validateCandles, validateStory, assertValid} from '../src/charts/validate.ts';
import {priceScale, slots, candleRects, revealAt, fmtUsd as fmtUsdVerbatim} from '../src/charts/chartGeometry.ts';
import {fmtUsd, fmtUsdSig, fmtPctDisplay, labelSig, linearTicks, parseUsd} from '../src/charts/chartFormat.ts';
import {evenSlots, layoutChart, mixOver, textWidth, volumeFillFor, TEXT, type ChartModel, type ChartOptions} from '../src/charts/chartLayout.ts';
import {flickerIssues, planReveal, revealStateAt} from '../src/charts/revealPlan.ts';
import {refLabel} from '../src/charts/chartData.ts';
import {CHART_DARK, CHART_LIGHT} from '../src/charts/tokens.ts';
import {BOX_TEST, demoData, demoOptions, REVEAL_FRAMES, REVEAL_START, revealSegments} from '../src/charts/dev/demoData.ts';

let failures = 0;
const failMsgs: string[] = [];
const check = (ok: boolean, msg: string) => {
	if (ok) return;
	failures++;
	if (failMsgs.length < 20) failMsgs.push(msg);
};

// ---- 10,000 seeds: invariants (price and market cap), story checks, geometry, forming candles ----
let seedsWithIssues = 0, rects = 0, formFrames = 0;
const plot = {x: 120, y: 140, w: 1560, h: 600};
for (let seed = 1; seed <= 10000; seed++) {
	const keep = seed <= 300; // forming-candle sweep on the first 300 seeds (needs ticks)
	const s = generate(seed, undefined, {keepTicks: keep});
	const mc = toMarketCap(s.candles, s.supply);
	const issues = [...validateCandles(s.candles, 300), ...validateCandles(mc, 300), ...validateStory(s)];
	if (issues.length) seedsWithIssues++;
	const sc = priceScale(mc, plot.y, plot.h); // auto mode
	check(sc.mode === 'log', `seed ${seed}: span > 10x must pick log`);
	const L = slots(mc.length, plot.x, plot.w);
	check(L.slot % 2 === 0 && L.x0 % 2 === 0 && L.cx(0) % 2 === 0 && L.bodyW % 2 === 1, `seed ${seed}: slot/x0/cx parity`);
	mc.forEach((c, i) => {
		const r = candleRects(c, L.cx(i), L.bodyW, sc.y);
		rects++;
		check(r.dir === direction(c) && r.wick.y <= r.body.y && r.body.y + r.body.h <= r.wick.y + r.wick.h, `seed ${seed} i ${i}: body outside wick`);
		check(r.wick.y >= plot.y && r.wick.y + r.wick.h <= plot.y + plot.h, `seed ${seed} i ${i}: wick leaves plot (R3)`);
		check(r.body.h >= 3 && r.wick.w === 3 && r.wick.x === L.cx(i) - 1, `seed ${seed} i ${i}: min body / wick column`);
		if (keep) {
			let prev: ReturnType<typeof candleRects> | null = null;
			for (let f = 0; f <= 30; f++) {
				const fc = formingCandle(c, f / 30);
				formFrames++;
				check(fc.h >= Math.max(fc.o, fc.c) && fc.l <= Math.min(fc.o, fc.c), `seed ${seed} i ${i} f ${f}: forming invariant`);
				const r2 = candleRects(fc, L.cx(i), L.bodyW, sc.y);
				if (prev) check(r2.wick.y <= prev.wick.y && r2.wick.y + r2.wick.h >= prev.wick.y + prev.wick.h, `seed ${seed} i ${i} f ${f}: wick shrank`);
				prev = r2;
			}
			check(JSON.stringify(candleRects(formingCandle(c, 1), L.cx(i), L.bodyW, sc.y)) === JSON.stringify(r), `seed ${seed} i ${i}: end frame != stored`);
		}
	});
}

// ---- revealAt: left to right, history never changes, forming candle exact at window end, no 1-frame states ----
let revealFrames = 0;
const ohlcKey = (c: Candle) => `${c.o},${c.h},${c.l},${c.c}`;
for (let seed = 1; seed <= 100; seed++) {
	const cs = generate(seed, undefined, {keepTicks: true}).candles;
	for (const fpc of [1, 2, 3, 4, 6, 7, 10, 15]) {
		for (const mode of ['step', 'live'] as const) {
			let prevLen = 0, prevKey = '', runLen = 0, prevIdx = -1;
			const start = 5;
			for (let f = 0; f <= start + cs.length * fpc + 3; f++) {
				const shown = revealAt(cs, f, start, fpc, mode);
				revealFrames++;
				check(shown.length >= prevLen, `reveal shrank seed ${seed} fpc ${fpc}`);
				shown.slice(0, -1).forEach((c, i) => check(ohlcKey(c) === ohlcKey(cs[i]), `history changed seed ${seed} f ${f}`));
				const last = shown.length - 1;
				if (last >= 0) {
					const lc = shown[last];
					check(lc.h >= Math.max(lc.o, lc.c) && lc.l <= Math.min(lc.o, lc.c), 'forming invariant (reveal)');
					const localEnd = (f - start) % fpc === fpc - 1;
					if (mode === 'live' && localEnd) check(ohlcKey(lc) === ohlcKey(cs[last]), `seed ${seed} fpc ${fpc} f ${f}: candle not exact at window end`);
					const key = ohlcKey(lc);
					if (last === prevIdx && key !== prevKey) {
						// state changed within the same candle: the previous state must have lasted >= 2 frames
						if (mode === 'live' && fpc >= 4) check(runLen >= 2, `seed ${seed} fpc ${fpc} f ${f}: 1-frame state`);
						runLen = 1;
					} else runLen = last === prevIdx ? runLen + 1 : 1;
					prevKey = key;
					prevIdx = last;
				}
				prevLen = shown.length;
			}
			check(prevLen === cs.length, `seed ${seed} fpc ${fpc} ${mode}: not all candles revealed`);
		}
	}
}

// ---- negative tests: the validator must catch each injected fault ----
const base: Candle[] = [
	{t: 0, o: 1, h: 1.2, l: 0.9, c: 1.1, v: 10},
	{t: 60, o: 1.1, h: 1.3, l: 1.0, c: 1.05, v: 12},
];
check(validateCandles(base, 60).length === 0, 'clean base series must pass');
const mut = (f: (c: Candle[]) => void) => {
	const c = structuredClone(base);
	f(c);
	return c;
};
const negatives: Array<[string, Candle[]]> = [
	['high below close', mut((c) => (c[1].h = 1.0))],
	['low above open', mut((c) => (c[0].l = 1.05))],
	['negative price', mut((c) => (c[0].l = -1))],
	['NaN', mut((c) => (c[1].c = NaN))],
	['gap open', mut((c) => (c[1].o = 1.3))],
	['irregular interval', mut((c) => (c[1].t = 90))],
	['negative volume', mut((c) => (c[1].v = -5))],
	['ticks disagree', mut((c) => (c[0].ticks = [1.05, 1.1]))],
	['empty', []],
];
const caught = negatives.filter(([, cs]) => validateCandles(cs, 60).length > 0).length;
let threw = false;
try {
	assertValid(negatives[0][1], 60);
} catch {
	threw = true;
}
const custom: Series = generate(5, [{kind: 'launch', bars: 20}, {kind: 'chop', bars: 30}, {kind: 'bleed', bars: 10}]);
const customOk = validateCandles(custom.candles, 300).length === 0 && validateStory(custom).length === 0;
const gaps = fillGaps([base[0], {...base[1], t: 180}], 60);
const gapsValid = validateCandles(gaps, 60).length === 0;
const deterministic = JSON.stringify(generate(42)) === JSON.stringify(generate(42));

const row = (left: string, note = '') => (note ? `${left.padEnd(28)}${note}` : left);
console.log(
	[
		row(`seedsWithIssues: ${seedsWithIssues}`, '(10,000 seeds; price and market cap)'),
		row(`rects: ${rects}, geometryFailures: ${failures}`),
		row(`formFrames: ${formFrames}`, '(300 seeds × 116 candles × 31 frames; wick never shrinks; end frame = stored)'),
		row(`revealFrames: ${revealFrames}`, '(revealAt: left to right, history fixed, exact at window end, no 1-frame states)'),
		row(`negativesCaught: ${caught}/${negatives.length}`, '(high<close, low>open, negative, NaN, gap open, irregular interval, negative volume, ticks≠OHLC, empty)'),
		`assertValidThrows: ${threw}, customStoryNoRugPasses: ${customOk}, fillGaps: ${gaps.length} candles ${gapsValid ? 'valid' : 'INVALID'}, deterministic: ${deterministic}`,
	].join('\n'),
);

// =====================================================================================================================
// Added checks (not in CHART_SPEC 10). They test what the chart DRAWS (chartLayout, chartFormat, revealPlan), so each
// one fails on the defect it was written for: the verbatim helpers are run alongside as negative controls.
// =====================================================================================================================
let extraFailures = 0;
const extraMsgs: string[] = [];
const check2 = (ok: boolean, msg: string) => {
	if (ok) return;
	extraFailures++;
	if (extraMsgs.length < 20) extraMsgs.push(msg);
};
const fmtN = (x: number) => x.toLocaleString('en-US');

// ---- G1/G2: every centre column is even, for every slot size (the verbatim slots() is odd when slot % 4 == 2) ----
let slotLayouts = 0, oddCx = 0, verbatimOdd = 0;
for (let n = 30; n <= 160; n++)
	for (let availW = 400; availW <= 2000; availW += 6)
		for (const x of [35, 36]) {
			let L: ReturnType<typeof evenSlots>;
			try {
				L = evenSlots(n, x, availW);
			} catch {
				continue; // slot < 8 px: refused (L5)
			}
			slotLayouts++;
			const V = slots(n, x, availW);
			if (V.cx(0) % 2 !== 0) verbatimOdd++;
			let odd = false;
			for (let i = 0; i < n; i++) if (L.cx(i) % 2 !== 0) odd = true;
			if (odd) oddCx++;
			const centred = x + (availW - L.plotW) / 2;
			check2(!odd && L.slot === V.slot && L.bodyW === V.bodyW && Math.abs(L.x0 - centred) <= 1, `evenSlots n ${n} w ${availW} x ${x}: x0 ${L.x0} centred ${centred}`);
		}
// the same through layoutChart, on many box widths and candle counts
let boxLayouts = 0;
const base116 = demoData();
for (let w = 900; w <= 1900; w += 10)
	for (const n of [40, 58, 80, 100, 116]) {
		const data = {...base116, candles: base116.candles.slice(0, n), source: {kind: 'geckoterminal' as const, url: 'test', fetchedAt: '2026-11-24T00:00:00Z', attribution: 'test'}, illustrative: true};
		let m: ChartModel;
		try {
			m = layoutChart({data, box: {x: 37 + (w % 4), y: 40, w, h: 900}}, 0);
		} catch {
			continue;
		}
		boxLayouts++;
		check2(m.candles.every((c) => (c.wick.x + 1) % 2 === 0 && c.wick.w === 3), `layoutChart w ${w} n ${n}: odd wick column (slot ${m.layout.slot})`);
	}

// ---- fmtUsd: every string decodes to the value rounded to its precision; units promoted; no exponent ----
const SIG_TOL = (s: string) => (s.startsWith('$0.0') && /[₀-₉]/.test(s) ? 0.05 : 0.005); // half a unit in the last digit
let usdValues = 0, usdWrong = 0, usdExp = 0, usdUnpromoted = 0, verbatimWrong = 0;
for (let k = 0; k <= 190_000; k++) {
	const v = 10 ** (-9 + k / 10_000);
	usdValues++;
	const s = fmtUsd(v);
	if (/e/i.test(s)) usdExp++;
	const unit = /^\$(\d+(?:\.\d+)?)[KMB]$/.exec(s);
	if (unit && Number(unit[1]) >= 1000) usdUnpromoted++;
	if (!(Math.abs(parseUsd(s) / v - 1) <= SIG_TOL(s) * 1.0000001)) usdWrong++;
	const sv = fmtUsdVerbatim(v);
	if (!(Math.abs(parseUsd(sv) / v - 1) <= SIG_TOL(sv) * 1.0000001)) verbatimWrong++;
}
check2(usdWrong === 0 && usdExp === 0 && usdUnpromoted === 0, `fmtUsd: ${usdWrong} wrong, ${usdExp} exponent, ${usdUnpromoted} unpromoted`);
check2(verbatimWrong > 0, 'negative control: the verbatim fmtUsd carry bug was not detected');
for (const [v, want] of [[0.000009966570284, '$0.0₄10'], [0.0009996, '$0.001'], [999_600, '$1M'], [999.6, '$1K'], [0.0000032, '$0.0₅32'], [61_700, '$61.7K']] as const)
	check2(fmtUsd(v) === want, `fmtUsd(${v}) = ${fmtUsd(v)}, want ${want}`);

// ---- L7 linear ticks: 4-7 ticks, distinct labels, each label decodes to within step/2 of its tick ----
let linWindows = 0, linOutOfBand = 0, linDup = 0, linMisread = 0, verbatimDup = 0;
for (let seed = 1; seed <= 200; seed++) {
	const s = generate(seed);
	const cs = toMarketCap(s.candles, s.supply);
	for (const len of [8, 12, 24, 40])
		for (let st = 0; st + len <= cs.length; st += 4) {
			const sc = priceScale(cs.slice(st, st + len), 0, 600, 'linear');
			linWindows++;
			const {ticks, step} = linearTicks(sc.min, sc.max);
			const sig = labelSig(ticks, step);
			const labels = ticks.map((t) => fmtUsdSig(t, sig));
			if (ticks.length < 4 || ticks.length > 7) linOutOfBand++;
			if (new Set(labels).size !== labels.length) linDup++;
			if (labels.some((l, k) => !(Math.abs(parseUsd(l) - ticks[k]) <= step / 2))) linMisread++;
			const vl = sc.ticks.map(fmtUsdVerbatim);
			if (new Set(vl).size !== vl.length) verbatimDup++;
		}
}
check2(linOutOfBand === 0 && linDup === 0 && linMisread === 0, `linear ticks: ${linOutOfBand} out of 4-7, ${linDup} duplicate, ${linMisread} misread`);

// ---- L4/CD7 callout percentage: the glyph direction and the sign come from the rounded value ----
let pctValues = 0, pctBad = 0;
for (let k = -20_000; k <= 50_000; k++) {
	const r = k / 10_000 + (k % 7) * 1e-6;
	pctValues++;
	const {text, dir} = fmtPctDisplay(r);
	const num = Number(text.replace('−', '-').replace('%', ''));
	const decimals = text.includes('.') ? 1 : 0;
	const ok =
		(dir === 'flat') === (text === '0.0%') &&
		(dir !== 'up' || text.startsWith('+')) &&
		(dir !== 'down' || text.startsWith('−')) &&
		(Math.abs(num) >= 10 ? decimals === 0 : decimals === 1) &&
		Math.abs(num - r * 100) <= (decimals ? 0.05 : 0.5) + 1e-9;
	if (!ok) pctBad++;
}
check2(pctBad === 0, `fmtPctDisplay: ${pctBad} inconsistent`);

// ---- volume colours: the 45% mix rule reproduces the spec's precomputed tokens; doji volume uses the same rule ----
const mixOk =
	mixOver(CHART_DARK.up, CHART_DARK.surface, 0.45) === CHART_DARK.volumeUp &&
	mixOver(CHART_DARK.down, CHART_DARK.surface, 0.45) === CHART_DARK.volumeDown &&
	mixOver(CHART_LIGHT.up, CHART_LIGHT.surface, 0.45) === CHART_LIGHT.volumeUp &&
	mixOver(CHART_LIGHT.down, CHART_LIGHT.surface, 0.45) === CHART_LIGHT.volumeDown;
check2(mixOk, 'mixOver does not reproduce the spec volume tokens');

// ---- ChartReveal: no 1-frame state in any drawn element; tick labels keep >= 8 px from the pill on every frame ----
const rd = demoData();
const plan = planReveal(revealSegments(rd), REVEAL_START, rd.candles.length);
const revealOpts = (f: number): ChartOptions => {
	const st = revealStateAt(plan, f);
	return {data: rd, box: BOX_TEST, surface: 'dark', callout: {candlesBack: 12, label: refLabel(12, rd.intervalSec)}, draft: true, reveal: st.spec, calloutVisible: st.calloutVisible};
};
const revealModels: ChartModel[] = [];
for (let f = 0; f < REVEAL_FRAMES; f++) revealModels.push(layoutChart(revealOpts(f), f));
const flicker = flickerIssues(revealModels);
check2(flicker.length === 0, `reveal flicker: ${flicker.slice(0, 3).join('; ')}`);
// text boxes from Inter metrics: ink from 0.8 em above the baseline to 0.24 em below; the pill is its rect
const textBox = (t: {text: string; x: number; y: number}, size: number, weight: 600 | 700, anchor: 'start' | 'end' = 'start') => {
	const w = textWidth(t.text, size, weight);
	const x0 = anchor === 'end' ? t.x - w : t.x;
	return {x0, x1: x0 + w, y0: t.y - 0.8 * size, y1: t.y + 0.24 * size};
};
type BoxT = ReturnType<typeof textBox>;
const gapY = (a: BoxT, b: BoxT) => Math.max(a.y0 - b.y1, b.y0 - a.y1);
const overlapX = (a: BoxT, b: BoxT) => a.x0 < b.x1 && b.x0 < a.x1;
let minPillGap = Infinity, textCollisions = 0;
const textCheck = (m: ChartModel, tag: string) => {
	const boxes: Array<[string, BoxT]> = [
		...m.header.map((t): [string, BoxT] => ['header', textBox(t, TEXT.header.size, TEXT.header.weight)]),
		...m.tickLabels.map((t): [string, BoxT] => ['tick', textBox(t, TEXT.axis.size, TEXT.axis.weight)]),
		['footer', textBox(m.footerLabel, TEXT.footer.size, TEXT.footer.weight, 'end')],
	];
	if (m.callout) boxes.push(['callout', {...textBox(m.callout.label, TEXT.callout.size, TEXT.callout.weight), x0: m.callout.label.x - 34}]);
	if (m.pill) {
		const p = {x0: m.pill.rect.x, x1: m.pill.rect.x + m.pill.rect.w, y0: m.pill.rect.y, y1: m.pill.rect.y + m.pill.rect.h};
		for (const [n, b] of boxes) if (n === 'tick' && overlapX(p, b)) minPillGap = Math.min(minPillGap, gapY(p, b));
		boxes.push(['pill', p]);
	}
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++)
			if (overlapX(boxes[i][1], boxes[j][1]) && gapY(boxes[i][1], boxes[j][1]) < 2) {
				textCollisions++;
				check2(false, `${tag}: ${boxes[i][0]} touches ${boxes[j][0]}`);
			}
};
revealModels.forEach((m, f) => textCheck(m, `ChartReveal f${f}`));
const demos = demoOptions();
for (const id of ['ChartTest', 'ChartLight', 'ChartShort'] as const) textCheck(layoutChart(demos[id], 0), id);
check2(minPillGap >= 8, `a tick label comes within ${minPillGap.toFixed(1)} px of the pill`);
// every demo: even wick columns and doji volume in the derived colour
for (const id of ['ChartTest', 'ChartLight', 'ChartShort'] as const) {
	const m = layoutChart(demos[id], 0);
	check2(m.candles.every((c) => (c.wick.x + 1) % 2 === 0), `${id}: odd wick column`);
	check2(m.volume.every((v) => v.fill === volumeFillFor(m.T, m.candles.find((c) => c.body.x === v.x)!.dir)), `${id}: volume colour`);
}

// ---- G3 as drawn: the close edge and the wick ends are exact; only the 3-row box on the open's row adds ink ----
// G3 joins every candle with the box on rows floor(y(o))-1 .. floor(y(o))+1, so the open side of the mark can extend up to
// 2 px past the true open (and past the high or low when the open is the extreme). That is the spec rule (CD5 "anchored
// on the open"), and A4's never-shrinking forming wick depends on it; this check states the exact bound instead of
// calling the rects "exact".
let g3Candles = 0, g3Past1 = 0, g3MaxPast = 0;
for (let seed = 1; seed <= 200; seed++) {
	const cs = toMarketCap(generate(seed).candles, 1e9);
	const sc = priceScale(cs, 152, 600);
	const L = evenSlots(cs.length, 194, 1392);
	cs.forEach((c, i) => {
		const r = candleRects(c, L.cx(i), L.bodyW, sc.y);
		g3Candles++;
		const a = Math.floor(sc.y(c.o));
		const yc = Math.round(sc.y(c.c)), yh = Math.round(sc.y(c.h)), yl = Math.round(sc.y(c.l));
		const bodyTop = r.body.y, bodyBot = r.body.y + r.body.h, wTop = r.wick.y, wBot = r.wick.y + r.wick.h;
		// close edge exact whenever the close lies outside the open box
		if (c.c > c.o && yc <= a - 1) check2(bodyTop === yc, `G3 seed ${seed} i ${i}: up close edge`);
		if (c.c < c.o && yc >= a + 2) check2(bodyBot === yc, `G3 seed ${seed} i ${i}: down close edge`);
		// wick ends exact whenever the high/low lies outside the open box
		if (yh <= a - 1) check2(wTop === yh, `G3 seed ${seed} i ${i}: wick top`);
		if (yl >= a + 2) check2(wBot === yl, `G3 seed ${seed} i ${i}: wick bottom`);
		// ink past the true high and low: never more than 2 px (the open box), and never short of it by more than 0.5 px
		const pastHigh = sc.y(c.h) - wTop, pastLow = wBot - sc.y(c.l);
		check2(pastHigh <= 2 + 1e-9 && pastLow <= 2 + 1e-9 && pastHigh >= -0.5 - 1e-9 && pastLow >= -0.5 - 1e-9, `G3 seed ${seed} i ${i}: ink ${pastHigh}/${pastLow} px past high/low`);
		const past = Math.max(pastHigh, pastLow);
		g3MaxPast = Math.max(g3MaxPast, past);
		if (past > 1) g3Past1++;
	});
}

console.log(
	[
		'--- added checks (not in CHART_SPEC 10) ---',
		`evenCx: ${fmtN(slotLayouts)} slot layouts (n 30-160, widths 400-2000, odd and even x) and ${boxLayouts} layoutChart boxes; odd centre columns: ${oddCx} (verbatim slots(): ${fmtN(verbatimOdd)})`,
		`fmtUsd: ${fmtN(usdValues)} values 1e-9..1e10; misread: ${usdWrong}, exponent: ${usdExp}, unpromoted units: ${usdUnpromoted} (verbatim fmtUsd misreads ${verbatimWrong})`,
		`linearTicks: ${fmtN(linWindows)} windows; outside 4-7 ticks: ${linOutOfBand}, duplicate labels: ${linDup}, labels off by > step/2: ${linMisread} (verbatim ticks+fmtUsd: ${verbatimDup} windows with duplicates)`,
		`fmtPct: ${fmtN(pctValues)} values; glyph, sign or precision inconsistent: ${pctBad}`,
		`volumeMix: 45% rule reproduces the 4 spec volume tokens: ${mixOk}; doji volume ${mixOver(CHART_DARK.flat, CHART_DARK.surface, 0.45)} dark, ${mixOver(CHART_LIGHT.flat, CHART_LIGHT.surface, 0.45)} light`,
		`ChartReveal: ${REVEAL_FRAMES} frames; 1-frame states: ${flicker.length}; text collisions (all frames and demos): ${textCollisions}; min tick label to pill gap: ${minPillGap.toFixed(1)} px`,
		`G3 open box: ${fmtN(g3Candles)} candles; close edge and wick ends exact outside the open box; ink past high/low max ${g3MaxPast.toFixed(3)} px, > 1 px on ${fmtN(g3Past1)} (${((100 * g3Past1) / g3Candles).toFixed(1)}%)`,
	].join('\n'),
);
if (extraFailures) {
	console.error(`ADDED CHECKS FAILED (${extraFailures}). First failures:\n${extraMsgs.join('\n')}`);
	process.exitCode = 1;
}

const expected = {seedsWithIssues: 0, rects: 1_160_000, failures: 0, formFrames: 1_078_800, revealFrames: 1_128_000, caught: 9};
const ok =
	seedsWithIssues === expected.seedsWithIssues &&
	rects === expected.rects &&
	failures === expected.failures &&
	formFrames === expected.formFrames &&
	revealFrames === expected.revealFrames &&
	caught === expected.caught &&
	threw &&
	customOk &&
	gaps.length === 4 &&
	gapsValid &&
	deterministic;
if (!ok) {
	console.error(`FAILED. First failures:\n${failMsgs.join('\n')}`);
	process.exitCode = 1;
}
