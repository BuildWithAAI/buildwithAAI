// node --test scripts/farm/tests/probe.test.ts
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fmtBytes, fmtSeconds, isProbe, jobSummary, parseProbe, parseRate, runSummary, type RenderProbe, type VoiceProbe} from '../probe.ts';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIX, name), 'utf8'));

test('parseProbe: a Remotion MP4 (TestCard, real ffprobe output)', () => {
	const i = parseProbe(fixture('ffprobe-testcard-mp4.json'), 'video');
	assert.deepEqual(
		[i.width, i.height, i.durationSec, i.fps, i.videoCodec, i.pixFmt, i.audioCodec, i.sizeBytes, i.format],
		[1920, 1080, 3, 30, 'h264', 'yuv420p', null, 387950, 'mov,mp4,m4a,3gp,3g2,mj2'],
	);
});

test('parseProbe: a PNG still reports its size but no duration or frame rate', () => {
	const i = parseProbe(fixture('ffprobe-chart-png.json'), 'still');
	assert.deepEqual([i.width, i.height, i.durationSec, i.fps, i.videoCodec, i.sizeBytes], [1920, 1080, null, null, 'png', 86505]);
});

test('parseProbe: narration WAV (24 kHz mono, from the voice step)', () => {
	const i = parseProbe(fixture('ffprobe-narration-wav.json'), 'audio');
	assert.deepEqual([i.width, i.durationSec, i.audioCodec, i.sampleRate, i.channels, i.sizeBytes], [null, 7.4, 'pcm_s16le', 24000, 1, 355278]);
});

test('parseProbe tolerates garbage', () => {
	for (const junk of [null, 'x', {}, {streams: 'no'}, {streams: [null, 3], format: []}]) {
		const i = parseProbe(junk, 'video');
		assert.equal(i.width, null);
		assert.equal(i.durationSec, null);
	}
	assert.equal(parseProbe({streams: [{codec_type: 'video', codec_name: 'h264; rm -rf /'}], format: {}}, 'video').videoCodec, null);
});

test('rates, durations and sizes format for people', () => {
	assert.equal(parseRate('30000/1001'), 29.97);
	assert.equal(parseRate('0/0'), null);
	assert.equal(fmtSeconds(3), '3.00 s');
	assert.equal(fmtSeconds(75.25), '1:15.3');
	assert.equal(fmtSeconds(3723), '1:02:03.0');
	assert.equal(fmtSeconds(null), '-');
	assert.equal(fmtBytes(387950), '378.9 KiB');
	assert.equal(fmtBytes(5 * 1024 * 1024), '5.00 MiB');
});

const render = (over: Partial<RenderProbe> = {}): RenderProbe => ({
	type: 'render',
	request: 'farm-selftest',
	index: 0,
	composition: 'TestCard',
	kind: 'video',
	lang: '-',
	output: 'out/farm/selftest/testcard.mp4',
	artifact: 'render_farm-selftest_0_TestCard',
	encrypted: false,
	ok: true,
	exitCode: 0,
	renderSeconds: 21.4,
	jobSeconds: 80.2,
	voiceTracks: 0,
	info: parseProbe(fixture('ffprobe-testcard-mp4.json'), 'video'),
	...over,
});

const voice: VoiceProbe = {
	type: 'voice',
	request: 'farm-selftest-voice',
	vindex: 1,
	channel: '_farm',
	slug: 'voice-selftest',
	lang: 'es',
	artifact: 'voice_farm-selftest-voice_1',
	encrypted: true,
	ok: true,
	exitCode: 0,
	buildSeconds: 9.1,
	info: parseProbe(fixture('ffprobe-narration-wav.json'), 'audio'),
};

test('job and run summaries: measurements and ids only', () => {
	const one = jobSummary(render());
	assert.match(one, /\| farm-selftest \| 0 \| TestCard \| - \| video \| `out\/farm\/selftest\/testcard.mp4` \| 1920x1080 \| 3.00 s \| 30 \| h264 \/ yuv420p \| 378.9 KiB \| 21.4 s \| 1:20.2 \|/);
	const all = runSummary([render({index: 1, ok: false, exitCode: 1, info: null}), voice, render()], 3);
	assert.match(all, /1 of 3 outputs rendered/);
	assert.match(all, /1 job\(s\) reported nothing/);
	assert.match(all, /### Voice tracks[\s\S]*_farm\/voice-selftest \| es \| 7.40 s \| 24000 Hz/);
	assert.ok(all.indexOf('| farm-selftest | 0 |') < all.indexOf('| farm-selftest | 1 |'), 'rows are sorted by job');
	assert.match(all, /failed \(exit 1\)/);
	assert.match(all, /decrypt\.sh/);
	assert.ok(jobSummary(render({output: 'out/a|b.mp4'})).includes('a\\|b'), 'pipes are escaped');
});

test('isProbe recognizes probe records only', () => {
	assert.ok(isProbe(render()));
	assert.ok(isProbe(voice));
	assert.ok(!isProbe({type: 'render'}));
	assert.ok(!isProbe(null));
});
