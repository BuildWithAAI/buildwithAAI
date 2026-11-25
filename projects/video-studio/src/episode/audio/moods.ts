/**
 * The Zoora AI story beds and what the planner needs to know about their music (pure).
 *
 * Moods: curious (F lydian), tension (D minor), ominous (D phrygian), resolve (D major), all 75 BPM 64 s loops with the
 * downbeat on sample 0, so they share one clock. Under narration only the -underscore versions play (motif and lead
 * lines muted: the CLAUDE.md mixing rule).
 *
 * Harmony: the pitch classes each underscore bed sounds in each of its 20 bars, transcribed from the composer's score
 * (scripts/audio/music/composer/cues/zoora.py: CURIOUS, the tension progression and ostinati, the ominous drones and
 * piano, RESOLVE). A bed change crossfades two beds at the SAME bar of the loop (one clock), so the planner can ask
 * whether the two bars clash: a pitch class one bed adds a semitone from a pitch class the other adds (a minor second
 * or a minor ninth that neither bed already holds on its own). Clashing pairs overlap briefly, staggered (a short
 * "breath", listed in the cue sheet); the others crossfade in full (critic F12: decide from the actual pitch content,
 * not the scale).
 * A re-composed bed must update HARMONY: bedLevels.json records each file's sha256 and the tests fail on a changed bed.
 */
import {BAR_FRAMES, FPS, LOOP_SEC} from './constants.ts';

export type StoryBed = 'curious' | 'tension' | 'ominous' | 'resolve';
export const STORY_BEDS: readonly StoryBed[] = ['curious', 'tension', 'ominous', 'resolve'];
/** A scene's music: a story bed, no music, or the end screen's music. */
export type Mood = StoryBed | 'none' | 'end';

/** The bed a mood plays under narration. */
export const underscoreOf = (m: StoryBed): string => `bed-story-${m}-underscore`;

// pitch classes: C 0, C# 1, D 2, Eb 3, E 4, F 5, F# 6, G 7, Ab 8, A 9, Bb 10, B 11
const C = 0, Cs = 1, D = 2, Eb = 3, E = 4, F = 5, Fs = 6, G = 7, Ab = 8, A = 9, Bb = 10, B = 11;

const bars = (spec: Array<[number[], number[]]>): number[][] => {
	const out: number[][] = Array.from({length: 20}, () => []);
	for (const [which, pcs] of spec) for (const b of which) out[b] = [...new Set([...out[b], ...pcs])].sort((x, y) => x - y);
	return out;
};

/** Pitch classes sounding in each of the 20 bars of each underscore bed (the score, not an analysis of the audio). */
export const HARMONY: Readonly<Record<string, readonly (readonly number[])[]>> = {
	// curious: the harp arpeggio, pizzicato root and pad, two bars per chord; the B of bars 0/1/8/9/16/17 is a D in the
	// score (no lydian B under the motif), and the underscore has no B at all; a glockenspiel A over bar 4
	'bed-story-curious-underscore': bars([
		[[0, 1, 8, 9, 16, 17], [F, C, G, A, D]],
		[[2, 3, 10, 11], [D, A, F, C, E]],
		[[4, 5, 12, 13], [Bb, F, C, D, E]],
		[[4], [A]],
		[[6, 7, 14, 15, 18, 19], [C, G, Bb, D, F]],
	]),
	// tension: | D | D | Bb | Bb | G | G | A | A | twice, then D D Bb A; the celli ostinato (an Eb over D, a C# over A),
	// the violas' tremolo in bars 8-15, the violins' A and Bb in bars 16-19
	'bed-story-tension-underscore': bars([
		[[0, 1, 8, 9, 16, 17], [D, A, Eb]],
		[[8, 9], [F]],
		[[2, 3, 10, 11, 18], [D, Bb, F]],
		[[4, 5, 12, 13], [D, G, Bb, A]],
		[[6, 7, 14, 15, 19], [Cs, A, E, Bb]],
	]),
	// ominous: D and F drones and the bowed D/A drone throughout; the piano's A-flat in bars 2-3, 6-7, 10-11, 14-15 and
	// 18-19; E-flat on the glockenspiel (bar 6), the bowed vibes (bars 9-12) and the violins (bars 18-19)
	'bed-story-ominous-underscore': bars([
		[[...Array(20).keys()], [D, F, A]],
		[[2, 3, 6, 7, 10, 11, 14, 15, 18, 19], [Ab]],
		[[6, 9, 10, 11, 12, 18, 19], [Eb]],
	]),
	// resolve: | Dmaj9 | A/C# | Bm9 | Gmaj7#11 | Em9 | A7sus4 | D/F# | Gmaj9 | twice, then Gmaj9 Em9 A7sus4 A7sus4 with
	// the harp lift and the violins' B, C# and A
	'bed-story-resolve-underscore': bars([
		[[0, 8], [D, A, E, Fs, B]],
		[[1, 9], [Cs, A, E]],
		[[2], [B, Fs, D, A, Cs]],
		[[10], [B, Fs, D, Cs]],
		[[3, 11, 7, 15, 16], [G, D, A, B, Fs]],
		[[4, 12, 17], [E, B, G, D, Fs]],
		[[5, 13, 18, 19], [A, E, G, B, D]],
		[[6, 14], [Fs, D, A]],
		[[16], [E]],
		[[18], [Cs]],
	]),
};

/** The loop bar (0-19) sounding at composition frame `frame` on a clock offset of `offsetSec`. */
export const loopBarAt = (frame: number, offsetSec: number): number => {
	const pos = (((offsetSec + frame / FPS) % LOOP_SEC) + LOOP_SEC) % LOOP_SEC;
	return Math.min(19, Math.floor((pos * FPS) / BAR_FRAMES + 1e-9));
};

/** Semitone clashes between two underscore beds over the loop bars of [from, to) frames: pairs [pcA, pcB]. */
export const harmonicClashes = (cueA: string, cueB: string, from: number, to: number, offsetSec: number): Array<[number, number]> => {
	const ha = HARMONY[cueA];
	const hb = HARMONY[cueB];
	if (!ha || !hb) return [];
	const barsHit = new Set<number>();
	for (let f = from; f < Math.max(from + 1, to); f++) barsHit.add(loopBarAt(f, offsetSec));
	const out: Array<[number, number]> = [];
	for (const bar of barsHit) {
		const a = new Set(ha[bar]);
		const b = new Set(hb[bar]);
		const onlyA = [...a].filter((x) => !b.has(x));
		const onlyB = [...b].filter((x) => !a.has(x));
		for (const x of onlyA) for (const y of onlyB) if ((x - y + 12) % 12 === 1 || (y - x + 12) % 12 === 1) out.push([x, y]);
	}
	return out;
};

export const PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
