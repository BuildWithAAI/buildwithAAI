import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {checkCaptions, textBetween, toCues, toSrt, toVtt, wrapLines} from './captions.ts';
import type {Caption} from './types.ts';

const word = (text: string, startMs: number, endMs: number, extra: Partial<Caption> = {}): Caption => ({text, startMs, endMs, timestampMs: null, confidence: null, ...extra});

describe('checkCaptions', () => {
	it('accepts Remotion captions and normalizes missing optional fields', () => {
		const {captions, errors} = checkCaptions([{text: 'Hi', startMs: 0, endMs: 300}]);
		assert.deepEqual(errors, []);
		assert.deepEqual(captions, [{text: 'Hi', startMs: 0, endMs: 300, timestampMs: null, confidence: null}]);
	});
	it('collects every problem', () => {
		const {errors} = checkCaptions([
			{text: 'a', startMs: 500, endMs: 100},
			{text: 5, startMs: 0, endMs: 1},
			{text: 'b', startMs: 10, endMs: 20, confidence: 'high'},
			{text: 'c', startMs: 5, endMs: 8},
		]);
		assert.match(errors.join('\n'), /captions\[0\]: "endMs" is before "startMs"/);
		assert.match(errors.join('\n'), /captions\[1\] needs a string "text"/);
		assert.match(errors.join('\n'), /captions\[2\]: "confidence" must be a number or null/);
		assert.match(errors.join('\n'), /captions\[3\] starts before captions\[2\]: sort by startMs/);
		assert.deepEqual(checkCaptions({}).errors, ['captions.json must be an array of Remotion captions']);
	});
});

describe('wrapLines', () => {
	it('keeps short text on one line and balances long text over two', () => {
		assert.deepEqual(wrapLines('Short line.'), ['Short line.']);
		const lines = wrapLines('A stranger says you qualify for a free airdrop today.');
		assert.equal(lines.length, 2);
		assert.ok(lines.every((l) => l.length <= 42));
	});
});

describe('toCues', () => {
	it('ends a cue at a sentence, a pause over 1 s and pageBreakAfter', () => {
		const cues = toCues([
			word('It is', 0, 300),
			word(' late.', 300, 600),
			word(' Your', 700, 900),
			word(' phone', 900, 1200),
			word(' buzzes', 2500, 2900),
			word(' again', 2900, 3200, {pageBreakAfter: true}),
			word(' now', 3200, 3500),
		]);
		assert.deepEqual(
			cues.map((c) => c.lines.join(' ')),
			['It is late.', 'Your phone', 'buzzes again', 'now'],
		);
	});
	it('keeps cues within 2 lines of 42 characters and 7 seconds', () => {
		const many = Array.from({length: 60}, (_, i) => word(`${i ? ' ' : ''}word${i}`, i * 300, i * 300 + 250));
		for (const cue of toCues(many)) {
			assert.ok(cue.lines.length <= 2 && cue.lines.every((l) => l.length <= 42), JSON.stringify(cue));
			assert.ok(cue.endMs - cue.startMs <= 7000);
		}
	});
	it('never lets a cue overlap the next one', () => {
		const cues = toCues([word('One.', 0, 1500), word(' Two.', 1000, 2000)]);
		assert.ok(cues[0].endMs <= cues[1].startMs);
	});
});

describe('SRT and WebVTT', () => {
	const cues = [
		{startMs: 400, endMs: 1160, lines: ['It is late.']},
		{startMs: 3_723_045, endMs: 3_724_000, lines: ['A <b> & c', 'second line']},
	];
	it('writes SubRip with comma milliseconds and no angle brackets', () => {
		assert.equal(toSrt(cues), '1\n00:00:00,400 --> 00:00:01,160\nIt is late.\n\n2\n01:02:03,045 --> 01:02:04,000\nA b & c\nsecond line\n');
	});
	it('writes WebVTT with a header, dot milliseconds and escaped markup', () => {
		assert.equal(toVtt(cues), 'WEBVTT\n\n00:00:00.400 --> 00:00:01.160\nIt is late.\n\n01:02:03.045 --> 01:02:04.000\nA &lt;b&gt; &amp; c\nsecond line\n');
	});
	it('textBetween returns the words spoken in a window', () => {
		const words = [word('Hello', 0, 400), word(' there.', 500, 900), word(' Later', 5000, 5400)];
		assert.equal(textBetween(words, 0, 1000), 'Hello there.');
		assert.equal(textBetween(words, 1000, 6000), 'Later');
	});
});
