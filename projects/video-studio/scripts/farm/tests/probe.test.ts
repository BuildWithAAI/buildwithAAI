// node --test scripts/farm/tests/probe.test.ts
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fmtBytes, fmtSeconds, isProbe, jobSummary, parseProbe, parseRate, runSummary, wavInfo, type RenderProbe, type VoiceProbe} from '../probe.ts';

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

// ---- wavInfo: the voice jobs read narration.wav headers themselves ------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), 'farm-wav-'));
after(() => rmSync(tmp, {recursive: true, force: true}));

/** A RIFF/WAVE file: optional LIST chunk before data, PCM (1) or float (3), optionally WAVE_FORMAT_EXTENSIBLE. */
const wav = (name: string, o: {format: number; channels: number; rate: number; bits: number; frames: number; list?: boolean; extensible?: boolean}) => {
	const block = (o.channels * o.bits) / 8;
	const fmt = Buffer.alloc(o.extensible ? 40 : 16);
	fmt.writeUInt16LE(o.extensible ? 0xfffe : o.format, 0);
	fmt.writeUInt16LE(o.channels, 2);
	fmt.writeUInt32LE(o.rate, 4);
	fmt.writeUInt32LE(o.rate * block, 8);
	fmt.writeUInt16LE(block, 12);
	fmt.writeUInt16LE(o.bits, 14);
	if (o.extensible) {
		fmt.writeUInt16LE(22, 16);
		fmt.writeUInt16LE(o.bits, 18);
		fmt.writeUInt16LE(o.format, 24);
	}
	const chunk = (id: string, body: Buffer) => {
		const h = Buffer.alloc(8);
		h.write(id, 0, 'latin1');
		h.writeUInt32LE(body.length, 4);
		return Buffer.concat([h, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
	};
	const parts = [chunk('fmt ', fmt)];
	if (o.list) parts.push(chunk('LIST', Buffer.from('INFOISFT\x05\x00\x00\x00Lavf\x00', 'latin1')));
	parts.push(chunk('data', Buffer.alloc(o.frames * block)));
	const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), ...parts]);
	const riff = Buffer.alloc(8);
	riff.write('RIFF', 0, 'latin1');
	riff.writeUInt32LE(body.length, 4);
	const p = join(tmp, name);
	writeFileSync(p, Buffer.concat([riff, body]));
	return p;
};

test('wavInfo reads the voice step\'s 24 kHz mono 16-bit narration (with a LIST chunk) like ffprobe does', () => {
	const p = wav('n.wav', {format: 1, channels: 1, rate: 24000, bits: 16, frames: 24000 * 7.3, list: true});
	const i = wavInfo(p);
	assert.ok(i);
	assert.deepEqual([i.durationSec, i.sampleRate, i.channels, i.audioCodec, i.format, i.width], [7.3, 24000, 1, 'pcm_s16le', 'wav', null]);
	// The real fixture (ffprobe of an es narration.wav) agrees on the fields wavInfo reports.
	const real = parseProbe(fixture('ffprobe-narration-wav.json'), 'audio');
	assert.deepEqual([real.sampleRate, real.channels, real.audioCodec], [i.sampleRate, i.channels, i.audioCodec]);
});

test('wavInfo: float and WAVE_FORMAT_EXTENSIBLE files; non-WAV and truncated files give null', () => {
	const f = wavInfo(wav('f.wav', {format: 3, channels: 2, rate: 48000, bits: 32, frames: 4800, extensible: true}));
	assert.deepEqual([f?.durationSec, f?.audioCodec, f?.channels], [0.1, 'pcm_f32le', 2]);
	writeFileSync(join(tmp, 'x.wav'), 'RIFFfake');
	assert.equal(wavInfo(join(tmp, 'x.wav')), null);
	assert.equal(wavInfo(join(tmp, 'missing.wav')), null);
	const whole = readFileSync(wav('t.wav', {format: 1, channels: 1, rate: 24000, bits: 16, frames: 100}));
	writeFileSync(join(tmp, 'cut.wav'), whole.subarray(0, 30));
	assert.equal(wavInfo(join(tmp, 'cut.wav')), null);
});
