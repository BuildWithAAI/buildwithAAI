/**
 * Sample-accurate rendering of a (looping, band-split) source through a BedGain, one video frame at
 * a time. Pure TypeScript: the render path (components/PcmTrack.tsx) and the tests call the same code.
 *
 * Why this exists: Remotion's <Html5Audio volume={f => ...}> applies ONE gain per video frame (and its
 * ffmpeg path steps it at the decoder's packet boundaries, rounded to 1/97). A 12 dB duck with a
 * 120 ms attack then moves in 3-4 dB steps: zipper noise. Here every sample gets its own gain from the
 * smooth curve, so automation is as clean as in a DAW. The measured difference is in src/audio/README.md.
 */
import type {BedGain} from './envelope.ts';

export type LoopPoints = {startSample: number; endSample: number};

/** A decoded source, optionally split into bands that sum to it: bands[b][channel]. */
export type PcmSource = {
	sampleRate: number;
	length: number;
	bands: Float32Array[][];
	loop: LoopPoints | null;
};

/**
 * The file sample to play `pos` samples after the cue started (pos >= 0), or -1 when a one-shot cue
 * has ended. A loop plays the file up to endSample once, then [startSample, endSample) forever.
 */
export const sourceIndex = (pos: number, length: number, loop: LoopPoints | null): number => {
	if (pos < 0) return -1;
	if (!loop) return pos < length ? pos : -1;
	if (pos < loop.endSample) return pos;
	const len = loop.endSample - loop.startSample;
	return loop.startSample + ((pos - loop.startSample) % len);
};

export const validateLoop = (loop: LoopPoints | null, length: number): void => {
	if (!loop) return;
	const {startSample: s, endSample: e} = loop;
	if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > length || e - s < 1) {
		throw new Error(`loop points [${s}, ${e}) do not fit a ${length}-sample source`);
	}
};

/** Samples [first, last) of composition frame f at `fps` (the renderer places frame f at floor(f / fps * sr)). */
export const frameSampleRange = (frame: number, fps: number, sampleRate: number): [number, number] => [
	Math.floor((frame * sampleRate) / fps + 1e-9),
	Math.floor(((frame + 1) * sampleRate) / fps + 1e-9),
];

/** Deterministic TPDF dither in [-1, 1) LSB from a sample index and channel (identical in every render tab). */
const tpdf = (i: number, c: number): number => {
	const u = (x: number): number => {
		let h = (x ^ 0x9e3779b9) >>> 0;
		h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
		h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
		h = (h ^ (h >>> 16)) >>> 0;
		return h / 4294967296;
	};
	return u(i * 4 + c * 2) - u(i * 4 + c * 2 + 1);
};

export type ChunkRequest = {
	/** first global (composition) sample of the chunk */
	start: number;
	/** number of samples */
	length: number;
	/** global sample at which the cue's play position is `offset` */
	cueStart: number;
	/** play position (samples into the cue) at cueStart */
	offset: number;
	/** composition sample rate; must equal the source's */
	sampleRate: number;
	/** add TPDF dither before rounding to 16 bits (default true) */
	dither?: boolean;
	/** linear gain applied on top of the BedGain (e.g. a cue's level trim) */
	trim?: number;
};

export type Chunk = {
	/** interleaved stereo, 16-bit */
	pcm: Int16Array;
	/** largest absolute sample before rounding (1.0 = full scale): over 1 means it clipped */
	peak: number;
};

/** Render one chunk of `src` through `gain` to interleaved stereo 16-bit PCM. */
export const renderChunk = (src: PcmSource, gain: BedGain, req: ChunkRequest): Chunk => {
	if (req.sampleRate !== src.sampleRate) throw new Error(`source is ${src.sampleRate} Hz, the composition ${req.sampleRate} Hz`);
	if (gain.bands !== src.bands.length) throw new Error(`gain has ${gain.bands} band(s), the source ${src.bands.length}`);
	const n = req.length;
	const nb = src.bands.length;
	const chans = src.bands[0].length;
	if (chans < 1 || chans > 2) throw new Error('sources must be mono or stereo');
	const g = Array.from({length: nb}, () => new Float32Array(n));
	gain.fill(g, req.start / req.sampleRate, req.sampleRate);
	const trim = req.trim ?? 1;
	const dither = req.dither ?? true;
	const pcm = new Int16Array(n * 2);
	let peak = 0;
	// a mono source plays equal-power in both channels (-3 dB each), as ffmpeg's upmix does
	const mono = chans === 1 ? Math.SQRT1_2 : 1;
	for (let i = 0; i < n; i++) {
		const s = req.start + i;
		const k = sourceIndex(s - req.cueStart + req.offset, src.length, src.loop);
		for (let c = 0; c < 2; c++) {
			let v = 0;
			if (k >= 0) {
				const ch = chans === 1 ? 0 : c;
				for (let b = 0; b < nb; b++) v += src.bands[b][ch][k] * g[b][i];
				v *= trim * mono;
			}
			const a = Math.abs(v);
			if (a > peak) peak = a;
			if (v === 0) {
				pcm[i * 2 + c] = 0;
				continue;
			}
			const q = v * 32768 + (dither ? tpdf(s, c) : 0);
			pcm[i * 2 + c] = Math.max(-32768, Math.min(32767, Math.round(q)));
		}
	}
	return {pcm, peak};
};
