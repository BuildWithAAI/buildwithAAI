import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import {buildJoin, JoinError, parseTimeline} from './timeline.ts';

const VS = fileURLToPath(new URL('./fixtures/video-studio/', import.meta.url));
const codes = (issues: {code: string}[]) => issues.map((i) => i.code);

describe('join: long-form', () => {
	it('places every timeline scene with its storyboard type, Badger and title', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-story', lang: 'en'});
		assert.equal(j.format, 'long');
		assert.equal(j.renderer, 'episode');
		assert.equal(j.totalMs, 55_000);
		assert.deepEqual(j.scenes.map((s) => [s.id, s.type, s.startMs, s.durationMs]), [
			['s01', 'hook', 0, 2400],
			['s02', 'talk', 2400, 9300],
			['s03', 'chart', 11_700, 8100],
			['s04', 'steps', 19_800, 11_200],
			['s05', 'cta', 31_000, 4000],
			['s06', 'endscreen', 35_000, 20_000],
		]);
		assert.deepEqual(j.scenes.map((s) => s.badger), [false, true, true, false, true, true]);
		assert.equal(j.scenes[3]!.segment, 'BadgerRedFlag', 'inferred from the title "Badger\'s Red Flag: the countdown"');
		assert.equal(j.scenes[3]!.segmentSource, 'inferred');
		assert.equal(j.timeline.path, 'video-studio/public/generated/zoora-ai/fixture-ret-story/en/timeline.json');
		assert.match(j.timeline.sha256, /^[0-9a-f]{64}$/);
		assert.deepEqual(j.issues, []);
	});
	it('a dubbed version uses its own timeline and keeps English titles for the report', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-story', lang: 'es'});
		assert.equal(j.totalMs, 58_100);
		assert.equal(j.scenes[0]!.durationMs, 2800);
		assert.equal(j.scenes[0]!.title, 'You found a token');
		assert.equal(j.scenes[3]!.segment, 'BadgerRedFlag');
		assert.equal(j.storyboard.path, 'video-studio/content/zoora-ai/fixture-ret-story/storyboard.es.json');
	});
	it('falls back to storyboard.json when the language has no storyboard (scene ids are stable)', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-story', lang: 'pt-br'});
		assert.deepEqual(codes(j.issues), ['storyboard-fallback']);
		assert.equal(j.scenes[2]!.type, 'chart');
	});
	it('reports gaps, overlaps, empty, unknown, missing and overlong scenes, and keeps the rest', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-gaps', lang: 'en'});
		assert.deepEqual(codes(j.issues).sort(), ['empty-scene', 'gap', 'overlap', 'scene-not-in-storyboard', 'scene-past-end', 'storyboard-scene-missing'].sort());
		assert.deepEqual(j.scenes.map((s) => s.id), ['s01', 's02', 's03', 's99', 's05']);
		assert.equal(j.scenes.find((s) => s.id === 's99')!.type, 'unknown');
		assert.equal(j.scenes.find((s) => s.id === 's99')!.badger, null);
		const last = j.scenes.find((s) => s.id === 's05')!;
		assert.equal(last.startMs + last.durationMs, 30_000, 'cut at the end of the video');
		assert.match(j.issues.find((i) => i.code === 'storyboard-scene-missing')!.detail, /s04/);
	});
	it('flags a mock (silent preview) timeline', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-mock', lang: 'en'});
		assert.equal(j.timeline.mock, true);
		assert.deepEqual(codes(j.issues), ['mock-timeline']);
	});
	it('says how to make a missing timeline', () => {
		assert.throws(() => buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-story', lang: 'hi'}), (err: Error) => err instanceof JoinError && /run the voice step for zoora-ai\/fixture-ret-story --lang hi/.test(err.message));
	});
});

describe('join: Shorts', () => {
	it('retimes the listed scenes from 0 on the frame grid', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-story', lang: 'en', shortId: 'short1'});
		assert.equal(j.format, 'short');
		assert.deepEqual(j.scenes.map((s) => [s.id, s.index, Math.round(s.startMs), Math.round(s.durationMs)]), [
			['s01', 0, 0, 2400],
			['s03', 1, 2400, 8100],
			['s04', 2, 10_500, 11_200],
		]);
		assert.equal(Math.round(j.totalMs), 21_700);
	});
	it('skips (and reports) a scene the timeline does not have', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-story', lang: 'en', shortId: 'short-missing'});
		assert.deepEqual(codes(j.issues), ['short-scene-missing']);
		assert.equal(j.scenes.length, 1);
	});
	it('names the shorts that exist when the id is wrong', () => {
		assert.throws(() => buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-story', lang: 'en', shortId: 'nope'}), /has no short "nope" \(it has: short1, short-missing\)/);
	});
	it('a very short (4 s) Short still joins', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-ai', slug: 'fixture-ret-tiny', lang: 'en', shortId: 'tiny'});
		assert.equal(Math.round(j.totalMs), 4000);
		assert.equal(j.scenes.length, 2);
	});
});

describe('join: the show (zoora-security)', () => {
	it('reads camelCase segments and applies the show defaults', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-security', slug: 'fixture-ret-show', lang: 'en'});
		assert.equal(j.renderer, 'show');
		assert.deepEqual(j.scenes.map((s) => [s.segment, s.segmentSource]), [
			['ColdOpen', 'default'],
			['Headline', 'explicit'],
			['HowItWorked', 'explicit'],
			['BadgerRedFlag', 'explicit'],
			['ZooOneFix', 'explicit'],
			['Desk', 'default'],
			['OutroEndScreen', 'default'],
		]);
	});
	it('trims the outro in a ShowShort to its speech plus 45 frames (src/show/timing.ts)', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-security', slug: 'fixture-ret-show', lang: 'en', shortId: 'daily'});
		const outro = j.scenes[2]!;
		assert.equal(outro.segment, 'OutroEndScreen');
		// speech 2500 ms = 75 frames, + 45 = 120 frames = 4000 ms (the 20 s end-screen hold is only for the landscape episode)
		assert.equal(Math.round(outro.durationMs), 4000);
		assert.equal(Math.round(j.totalMs), 3500 + 10_600 + 4000);
	});
	it('the episode renderer can be chosen instead (no outro trim, no show defaults)', () => {
		const j = buildJoin({videoStudioDir: VS, channel: 'zoora-security', slug: 'fixture-ret-show', lang: 'en', renderer: 'episode'});
		assert.equal(j.scenes[0]!.segment, null);
		assert.equal(j.scenes[3]!.segment, 'BadgerRedFlag', 'explicit segments still count');
	});
});

describe('timeline validation', () => {
	it('rejects a timeline without a positive totalMs or scene timing', () => {
		assert.throws(() => parseTimeline({version: 1, fps: 30, totalMs: 0, scenes: []}, 'x.json'), /totalMs/);
		assert.throws(() => parseTimeline({version: 2, fps: 30, totalMs: 10, scenes: []}, 'x.json'), /version/);
		assert.throws(() => parseTimeline({version: 1, fps: 30, totalMs: 10, scenes: [{id: 's1'}]}, 'x.json'), /scene 1/);
	});
});
