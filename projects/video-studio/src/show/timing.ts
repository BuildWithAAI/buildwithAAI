/**
 * Scene spans on the frame grid (pure). The show never moves or stretches audio: every scene is exactly its timeline
 * window (timeline.startMs / durationMs, the voice step's output), so the rendered video keeps the timeline's timing
 * and the publish kit's chapters and subtitles stay in sync. Comic pauses are authored, not inserted: a `beat` scene
 * is a silent scene (empty narration + minDurationSec) that the voice step already turns into timeline time.
 *
 *  - ShowEpisode: one span per timeline scene, at its own audio position.
 *  - ShowShort: the scenes listed in storyboard.shorts[shortId], back to back from frame 0. The outro's end-screen hold
 *    (silent, up to 20 s, only useful in the landscape episode) is trimmed to 1.5 s after its speech.
 * Transitions overlap VISUALS only (the outgoing scene stays drawn under the incoming one), as in the episode engine.
 */
import type {ShowSegment, ShowStoryboard, Timeline} from './types.ts';
import {segmentOf} from './segments.ts';
import {msToFrame} from '../episode/motion.ts';

export type TransitionKind = 'cut' | 'fade' | 'slide' | 'wipe';
export const TRANSITION_FRAMES: Record<TransitionKind, number> = {cut: 0, fade: 12, slide: 18, wipe: 18};

/** A Short keeps this much of the outro after its last word (frames), and at least OUTRO_MIN_FRAMES in all. */
export const OUTRO_SHORT_TAIL = 45;
export const OUTRO_MIN_FRAMES = 60;

export type ShowSpan = {
	index: number; // index into storyboard.scenes and timeline.scenes
	id: string;
	segment: ShowSegment;
	from: number; // first frame in THIS composition
	durationInFrames: number; // frames this scene is shown (a Short's outro may be trimmed)
	sceneFrames: number; // the scene's full timeline length
	srcFrom: number; // first frame of the scene in the full timeline (audio offset)
	transition: TransitionKind;
	transitionFrames: number;
	tail: number; // frames this scene stays drawn under the NEXT scene's transition
};

const window = (tl: Timeline, index: number, fps: number) => {
	const s = tl.scenes[index];
	const from = msToFrame(s.startMs, fps);
	const to = msToFrame(s.startMs + s.durationMs, fps);
	return {from, frames: Math.max(1, to - from)};
};

const finish = (raw: Array<Omit<ShowSpan, 'transition' | 'transitionFrames' | 'tail'> & {want: TransitionKind}>): ShowSpan[] => {
	const spans: ShowSpan[] = raw.map((r, k) => {
		const kind: TransitionKind = k === 0 ? 'cut' : r.want;
		const cap = k === 0 ? 0 : Math.floor(Math.min(raw[k - 1].durationInFrames, r.durationInFrames) / 2);
		const t = Math.min(TRANSITION_FRAMES[kind], cap);
		const {want: _w, ...rest} = r;
		void _w;
		return {...rest, transition: t > 0 ? kind : 'cut', transitionFrames: t, tail: 0};
	});
	spans.forEach((s, k) => {
		if (k + 1 < spans.length) s.tail = spans[k + 1].transitionFrames;
	});
	return spans;
};

const wantOf = (sb: ShowStoryboard, index: number): TransitionKind => sb.scenes[index].transitionIn ?? 'cut';

export const episodeSpans = (sb: ShowStoryboard, tl: Timeline, fps: number): ShowSpan[] =>
	finish(
		tl.scenes.map((s, index) => {
			const w = window(tl, index, fps);
			return {index, id: s.id, segment: segmentOf(sb.scenes[index]), from: w.from, durationInFrames: w.frames, sceneFrames: w.frames, srcFrom: w.from, want: wantOf(sb, index)};
		}),
	);

/** Frames the Short keeps of an outro scene: its speech plus OUTRO_SHORT_TAIL, at least OUTRO_MIN_FRAMES. */
export const outroShortFrames = (speechMs: number, sceneFrames: number, fps: number): number =>
	Math.min(sceneFrames, Math.max(OUTRO_MIN_FRAMES, msToFrame(speechMs, fps) + OUTRO_SHORT_TAIL));

export const shortSpans = (sb: ShowStoryboard, tl: Timeline, shortId: string, fps: number): ShowSpan[] => {
	const short = (sb.shorts ?? []).find((x) => x.id === shortId);
	if (!short) throw new Error(`storyboard has no short "${shortId}" (it has: ${(sb.shorts ?? []).map((x) => x.id).join(', ') || 'none'})`);
	let at = 0;
	return finish(
		short.sceneIds.map((id) => {
			const index = tl.scenes.findIndex((s) => s.id === id);
			if (index < 0) throw new Error(`short "${shortId}": scene "${id}" is not in the timeline`);
			const w = window(tl, index, fps);
			const segment = segmentOf(sb.scenes[index]);
			const frames = segment === 'outroEndScreen' ? outroShortFrames(tl.scenes[index].speechMs, w.frames, fps) : w.frames;
			const span = {index, id, segment, from: at, durationInFrames: frames, sceneFrames: w.frames, srcFrom: w.from, want: wantOf(sb, index)};
			at += frames;
			return span;
		}),
	);
};

export const spansFrames = (spans: ShowSpan[]): number => (spans.length ? spans[spans.length - 1].from + spans[spans.length - 1].durationInFrames : 1);

/** The span showing composition frame f (the incoming scene wins during a transition overlap). */
export const spanAt = (spans: ShowSpan[], f: number): ShowSpan | null => {
	let hit: ShowSpan | null = null;
	for (const s of spans) if (f >= s.from && f < s.from + s.durationInFrames) hit = s;
	return hit;
};

/** ShowShort length rules: 45-60 s is the daily format (warning outside it); Shorts may not exceed 3 minutes. */
export const SHORT_TARGET_SEC = {min: 45, max: 60, hardMax: 180} as const;
