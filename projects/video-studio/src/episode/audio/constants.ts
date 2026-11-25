/**
 * The Episode's sound rules as numbers (pure). Every value here is a decision of the episode audio design
 * (docs/EPISODE_ENGINE.md, "Sound") with the critic round that set it; the planner (plan.ts), the tests and the gate
 * (tools/audio_check.py reads them from the plan JSON) share them.
 */

export const FPS = 30;
export const SAMPLE_RATE = 48000;
export const SAMPLES_PER_FRAME = SAMPLE_RATE / FPS; // 1600

/** The story beds' grid at 75 BPM, 4/4: a beat is 24 frames, a bar 96 (3.2 s), a 4-bar phrase 384 (12.8 s), the loop 64 s. */
export const BEAT_FRAMES = 24;
export const BAR_FRAMES = 96;
export const PHRASE_FRAMES = 384;
export const LOOP_SEC = 64;
export const LOOP_FRAMES = LOOP_SEC * FPS;

/** Moods by act, not by template (critic F4): a region lasts at least 8 bars unless the writer set it, and the bed changes at most once a minute. */
export const MIN_REGION_FRAMES = 8 * BAR_FRAMES; // 768 frames, 25.6 s: the beds' own sections are 8 bars
export const MIN_CHANGE_SPACING_FRAMES = 60 * FPS; // 1800 frames

/** Bed changes only in the voice-free window between two scenes: at most one beat (24 f), at least 9 f, one guard frame each side. */
export const XFADE = {maxFrames: 24, minFrames: 9, guardFrames: 1} as const;

/**
 * The duck every bed uses: the band-split duck the voice gate measured (2 / 12 / 4 dB below 700 Hz / 700 Hz-5 kHz /
 * above 5 kHz), 120 ms attack with 120 ms lookahead, 1.2 s release. Pauses under 2 s stay ducked (critic F3: the
 * 0.8 s of the design let the bed swell in the deadpan pauses a writer adds), and the planner holds it through every
 * scene change shorter than 3 s and through every reaction beat.
 */
export const DUCK = {split: true, depthDb: 12, depthsDb: [2, 12, 4] as const, attackMs: 120, releaseMs: 1200, minGapMs: 2000} as const;
/** A word's span for the duck: its start to its end + 60 ms (the release of its last phoneme). */
export const WORD_PAD_END_SEC = 0.06;
/** Scene changes with less speech-free time than this keep the duck held across them (critic F3). */
export const HOLD_PAUSE_MAX_SEC = 3;
/** Frames after Badger's reaction (and after Zoo's turn + 10) the duck stays held: the joke lands on a steady bed. */
export const BEAT_HOLD_FRAMES = 30;
export const BEAT_LEAD_FRAMES = 6;

/** The opening bed fades in over the first sentence, from silence, never shorter than 1 s (critic F5). */
export const OPENING_FADE = {minMs: 1000, maxMs: 4000} as const;
/** Without an end screen the last bed fades over the final voice-free tail; a Short's over its last 12 frames or fewer. */
export const END_FADE_FRAMES = {episode: 24, short: 12} as const;

/**
 * End screen (critic F7: Zoora AI's own major motif, not the show's minor cadence): resolve-underscore under the outro
 * line, then, once the duck has released, an equal-power "music up" of 2 beats to the motif version on a bar line,
 * +8 dB (about -19 LUFS, the end-screen music level), faded out over the last 2 s so it ends on the last frame.
 */
export const END_SCREEN = {under: 'bed-story-resolve-underscore', up: 'bed-story-resolve', upFrames: 2 * BEAT_FRAMES, liftDb: 8, finalFadeFrames: 60} as const;

/**
 * Every story bed sits under the voice at the same loudness (measured 2026-11-25, docs/EPISODE_ENGINE.md §12): the
 * tension and ominous underscores play 2.2-2.5 dB louder under the duck than curious, which put correct mixes under the
 * gate's worst-phrase and index lines. A bed is trimmed (never raised) so its ducked loudness over the loop
 * (bedLevels.json) is the curious underscore's, -30.8 LUFS; the end screen's music-up stays relative to the file.
 */
export const BED_UNDER_VOICE = {targetDuckedLufs: -30.8, maxCutDb: 4} as const;

/** Rests dip the bed this far instead of to silence (critic F18: Kokoro's pauses are digital zero). */
export const REST_FLOOR_DB = -18;

/** After 2 full loops (128 s) of one region the bed rests for a scene and at least 8 bars, then re-enters on a phrase start under the duck (critic F20). */
export const MUSIC_OUT = {afterFrames: 2 * LOOP_FRAMES, minFrames: MIN_REGION_FRAMES, fadeInFrames: 2 * BEAT_FRAMES} as const;

/**
 * Sound effects (critics F2, F8, F9, F19): restraint first.
 *  - at most 3 in any 10 s and 6 in any minute, 6 frames apart, 6 per scene;
 *  - a list item's pop only where Zoo is silent for 4 frames, at most 1 frame before and 4 after the reveal (audio
 *    leading the picture by more than about 45 ms reads as early, ITU-R BT.1359), else no sound;
 *  - nothing within 0.5 s of a spoken disclosure.
 */
export const SFX_RULES = {per10s: 3, perMinute: 6, perScene: 6, minSpacingFrames: 6, gapHoldFrames: 4, earliestFrames: 1, latestFrames: 4, protectSec: 0.5} as const;

/** Levels in 200 ms K-weighted loudness (the SFX library's measure). A whoosh is also capped at 6 LU over the bed under it. */
export const SFX_LEVELS = {itemLufs: -30, wipeMaxLufs: -24, slideMaxLufs: -30, accentLufs: -32, overBedMaxLu: 6} as const;

/** Which sound each event gets. A list is a pitch-stable soft pop (D5, in every story bed's key), never a rising arpeggio (F2). */
export const SFX_SOUNDS = {item: 'pop', wipe: 'whoosh_short', slide: 'whoosh_short_04', press: 'mouse_click', rug: 'tick_05'} as const;

/** Frames after a whoosh's pass-by until it is 20 dB under its peak (measured from the WAVs; tests re-derive them). */
export const WHOOSH_TAIL_FRAMES: Readonly<Record<string, number>> = {
	whoosh_short_01: 6,
	whoosh_short_02: 6,
	whoosh_short_03: 6,
	whoosh_short_04: 7,
};

/**
 * The clock: every bed plays position (offset + t) mod 64 s, offset = k x 12.8 s. Candidates in a seeded order, the
 * base section (k 0 or 1) first (critic F5); the first whose estimated worst phrase clears the gate's line by 2 LU wins
 * (F10); storyboard.music.offset overrides.
 */
export const CLOCK = {phrases: 5, phraseSec: PHRASE_FRAMES / FPS, estimateLineLu: 14} as const;

/** The brand sting (opt-in, off by default: critic F6). */
export const STING = {
	cue: 'intro-sting-zoora',
	frames: 135,
	minStartFrame: 60,
	fictionCardFrames: 170,
	afterReactionFrames: 30,
	guardFrames: 3,
	fadeOutMs: 500,
	fadeInMs: 600,
	firstSec: 12,
	maxSilentSecInFirst: 4,
} as const;

/**
 * The gate's lines (tools/audio_check.py reads them from the plan). Calibrated 2026-11-25 (critic F1, after the clock
 * fix F10) on the demo: 60 correct mixes (en, es, pt-br × the 4 moods × the 5 clock phrases, beds trimmed) and 40
 * wrong-duck controls (es and pt-br under the English duck), rebuilt from their plans by tools/audio_sim.py. The
 * loudness and index lines overlap between the two sets (a wrong duck under these quiet underscores costs about 1 LU
 * overall); two lines separate them: duck coverage (correct 100 %, controls 72.8-74.8 %) and the worst phrase's 1-4 kHz
 * ratio (correct 13.3-19.1 dB, controls 2.3-12.1 dB), so every control fails both, besides the null test that catches a
 * render differing from its plan. indexP10 sits at 0.45: one correct mix measured 0.475. docs/EPISODE_ENGINE.md §12.5.
 */
export const GATE = {
	loudnessLufs: -14,
	loudnessTolLu: 0.5,
	truePeakMaxDbtp: -1,
	voiceOverRestMinLu: 10,
	voiceOverRestWarnLu: 14,
	worstPhraseMinLu: 12,
	worstPhraseWarnLu: 13,
	indexMin: 0.75,
	indexP10Min: 0.45,
	framesUnder3dBMax: 0.16,
	worstPhraseSnrMinDb: 12.5,
	worstPhraseSnrWarnDb: 13,
	phoneVoiceOverRestWarnLu: 12,
	duckCoverageMin: 0.98,
	voiceFreeMaxDbfs: -60,
	nullResidualMaxDbfs: -60,
	sfxMaskPassDb: 10,
	sfxMaskFailDb: 6,
	protectVoiceOverRestLu: 15,
	protectSnr1to4kDb: 15,
	streamWarnDbtp: -0.5,
	streamFailDbtp: 0,
} as const;
