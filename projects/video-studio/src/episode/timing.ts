/**
 * Scene spans on the frame grid (pure). Audio is never moved: every scene starts on the exact frame of its own audio
 * (timeline.startMs). A transition only OVERLAPS VISUALS, and it is VOICE-FREE:
 *  - it ends no later than the incoming scene's first voiced frame (ZOO is never heard while his face is still fading
 *    or sliding in), and
 *  - it starts no earlier than the outgoing scene's last voiced frame (+2 f for the decay of the last sound).
 * Since 2026-11-25 (episode sound) "voice-free" replaces "silent": the music bed plays on through every transition
 * (src/episode/audio/plan.ts), and no effect plays in one unless the storyboard asks for it (a wipe's short whoosh, a
 * slide's soft air with sfx.transition). The gate measures every transition window on the voice stem (under -60 dBFS).
 * The transition first uses the outgoing scene's silent tail: the incoming scene's visuals start `preroll` frames
 * BEFORE its audio frame, held on its own frame 0 (mouth closed, nothing revealed yet). Whatever the transition still
 * needs runs in the incoming scene's leading silence, with the outgoing scene rendered `tail` frames past its end under
 * it. Total length and lip-sync are the same as with hard cuts (unlike TransitionSeries, which shortens the timeline).
 * Fixed 2026-11-24 (review): transitions used to start on the incoming audio frame and covered its first 8-16 voiced
 * frames while the outgoing scene's 20-30 silent tail frames went unused.
 */
import type {SceneType, Storyboard, StoryboardScene, Timeline, TimelineScene} from './types.ts';
import {msToFrame} from './motion.ts';
import {isJumpCut, zooPlacement} from './layout/faces.ts';
import type {Format} from './layout/specs.ts';

export type TransitionKind = NonNullable<StoryboardScene['transitionIn']>;

/** Frames per transition (ART_GUIDE MO16: fade 10-15 f for time jumps; slide/wipe 15-20 f for chapter changes). */
export const TRANSITION_FRAMES: Record<TransitionKind, number> = {cut: 0, fade: 12, slide: 18, wipe: 18};
/** Shorter than this, a transition reads as a glitch: the scene enters on a hard cut instead. */
export const MIN_TRANSITION_FRAMES: Record<TransitionKind, number> = {cut: 0, fade: 8, slide: 12, wipe: 12};
/** Frames after the last open-mouth frame that still carry the end of the last sound (the mouth leads the audio by 1 f). */
export const SOUND_DECAY_FRAMES = 2;

export type SceneSpan = {
	index: number; // index into storyboard.scenes / timeline.scenes
	id: string;
	type: SceneType;
	from: number; // first frame in THIS composition (the scene's audio frame)
	durationInFrames: number; // the scene's own length (its audio window)
	srcFrom: number; // first frame of the scene in the full episode timeline (audio trim for Shorts)
	transition: TransitionKind; // how this scene enters (cut for the first scene, or when the silence is too short)
	transitionFrames: number; // total transition length: preroll + the frames it runs inside this scene
	preroll: number; // transition frames BEFORE `from`, inside the previous scene's silent tail (this scene held on its frame 0)
	tail: number; // frames this scene stays rendered past its end under the NEXT scene's transition
};

/**
 * Silent frames at the start of a scene (before ZOO's mouth first opens) and at its end (after it last closes, minus the
 * decay of the last sound), from the timeline's mouth track. A scene with no speech is silent throughout.
 */
export const silentEdges = (s: Pick<TimelineScene, 'mouth'>, frames: number): {lead: number; tail: number} => {
	const m = Array.isArray(s.mouth) ? s.mouth : [];
	const n = Math.min(frames, m.length);
	let first = -1;
	let last = -1;
	for (let i = 0; i < n; i++) {
		if (m[i] === 'closed') continue;
		if (first < 0) first = i;
		last = i;
	}
	if (first < 0) return {lead: frames, tail: frames};
	return {lead: first, tail: Math.max(0, frames - 1 - last - SOUND_DECAY_FRAMES)};
};

const spanFor = (s: TimelineScene, fps: number) => {
	const from = msToFrame(s.startMs, fps);
	const to = msToFrame(s.startMs + s.durationMs, fps);
	return {from, dur: Math.max(1, to - from)};
};

type Raw = Omit<SceneSpan, 'transition' | 'transitionFrames' | 'preroll' | 'tail'> & {want: TransitionKind; silence: {lead: number; tail: number}};

/** Span options (added 2026-11-25, episode audio): scenes that must enter on a hard cut (the scene after the brand sting). */
export type SpanOptions = {forceCut?: ReadonlySet<string>};

const withTransitions = (raw: Raw[], opts: SpanOptions = {}): SceneSpan[] => {
	const spans: SceneSpan[] = raw.map((r, k) => {
		const base = {index: r.index, id: r.id, type: r.type, from: r.from, durationInFrames: r.durationInFrames, srcFrom: r.srcFrom, tail: 0};
		const kind: TransitionKind = k === 0 || opts.forceCut?.has(r.id) ? 'cut' : r.want;
		if (kind === 'cut') return {...base, transition: 'cut', transitionFrames: 0, preroll: 0};
		const prev = raw[k - 1];
		// never longer than half of either neighbour, so a short scene is never mostly transition
		const cap = Math.floor(Math.min(prev.durationInFrames, r.durationInFrames) / 2);
		// only in silence: the outgoing scene's silent tail, then the incoming scene's leading silence
		const t = Math.min(TRANSITION_FRAMES[kind], cap, prev.silence.tail + r.silence.lead);
		if (t < MIN_TRANSITION_FRAMES[kind]) return {...base, transition: 'cut', transitionFrames: 0, preroll: 0};
		return {...base, transition: kind, transitionFrames: t, preroll: Math.min(t, prev.silence.tail)};
	});
	spans.forEach((s, k) => {
		const next = spans[k + 1];
		if (next) s.tail = next.transitionFrames - next.preroll;
	});
	return spans;
};

/**
 * How a scene enters when the storyboard does not say: a hard cut, except where a cut from the previous scene would be a
 * landscape jump cut (layout/faces.ts isJumpCut), which gets a short fade instead. An explicit transitionIn always wins.
 */
export const defaultTransition = (prev: StoryboardScene | undefined, sc: StoryboardScene, format: Format): TransitionKind => {
	if (sc.transitionIn) return sc.transitionIn;
	if (!prev || format !== 'landscape') return 'cut';
	return isJumpCut(zooPlacement(prev, format), zooPlacement(sc, format), format) ? 'fade' : 'cut';
};

/** The full episode: one span per scene at its own audio position. */
export const episodeSpans = (sb: Storyboard, tl: Timeline, fps: number, format: Format = 'landscape', opts: SpanOptions = {}): SceneSpan[] =>
	withTransitions(
		tl.scenes.map((s, index) => {
			const {from, dur} = spanFor(s, fps);
			const sc = sb.scenes[index];
			return {index, id: s.id, type: sc.type, from, durationInFrames: dur, srcFrom: from, want: defaultTransition(sb.scenes[index - 1], sc, format), silence: silentEdges(s, dur)};
		}),
		opts,
	);

export const episodeFrames = (tl: Timeline, fps: number): number => Math.max(1, msToFrame(tl.totalMs, fps));

/** A Short: only its scenes, in the listed order, retimed to start at frame 0. srcFrom keeps each scene's audio position. */
export const shortSpans = (sb: Storyboard, tl: Timeline, shortId: string, fps: number): SceneSpan[] => {
	const short = (sb.shorts ?? []).find((x) => x.id === shortId);
	if (!short) throw new Error(`storyboard has no short "${shortId}"`);
	let at = 0;
	return withTransitions(
		short.sceneIds.map((id, k) => {
			const index = tl.scenes.findIndex((s) => s.id === id);
			if (index < 0) throw new Error(`short "${shortId}": scene "${id}" is not in the timeline`);
			const {from, dur} = spanFor(tl.scenes[index], fps);
			const sc = sb.scenes[index];
			const prevId = k > 0 ? short.sceneIds[k - 1] : null;
			const prev = prevId ? sb.scenes.find((x) => x.id === prevId) : undefined;
			const span = {index, id, type: sc.type, from: at, durationInFrames: dur, srcFrom: from, want: defaultTransition(prev, sc, 'vertical'), silence: silentEdges(tl.scenes[index], dur)};
			at += dur;
			return span;
		}),
	);
};

export const spansFrames = (spans: SceneSpan[]): number => (spans.length ? spans[spans.length - 1].from + spans[spans.length - 1].durationInFrames : 1);

/**
 * Transition progress (0..1) at transition time `t` (frames since the transition started, may be fractional for
 * motion-blur samples). Frame k of a T-frame transition shows t = k + 1 of T + 1 steps, so no transition frame
 * duplicates the frame before or after it, and the last one lands within a few px of rest: the scene then continues
 * at exactly 1 (no snap). Slide/wipe: a critically damped (no-overshoot) curve, normalised to reach 1 exactly at the end
 * (ART_GUIDE MO3/MO16 spring damping 200 behaves as critical damping); fade: sine in-out.
 */
const CRIT = 7.4; // the damping-200 spring's shape when stretched to its duration (it is ~99.5% settled there)
const critical = (u: number): number => {
	const g = (x: number) => 1 - (1 + CRIT * x) * Math.exp(-CRIT * x);
	return u <= 0 ? 0 : u >= 1 ? 1 : g(u) / g(1);
};
export const transitionProgress = (kind: TransitionKind, t: number, frames: number): number => {
	if (kind === 'cut' || frames <= 0) return 1;
	const u = Math.max(0, Math.min(1, t / (frames + 1)));
	if (kind === 'fade') return 0.5 - 0.5 * Math.cos(Math.PI * u);
	return critical(u);
};

/** Motion blur for wipes (ART_GUIDE MO16: 180° shutter, 16 samples). */
export const MOTION_BLUR = {shutter: 0.5, samples: 16} as const;
/** Sample times of one frame's exposure: the trailing half frame, ascending. */
export const blurSampleTimes = (t: number): number[] =>
	Array.from({length: MOTION_BLUR.samples}, (_, i) => t - MOTION_BLUR.shutter + (MOTION_BLUR.shutter * (i + 1)) / MOTION_BLUR.samples);

/**
 * A wipe's motion blur as NON-overlapping vertical strips of the incoming layer: the strip where k of the N exposure
 * samples had already revealed the frame is drawn once, at opacity k/N (and everything every sample revealed, opaque).
 * For a wipe this is the exact motion blur (the content does not move, only the edge), and every pixel is blended at
 * most once. Stacking N translucent full-frame copies instead drifts flat colours: measured in this headless Chrome,
 * 16 copies of #E6E8EB over itself came out 5 levels darker (8 copies: 2 levels), in tiles. Strip edges are whole px.
 */
export const wipeStrips = (t: number, frames: number, width: number): Array<{from: number; to: number; alpha: number}> => {
	const edges = blurSampleTimes(t).map((ts) => Math.round((1 - transitionProgress('wipe', ts, frames)) * width)); // descending
	const n = edges.length;
	const out: Array<{from: number; to: number; alpha: number}> = [{from: edges[0], to: width, alpha: 1}];
	for (let j = 1; j < n; j++) if (edges[j] < edges[j - 1]) out.push({from: edges[j], to: edges[j - 1], alpha: (n - j) / n});
	return out;
};

/**
 * A slide is a short push with a fade: the incoming layer travels SLIDE_PUSH of the frame width on the critically damped
 * curve while it fades in. Its fastest frames are almost transparent, so nothing strobes and no motion blur is needed
 * (Remotion 4.0.541 has no transition motionBlur, and stacked-opacity blur drifts flat colours; see wipeStrips).
 * Fixed 2026-11-24 (review: the full-frame slide moved up to ~300 px/frame with no blur and snapped 11 px at its end).
 */
export const SLIDE_PUSH = 0.12;
