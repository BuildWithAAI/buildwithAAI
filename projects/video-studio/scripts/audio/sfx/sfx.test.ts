import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {asManifest, durationInFrames, eventFrames, hash, nearestGapFrame, pick, pickSequence, rigStartFrame, sfx, speechMaskFromSpans, startFrame, syncFrames, validateManifest, variations, volume, volumeUnderSpeech} from './sfx.ts';
import type {SfxEntry, SfxManifest} from './sfx.ts';

const entry = (id: string, over: Partial<SfxEntry> = {}): SfxEntry => ({
	id,
	file: `audio/sfx/test/${id}.wav`,
	group: id.replace(/_\d\d$/, ''),
	variation: Number(id.slice(-2)),
	category: 'test',
	role: 'ui',
	tags: ['test'],
	description: '',
	durationMs: 400,
	onsetMs: 0,
	transientMs: 0.3,
	peakMs: 1,
	loudPeakMs: 20,
	syncKind: 'transient',
	syncMs: 0,
	syncFrame30: 0,
	suggestedGainDb: -6,
	suggestedVolume: 0.5012,
	loudness: {samplePeakDbfs: -6, truePeakDbtp: -5.9, lufs200Max: -18, lufsMomentaryMax: -20, lufs100Max: -15, targetLufs: -24, gainCapped: false},
	pitch: null,
	loop: false,
	events: [],
	sources: [{kind: 'synthesis', licence: 'original work, owned'}],
	sha256: '0'.repeat(64),
	...over,
});

const fixture = (): SfxManifest => {
	const sounds = [entry('pop_01'), entry('pop_02'), entry('pop_03'), entry('whoosh_medium_01', {syncKind: 'peak', syncMs: 300, syncFrame30: 9, role: 'transition'})];
	return {
		version: 1,
		fps: 30,
		frameSamples: 1600,
		groups: {pop: {category: 'test', role: 'ui', ids: ['pop_01', 'pop_02', 'pop_03']}},
		sounds,
	};
};

describe('validateManifest', () => {
	it('accepts a valid manifest and reports every problem in a broken one', () => {
		assert.deepEqual(validateManifest(fixture()), []);
		const bad = fixture();
		bad.sounds[0] = entry('pop_01', {syncMs: 10, file: 'pop.wav'});
		bad.groups.short = {category: 'x', role: 'ui', ids: ['pop_01']};
		const errors = validateManifest(bad).join('\n');
		assert.match(errors, /syncMs must be a whole 30 fps frame/);
		assert.match(errors, /file must be audio\/sfx/);
		assert.match(errors, /group short has fewer than 3 variations/);
		assert.deepEqual(validateManifest(null), ['manifest must be an object']);
		assert.throws(() => asManifest({}), /invalid SFX manifest/);
	});
});

describe('frame sync', () => {
	it('starts a file so its sync point lands on the target frame', () => {
		const w = sfx(fixture(), 'whoosh_medium_01');
		assert.equal(syncFrames(w), 9);
		assert.equal(startFrame(w, 100), 91);
		assert.equal(syncFrames(w, 60), 18);
		assert.equal(startFrame(sfx(fixture(), 'pop_01'), 42), 42);
		assert.equal(durationInFrames(w), 12);
	});
	it('lists event frames', () => {
		const e = entry('typing_burst_01', {events: [{ms: 0, frame: 0, kind: 'press'}, {ms: 133.33, frame: 4, kind: 'press'}, {ms: 233.33, frame: 7, kind: 'release'}]});
		assert.deepEqual(eventFrames(e), [0, 4, 7]);
		assert.deepEqual(eventFrames(e, 'press'), [0, 4]);
	});
	it('finds the next typing-pose frame that keeps the rig aligned', () => {
		const e = entry('typing_burst_01', {rig: {source: 'x', period: 36, startRigFrameMod36: 1, note: ''}});
		assert.equal(rigStartFrame(e, 0), 1);
		assert.equal(rigStartFrame(e, 1), 1);
		assert.equal(rigStartFrame(e, 2), 37);
		assert.equal(rigStartFrame(e, 73), 73);
		assert.throws(() => rigStartFrame(entry('pop_01'), 0), /not rig-synced/);
	});
});

describe('picks and volume', () => {
	it('picks deterministically and avoids immediate repeats', () => {
		const m = fixture();
		assert.equal(pick(m, 'pop', 'scene-1').id, pick(m, 'pop', 'scene-1').id);
		const seq = pickSequence(m, 'pop', 12, 'bullets');
		for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i].id, seq[i - 1].id);
		assert.equal(new Set(Array.from({length: 30}, (_, i) => pick(m, 'pop', i).id)).size, 3);
		assert.equal(hash('a'), hash('a'));
		assert.throws(() => variations(m, 'nope'), /no SFX group "nope"/);
		assert.throws(() => sfx(m, 'nope_01'), /no SFX "nope_01"/);
	});
	it('turns the suggested gain plus a trim into a linear volume', () => {
		const e = sfx(fixture(), 'pop_01');
		assert.ok(Math.abs(volume(e) - 10 ** (-6 / 20)) < 1e-12);
		assert.ok(Math.abs(volume(e, 6) - 1) < 1e-12);
	});
});

const PUBLIC = new URL('../../../public/audio/sfx/manifest.json', import.meta.url);
describe('the exported library', {skip: !existsSync(PUBLIC)}, () => {
	it('is a valid manifest whose every group can be picked and synced', () => {
		const m = asManifest(JSON.parse(readFileSync(PUBLIC, 'utf8')));
		assert.ok(m.sounds.length >= 100);
		for (const group of Object.keys(m.groups)) {
			const e = pick(m, group, 'test');
			assert.equal(startFrame(e, 300), 300 - e.syncFrame30);
			assert.ok(volume(e) > 0);
		}
		for (const e of m.sounds.filter((s) => s.rig)) assert.ok(rigStartFrame(e, 0) < 36);
	});
});

describe('speech gaps (critic round 1: UI sounds off Zoo\'s consonants)', () => {
	it('builds a per-frame mask from spans', () => {
		const m = speechMaskFromSpans([[0.1, 0.3], [0.5, 0.52]], 20);
		assert.equal(m.length, 20);
		assert.deepEqual(m.flatMap((x, i) => (x ? [i] : [])), [3, 4, 5, 6, 7, 8, 15]);
		assert.deepEqual(speechMaskFromSpans([[0.5, 0.4]], 5), [false, false, false, false, false]);
	});
	it('moves a pop to the nearest gap, earlier first, and gives up past maxShift', () => {
		const speech = [true, true, true, false, false, true, true, true, true, true, true, false, false, false];
		assert.equal(nearestGapFrame(speech, 3), 3);
		assert.equal(nearestGapFrame(speech, 6), 3); // 3 frames back beats 5 forward
		assert.equal(nearestGapFrame(speech, 9), 11);
		assert.equal(nearestGapFrame(speech, 8, 1), null);
		assert.equal(nearestGapFrame(speech, 20), 20); // past the narration: silent
	});
	it('trims a sound that has to stay under speech by its role', () => {
		const e = entry('pop_01', {underSpeechTrimDb: -3});
		assert.ok(Math.abs(20 * Math.log10(volume(e) / volumeUnderSpeech(e)) - 3) < 1e-9);
		assert.equal(volumeUnderSpeech(entry('pop_02')), volume(entry('pop_02')));
	});
});

describe('the delivered library (critic round 1)', {skip: !existsSync(PUBLIC)}, () => {
	const load = () => asManifest(JSON.parse(readFileSync(PUBLIC, 'utf8')));
	it('keeps one pitch per random group and the rising set in its own group', () => {
		const lib = load();
		for (const g of ['pop', 'plop']) assert.equal(new Set(variations(lib, g).map((e) => e.pitch)).size, 1, g);
		assert.deepEqual(variations(lib, 'pop_rise').map((e) => e.pitch), ['D5', 'G5', 'A5', 'D6']);
	});
	it('ui sounds carry the under-speech trim, and the role targets moved down 3 dB', () => {
		for (const e of load().sounds) {
			if (e.role === 'ui') assert.equal(e.underSpeechTrimDb, -3, e.id);
			if (e.role === 'ui') assert.equal(e.loudness.targetLufs, -27, e.id);
			if (e.role === 'transition') assert.equal(e.loudness.targetLufs, -21, e.id);
		}
	});
});
