/**
 * Scene spans on the frame grid (pure). Audio is never moved: every scene starts on the exact frame of its own audio
 * (timeline.startMs). A transition only OVERLAPS VISUALS: the outgoing scene keeps rendering for the incoming scene's
 * transition frames (its trailing pad), while the incoming scene starts on time on top of it. So the total length and
 * the audio sync are the same as with hard cuts (unlike TransitionSeries, which shortens the timeline).
 */
import type {SceneType, Storyboard, StoryboardScene, Timeline, TimelineScene} from './types.ts';
import {msToFrame} from './motion.ts';

export type TransitionKind = NonNullable<StoryboardScene['transitionIn']>;

/** Frames per transition (ART_GUIDE MO16: fade 10-15 f for time jumps; slide/wipe 15-20 f for chapter changes). */
export const TRANSITION_FRAMES: Record<TransitionKind, number> = {cut: 0, fade: 12, slide: 18, wipe: 18};

export type SceneSpan = {
	index: number; // index into storyboard.scenes / timeline.scenes
	id: string;
	type: SceneType;
	from: number; // first frame in THIS composition
	durationInFrames: number; // the scene's own length (its audio window)
	srcFrom: number; // first frame of the scene in the full episode timeline (audio trim for Shorts)
	transition: TransitionKind; // how this scene enters (cut for the first scene)
	transitionFrames: number;
	tail: number; // extra frames this scene stays rendered under the NEXT scene's transition
};

const spanFor = (tl: Timeline, s: TimelineScene, fps: number) => {
	const from = msToFrame(s.startMs, fps);
	const to = msToFrame(s.startMs + s.durationMs, fps);
	return {from, dur: Math.max(1, to - from)};
};

const withTransitions = (raw: Array<Omit<SceneSpan, 'transition' | 'transitionFrames' | 'tail'> & {want: TransitionKind}>): SceneSpan[] => {
	const spans: SceneSpan[] = raw.map((r, k) => {
		const kind: TransitionKind = k === 0 ? 'cut' : r.want;
		// never longer than half of either neighbour, so a short scene is never mostly transition
		const cap = k === 0 ? 0 : Math.floor(Math.min(raw[k - 1].durationInFrames, r.durationInFrames) / 2);
		const t = Math.min(TRANSITION_FRAMES[kind], cap);
		return {index: r.index, id: r.id, type: r.type, from: r.from, durationInFrames: r.durationInFrames, srcFrom: r.srcFrom, transition: t > 0 ? kind : 'cut', transitionFrames: t, tail: 0};
	});
	spans.forEach((s, k) => {
		if (k + 1 < spans.length) s.tail = spans[k + 1].transitionFrames;
	});
	return spans;
};

/** The full episode: one span per scene at its own audio position. */
export const episodeSpans = (sb: Storyboard, tl: Timeline, fps: number): SceneSpan[] =>
	withTransitions(
		tl.scenes.map((s, index) => {
			const {from, dur} = spanFor(tl, s, fps);
			const sc = sb.scenes[index];
			return {index, id: s.id, type: sc.type, from, durationInFrames: dur, srcFrom: from, want: sc.transitionIn ?? 'cut'};
		}),
	);

export const episodeFrames = (tl: Timeline, fps: number): number => Math.max(1, msToFrame(tl.totalMs, fps));

/** A Short: only its scenes, in the listed order, retimed to start at frame 0. srcFrom keeps each scene's audio position. */
export const shortSpans = (sb: Storyboard, tl: Timeline, shortId: string, fps: number): SceneSpan[] => {
	const short = (sb.shorts ?? []).find((x) => x.id === shortId);
	if (!short) throw new Error(`storyboard has no short "${shortId}"`);
	let at = 0;
	return withTransitions(
		short.sceneIds.map((id) => {
			const index = tl.scenes.findIndex((s) => s.id === id);
			if (index < 0) throw new Error(`short "${shortId}": scene "${id}" is not in the timeline`);
			const {from, dur} = spanFor(tl, tl.scenes[index], fps);
			const sc = sb.scenes[index];
			const span = {index, id, type: sc.type, from: at, durationInFrames: dur, srcFrom: from, want: sc.transitionIn ?? 'cut'};
			at += dur;
			return span;
		}),
	);
};

export const spansFrames = (spans: SceneSpan[]): number => (spans.length ? spans[spans.length - 1].from + spans[spans.length - 1].durationInFrames : 1);
