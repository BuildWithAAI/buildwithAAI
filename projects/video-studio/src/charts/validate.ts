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
