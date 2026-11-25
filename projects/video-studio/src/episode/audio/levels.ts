/**
 * The story beds' loudness over their loops (bedLevels.json, written by tools/bed_levels.py from the delivered FLACs),
 * and the two estimates the planner makes from it (pure):
 *  - a bed's level under a stretch of time, on the episode's clock (for the whoosh cap and the clock choice);
 *  - the worst spoken phrase's voice-over-bed margin for a clock offset (critic F10).
 * Levels are K-weighted loudness of 0.4 s hops, channels summed; averages are taken in power.
 */
import {BED_UNDER_VOICE, FPS, LOOP_SEC} from './constants.ts';

export type BedLevelTable = {
	version: 1;
	sampleRate: number;
	hopSamples: number;
	hopFrames: number;
	duck: {crossoversHz: number[]; depthsDb: number[]};
	beds: Record<string, {file: string; sha256: string; loopSec: number; lufs: number[]; lufsDucked: number[]}>;
};

const toPower = (lufs: number) => 10 ** ((lufs + 0.691) / 10);
const toLufs = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, 1e-30));

/**
 * The loudness (LUFS) of bed `cue` over composition seconds [t0, t1) on a clock offset of `offsetSec`, ducked or as
 * played. Sampled every 0.1 s, averaged in power. null when the table has no such bed.
 */
export const bedLufsOver = (table: BedLevelTable, cue: string, t0: number, t1: number, offsetSec: number, ducked: boolean): number | null => {
	const b = table.beds[cue];
	if (!b) return null;
	const hops = ducked ? b.lufsDucked : b.lufs;
	const hopSec = table.hopSamples / table.sampleRate;
	const step = 0.1;
	let sum = 0;
	let n = 0;
	for (let t = t0; t < Math.max(t1, t0 + step / 2); t += step) {
		const pos = (((offsetSec + t) % LOOP_SEC) + LOOP_SEC) % LOOP_SEC;
		sum += toPower(hops[Math.min(hops.length - 1, Math.floor(pos / hopSec + 1e-9))]);
		n++;
	}
	return toLufs(sum / n);
};

/** A bed's loudness over its whole loop (LUFS, power mean of the hops), ducked or as played; null when not in the table. */
export const bedLoopLufs = (table: BedLevelTable, cue: string, ducked: boolean): number | null => {
	const b = table.beds[cue];
	if (!b) return null;
	const hops = ducked ? b.lufsDucked : b.lufs;
	return toLufs(hops.reduce((s, x) => s + toPower(x), 0) / hops.length);
};

/**
 * The trim (dB, 0 or below, 0.1 dB steps) that puts bed `cue` under the voice at BED_UNDER_VOICE.targetDuckedLufs, so a
 * mood change never changes how far Zoo sits over the music. 0 for a bed the table does not know.
 */
export const bedTrimDb = (table: BedLevelTable, cue: string): number => {
	const l = bedLoopLufs(table, cue, true);
	if (l === null) return 0;
	const t = Math.max(-BED_UNDER_VOICE.maxCutDb, Math.min(0, BED_UNDER_VOICE.targetDuckedLufs - l));
	return Math.round(t * 10) / 10 || 0;
};

/** A phrase and the bed under it (`levelDb`: the bed's trim in the mix, default 0). */
export type PhraseBed = {start: number; end: number; cue: string | null; levelDb?: number};

/**
 * The voice-over-bed margin (LU) of each phrase for a clock offset: the voice at `voiceLufs` against the ducked bed that
 * plays under it (phrases without a bed are skipped). Returns the worst margin and its phrase. An estimate: it leaves
 * out the effects and the phrase-to-phrase variation of the voice, so the planner asks it for 2 LU more than the gate.
 */
export const worstPhraseMargin = (table: BedLevelTable, phrases: readonly PhraseBed[], offsetSec: number, voiceLufs: number): {marginLu: number; at: number} => {
	let worst = Infinity;
	let at = 0;
	for (const p of phrases) {
		if (!p.cue) continue;
		const bed = bedLufsOver(table, p.cue, p.start, p.end, offsetSec, true);
		if (bed === null) continue;
		const m = voiceLufs - (bed + (p.levelDb ?? 0));
		if (m < worst) {
			worst = m;
			at = p.start;
		}
	}
	return {marginLu: worst, at};
};

/** Frames of composition time per 0.4 s hop (12 at 30 fps), for callers working in frames. */
export const HOP_FRAMES = Math.round(0.4 * FPS);
