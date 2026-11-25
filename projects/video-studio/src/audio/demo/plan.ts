/**
 * The AudioDemo cue sheet, derived from the narration timeline (pure; tested in tests/demo.test.ts).
 *
 *   theme sting -> slide (whoosh) -> line 1 over the ducked bed -> 3 bullets (rising pops)
 *   -> Rekt Meter bumper (the bed rests) -> wipe (whoosh) -> line 2 over the ducked bed
 *   -> typing beat (frame-locked keys, Enter) -> theme button (the bed fades under it) -> end
 *
 * Everything is in frames at 30 fps; speech spans and rests in seconds (absolute).
 */
import type {Rest, Span} from '../core/envelope.ts';
import {planBed, type BedPlan, type LiftSpec} from '../core/bed.ts';
import {placeStinger as place, stingerRest, type MusicManifest, type StingerPlacement} from '../core/music.ts';
import {resolveCue} from '../core/music.ts';
import {sfxForBulletReveal, sfxForTransition, typingClicks, type SfxCue, type SfxManifest, type TypingCue} from '../core/sfx.ts';
import {speechSpansFromScenes} from '../core/speech.ts';

export const DEMO_FPS = 30;

/** The narration timeline fields the demo reads (voice step output, src/episode/types.ts Timeline). */
export type DemoTimeline = {
	scenes: ReadonlyArray<{id: string; audio: string; durationMs: number; speechMs: number; words: ReadonlyArray<{text: string; startMs: number; endMs: number}>}>;
};

export type DemoLine = {id: string; audio: string; from: number; durationInFrames: number; words: DemoTimeline['scenes'][number]['words']; text: string};
export type DemoSection = {id: string; title: string; from: number; to: number};

export type DemoPlan = {
	fps: number;
	durationInFrames: number;
	sting: StingerPlacement;
	bumper: StingerPlacement;
	outro: StingerPlacement;
	/** startAtSec: where in the bed it starts (a bar line before the loop end, so the demo crosses the loop seam) */
	bed: {id: string; from: number; durationInFrames: number; fadeInMs: number; fadeOutMs: number; rests: Rest[]; speech: Span[]; startAtSec: number; lift: LiftSpec};
	lines: DemoLine[];
	transitions: Array<{type: 'slide' | 'wipe'; at: number; frames: number; cue: SfxCue}>;
	bullets: Array<{text: string; at: number; cue: SfxCue}>;
	typing: {from: number; to: number; text: string; cues: TypingCue[]};
	sections: DemoSection[];
};

export const DEMO_BULLETS = ['Countdown pressure', 'A wallet signature', 'Too-good returns'] as const;
export const DEMO_TYPED = 'check it twice\n';
export const DEMO_TYPING_KEYS_PER_SEC = 6.5;
/** Music up in the demo's music-only stretches (the bullets, the typing beat); the master step catches the peaks. */
export const DEMO_LIFT: LiftSpec = {db: 6};
export const DEMO_BED = 'bed-show-neutral-underscore';
/**
 * The bed enters on its loop's last bar (90 BPM, 4/4: 2.667 s), a pickup into the top of the loop, so the demo crosses
 * the loop seam 2.667 s after the bed starts, under line 1, where the bed is audible: the render proves the seam.
 */
export const DEMO_BED_START_SEC = 64 - (4 * 60) / 90;

const frames = (ms: number, fps: number) => Math.round((ms / 1000) * fps);

export const demoPlan = (tl: DemoTimeline, sfx: SfxManifest, music: MusicManifest, fps = DEMO_FPS): DemoPlan => {
	if (tl.scenes.length < 2) throw new Error('the demo needs two narration lines (scenes s01 and s02)');
	const [s1, s2] = tl.scenes;
	const sections: DemoSection[] = [];

	// 1. theme sting: its downbeat on frame 0
	const sting = place(resolveCue(music, 'intro-sting-show'), 0, fps);
	const stingEnd = sting.from + sting.durationInFrames;
	sections.push({id: 'sting', title: 'Theme sting', from: 0, to: stingEnd});

	// 2. a slide into line 1, centred on the sting's end; the whoosh passes mid-slide
	const slide = {type: 'slide' as const, at: stingEnd - 9, frames: 18};
	const line1From = stingEnd + 15;
	const line1: DemoLine = {id: s1.id, audio: s1.audio, from: line1From, durationInFrames: frames(s1.durationMs, fps), words: s1.words, text: s1.words.map((w) => w.text).join(' ')};
	const speech1End = line1From + frames(s1.words[s1.words.length - 1].endMs, fps);
	sections.push({id: 'line1', title: 'Narration over the ducked bed', from: slide.at, to: speech1End + 18});

	// 3. three bullets in the pause after line 1, once the bed is back up (450 ms release), then the
	//    bed alone for a moment (its undiminished level, before it steps out)
	const bulletAt = DEMO_BULLETS.map((_, i) => speech1End + 27 + i * 24);
	sections.push({id: 'bullets', title: 'Three bullets', from: speech1End + 18, to: bulletAt[2] + 51});

	// 4. Rekt Meter bumper: the bed steps out for it
	const bumper = place(resolveCue(music, 'bumper-rekt-meter'), bulletAt[2] + 60, fps);
	sections.push({id: 'bumper', title: 'Rekt Meter bumper', from: bulletAt[2] + 51, to: bumper.from + bumper.durationInFrames});

	// 5. a wipe into line 2 as the bumper's tail decays
	const bumperEnd = bumper.from + bumper.durationInFrames;
	const wipe = {type: 'wipe' as const, at: bumperEnd - 9, frames: 18};
	const line2From = bumperEnd + 12;
	const line2: DemoLine = {id: s2.id, audio: s2.audio, from: line2From, durationInFrames: frames(s2.durationMs, fps), words: s2.words, text: s2.words.map((w) => w.text).join(' ')};
	const speech2End = line2From + frames(s2.words[s2.words.length - 1].endMs, fps);
	sections.push({id: 'line2', title: 'Narration over the ducked bed', from: wipe.at, to: speech2End + 12});

	// 6. typing beat over the bed
	const typeFrom = speech2End + 30;
	const typeTo = typeFrom + 90;
	const typingCues = typingClicks(sfx, typeFrom, typeTo, DEMO_TYPING_KEYS_PER_SEC, {scene: 'demo-typing', text: DEMO_TYPED, fps});
	const typedEnd = typingCues.length ? typingCues[typingCues.length - 1].at : typeFrom;
	sections.push({id: 'typing', title: 'Typing beat', from: speech2End + 12, to: typedEnd + 15});

	// 7. theme button: the bed fades out under it and the demo ends on its tail
	const outro = place(resolveCue(music, 'theme-5s'), typedEnd + 66, fps);
	const end = outro.from + outro.durationInFrames + 15;
	sections.push({id: 'outro', title: 'Theme button', from: typedEnd + 15, to: end});

	const bedFrom = slide.at;
	const speech = speechSpansFromScenes([
		{atSec: line1.from / fps, untilSec: (line1.from + line1.durationInFrames) / fps, words: line1.words},
		{atSec: line2.from / fps, untilSec: (line2.from + line2.durationInFrames) / fps, words: line2.words},
	]);
	const bumperRest = stingerRest(bumper, fps);
	// the bed ends under the theme button: out 0.6 s before its downbeat, done before its first hit lands
	const bedEnd = outro.downbeat - 6;
	return {
		fps,
		durationInFrames: end,
		sting,
		bumper,
		outro,
		bed: {id: DEMO_BED, from: bedFrom, durationInFrames: bedEnd - bedFrom, fadeInMs: 500, fadeOutMs: 1400, rests: [bumperRest], speech, startAtSec: DEMO_BED_START_SEC, lift: DEMO_LIFT},
		lines: [line1, line2],
		transitions: [slide, wipe].map((t) => {
			const cue = sfxForTransition(sfx, t.type, {at: t.at, frames: t.frames, scene: `demo-${t.type}`, fps});
			if (!cue) throw new Error(`no SFX for ${t.type}`);
			return {...t, cue};
		}),
		bullets: DEMO_BULLETS.map((text, i) => ({text, at: bulletAt[i], cue: sfxForBulletReveal(sfx, {at: bulletAt[i], index: i, count: DEMO_BULLETS.length, scene: 'demo-bullets', fps})})),
		typing: {from: typeFrom, to: typeTo, text: DEMO_TYPED, cues: typingCues},
		sections,
	};
};

/** The bed's gain law exactly as <MusicBed> builds it from these props (the panel and the measurement use it too). */
export const demoBedPlan = (p: DemoPlan): BedPlan =>
	planBed({
		start: p.bed.from / p.fps,
		end: (p.bed.from + p.bed.durationInFrames) / p.fps,
		duck: {speech: p.bed.speech},
		lift: p.bed.lift,
		rests: p.bed.rests,
		fadeInMs: p.bed.fadeInMs,
		fadeOutMs: p.bed.fadeOutMs,
	});

/** Every SFX cue of the plan, in time order (whooshes, pops, keys). */
export const planSfx = (p: DemoPlan): SfxCue[] => [...p.transitions.map((t) => t.cue), ...p.bullets.map((b) => b.cue), ...p.typing.cues].sort((a, b) => a.from - b.from);
