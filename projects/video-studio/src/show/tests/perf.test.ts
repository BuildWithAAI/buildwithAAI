/** Performance: Zoo's lines, Badger's beats and reactions, the global plan (lip-sync, blinks, gestures, push-ins). */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {TimelineWord} from '../../episode/types.ts';
import {lineEndMs, splitLines} from '../perf/lines.ts';
import {activeBeat, badgerAt, MIN_BEAT_GAP, normalizeBeats, REACTION_HOLD, scheduleBadger, type Beat} from '../perf/badger.ts';
import {BASE_SHOT, BEAT_DELAY, BEAT_SCENE_DELAY, planShow, pushAt, sceneBeats, zooStateAt} from '../perf/plan.ts';
import {sceneReveals} from '../perf/reveals.ts';
import {episodeSpans, shortSpans, spansFrames} from '../timing.ts';
import {shotFor} from '../layout/shots.ts';
import {msToFrame} from '../../episode/motion.ts';
import {BADGER_REACTIONS, SHOW_SEGMENTS, type Format} from '../types.ts';
import {clone, fixture, mock} from './helpers.ts';

const W = (text: string, startMs: number, endMs: number): TimelineWord => ({text, startMs, endMs});
const WORDS = [W('One', 0, 200), W('leaked', 220, 500), W('key.', 520, 800), W('Four', 1200, 1400), W('million', 1420, 1800), W('gone.', 1820, 2100), W('Morning.', 2600, 3000)];

test('lines: sentences end at . ! ? (and the last word); beats follow a line, a cue word or the end', () => {
	assert.deepEqual(splitLines(WORDS).map((l) => [l.first, l.last]), [[0, 2], [3, 5], [6, 6]]);
	assert.equal(lineEndMs(WORDS, 'end', 'en'), 3000);
	assert.equal(lineEndMs(WORDS, 0, 'en'), 800);
	assert.equal(lineEndMs(WORDS, 9, 'en'), 3000, 'an index past the last line clamps to it');
	assert.equal(lineEndMs(WORDS, 'million', 'en'), 2100);
	assert.equal(lineEndMs(WORDS, 'zebra', 'en'), 3000, 'an unmatched cue falls back to the end');
	assert.equal(lineEndMs([], 'end', 'en'), null);
});

const beat = (at: number, reaction: Beat['reaction'], source: Beat['source'] = 'default'): Beat => ({at, reaction, hold: REACTION_HOLD[reaction], sceneId: 'x', source});

test('beats: crowded beats keep the authored one; holds release before the next reaction', () => {
	const out = normalizeBeats([beat(100, 'slowBlink', 'reaction'), beat(110, 'judge', 'beatScene'), beat(400, 'happy'), beat(430, 'judge')], 1000);
	assert.deepEqual(out.map((b) => [b.at, b.reaction]), [[110, 'judge'], [400, 'happy']]);
	const tight = normalizeBeats([beat(0, 'judge'), beat(MIN_BEAT_GAP + 2, 'lookUp')], 1000);
	assert.equal(tight.length, 2);
	assert.ok(tight[0].at + tight[0].hold < tight[1].at, 'the first reaction is released before the second starts');
	assert.deepEqual(normalizeBeats([beat(-5, 'judge'), beat(2000, 'judge')], 1000), [], 'beats outside the render are dropped');
});

test('badger: each reaction peaks and fully releases; expression and head swaps land on a closed blink', () => {
	for (const r of BADGER_REACTIONS) {
		const s = scheduleBadger([beat(100, r)], 600, `t:${r}`);
		const b = s.beats[0];
		const rest = badgerAt(s, b.at + b.hold + 40);
		assert.equal(rest.judge, 0, `${r}: judge released`);
		assert.equal(rest.earsBack, 0, `${r}: ears released`);
		assert.equal(rest.expression, 'neutral', `${r}: expression released`);
		assert.equal(rest.head, 'front', `${r}: head back to camera`);
		const peak = badgerAt(s, b.at + 20);
		if (r === 'judge') assert.equal(peak.judge, 1);
		if (r === 'earsBack') assert.equal(peak.expression, 'worried');
		if (r === 'happy') assert.equal(peak.expression, 'happy');
		if (r === 'shocked') assert.equal(peak.expression, 'shocked');
		if (r === 'lookUp') assert.equal(peak.head, 'threeQuarterLeftScreen');
		if (r === 'earsBack' || r === 'happy' || r === 'lookUp') {
			assert.equal(badgerAt(s, b.at).blink, 1, `${r}: the swap in is hidden in a closed blink`);
			assert.equal(badgerAt(s, b.at + b.hold).blink, 1, `${r}: the swap back is hidden in a closed blink`);
		}
		if (r === 'slowBlink') assert.equal(badgerAt(s, b.at + 6).blink, 1, 'the long blink is shut');
	}
	// between reactions he listens: natural blinks and darts toward Zoo, never during a reaction
	const s = scheduleBadger([beat(300, 'judge')], 1200, 'idle');
	for (const bl of s.blinks.filter((x) => !x.long)) assert.ok(!(bl.start > 290 && bl.start < 300 + s.beats[0].hold), 'no natural blink inside the reaction');
	assert.ok(s.glances.length > 0);
	for (const g of s.glances) assert.equal(activeBeat(s, g.frame), null);
	assert.deepEqual(badgerAt(s, 777), badgerAt(scheduleBadger([beat(300, 'judge')], 1200, 'idle'), 777), 'deterministic');
});

test('plan: Zoo lip-syncs to the timeline mouth track frame by frame, in both formats', () => {
	const sb = fixture();
	const tl = mock(sb);
	for (const format of ['landscape', 'vertical'] as Format[]) {
		const spans = format === 'vertical' ? shortSpans(sb, tl, 'short1', 30) : episodeSpans(sb, tl, 30);
		const frames = spansFrames(spans);
		const plan = planShow({sb, tl, spans, format, fps: 30, frames, seed: 'test'});
		spans.forEach((s, k) => {
			for (const i of [0, 7, Math.floor(s.durationInFrames / 2), s.durationInFrames - 1]) {
				assert.equal(zooStateAt(plan, k, s.from + i).mouth, tl.scenes[s.index].mouth[i], `${format} ${s.id} frame ${i}`);
			}
		});
		assert.equal(zooStateAt(plan, 0, frames + 50).mouth, 'closed');
	}
});

test('plan: Badger beats land after Zoo\'s lines; Zoo holds still (no blink) through each beat', () => {
	const sb = fixture();
	const tl = mock(sb);
	const spans = episodeSpans(sb, tl, 30);
	const plan = planShow({sb, tl, spans, format: 'landscape', fps: 30, frames: spansFrames(spans), seed: 'test'});
	const byScene = new Map(plan.beats.map((b) => [b.sceneId, b]));
	for (const id of ['s01b', 's05b', 's07b']) {
		const span = spans.find((s) => s.id === id)!;
		assert.equal(byScene.get(id)?.at, span.from + BEAT_SCENE_DELAY, `${id}: the beat scene's reaction starts just after the cut`);
		assert.equal(byScene.get(id)?.source, 'beatScene');
	}
	assert.equal(byScene.get('s01b')?.reaction, 'judge');
	assert.equal(byScene.get('s07b')?.reaction, 'lookUp');
	// the headline's authored reaction follows its FIRST line (after: 0), mid-scene
	const s02 = spans.find((s) => s.id === 's02')!;
	const words = tl.scenes[s02.index].words;
	const firstLineEnd = words.find((w) => /[.!?]$/.test(w.text))!.endMs;
	assert.equal(byScene.get('s02')?.reaction, 'earsBack');
	assert.equal(byScene.get('s02')?.at, s02.from + msToFrame(firstLineEnd, 30) + BEAT_DELAY);
	for (const b of plan.beats) for (const bl of plan.zoo.blinks) if (!bl.long) assert.ok(bl.start + 7 < b.at - 14 || bl.start > b.at + b.hold, `Zoo blinks at ${bl.start} inside the beat at ${b.at}`);
});

test('plan: shots per segment, point gestures only toward a right-hand graphic, push-ins bounded', () => {
	const sb = fixture();
	const tl = mock(sb);
	for (const seg of SHOW_SEGMENTS) {
		assert.ok(BASE_SHOT.landscape[seg] && BASE_SHOT.vertical[seg], seg);
		for (const f of ['landscape', 'vertical'] as Format[]) assert.doesNotThrow(() => shotFor(f, BASE_SHOT[f][seg]), `${f} ${seg}`);
	}
	const spans = episodeSpans(sb, tl, 30);
	const plan = planShow({sb, tl, spans, format: 'landscape', fps: 30, frames: spansFrames(spans), seed: 'test'});
	assert.ok(plan.zoo.gestures.length >= 1);
	for (const g of plan.zoo.gestures) {
		const k = spans.findIndex((s) => g.frame >= s.from && g.frame < s.from + s.durationInFrames);
		assert.equal(plan.scenes[k].shot, 'zooL', 'Zoo only points when the graphic is on his right');
	}
	spans.forEach((s, k) => {
		const shot = plan.scenes[k].shot;
		const max = shot === 'none' ? 1 : shotFor('landscape', shot).push;
		for (const f of [s.from, s.from + s.durationInFrames - 1]) {
			const p = pushAt(plan, k, f);
			assert.ok(p >= 1 && p <= max + 1e-9);
		}
		assert.equal(pushAt(plan, k, s.from), 1, 'push-ins start from the cut framing');
	});
	assert.equal(plan.onAirFrom, 6, 'ON AIR lights just after the cold open starts');
	const v = planShow({sb, tl, spans: shortSpans(sb, tl, 'short1', 30), format: 'vertical', fps: 30, frames: spansFrames(shortSpans(sb, tl, 'short1', 30)), seed: 'test'});
	assert.equal(v.zoo.gestures.length, 0, 'no point gesture in the Short (graphics are above him)');
	// determinism
	const again = planShow({sb, tl, spans, format: 'landscape', fps: 30, frames: spansFrames(spans), seed: 'test'});
	assert.deepEqual(again.zoo.blinks, plan.zoo.blinks);
	assert.deepEqual(again.beats, plan.beats);
});

test('plan: an end-of-scene reaction nobody could see (short tail, cut to a shot without Badger) is dropped', () => {
	const sb = clone(fixture());
	const s02 = sb.scenes.find((s) => s.id === 's02')!;
	delete s02.badgerBeats;
	s02.badger = {present: true, reaction: 'worried'};
	const tl = mock(sb);
	for (const format of ['landscape', 'vertical'] as Format[]) {
		const spans = format === 'vertical' ? shortSpans(sb, tl, 'short1', 30) : episodeSpans(sb, tl, 30);
		const plan = planShow({sb, tl, spans, format, fps: 30, frames: spansFrames(spans), seed: 'test'});
		assert.ok(!plan.beats.some((b) => b.sceneId === 's02'), `${format}: the 10-frame tail before the diagram cannot carry a reaction`);
	}
});

test('plan: a storyboard can switch Badger off for a scene, and silent scenes still get their beat', () => {
	const sb = clone(fixture());
	const s02 = sb.scenes.find((s) => s.id === 's02')!;
	s02.badger = {present: false};
	const tl = mock(sb);
	const spans = episodeSpans(sb, tl, 30);
	const k = spans.findIndex((s) => s.id === 's02');
	const reveals = sceneReveals(s02, 'headline', tl.scenes[k].words, tl.scenes[k].speechMs, 30, 'en');
	assert.deepEqual(sceneBeats(s02, spans[k], tl.scenes[k].words, reveals, 30, 'en'), []);
	assert.ok(reveals.meter !== null && reveals.meter > reveals.card, 'the needle sweeps when the figure is said');
	const silent = sb.scenes.find((s) => s.id === 's05b')!;
	const j = spans.findIndex((s) => s.id === 's05b');
	assert.deepEqual(sceneBeats(silent, spans[j], [], sceneReveals(silent, 'beat', [], 0, 30, 'en'), 30, 'en').map((b) => b.reaction), ['slowBlink']);
});

test('reveals: diagram nodes land on the words that name them, in order', () => {
	const sb = fixture();
	const tl = mock(sb);
	const k = sb.scenes.findIndex((s) => s.id === 's03');
	const r = sceneReveals(sb.scenes[k], 'howItWorked', tl.scenes[k].words, tl.scenes[k].speechMs, 30, 'en');
	assert.equal(r.items.length, 4);
	for (let i = 1; i < r.items.length; i++) assert.ok(r.items[i] > r.items[i - 1]);
	const keyWord = tl.scenes[k].words.find((w) => /^key/i.test(w.text))!;
	assert.ok(Math.abs(r.items[0] - msToFrame(keyWord.startMs, 30)) <= 4, 'the key appears as Zoo says "key"');
});
