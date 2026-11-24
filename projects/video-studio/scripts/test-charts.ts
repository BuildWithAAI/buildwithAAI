// Acceptance sweep for the chart modules (docs/CHART_SPEC.md section 10; reference run E9).
// Run: node scripts/test-charts.ts   (Node 22 strips the types; no build step)
// Prints exactly the six result lines of CHART_SPEC 10. Any failure is listed on stderr and sets exit code 1.
import {generate, formingCandle, fillGaps, toMarketCap, direction, type Candle, type Series} from '../src/charts/ohlc.ts';
import {validateCandles, validateStory, assertValid} from '../src/charts/validate.ts';
import {priceScale, slots, candleRects, revealAt} from '../src/charts/chartGeometry.ts';

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
