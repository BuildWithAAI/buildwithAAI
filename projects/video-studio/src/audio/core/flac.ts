/**
 * FLAC STREAMINFO reader: sample rate, channels, bit depth and length of a FLAC file, read from its
 * header without decoding. The render path decodes FLAC with the browser's decoder and uses this to
 * prove the browser returned exactly the file's samples (same rate, same length: no resampling).
 */

export type FlacInfo = {sampleRate: number; channels: number; bitsPerSample: number; totalSamples: number};

export const isFlac = (buf: ArrayBuffer): boolean => {
	if (buf.byteLength < 4) return false;
	const b = new Uint8Array(buf, 0, 4);
	return b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43; // "fLaC"
};

export const flacInfo = (buf: ArrayBuffer): FlacInfo => {
	if (!isFlac(buf)) throw new Error('not a FLAC file');
	const b = new Uint8Array(buf);
	// first metadata block must be STREAMINFO (type 0), 34 bytes
	const type = b[4] & 0x7f;
	const len = (b[5] << 16) | (b[6] << 8) | b[7];
	if (type !== 0 || len !== 34 || b.byteLength < 8 + 34) throw new Error('FLAC: missing STREAMINFO');
	const s = 8;
	// bytes 10..17 of STREAMINFO: sample rate (20 bits), channels-1 (3), bps-1 (5), total samples (36)
	const sampleRate = (b[s + 10] << 12) | (b[s + 11] << 4) | (b[s + 12] >> 4);
	const channels = ((b[s + 12] >> 1) & 0x07) + 1;
	const bitsPerSample = (((b[s + 12] & 0x01) << 4) | (b[s + 13] >> 4)) + 1;
	const totalSamples = (b[s + 13] & 0x0f) * 2 ** 32 + ((b[s + 14] << 24) >>> 0) + (b[s + 15] << 16) + (b[s + 16] << 8) + b[s + 17];
	return {sampleRate, channels, bitsPerSample, totalSamples};
};
