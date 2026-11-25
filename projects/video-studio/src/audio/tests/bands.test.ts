import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {butterHighpass, butterLowpass, butterworthQs, filtfilt, magnitude, splitBands, VOICE_CROSSOVERS} from '../core/bands.ts';
import {db, near, noise, rms, sine} from './helpers.ts';

const SR = 48000;

describe('Butterworth sections', () => {
	it('uses the standard section Qs (order 4: 0.5412, 1.3066)', () => {
		const q = butterworthQs(4);
		assert.ok(near(q[0], 0.541196, 1e-5));
		assert.ok(near(q[1], 1.306563, 1e-5));
		assert.throws(() => butterworthQs(3), /even/);
	});
	it('a 4th-order low-pass is -3.01 dB at fc and falls 24 dB/octave', () => {
		const lp = butterLowpass(700, 4, SR);
		assert.ok(near(db(magnitude(lp, 700, SR)), -3.01, 0.02));
		assert.ok(near(db(magnitude(lp, 50, SR)), 0, 0.01));
		// one octave well above fc (analog: -24.06 dB; the bilinear warp adds a little this far below Nyquist)
		const oct = db(magnitude(lp, 2800, SR)) - db(magnitude(lp, 1400, SR));
		assert.ok(near(oct, -24.06, 0.5), `octave slope ${oct}`);
		const hp = butterHighpass(150, 2, SR);
		assert.ok(near(db(magnitude(hp, 150, SR)), -3.01, 0.02));
	});
	it('rejects cut-offs outside (0, Nyquist)', () => {
		assert.throws(() => butterLowpass(30000, 4, SR), /fc/);
	});
});

describe('filtfilt (zero phase)', () => {
	it('is -6.02 dB at the crossover (Linkwitz-Riley magnitude) and moves no sample in time', () => {
		const n = SR;
		const x = sine(n, 700, SR, 0.5);
		const y = filtfilt(x, butterLowpass(700, 4, SR), {circular: true, pad: 9600});
		assert.ok(near(db(rms(y, 4800, n - 4800) / rms(x, 4800, n - 4800)), -6.02, 0.05));
		// zero phase: the filtered sine stays in phase with the input (correlation at lag 0 is the maximum)
		const corr = (lag: number) => {
			let s = 0;
			for (let i = 4800; i < n - 4800; i++) s += x[i] * y[i + lag];
			return s;
		};
		assert.ok(corr(0) > corr(1) && corr(0) > corr(-1));
	});
	it('a circular split of a loop wraps without a seam', () => {
		// a loop of whole periods: the wrap is continuous in the input, so it must be in the output too
		const n = 4800;
		const x = sine(n, 100, SR, 0.5);
		const y = filtfilt(x, butterLowpass(700, 4, SR), {circular: true, pad: 9600});
		const jumpAtSeam = Math.abs(y[0] - y[n - 1]);
		let typical = 0;
		for (let i = 1; i < n; i++) typical = Math.max(typical, Math.abs(y[i] - y[i - 1]));
		assert.ok(jumpAtSeam <= typical * 1.01, `seam ${jumpAtSeam} vs largest step ${typical}`);
	});
});

describe('splitBands', () => {
	it('the bands sum back to the input exactly (the duck at 0 dB is transparent)', () => {
		const x = noise(SR, 0.5);
		const bands = splitBands([x], SR, {circular: false});
		assert.equal(bands.length, 3);
		let worst = 0;
		for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(bands[0][0][i] + bands[1][0][i] + bands[2][0][i] - x[i]));
		assert.ok(worst < 1e-6, `sum error ${worst}`); // float32 storage
	});
	it('puts each tone in its band: 200 Hz low, 2 kHz mid, 9 kHz high', () => {
		const n = SR;
		const lvl = (f: number) => {
			const b = splitBands([sine(n, f, SR, 0.5)], SR, {circular: true});
			return b.map((band) => db(rms(band[0], 4800, n - 4800) / (0.5 / Math.SQRT2)));
		};
		const low = lvl(200);
		const mid = lvl(2000);
		const high = lvl(9000);
		assert.ok(low[0] > -0.1 && low[1] < -30, `200 Hz: ${low}`);
		assert.ok(mid[1] > -0.2 && mid[0] < -40 && mid[2] < -40, `2 kHz: ${mid}`);
		assert.ok(high[2] > -0.1 && high[1] < -25, `9 kHz: ${high}`);
	});
	it('defaults to the voice crossovers and validates them', () => {
		assert.deepEqual([...VOICE_CROSSOVERS], [700, 5000]);
		assert.throws(() => splitBands([new Float64Array(10)], SR, {circular: false, crossovers: [5000, 700]}), /rise/);
	});
});
