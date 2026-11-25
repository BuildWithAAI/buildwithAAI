import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {BedGain, DuckCurve, dbToGain, gainToDb, mergeSpans, rcos, shiftSpans} from '../core/envelope.ts';
import {db, near} from './helpers.ts';

const SR = 48000;

describe('rcos', () => {
	it('rises 0 -> 1 with zero slope at both ends and clamps outside [0, 1]', () => {
		assert.equal(rcos(-1), 0);
		assert.equal(rcos(0), 0);
		assert.equal(rcos(1), 1);
		assert.equal(rcos(2), 1);
		assert.ok(near(rcos(0.5), 0.5, 1e-12));
		// slope at the ends ~0: a tiny step changes it by a second-order amount
		assert.ok(rcos(1e-4) < 1e-7);
		assert.ok(1 - rcos(1 - 1e-4) < 1e-7);
		let prev = 0;
		for (let i = 1; i <= 100; i++) {
			const v = rcos(i / 100);
			assert.ok(v >= prev);
			prev = v;
		}
	});
});

describe('mergeSpans', () => {
	it('sorts, drops empty and non-finite spans, merges overlaps and short gaps', () => {
		const out = mergeSpans(
			[
				{start: 5, end: 6},
				{start: 1, end: 2},
				{start: 2.5, end: 3},
				{start: 3, end: 3}, // empty
				{start: Number.NaN, end: 4},
				{start: 1.5, end: 2.2}, // overlaps the first
			],
			0.6,
		);
		assert.deepEqual(out, [
			{start: 1, end: 3},
			{start: 5, end: 6},
		]);
	});
	it('keeps spans apart when the gap is at least minGap', () => {
		assert.deepEqual(mergeSpans([{start: 0, end: 1}, {start: 1.8, end: 2}], 0.8), [
			{start: 0, end: 1},
			{start: 1.8, end: 2},
		]);
	});
	it('shiftSpans moves every span', () => {
		assert.deepEqual(shiftSpans([{start: 1, end: 2}], 4), [{start: 5, end: 6}]);
	});
});

describe('DuckCurve', () => {
	const timing = {attackMs: 120, releaseMs: 450};
	it('is complete on the first word (lookahead = attack) and releases over releaseMs after the last', () => {
		const c = new DuckCurve([{start: 2, end: 4}], timing);
		assert.equal(c.at(1.88), 0);
		assert.ok(near(c.at(1.94), 0.5, 1e-9)); // half-way through the attack
		assert.equal(c.at(2), 1);
		assert.equal(c.at(3), 1);
		assert.equal(c.at(4), 1);
		assert.ok(near(c.at(4.225), 0.5, 1e-9));
		assert.equal(c.at(4.45), 0);
		assert.equal(c.at(10), 0);
	});
	it('fills pauses shorter than minGapMs (default 800 ms) and lets longer ones release', () => {
		const c = new DuckCurve([{start: 1, end: 2}, {start: 2.7, end: 3}, {start: 5, end: 6}], timing);
		assert.equal(c.spans.length, 2);
		assert.equal(c.at(2.35), 1); // inside the filled 0.7 s pause
		assert.ok(c.at(4) === 0); // the 2 s pause releases fully
	});
	it('a span shorter than the attack releases from where the attack got to (continuous)', () => {
		const c = new DuckCurve([{start: 1, end: 1.02}], {attackMs: 200, releaseMs: 300, lookaheadMs: 0});
		let prev = 0;
		let maxStep = 0;
		for (let i = 0; i < 1.6 * SR; i++) {
			const v = c.at(i / SR);
			maxStep = Math.max(maxStep, Math.abs(v - prev));
			prev = v;
		}
		assert.ok(maxStep < 1e-3, `largest per-sample step ${maxStep}`);
		assert.ok(c.at(1.02) < 0.1); // only 20 ms of a 200 ms attack
	});
	it('holdMs keeps the duck down after the speech', () => {
		const c = new DuckCurve([{start: 1, end: 2}], {...timing, holdMs: 300});
		assert.equal(c.at(2.3), 1);
		assert.ok(c.at(2.4) < 1);
	});
	it('isIdle agrees with at() everywhere', () => {
		const c = new DuckCurve([{start: 1, end: 2}, {start: 4, end: 4.5}, {start: 9, end: 12}], timing);
		for (let t = 0; t < 14; t += 0.0333) {
			const idle = c.isIdle(t, t + 0.0333);
			if (idle) for (let k = 0; k <= 10; k++) assert.equal(c.at(t + (0.0333 * k) / 10), 0, `idle at ${t} but at() > 0`);
		}
		assert.equal(c.isIdle(0, 0.5), true);
		assert.equal(c.isIdle(1.5, 1.6), false);
	});
	it('rejects non-finite timing', () => {
		assert.throws(() => new DuckCurve([], {attackMs: Number.NaN, releaseMs: 1}), /finite/);
	});
});

describe('BedGain', () => {
	const duck = new DuckCurve([{start: 1, end: 2}], {attackMs: 120, releaseMs: 450});
	it('ducks each band by its own depth (the 2 / 12 / 4 dB split)', () => {
		const g = new BedGain({bands: 3, start: 0, end: 10, sources: [{curve: duck, depthsDb: [2, 12, 4]}]});
		assert.ok(near(db(g.gain(1.5, 0)), -2, 1e-9));
		assert.ok(near(db(g.gain(1.5, 1)), -12, 1e-9));
		assert.ok(near(db(g.gain(1.5, 2)), -4, 1e-9));
		assert.equal(g.gain(5, 1), 1);
	});
	it('one depth applies to every band; the deepest of several sources wins', () => {
		const other = new DuckCurve([{start: 1.4, end: 1.6}], {attackMs: 0, releaseMs: 0, lookaheadMs: 0});
		const g = new BedGain({bands: 2, start: 0, end: 10, sources: [{curve: duck, depthsDb: [6]}, {curve: other, depthsDb: [20]}]});
		assert.ok(near(db(g.gain(1.2, 0)), -6, 1e-9));
		assert.ok(near(db(g.gain(1.5, 1)), -20, 1e-9));
	});
	it('fill() is gain() evaluated at every sample', () => {
		const g = new BedGain({bands: 3, start: 0.5, end: 3, fadeInMs: 200, fadeOutMs: 300, sources: [{curve: duck, depthsDb: [2, 12, 4]}]});
		const n = 2400;
		for (const t0 of [0.4, 0.85, 1.95, 2.8]) {
			const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
			g.fill(out, t0, SR);
			for (let b = 0; b < 3; b++) for (let i = 0; i < n; i += 37) assert.ok(near(out[b][i], g.gain(t0 + i / SR, b), 1e-6));
		}
	});
	it('moves smoothly: no per-sample step larger than the raised cosine allows (no zipper noise)', () => {
		const g = new BedGain({bands: 1, start: 0, end: 4, sources: [{curve: duck, depthsDb: [12]}]});
		const n = 4 * SR;
		const out = [new Float32Array(n)];
		g.fill(out, 0, SR);
		let maxStep = 0;
		for (let i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(db(out[0][i]) - db(out[0][i - 1])));
		// d/dt of 12 dB * rcos(t / 0.12 s) peaks at 12 * pi / 2 / 0.12 dB/s
		const bound = (12 * Math.PI) / 2 / 0.12 / SR;
		assert.ok(maxStep <= bound * 1.001, `max step ${maxStep} dB > ${bound}`);
		assert.ok(maxStep > bound * 0.9);
	});
	it('rests silence the bed with raised-cosine fades around them', () => {
		const g = new BedGain({bands: 1, start: 0, end: 10, rests: [{start: 4, end: 5, fadeOutMs: 400, fadeInMs: 800}]});
		assert.equal(g.amplitude(3.5), 1);
		assert.ok(near(g.amplitude(3.8), 0.5, 1e-9));
		assert.equal(g.amplitude(4.5), 0);
		assert.ok(near(g.amplitude(5.4), 0.5, 1e-9));
		assert.equal(g.amplitude(5.9), 1);
		assert.equal(g.gain(4.5), 0);
	});
	it('is silent outside [start, end) and fades in and out', () => {
		const g = new BedGain({bands: 1, start: 1, end: 3, fadeInMs: 500, fadeOutMs: 500});
		assert.equal(g.gain(0.99), 0);
		assert.ok(near(g.gain(1.25), 0.5, 1e-9));
		assert.equal(g.gain(2), 1);
		assert.ok(near(g.gain(2.75), 0.5, 1e-9));
		assert.equal(g.gain(3), 0);
	});
	it('a boost lifts the bed and the duck still wins under speech', () => {
		const lift = new DuckCurve([{start: 5, end: 7}], {attackMs: 500, releaseMs: 500, lookaheadMs: 0, minGapMs: 0});
		const g = new BedGain({bands: 1, start: 0, end: 10, sources: [{curve: duck, depthsDb: [12]}], boosts: [{curve: lift, depthsDb: [6]}]});
		assert.ok(near(db(g.gain(6)), 6, 1e-9));
		assert.ok(near(db(g.gain(1.5)), -12, 1e-9));
	});
	it('rejects bad settings', () => {
		assert.throws(() => new BedGain({bands: 0, start: 0, end: 1}), /bands/);
		assert.throws(() => new BedGain({bands: 3, start: 0, end: 1, sources: [{curve: duck, depthsDb: [1, 2]}]}), /depths/);
		assert.throws(() => new BedGain({bands: 1, start: 0, end: 1, sources: [{curve: duck, depthsDb: [-3]}]}), />= 0/);
		assert.throws(() => new BedGain({bands: 1, start: 2, end: 1}), /end after/);
		assert.throws(() => new BedGain({bands: 1, start: 0, end: 1, rests: [{start: 2, end: 1, fadeInMs: 0, fadeOutMs: 0}]}), /rest/);
	});
	it('dB helpers round-trip', () => {
		assert.ok(near(gainToDb(dbToGain(-7.5)), -7.5, 1e-12));
		assert.equal(gainToDb(0), -Infinity);
	});
});
