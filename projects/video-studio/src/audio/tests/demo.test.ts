import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {DEMO_BED_START_SEC, DEMO_BULLETS, DEMO_TYPED, demoBedPlan, demoPlan, hitLabel, planSfx, type DemoTimeline} from '../demo/plan.ts';
import {overlappingRepeats} from '../core/sfx.ts';
import {DEMO_NARRATION, hasDemoNarration, musicLib, pub, sfxLib} from './helpers.ts';

/** The real narration timeline when the voice step has run, else one shaped like it (two ~4.3 s lines). */
const timeline = (): DemoTimeline => {
	if (hasDemoNarration()) return JSON.parse(readFileSync(pub(`${DEMO_NARRATION}/timeline.json`), 'utf8')) as DemoTimeline;
	const line = (id: string, text: string) => {
		const ws = text.split(' ');
		return {id, audio: `generated/test/${id}.wav`, durationMs: 4700, speechMs: 4300, words: ws.map((w, i) => ({text: w, startMs: 150 + i * 330, endMs: 150 + i * 330 + 280}))};
	};
	return {scenes: [line('s01', 'Welcome back. Today has three red flags, and one easy fix.'), line('s02', 'Here is the fix. Slow down, type it yourself, and check it twice.')]};
};

const plan = demoPlan(timeline(), sfxLib(), musicLib());
const inSpeech = (frame: number) => plan.bed.speech.some((s) => frame / plan.fps >= s.start && frame / plan.fps < s.end);

describe('AudioDemo plan', () => {
	it('runs 30-45 s at 30 fps and is deterministic', () => {
		const sec = plan.durationInFrames / plan.fps;
		assert.ok(sec >= 30 && sec <= 45, `${sec.toFixed(2)} s`);
		assert.deepEqual(demoPlan(timeline(), sfxLib(), musicLib()), plan);
	});
	it('holds every element of the brief: theme sting, ducked bed, Rekt Meter bumper, 2 whooshes, 3 pops, typing', () => {
		assert.equal(plan.sting.cue.id, 'intro-sting-show');
		assert.equal(plan.sting.downbeat, 0);
		assert.equal(plan.bumper.cue.id, 'bumper-rekt-meter');
		assert.equal(plan.outro.cue.id, 'theme-5s');
		assert.equal(plan.transitions.length, 2);
		assert.deepEqual(
			plan.transitions.map((t) => t.type),
			['slide', 'wipe'],
		);
		for (const t of plan.transitions) {
			assert.match(t.cue.id, /^whoosh_/);
			assert.equal(t.cue.at, t.at + Math.round(t.frames / 2)); // the pass-by mid-move
		}
		assert.deepEqual(
			plan.bullets.map((b) => b.cue.id),
			['pop_rise_01', 'pop_rise_02', 'pop_rise_03'],
		);
		assert.deepEqual(
			plan.bullets.map((b) => b.text),
			[...DEMO_BULLETS],
		);
		const keys = plan.typing.cues;
		assert.equal(keys.length, DEMO_TYPED.length);
		assert.equal(keys[keys.length - 1].key, 'enter');
		assert.equal(plan.lines.length, 2);
	});
	it('ducks under every word, rests under the bumper and crosses the bed loop seam while it is audible', () => {
		const words = plan.lines.reduce((n, l) => n + l.words.length, 0);
		assert.equal(plan.bed.speech.length, words);
		assert.equal(plan.bed.rests.length, 1);
		const bed = demoBedPlan(plan);
		assert.deepEqual(bed.depthsDb, [2, 12, 4]);
		const seamSec = plan.bed.from / plan.fps + (64 - DEMO_BED_START_SEC);
		assert.ok(seamSec < (plan.bed.from + plan.bed.durationInFrames) / plan.fps);
		assert.ok(bed.gain.gain(seamSec, 0) > 0.5, 'the loop seam falls where the bed plays');
		// fully ducked on every word, resting (silent) through the bumper's body
		for (const s of plan.bed.speech) assert.ok(Math.abs(20 * Math.log10(bed.gain.gain((s.start + s.end) / 2, 1)) + 12) < 1e-6);
		const r = plan.bed.rests[0];
		assert.equal(bed.gain.gain((r.start + r.end) / 2, 1), 0);
	});
	it('keeps sounds out of each other: pops and keys off speech, voice off the stingers, no file over itself', () => {
		for (const b of plan.bullets) assert.ok(!inSpeech(b.at), `bullet at ${b.at} lands on speech`);
		for (const k of plan.typing.cues) assert.ok(!inSpeech(k.at), `key at ${k.at} lands on speech`);
		const stingEnd = plan.sting.from + plan.sting.durationInFrames;
		assert.ok(plan.lines[0].from >= stingEnd);
		assert.ok(plan.lines[1].from >= plan.bumper.from + plan.bumper.durationInFrames);
		assert.ok(plan.outro.from >= plan.typing.cues[plan.typing.cues.length - 1].at);
		assert.equal(overlappingRepeats(planSfx(plan)).length, 0);
		// the bed is out before the theme button's downbeat
		assert.ok(plan.bed.from + plan.bed.durationInFrames <= plan.outro.downbeat);
	});
	it('every SFX and key sits on a whole frame inside the demo', () => {
		for (const c of planSfx(plan)) {
			assert.ok(Number.isInteger(c.at) && Number.isInteger(c.from));
			assert.ok(c.from >= 0 && c.from + c.durationInFrames <= plan.durationInFrames, `${c.id} at ${c.at}`);
		}
	});
	it('labels stinger hits briefly for the picture', () => {
		assert.deepEqual(
			plan.outro.hits.map((h) => hitLabel(h.what)),
			['motif starts', 'SHOW lands', 'Badger E-flat', 'Badger D'],
		);
		assert.equal(hitLabel('SHOW lands: ampersand turns teal'), 'SHOW lands');
	});
});
