import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {flacInfo, isFlac} from '../core/flac.ts';
import {encodeWav16, parseWav} from '../core/wav.ts';
import {musicLib, pub, sfxLib} from './helpers.ts';

const buf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** A WAV with an arbitrary fmt chunk, for the formats encodeWav16 does not write. */
const wav = (o: {format: number; channels: number; bits: number; rate: number; data: Uint8Array; extensible?: boolean; extra?: Uint8Array}): ArrayBuffer => {
	const fmtSize = o.extensible ? 40 : 16;
	const extra = o.extra ?? new Uint8Array(0);
	const size = 12 + 8 + fmtSize + extra.length + 8 + o.data.length;
	const b = new ArrayBuffer(size);
	const v = new DataView(b);
	const put = (at: number, s: string) => {
		for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i));
	};
	put(0, 'RIFF');
	v.setUint32(4, size - 8, true);
	put(8, 'WAVE');
	put(12, 'fmt ');
	v.setUint32(16, fmtSize, true);
	v.setUint16(20, o.extensible ? 0xfffe : o.format, true);
	v.setUint16(22, o.channels, true);
	v.setUint32(24, o.rate, true);
	v.setUint32(28, (o.rate * o.channels * o.bits) / 8, true);
	v.setUint16(32, (o.channels * o.bits) / 8, true);
	v.setUint16(34, o.bits, true);
	if (o.extensible) {
		v.setUint16(36, 22, true);
		v.setUint16(38, o.bits, true);
		v.setUint32(40, 3, true);
		v.setUint16(44, o.format, true); // SubFormat GUID, first two bytes
	}
	let at = 20 + fmtSize;
	new Uint8Array(b, at, extra.length).set(extra); // e.g. a LIST chunk before data
	at += extra.length;
	put(at, 'data');
	v.setUint32(at + 4, o.data.length, true);
	new Uint8Array(b, at + 8).set(o.data);
	return b;
};

describe('WAV reader', () => {
	it('round-trips 16-bit PCM written by encodeWav16', () => {
		const l = Float32Array.from([0, 0.5, -0.5, 0.999]);
		const r = Float32Array.from([0.25, -1, 1, 0]);
		const d = parseWav(buf(encodeWav16([l, r], 48000)));
		assert.equal(d.sampleRate, 48000);
		assert.equal(d.bitsPerSample, 16);
		assert.equal(d.channels.length, 2);
		// exact to half an LSB; +1.0 clamps to the largest 16-bit value
		for (let i = 0; i < 4; i++) {
			assert.ok(Math.abs(d.channels[0][i] - l[i]) <= 0.5 / 32768);
			assert.ok(Math.abs(d.channels[1][i] - Math.min(r[i], 32767 / 32768)) <= 0.5 / 32768);
		}
	});
	it('reads 24-bit PCM, 32-bit float (plain and EXTENSIBLE) and skips chunks before data', () => {
		const p24 = new Uint8Array([0x00, 0x00, 0x40, 0x00, 0x00, 0xc0]); // +0.5, -0.5
		const d24 = parseWav(wav({format: 1, channels: 1, bits: 24, rate: 24000, data: p24, extra: new Uint8Array([0x4c, 0x49, 0x53, 0x54, 2, 0, 0, 0, 0, 0])}));
		assert.deepEqual(Array.from(d24.channels[0]), [0.5, -0.5]);
		const f = new Float32Array([0.25, -0.75]);
		const df = parseWav(wav({format: 3, channels: 1, bits: 32, rate: 48000, data: new Uint8Array(f.buffer), extensible: true}));
		assert.deepEqual(Array.from(df.channels[0]), [0.25, -0.75]);
	});
	it('refuses what it cannot read', () => {
		assert.throws(() => parseWav(new ArrayBuffer(8)), /RIFF/);
		assert.throws(() => parseWav(wav({format: 2, channels: 1, bits: 16, rate: 8000, data: new Uint8Array(4)})), /unsupported/);
	});
	it('reads the committed SFX files: 48 kHz stereo, as the manifest says', () => {
		const lib = sfxLib();
		for (const e of lib.sounds.slice(0, 12)) {
			const d = parseWav(buf(readFileSync(pub(e.file))));
			assert.equal(d.sampleRate, 48000, e.id);
			assert.equal(d.channels.length, 2, e.id);
			assert.ok(Math.abs((d.channels[0].length / 48) - e.durationMs) < 1, `${e.id}: ${d.channels[0].length / 48} ms vs ${e.durationMs}`);
		}
	});
});

describe('FLAC STREAMINFO', () => {
	it('every committed FLAC bed holds exactly the samples the music manifest says (no resampling on decode)', () => {
		const flacs = musicLib().cues.filter((c) => c.file.endsWith('.flac'));
		assert.ok(flacs.length >= 8);
		for (const c of flacs) {
			const b = readFileSync(pub(c.file));
			const ab = buf(b.subarray(0, 64));
			assert.ok(isFlac(ab), c.id);
			const info = flacInfo(ab);
			assert.equal(info.sampleRate, 48000, c.id);
			assert.equal(info.channels, 2, c.id);
			assert.equal(info.totalSamples, c.durationSamples, c.id);
		}
		assert.equal(isFlac(new ArrayBuffer(2)), false);
		assert.throws(() => flacInfo(new ArrayBuffer(64)), /not a FLAC/);
	});
});
