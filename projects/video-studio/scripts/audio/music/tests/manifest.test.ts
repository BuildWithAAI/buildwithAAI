/**
 * Music manifest tests (node:test). Run from projects/video-studio:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/audio/music/tests/manifest.test.ts
 * The delivered-manifest test skips when public/audio/music/manifest.json does not exist yet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cueById, framesPerBar, framesPerBeat, loopFrames, nextBarFrame, parseManifest, type MusicCue} from '../manifest.ts';

const STUDIO = fileURLToPath(new URL('../../../../', import.meta.url));
const DELIVERED = join(STUDIO, 'public', 'audio', 'music', 'manifest.json');

const bed = (over: Partial<MusicCue> = {}): MusicCue => ({
	id: 'bed-show-neutral', title: 't', channel: 'zoora-security', cueType: 'bed', mood: 'm', key: 'D dorian', bpm: 90,
	durationSec: 64, durationSamples: 3072000,
	loop: {seamless: true, startSample: 0, endSample: 3072000, startSec: 0, endSec: 64, frames30: 1920},
	hits: [], file: 'audio/music/bed-show-neutral.flac', format: 'flac-16bit', integratedLufs: -26, shortTermMedianLufs: -26,
	truePeakDbtp: -6.3, profile: 'bed', metadata: 'audio/music/bed-show-neutral.json', ...over,
});

test('frame-aligned tempos', () => {
	assert.equal(framesPerBeat(100), 18);
	assert.equal(framesPerBeat(90), 20);
	assert.equal(framesPerBeat(75), 24);
	assert.equal(framesPerBar(90), 80);
});

test('a valid manifest parses and the helpers work', () => {
	const m = parseManifest({schema: 1, sampleRate: 48000, cues: [bed()]});
	const c = cueById(m, 'bed-show-neutral');
	assert.equal(loopFrames(c), 1920);
	assert.equal(nextBarFrame(c, 0), 0);
	assert.equal(nextBarFrame(c, 1), 80);
	assert.equal(nextBarFrame(c, 160), 160);
	assert.throws(() => cueById(m, 'nope'), /no music cue "nope"/);
	assert.throws(() => loopFrames({...c, loop: null}), /does not loop/);
});

test('every problem is reported', () => {
	const bad = {schema: 2, sampleRate: 44100, cues: [bed({loop: null}), bed({file: '../../etc/passwd', bpm: 0}), {id: 'x'}]};
	assert.throws(() => parseManifest(bad), (e: unknown) => {
		const msg = String((e as Error).message);
		for (const part of ['schema 2', 'sampleRate 44100', 'a bed must loop', 'duplicate id', 'file must be', 'bpm must be']) assert.ok(msg.includes(part), `${part} missing from: ${msg}`);
		return true;
	});
	assert.throws(() => parseManifest(null), /not an object/);
});

test('the delivered manifest is valid and its files exist', {skip: !existsSync(DELIVERED)}, () => {
	const m = parseManifest(JSON.parse(readFileSync(DELIVERED, 'utf8')));
	assert.ok(m.cues.length >= 19, `expected at least 19 cues, got ${m.cues.length}`);
	for (const c of m.cues) {
		const f = join(STUDIO, 'public', c.file);
		assert.ok(existsSync(f), `${c.id}: ${c.file} missing`);
		assert.ok(statSync(f).size <= 10_000_000, `${c.id}: over 10 MB`);
		assert.ok(existsSync(join(STUDIO, 'public', c.metadata)), `${c.id}: metadata missing`);
		if (c.loop) assert.equal(Number.isInteger(loopFrames(c)), true);
	}
});
