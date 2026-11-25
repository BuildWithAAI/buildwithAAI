/**
 * Fade curves and rest floors (added 2026-11-25 for the Episode's bed changes): equal-power crossfades between two
 * different beds, raised-cosine fades unchanged by default, and rests that dip to a floor instead of silence.
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {BedGain, fadeShape, rcos} from '../core/envelope.ts';
import {planBed} from '../core/bed.ts';
import {db, near} from './helpers.ts';

const SR = 48000;

describe('fadeShape', () => {
	it("the default is the raised cosine, so nothing that exists changes", () => {
		for (let i = 0; i <= 50; i++) assert.equal(fadeShape(i / 50), rcos(i / 50));
		const g = new BedGain({bands: 1, start: 0, end: 4, fadeInMs: 500, fadeOutMs: 500});
		assert.ok(near(g.gain(0.25), 0.5, 1e-12));
		assert.ok(near(g.gain(3.75), 0.5, 1e-12));
	});
	it('equal power: an aligned fade-in and fade-out sum to constant power at every sample (in^2 + out^2 = 1)', () => {
		const fadeIn = new BedGain({bands: 1, start: 1, end: 9, fadeInMs: 800, fadeCurve: 'equalPower'});
		const fadeOut = new BedGain({bands: 1, start: 0, end: 1.8, fadeOutMs: 800, fadeCurve: 'equalPower'});
		for (let i = 0; i <= 0.8 * SR; i += 7) {
			const t = 1 + i / SR;
			const a = fadeIn.gain(t);
			const b = fadeOut.gain(t);
			assert.ok(near(a * a + b * b, 1, 1e-9), `t ${t}: ${a * a + b * b}`);
		}
	});
	it('equal power starts and ends with zero slope (no corner) and is monotonic', () => {
		assert.equal(fadeShape(0, 'equalPower'), 0);
		assert.equal(fadeShape(1, 'equalPower'), 1);
		assert.ok(fadeShape(1e-4, 'equalPower') < 1e-6);
		assert.ok(1 - fadeShape(1 - 1e-4, 'equalPower') < 1e-6);
		let prev = 0;
		for (let i = 1; i <= 200; i++) {
			const v = fadeShape(i / 200, 'equalPower');
			assert.ok(v >= prev);
			prev = v;
		}
		assert.ok(near(fadeShape(0.5, 'equalPower'), Math.SQRT1_2, 1e-12)); // -3 dB at the midpoint, where the partner is also -3 dB
	});
	it('the fade-out can take its own curve (in from silence, out into another bed)', () => {
		const g = new BedGain({bands: 1, start: 0, end: 4, fadeInMs: 1000, fadeOutMs: 1000, fadeCurve: 'raisedCosine', fadeOutCurve: 'equalPower'});
		assert.ok(near(g.gain(0.5), 0.5, 1e-12));
		assert.ok(near(g.gain(3.5), Math.SQRT1_2, 1e-12));
		const p = planBed({start: 0, end: 4, fadeInMs: 1000, fadeOutMs: 1000, fadeOutCurve: 'equalPower'});
		assert.ok(near(p.gain.gain(3.5), Math.SQRT1_2, 1e-12));
		assert.ok(near(p.gain.gain(0.5), 0.5, 1e-12));
	});
	it('planBed passes the curve through, and rejects an unknown one', () => {
		const p = planBed({start: 0, end: 4, fadeInMs: 1000, fadeCurve: 'equalPower'});
		assert.ok(near(p.gain.gain(0.5), Math.SQRT1_2, 1e-12));
		assert.throws(() => new BedGain({bands: 1, start: 0, end: 1, fadeCurve: 'linear' as never}), /fade curve/);
	});
});

describe('rest floors', () => {
	it('a rest with floorDb dips to that level instead of silence, with raised-cosine moves between', () => {
		const g = new BedGain({bands: 1, start: 0, end: 10, rests: [{start: 4, end: 5, fadeOutMs: 400, fadeInMs: 800, floorDb: -18}]});
		const fl = 10 ** (-18 / 20);
		assert.equal(g.amplitude(3.5), 1);
		assert.ok(near(g.amplitude(3.8), fl + (1 - fl) * 0.5, 1e-12));
		assert.ok(near(db(g.amplitude(4.5)), -18, 1e-9));
		assert.ok(near(g.amplitude(5.4), fl + (1 - fl) * 0.5, 1e-12));
		assert.equal(g.amplitude(5.9), 1);
	});
	it('without floorDb a rest is still silence (unchanged), and a bad floor is refused', () => {
		const g = new BedGain({bands: 1, start: 0, end: 10, rests: [{start: 4, end: 5, fadeOutMs: 400, fadeInMs: 800}]});
		assert.equal(g.amplitude(4.5), 0);
		assert.throws(() => new BedGain({bands: 1, start: 0, end: 1, rests: [{start: 0.2, end: 0.4, fadeInMs: 0, fadeOutMs: 0, floorDb: 3}]}), /floorDb/);
	});
	it('the floor moves smoothly: no per-sample step larger than a raised cosine allows', () => {
		const g = new BedGain({bands: 1, start: 0, end: 4, rests: [{start: 2, end: 3, fadeOutMs: 300, fadeInMs: 300, floorDb: -18}]});
		const n = 4 * SR;
		const out = [new Float32Array(n)];
		g.fill(out, 0, SR);
		let maxStep = 0;
		for (let i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(out[0][i] - out[0][i - 1]));
		const bound = ((1 - 10 ** (-18 / 20)) * Math.PI) / 2 / 0.3 / SR; // the slope of (1 - floor) * rcos over 300 ms
		assert.ok(maxStep <= bound * 1.001, `max step ${maxStep} > ${bound}`);
	});
});
