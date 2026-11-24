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
