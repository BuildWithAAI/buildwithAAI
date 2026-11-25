/**
 * Where Zoo speaks, as spans in composition seconds: from the voice step's Timeline (word timings),
 * from scenes placed anywhere (Shorts, demos), or from the narration's level (RMS) when no word timings
 * exist. The duck (core/envelope.ts) turns these spans into a gain curve. Pure TypeScript.
 */
import type {Span} from './envelope.ts';
import {butterHighpass, butterLowpass, type Biquad} from './bands.ts';

/** The parts of the Timeline contract (src/episode/types.ts) this module reads. */
export type TimelineLike = {
	scenes: ReadonlyArray<{startMs: number; durationMs?: number; words: ReadonlyArray<{startMs: number; endMs: number}>}>;
};

export type WordPadding = {
	/** extend each word's end (ms): word ends sit on the last phoneme while its release still rings. Default 60. */
	padEndMs?: number;
	/** start each word earlier (ms). Default 0: the duck's lookahead already starts before the word. */
	padStartMs?: number;
};

const pads = (o: WordPadding = {}) => ({end: (o.padEndMs ?? 60) / 1000, start: (o.padStartMs ?? 0) / 1000});

/** Speech spans of a whole timeline: scene.startMs + word times, shifted by `offsetSec` (where the timeline's 0 sits). */
export const speechSpansFromTimeline = (tl: TimelineLike, opts: WordPadding & {offsetSec?: number} = {}): Span[] => {
	const p = pads(opts);
	const off = opts.offsetSec ?? 0;
	const out: Span[] = [];
	for (const sc of tl.scenes) {
		for (const w of sc.words) {
			if (!(w.endMs > w.startMs)) continue;
			out.push({start: off + (sc.startMs + w.startMs) / 1000 - p.start, end: off + (sc.startMs + w.endMs) / 1000 + p.end});
		}
	}
	return out.sort((a, b) => a.start - b.start);
};

/**
 * Speech spans of scenes placed at arbitrary composition times (a Short re-times scenes; a demo spaces
 * them out). Words are scene-relative ms; `untilSec` (optional) cuts a scene's words where it is cut.
 */
export const speechSpansFromScenes = (
	scenes: ReadonlyArray<{atSec: number; untilSec?: number; words: ReadonlyArray<{startMs: number; endMs: number}>}>,
	opts: WordPadding = {},
): Span[] => {
	const p = pads(opts);
	const out: Span[] = [];
	for (const sc of scenes) {
		for (const w of sc.words) {
			if (!(w.endMs > w.startMs)) continue;
			const start = sc.atSec + w.startMs / 1000 - p.start;
			let end = sc.atSec + w.endMs / 1000 + p.end;
			if (sc.untilSec !== undefined) {
				if (start >= sc.untilSec) continue;
				end = Math.min(end, sc.untilSec);
			}
			out.push({start, end});
		}
	}
	return out.sort((a, b) => a.start - b.start);
};

export type LevelOptions = {
	/** frames within this many dB of the loud level (95th percentile) count as speech. Default 30. */
	rangeDb?: number;
	/** and above this absolute level (dBFS). Default -55. */
	floorDb?: number;
	/** drop speech runs shorter than this (ms). Default 80. */
	minSpeechMs?: number;
};

/**
 * Speech spans from a level track (dBFS per hop, e.g. band-limited RMS every 10 ms), the same rule as
 * the audio engine's voice_activity (scripts/audio/audiolib/duck.py): loud-relative threshold, absolute
 * floor, short runs dropped. Gap filling is left to the duck (DuckTiming.minGapMs).
 */
export const speechSpansFromLevels = (levelsDb: ArrayLike<number>, hopSec: number, opts: LevelOptions & {offsetSec?: number; windowSec?: number} = {}): Span[] => {
	const n = levelsDb.length;
	if (n === 0) return [];
	const sorted = Array.from(levelsDb).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	if (!sorted.length) return [];
	const loud = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))];
	const thr = Math.max(loud - (opts.rangeDb ?? 30), opts.floorDb ?? -55);
	const minRun = Math.max(1, Math.round((opts.minSpeechMs ?? 80) / 1000 / hopSec));
	const win = opts.windowSec ?? hopSec;
	const off = opts.offsetSec ?? 0;
	const out: Span[] = [];
	let on = -1;
	for (let i = 0; i <= n; i++) {
		const sp = i < n && levelsDb[i] > thr;
		if (sp && on < 0) on = i;
		else if (!sp && on >= 0) {
			if (i - on >= minRun) out.push({start: off + on * hopSec, end: off + (i - 1) * hopSec + win});
			on = -1;
		}
	}
	return out;
};

/**
 * Band-limited (150 Hz-4 kHz) RMS level in dBFS every `hopSec`, over `windowSec` windows: the input of
 * speechLevels' caller speechSpansFromLevels, measured as the engine does. `samples` is mono.
 *
 * One streaming pass (biquad state in float64, squares accumulated at the window edges only), so a
 * ten-minute narration costs a few kilobytes beyond its own samples: it runs inside a render tab.
 */
export const speechLevels = (samples: ArrayLike<number>, sampleRate: number, hopSec = 0.01, windowSec = 0.03): Float64Array => {
	const n = samples.length;
	const hop = Math.max(1, Math.round(hopSec * sampleRate));
	const w = Math.max(hop, Math.round(windowSec * sampleRate));
	const frames = n >= w ? Math.floor((n - w) / hop) + 1 : 0;
	const out = new Float64Array(frames);
	if (!frames) return out;
	const sections: Biquad[] = [...butterHighpass(150, 2, sampleRate), ...butterLowpass(4000, 2, sampleRate)];
	const z1 = new Float64Array(sections.length);
	const z2 = new Float64Array(sections.length);
	// cumulative energy sampled where windows start (k * hop) and end (k * hop + w)
	const atStart = new Float64Array(frames);
	const atEnd = new Float64Array(frames);
	let cum = 0;
	let nextStart = 0; // index into atStart
	let nextEnd = 0; // index into atEnd
	for (let i = 0; i <= n; i++) {
		// cum = sum of y^2 over [0, i)
		while (nextStart < frames && nextStart * hop === i) atStart[nextStart++] = cum;
		while (nextEnd < frames && nextEnd * hop + w === i) atEnd[nextEnd++] = cum;
		if (i === n || nextEnd >= frames) break;
		let y = samples[i];
		for (let s = 0; s < sections.length; s++) {
			const q = sections[s];
			const v = y;
			y = q.b0 * v + z1[s];
			z1[s] = q.b1 * v - q.a1 * y + z2[s];
			z2[s] = q.b2 * v - q.a2 * y;
		}
		cum += y * y;
	}
	for (let f = 0; f < frames; f++) out[f] = 10 * Math.log10(Math.max((atEnd[f] - atStart[f]) / w, 1e-24));
	return out;
};

/** Mono mix (mean of channels) of decoded audio. */
export const monoMix = (channels: readonly ArrayLike<number>[]): Float32Array => {
	if (!channels.length) return new Float32Array(0);
	if (channels.length === 1) return Float32Array.from(channels[0]);
	const n = channels[0].length;
	const out = new Float32Array(n);
	for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
	return out;
};

/** Speech spans of a narration from its audio (RMS levels), relative to the file's start plus `offsetSec`. */
export const speechSpansFromAudio = (channels: readonly ArrayLike<number>[], sampleRate: number, opts: LevelOptions & {offsetSec?: number; hopSec?: number; windowSec?: number} = {}): Span[] => {
	const hop = opts.hopSec ?? 0.01;
	const win = opts.windowSec ?? 0.03;
	const levels = speechLevels(monoMix(channels), sampleRate, hop, win);
	return speechSpansFromLevels(levels, Math.max(1, Math.round(hop * sampleRate)) / sampleRate, {...opts, windowSec: Math.max(1, Math.round(win * sampleRate)) / sampleRate});
};
