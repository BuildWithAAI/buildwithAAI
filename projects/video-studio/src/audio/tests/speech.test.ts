import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {mergeSpans, type Span} from '../core/envelope.ts';
import {monoMix, speechLevels, speechSpansFromAudio, speechSpansFromLevels, speechSpansFromScenes, speechSpansFromTimeline} from '../core/speech.ts';
import {parseWav} from '../core/wav.ts';
import {DEMO_NARRATION, hasDemoNarration, near, noise, pub, sine} from './helpers.ts';

const words = [
	{startMs: 100, endMs: 400},
	{startMs: 450, endMs: 900},
];

describe('speech spans from word timings', () => {
	it('places each word at scene start + word time, pads the end, applies the offset', () => {
		const spans = speechSpansFromTimeline({scenes: [{startMs: 1000, words}, {startMs: 5000, words: [{startMs: 0, endMs: 200}]}]}, {offsetSec: 2});
		assert.deepEqual(
			spans.map((s) => [+s.start.toFixed(3), +s.end.toFixed(3)]),
			[
				[3.1, 3.46],
				[3.45, 3.96],
				[7, 7.26],
			],
		);
	});
	it('re-timed scenes (Shorts, demos) are cut where the scene is cut; empty words are skipped', () => {
		const spans = speechSpansFromScenes([{atSec: 10, untilSec: 10.5, words: [...words, {startMs: 600, endMs: 600}]}], {padEndMs: 0});
		assert.deepEqual(
			spans.map((s) => [+s.start.toFixed(3), +s.end.toFixed(3)]),
			[
				[10.1, 10.4],
				[10.45, 10.5],
			],
		);
	});
});

describe('speech spans from the level (RMS)', () => {
	it('marks runs within rangeDb of the loud level and above the floor, dropping blips', () => {
		const lv = new Float64Array(300).fill(-80);
		for (let i = 50; i < 120; i++) lv[i] = -20; // 0.7 s of speech
		for (let i = 200; i < 203; i++) lv[i] = -22; // a 30 ms blip: dropped (min 80 ms)
		for (let i = 230; i < 260; i++) lv[i] = -40; // quiet but within 30 dB of -20: speech
		const spans = speechSpansFromLevels(lv, 0.01, {windowSec: 0.03});
		assert.deepEqual(
			spans.map((s) => [+s.start.toFixed(2), +s.end.toFixed(2)]),
			[
				[0.5, 1.22],
				[2.3, 2.62],
			],
		);
		assert.deepEqual(speechSpansFromLevels(new Float64Array(0), 0.01), []);
	});
	it('speechLevels matches a direct windowed RMS of the band-passed signal', () => {
		const sr = 24000;
		const x = sine(sr, 1000, sr, 0.5); // 1 kHz sits in the 150 Hz-4 kHz band: about 0.5 / sqrt(2) RMS
		const lv = speechLevels(x, sr);
		assert.equal(lv.length, Math.floor((sr - 720) / 240) + 1);
		const mid = lv[Math.floor(lv.length / 2)];
		assert.ok(near(mid, 20 * Math.log10(0.5 / Math.SQRT2), 0.15), `level ${mid}`);
		// 60 Hz hum sits 1.3 octaves under the 2nd-order 150 Hz high-pass: 16.1 dB down (analog)
		const hum = speechLevels(sine(sr, 60, sr, 0.5), sr);
		assert.ok(near(hum[Math.floor(hum.length / 2)] - mid, -16.1, 0.5), `hum ${hum[Math.floor(hum.length / 2)] - mid} dB`);
	});
	it('finds bursts in synthetic audio and ignores the noise floor', () => {
		const sr = 24000;
		const x = noise(3 * sr, 0.0005, 7); // -66 dBFS floor
		const burst = noise(sr, 0.3, 9);
		for (let i = 0; i < 0.8 * sr; i++) x[Math.round(0.6 * sr) + i] += burst[i];
		for (let i = 0; i < 0.5 * sr; i++) x[Math.round(2.0 * sr) + i] += burst[i];
		const spans = speechSpansFromAudio([x], sr, {offsetSec: 10});
		assert.equal(spans.length, 2);
		assert.ok(near(spans[0].start, 10.6, 0.03) && near(spans[0].end, 11.4, 0.04), JSON.stringify(spans[0]));
		assert.ok(near(spans[1].start, 12.0, 0.03) && near(spans[1].end, 12.5, 0.04), JSON.stringify(spans[1]));
	});
	it('monoMix averages channels', () => {
		const m = monoMix([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
		assert.deepEqual(Array.from(m), [0.5, 0.5]);
	});
	it(
		'on the demo narration (Kokoro im_nicola), the RMS spans cover the words the timeline says were spoken',
		{skip: hasDemoNarration() ? false : 'run the voice step first (src/audio/tools/demo.sh)'},
		() => {
			const tl = JSON.parse(readFileSync(pub(`${DEMO_NARRATION}/timeline.json`), 'utf8')) as {narration: string; scenes: Array<{startMs: number; words: Array<{startMs: number; endMs: number}>}>};
			const wav = parseWav(readFileSync(pub(tl.narration)).buffer as ArrayBuffer);
			const byLevel = mergeSpans(speechSpansFromAudio(wav.channels, wav.sampleRate), 0.3);
			const byWords = mergeSpans(speechSpansFromTimeline(tl, {padEndMs: 0}), 0.3);
			const len = (s: Span[]) => s.reduce((a, b) => a + b.end - b.start, 0);
			const overlap = (a: Span[], b: Span[]) => {
				let o = 0;
				for (const x of a) for (const y of b) o += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));
				return o;
			};
			const covered = overlap(byWords, byLevel) / len(byWords);
			const extra = (len(byLevel) - overlap(byLevel, byWords)) / len(byLevel);
			assert.ok(covered > 0.9, `RMS spans cover ${(covered * 100).toFixed(1)}% of the spoken words`);
			assert.ok(extra < 0.15, `${(extra * 100).toFixed(1)}% of the RMS spans fall outside the words`);
		},
	);
});
