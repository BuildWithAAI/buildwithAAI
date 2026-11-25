/**
 * A strict RIFF/WAVE reader for the render path: PCM 16/24/32-bit and IEEE float 32/64-bit,
 * plain or WAVE_FORMAT_EXTENSIBLE. Deterministic (no browser codec involved), so a WAV decodes to
 * the same samples in every render tab. FLAC goes through the browser's decoder instead
 * (components/decode.ts).
 */

export type DecodedAudio = {sampleRate: number; channels: Float32Array[]; bitsPerSample: number};

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

const tag = (v: DataView, at: number): string => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

export const parseWav = (buf: ArrayBuffer): DecodedAudio => {
	const v = new DataView(buf);
	if (buf.byteLength < 12 || tag(v, 0) !== 'RIFF' || tag(v, 8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
	let at = 12;
	let fmt: {format: number; channels: number; sampleRate: number; bits: number; blockAlign: number} | null = null;
	let data: {offset: number; size: number} | null = null;
	while (at + 8 <= buf.byteLength) {
		const id = tag(v, at);
		const size = v.getUint32(at + 4, true);
		const body = at + 8;
		if (id === 'fmt ') {
			let format = v.getUint16(body, true);
			const channels = v.getUint16(body + 2, true);
			const sampleRate = v.getUint32(body + 4, true);
			const blockAlign = v.getUint16(body + 12, true);
			const bits = v.getUint16(body + 14, true);
			if (format === EXTENSIBLE && size >= 40) format = v.getUint16(body + 24, true); // SubFormat GUID's first two bytes
			fmt = {format, channels, sampleRate, bits, blockAlign};
		} else if (id === 'data') {
			// a streamed WAV may carry 0 or 0xFFFFFFFF here: read to the end of the file then
			const avail = buf.byteLength - body;
			data = {offset: body, size: size === 0 || size === 0xffffffff || size > avail ? avail : size};
			break;
		}
		at = body + size + (size % 2);
	}
	if (!fmt) throw new Error('WAV has no fmt chunk');
	if (!data) throw new Error('WAV has no data chunk');
	const {format, channels, sampleRate, bits, blockAlign} = fmt;
	if (channels < 1) throw new Error('WAV has no channels');
	const bytes = bits / 8;
	if (blockAlign !== channels * bytes) throw new Error(`WAV block align ${blockAlign} does not match ${channels} x ${bits}-bit`);
	const frames = Math.floor(data.size / blockAlign);
	const out = Array.from({length: channels}, () => new Float32Array(frames));
	const o = data.offset;
	if (format === PCM && bits === 16) {
		for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c][i] = v.getInt16(o + i * blockAlign + c * 2, true) / 32768;
	} else if (format === PCM && bits === 24) {
		for (let i = 0; i < frames; i++)
			for (let c = 0; c < channels; c++) {
				const p = o + i * blockAlign + c * 3;
				const u = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16);
				out[c][i] = (u & 0x800000 ? u - 0x1000000 : u) / 8388608;
			}
	} else if (format === PCM && bits === 32) {
		for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c][i] = v.getInt32(o + i * blockAlign + c * 4, true) / 2147483648;
	} else if (format === FLOAT && bits === 32) {
		for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c][i] = v.getFloat32(o + i * blockAlign + c * 4, true);
	} else if (format === FLOAT && bits === 64) {
		for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c][i] = v.getFloat64(o + i * blockAlign + c * 8, true);
	} else throw new Error(`unsupported WAV encoding: format ${format}, ${bits}-bit`);
	return {sampleRate, channels: out, bitsPerSample: bits};
};

/** Write 16-bit PCM WAV bytes (tests and tools). */
export const encodeWav16 = (channels: readonly Float32Array[], sampleRate: number): Uint8Array => {
	const n = channels[0]?.length ?? 0;
	const ch = channels.length;
	const size = n * ch * 2;
	const buf = new ArrayBuffer(44 + size);
	const v = new DataView(buf);
	const put = (at: number, s: string) => {
		for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i));
	};
	put(0, 'RIFF');
	v.setUint32(4, 36 + size, true);
	put(8, 'WAVE');
	put(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, PCM, true);
	v.setUint16(22, ch, true);
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * ch * 2, true);
	v.setUint16(32, ch * 2, true);
	v.setUint16(34, 16, true);
	put(36, 'data');
	v.setUint32(40, size, true);
	// the same scale as the reader (x 32768), clamped: a round trip is exact to half an LSB
	for (let i = 0; i < n; i++)
		for (let c = 0; c < ch; c++) v.setInt16(44 + (i * ch + c) * 2, Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32768))), true);
	return new Uint8Array(buf);
};
