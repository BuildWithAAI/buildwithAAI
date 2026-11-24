/** Scene spans (the timeline's timing, untouched), the Short's outro trim, transitions and caption pages. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {episodeSpans, OUTRO_MIN_FRAMES, OUTRO_SHORT_TAIL, outroShortFrames, shortSpans, spanAt, spansFrames, TRANSITION_FRAMES} from '../timing.ts';
import {captionPages} from '../captions/pages.ts';
import {msToFrame} from '../../episode/motion.ts';
import {clone, fixture, mock} from './helpers.ts';

test('timing: the episode is the timeline, scene for scene and frame for frame', () => {
	const sb = fixture();
	const tl = mock(sb);
	const spans = episodeSpans(sb, tl, 30);
	assert.equal(spans.length, sb.scenes.length);
	spans.forEach((s, k) => {
		assert.equal(s.from, msToFrame(tl.scenes[k].startMs, 30));
		assert.equal(s.durationInFrames, msToFrame(tl.scenes[k].durationMs, 30));
		assert.equal(s.srcFrom, s.from);
		if (k > 0) assert.equal(s.from, spans[k - 1].from + spans[k - 1].durationInFrames, 'contiguous');
	});
	assert.equal(spansFrames(spans), msToFrame(tl.totalMs, 30));
	assert.deepEqual(
		spans.map((s) => s.segment),
		['coldOpen', 'beat', 'headline', 'howItWorked', 'badgerRedFlag', 'zooOneFix', 'beat', 'scamOfTheWeek', 'correction', 'beat', 'sources', 'outroEndScreen'],
	);
	assert.equal(spanAt(spans, 0)?.id, 's01');
	assert.equal(spanAt(spans, spans[2].from)?.id, 's02');
});

test('timing: a Short plays its scenes back to back with their own audio windows; the outro hold is trimmed', () => {
	const sb = fixture();
	const tl = mock(sb);
	const spans = shortSpans(sb, tl, 'short1', 30);
	assert.deepEqual(spans.map((s) => s.id), ['s01', 's01b', 's02', 's03', 's04', 's05', 's09']);
	let at = 0;
	for (const s of spans) {
		assert.equal(s.from, at);
		const tls = tl.scenes[s.index];
		assert.equal(s.srcFrom, msToFrame(tls.startMs, 30), 'audio comes from the scene\'s own window');
		at += s.durationInFrames;
	}
	const outro = spans[spans.length - 1];
	assert.equal(outro.segment, 'outroEndScreen');
	assert.equal(outro.sceneFrames, 600, '20 s end-screen hold in the timeline');
	assert.equal(outro.durationInFrames, outroShortFrames(tl.scenes[outro.index].speechMs, 600, 30));
	assert.equal(outro.durationInFrames, Math.max(OUTRO_MIN_FRAMES, msToFrame(tl.scenes[outro.index].speechMs, 30) + OUTRO_SHORT_TAIL));
	assert.ok(outro.durationInFrames < outro.sceneFrames / 2, 'the end-screen hold is cut from the Short');
	assert.equal(outroShortFrames(3000, 600, 30), 90 + OUTRO_SHORT_TAIL);
	assert.equal(outroShortFrames(100, 600, 30), OUTRO_MIN_FRAMES);
	assert.equal(outroShortFrames(30000, 600, 30), 600, 'never longer than the scene');
	assert.throws(() => shortSpans(sb, tl, 'nope', 30), /no short "nope"/);
});

test('timing: transitions overlap visuals only and never take more than half a scene', () => {
	const sb = clone(fixture());
	sb.scenes[2].transitionIn = 'wipe';
	sb.scenes[1].transitionIn = 'fade';
	const spans = episodeSpans(sb, mock(sb), 30);
	assert.equal(spans[0].transition, 'cut');
	assert.equal(spans[2].transition, 'wipe');
	assert.equal(spans[2].transitionFrames, TRANSITION_FRAMES.wipe);
	assert.equal(spans[1].tail, spans[2].transitionFrames, 'the outgoing scene stays drawn under the wipe');
	assert.ok(spans[1].transitionFrames <= Math.floor(Math.min(spans[0].durationInFrames, spans[1].durationInFrames) / 2));
	assert.equal(spansFrames(spans), spansFrames(episodeSpans(fixture(), mock(fixture()), 30)), 'the length is unchanged');
});

test('captions: pages stay inside their scene, in composition time, in order', () => {
	const sb = fixture();
	const tl = mock(sb);
	const spans = shortSpans(sb, tl, 'short1', 30);
	const pages = captionPages(spans, tl, 'en', 30);
	assert.ok(pages.length > 10);
	for (let i = 1; i < pages.length; i++) assert.ok(pages[i].startMs >= pages[i - 1].startMs);
	for (const p of pages) {
		const s = spans.find((x) => p.startMs >= (x.from * 1000) / 30 - 70 && p.startMs < ((x.from + x.durationInFrames) * 1000) / 30);
		assert.ok(s, `page "${p.text}" belongs to a scene`);
		assert.ok(p.endMs <= ((s.from + s.durationInFrames) * 1000) / 30 + 1e-6, `page "${p.text}" ends inside its scene`);
		assert.ok(p.words.length >= 1 && p.words.length <= 4);
	}
	// the cold open's first caption is its first words
	assert.ok(pages[0].text.startsWith('One leaked key'));
});
