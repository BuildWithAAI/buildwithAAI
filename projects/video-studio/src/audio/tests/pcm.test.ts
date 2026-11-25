import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {BedGain, DuckCurve} from '../core/envelope.ts';
import {frameSampleRange, renderChunk, sourceIndex, validateLoop, type PcmSource} from '../core/pcm.ts';
import {splitBands} from '../core/bands.ts';
import {noise} from './helpers.ts';

const SR = 48000;
const FPS = 30;

const ramp = (n: number): Float32Array => Float32Array.from({length: n}, (_, i) => ((i % 1000) - 500) / 2000);
const flat = (n: number, v: number): Float32Array => new Float32Array(n).fill(v);
const unity = (bands = 1, end = 100) => new BedGain({bands, start: 0, end});

/** Render a whole cue frame by frame, the way the renderer asks for it, into one float array per channel. */
const renderFrames = (src: PcmSource, gain: BedGain, o: {fromFrame: number; frames: number; cueStartFrame: number; offset?: number; trim?: number; dither?: boolean}) => {
	const [first] = frameSampleRange(o.fromFrame, FPS, SR);
	const [, last] = frameSampleRange(o.fromFrame + o.frames - 1, FPS, SR);
	const out = [new Float64Array(last - first), new Float64Array(last - first)];
	const [cueStart] = frameSampleRange(o.cueStartFrame, FPS, SR);
	for (let f = o.fromFrame; f < o.fromFrame + o.frames; f++) {
		const [s0, s1] = frameSampleRange(f, FPS, SR);
		const c = renderChunk(src, gain, {start: s0, length: s1 - s0, cueStart, offset: o.offset ?? 0, sampleRate: SR, dither: o.dither, trim: o.trim});
		for (let i = 0; i < s1 - s0; i++) for (let ch = 0; ch < 2; ch++) out[ch][s0 - first + i] = c.pcm[i * 2 + ch] / 32768;
	}
	return out;
};

describe('sourceIndex and loops', () => {
	it('plays a one-shot once and a loop forever from its loop start', () => {
		assert.equal(sourceIndex(-1, 10, null), -1);
		assert.equal(sourceIndex(9, 10, null), 9);
		assert.equal(sourceIndex(10, 10, null), -1);
		const loop = {startSample: 2, endSample: 8};
		assert.equal(sourceIndex(7, 10, loop), 7);
		assert.equal(sourceIndex(8, 10, loop), 2);
		assert.equal(sourceIndex(13, 10, loop), 7);
		assert.equal(sourceIndex(14, 10, loop), 2);
		assert.equal(sourceIndex(8 + 6 * 1000 + 3, 10, loop), 5);
	});
	it('validates loop points against the source', () => {
		assert.doesNotThrow(() => validateLoop({startSample: 0, endSample: 10}, 10));
		assert.throws(() => validateLoop({startSample: 0, endSample: 11}, 10), /fit/);
		assert.throws(() => validateLoop({startSample: 5, endSample: 5}, 10), /fit/);
		assert.throws(() => validateLoop({startSample: 0.5, endSample: 5}, 10), /fit/);
	});
	it('frame f covers samples [floor(f / fps * sr), floor((f + 1) / fps * sr)): 1600 at 30 fps', () => {
		assert.deepEqual(frameSampleRange(0, 30, SR), [0, 1600]);
		assert.deepEqual(frameSampleRange(123, 30, SR), [196800, 198400]);
		// 29.97 fps does not divide 48 kHz: consecutive frames still tile without gaps or overlaps
		let prevEnd = 0;
		for (let f = 0; f < 3000; f++) {
			const [a, b] = frameSampleRange(f, 30000 / 1001, SR);
			assert.equal(a, prevEnd);
			prevEnd = b;
		}
	});
});

describe('renderChunk', () => {
	it('renders frame by frame exactly what one long render gives (no seams between frames)', () => {
		const n = SR * 2;
		const src: PcmSource = {sampleRate: SR, length: n, bands: [[ramp(n), ramp(n)]], loop: null};
		const duck = new DuckCurve([{start: 0.5, end: 0.9}], {attackMs: 120, releaseMs: 450});
		const gain = new BedGain({bands: 1, start: 0, end: 10, sources: [{curve: duck, depthsDb: [12]}]});
		const frames = renderFrames(src, gain, {fromFrame: 3, frames: 40, cueStartFrame: 3, dither: false});
		const whole = renderChunk(src, gain, {start: 4800, length: 40 * 1600, cueStart: 4800, offset: 0, sampleRate: SR, dither: false});
		for (let i = 0; i < 40 * 1600; i++) assert.equal(frames[0][i], whole.pcm[i * 2] / 32768);
	});
	it('applies the gain per sample, then rounds to 16 bits (no dither: exact)', () => {
		const n = 4800;
		const src: PcmSource = {sampleRate: SR, length: n, bands: [[flat(n, 0.5), flat(n, 0.5)]], loop: null};
		const gain = new BedGain({bands: 1, start: 0, end: 1, fadeInMs: 50});
		const c = renderChunk(src, gain, {start: 0, length: n, cueStart: 0, offset: 0, sampleRate: SR, dither: false});
		for (const i of [0, 600, 1200, 2399, 2400, 4000]) assert.equal(c.pcm[i * 2], Math.round(0.5 * gain.gain(i / SR) * 32768));
		assert.equal(c.peak, 0.5);
	});
	it('plays a mono source equal-power in both channels (-3 dB each, as ffmpeg upmixes)', () => {
		const src: PcmSource = {sampleRate: SR, length: 100, bands: [[flat(100, 0.5)]], loop: null};
		const c = renderChunk(src, unity(), {start: 0, length: 100, cueStart: 0, offset: 0, sampleRate: SR, dither: false});
		assert.equal(c.pcm[0], Math.round(0.5 * Math.SQRT1_2 * 32768));
		assert.equal(c.pcm[1], c.pcm[0]);
	});
	it('sums the bands (each with its own gain) back to the source when nothing ducks', () => {
		const n = SR / 2;
		const x = noise(n, 0.4);
		const bands = splitBands([x, x], SR, {circular: true}).map((b) => b.map((ch) => Float32Array.from(ch)));
		const src: PcmSource = {sampleRate: SR, length: n, bands, loop: {startSample: 0, endSample: n}};
		const c = renderChunk(src, unity(3), {start: 0, length: n, cueStart: 0, offset: 0, sampleRate: SR, dither: false});
		let worst = 0;
		for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(c.pcm[i * 2] / 32768 - x[i]));
		assert.ok(worst <= 1.5 / 32768, `largest error ${worst * 32768} LSB`);
	});
	it('wraps a loop on its exact sample and honours the start offset', () => {
		const n = 1000;
		const x = Float32Array.from({length: n}, (_, i) => i / 4000);
		const src: PcmSource = {sampleRate: SR, length: n, bands: [[x, x]], loop: {startSample: 0, endSample: n}};
		const c = renderChunk(src, unity(), {start: 1600, length: 1600, cueStart: 1600, offset: 990, sampleRate: SR, dither: false});
		assert.equal(c.pcm[0], Math.round((990 / 4000) * 32768));
		assert.equal(c.pcm[10 * 2], 0); // sample 1000 wraps to 0
		assert.equal(c.pcm[11 * 2], Math.round((1 / 4000) * 32768));
	});
	it('is silent before the cue starts and after a one-shot ends (digital zero, no dither noise)', () => {
		const src: PcmSource = {sampleRate: SR, length: 100, bands: [[flat(100, 0.25), flat(100, 0.25)]], loop: null};
		const c = renderChunk(src, unity(), {start: 0, length: 400, cueStart: 200, offset: 0, sampleRate: SR});
		assert.equal(c.pcm[199 * 2], 0);
		assert.notEqual(c.pcm[200 * 2], 0);
		assert.equal(c.pcm[300 * 2], 0);
	});
	it('dither is deterministic (identical in every render tab) and at most 1 LSB of TPDF', () => {
		const n = 4800;
		const src: PcmSource = {sampleRate: SR, length: n, bands: [[flat(n, 0.1), flat(n, 0.1)]], loop: null};
		const a = renderChunk(src, unity(), {start: 0, length: n, cueStart: 0, offset: 0, sampleRate: SR});
		const b = renderChunk(src, unity(), {start: 0, length: n, cueStart: 0, offset: 0, sampleRate: SR});
		assert.deepEqual(a.pcm, b.pcm);
		const exact = 0.1 * 32768;
		let changed = 0;
		for (let i = 0; i < n; i++) {
			assert.ok(Math.abs(a.pcm[i * 2] - exact) < 1.51);
			if (a.pcm[i * 2] !== Math.round(exact)) changed++;
		}
		assert.ok(changed > n / 10, 'dither should move some samples');
	});
	it('reports overs instead of clipping silently, and refuses mismatched rates and bands', () => {
		const src: PcmSource = {sampleRate: SR, length: 10, bands: [[flat(10, 0.9), flat(10, 0.9)]], loop: null};
		const c = renderChunk(src, unity(), {start: 0, length: 10, cueStart: 0, offset: 0, sampleRate: SR, trim: 2});
		assert.ok(c.peak > 1);
		assert.equal(c.pcm[0], 32767);
		assert.throws(() => renderChunk(src, unity(), {start: 0, length: 10, cueStart: 0, offset: 0, sampleRate: 44100}), /Hz/);
		assert.throws(() => renderChunk(src, unity(3), {start: 0, length: 10, cueStart: 0, offset: 0, sampleRate: SR}), /band/);
	});
});
