import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {DUCK_DEFAULTS, liftSpans, planBed, SPLIT_DEPTH_RATIOS} from '../core/bed.ts';
import {DuckCurve} from '../core/envelope.ts';
import {bedFor, loopOf, PEAK_BUDGET_DBTP, peakBudgetTrimDb, placeStinger, resolveCue, stingerRest} from '../core/music.ts';
import {db, musicLib, near} from './helpers.ts';

const music = musicLib();

describe('music cues', () => {
	it('a mood resolves to its underscore bed under narration, the full bed on request', () => {
		assert.equal(bedFor(music, 'neutral').id, 'bed-show-neutral-underscore');
		assert.equal(bedFor(music, 'tension', {channel: 'story', underscore: false}).id, 'bed-story-tension');
		assert.throws(() => bedFor(music, 'ominous'), /no show bed/);
	});
	it('cues resolve by id or by file, and every bed loops seamlessly over its whole file', () => {
		assert.equal(resolveCue(music, 'audio/music/theme-5s.wav').id, 'theme-5s');
		for (const c of music.cues.filter((x) => x.cueType === 'bed')) {
			const l = loopOf(c);
			assert.ok(l && l.startSample === 0 && l.endSample === c.durationSamples, c.id);
		}
		assert.equal(loopOf(resolveCue(music, 'theme-5s')), null);
	});
	it('a stinger is placed so its first downbeat lands on the frame asked (pre-roll included)', () => {
		const b = placeStinger(resolveCue(music, 'bumper-rekt-meter'), 300);
		assert.equal(b.downbeat, 300);
		assert.equal(b.from, 298); // 2-frame pre-roll (downbeatSec 0.0667)
		assert.equal(b.durationInFrames, 96); // 3.2 s
		assert.equal(b.hits[0].frame, 300); // the first hit is the downbeat
		const s = placeStinger(resolveCue(music, 'intro-sting-show'), 0);
		assert.equal(s.from, 0);
		assert.deepEqual(
			s.hits.filter((h) => /SHOW lands|Badger: D/.test(h.what)).map((h) => h.frame),
			[30, 58],
		);
		assert.throws(() => placeStinger(resolveCue(music, 'bed-show-neutral'), 0), /bed/);
	});
	it('the bed rests from the stinger start until its tail decays', () => {
		const p = placeStinger(resolveCue(music, 'bumper-rekt-meter'), 300);
		const r = stingerRest(p);
		assert.ok(near(r.start, 298 / 30, 1e-9));
		assert.ok(near(r.end, (298 + 96) / 30 - 0.35, 1e-9));
		assert.equal(r.fadeOutMs, 350);
		assert.equal(r.fadeInMs, 900);
	});
	it('the peak-budget trim keeps every sting and bumper at or under -2 dBTP, never boosts', () => {
		for (const c of music.cues.filter((x) => x.cueType !== 'bed')) {
			const t = peakBudgetTrimDb(c);
			assert.ok(t <= 0);
			assert.ok((c.truePeakDbtp ?? 0) + t <= PEAK_BUDGET_DBTP + 1e-9, c.id);
		}
	});
});

describe('planBed', () => {
	const speech = [
		{start: 2, end: 4},
		{start: 4.5, end: 6}, // 0.5 s pause: filled (default minGap 0.8 s)
		{start: 9, end: 10},
	];
	it("defaults to the brief's timing and the engine's band-split depths (2 / 12 / 4 dB at 700 Hz and 5 kHz)", () => {
		assert.deepEqual({...DUCK_DEFAULTS}, {depthDb: 12, attackMs: 120, releaseMs: 450, minGapMs: 800, split: true});
		const p = planBed({start: 0, end: 12, duck: {speech}});
		assert.deepEqual(p.depthsDb, SPLIT_DEPTH_RATIOS.map((r) => 12 * r));
		assert.deepEqual(p.crossovers, [700, 5000]);
		assert.ok(near(db(p.gain.gain(3, 0)), -2, 1e-9));
		assert.ok(near(db(p.gain.gain(3, 1)), -12, 1e-9));
		assert.ok(near(db(p.gain.gain(3, 2)), -4, 1e-9));
		assert.ok(near(db(p.gain.gain(4.25, 1)), -12, 1e-9)); // the short pause stays ducked
		assert.equal(p.gain.gain(7.5, 1), 1); // the long one releases
	});
	it('split: false is a broadband duck of depthDb; explicit depths override the ratios', () => {
		const b = planBed({start: 0, end: 12, duck: {speech, split: false, depthDb: 9}});
		assert.equal(b.gain.bands, 1);
		assert.equal(b.crossovers, undefined);
		assert.ok(near(db(b.gain.gain(3)), -9, 1e-9));
		const e = planBed({start: 0, end: 12, duck: {speech, depthsDb: [1, 10, 3]}});
		assert.deepEqual(e.depthsDb, [1, 10, 3]);
	});
	it('no duck: a flat bed with its fades', () => {
		const p = planBed({start: 1, end: 5, fadeInMs: 500});
		assert.equal(p.gain.bands, 1);
		assert.ok(near(p.gain.gain(1.25), 0.5, 1e-9));
		assert.equal(p.gain.gain(3), 1);
	});
	it('lifts only in long music-only stretches, back down before the next duck or rest begins', () => {
		const rest = {start: 15, end: 17, fadeOutMs: 350, fadeInMs: 900};
		const p = planBed({start: 0, end: 25, duck: {speech}, lift: {db: 6}, rests: [rest], fadeOutMs: 1000});
		assert.ok(p.lifts.length >= 2);
		const curve = new DuckCurve(speech, {attackMs: 120, releaseMs: 450, minGapMs: 800});
		for (const l of p.lifts) {
			// never inside a duck (with its lookahead and release) or a rest (with its fades)
			// the lift (with its 600 ms ramp down) must be over by the time a duck or a rest's fade starts
			const steps = Math.round((l.end + 0.6 - l.start) / 0.01);
			for (let k = 0; k <= steps; k++) {
				const t = l.start + k * 0.01;
				assert.ok(curve.at(t) < 1e-6, `lift at ${t.toFixed(2)} overlaps a duck`);
				assert.ok(t <= rest.start - 0.35 + 1e-6 || t >= rest.end + 0.9 - 1e-6, `lift at ${t.toFixed(2)} overlaps the rest`);
			}
		}
		// fully up once its 600 ms ramp is done, until it starts down again at its end
		for (const l of p.lifts) for (const t of [l.start + 0.6, (l.start + 0.6 + l.end) / 2, l.end]) assert.ok(near(db(p.gain.gain(t, 1)), 6, 1e-6), `lift at ${t}`);
		assert.ok(db(p.gain.gain(p.lifts[0].start + 0.3, 1)) < 6);
		assert.ok(near(db(p.gain.gain(3, 1)), -12, 1e-9)); // still ducked under speech
		// the lift spans helper with no duck: one span over the whole bed minus fades and ramps
		const only = liftSpans({start: 0, end: 10, duck: null, lift: {db: 4}});
		assert.equal(only.length, 1);
	});
});
