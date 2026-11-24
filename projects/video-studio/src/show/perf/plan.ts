/**
 * The show's performance plan (pure): one plan for the whole render, in composition frames.
 *  - Shots: each segment's camera per format (layout/shots.ts). Hard cuts between scenes; no mid-scene inserts, so a
 *    graphic never flickers away. A punchline reaction shot is its own silent `beat` scene in the storyboard.
 *  - Zoo: the episode engine's scheduler (src/episode/perf/zoo.ts) run once over the whole render: his mouth is the
 *    timeline's per-frame mouth track (visemes from the voice step), natural blinks, head accents on stressed words,
 *    point gestures at diagrams and tip cards (landscape), 2-frame eye darts to graphics and to Badger. His expression
 *    changes only on cuts (ART_GUIDE CH5). During a Badger beat he holds still: no blink (MO17).
 *  - Badger: beats after Zoo's lines (perf/badger.ts).
 */
import type {Expression, MouthShape} from '../../characters/types';
import type {Timeline, TimelineWord} from '../../episode/types.ts';
import {scheduleZoo, zooAt, type Gesture, type Glance, type ZooSchedule} from '../../episode/perf/zoo.ts';
import {EASE, frameToMs, msToFrame, rand} from '../../episode/motion.ts';
import type {BadgerReaction, Format, ShowScene, ShowSegment, ShowStoryboard} from '../types.ts';
import type {ShowSpan} from '../timing.ts';
import {list, SEGMENT_SPECS, str} from '../segments.ts';
import {shotFor, type ShotName} from '../layout/shots.ts';
import {lineEndMs} from './lines.ts';
import {sceneReveals, type Reveals} from './reveals.ts';
import {badgerAt, REACTION_HOLD, scheduleBadger, type BadgerSchedule, type Beat} from './badger.ts';
import type {BadgerState, ZooState} from './state.ts';

/** Each segment's camera, per format. */
export const BASE_SHOT: Record<Format, Record<ShowSegment, ShotName>> = {
	landscape: {
		coldOpen: 'wide',
		headline: 'zooR',
		howItWorked: 'zooL',
		badgerRedFlag: 'badgerR',
		zooOneFix: 'zooL',
		scamOfTheWeek: 'none',
		correction: 'zooR',
		sources: 'none',
		outroEndScreen: 'wideL',
		beat: 'badgerC',
		desk: 'wide',
	},
	vertical: {
		coldOpen: 'two',
		headline: 'two',
		howItWorked: 'none',
		badgerRedFlag: 'badger',
		zooOneFix: 'zoo',
		scamOfTheWeek: 'two',
		correction: 'zoo',
		sources: 'two',
		outroEndScreen: 'two',
		beat: 'badger',
		desk: 'two',
	},
};

/** Zoo's expression per segment unless the storyboard sets zoo.expression. Deadpan by default; worried for a correction. */
export const DEFAULT_EXPRESSION: Record<ShowSegment, Expression> = {
	coldOpen: 'neutral',
	headline: 'neutral',
	howItWorked: 'neutral',
	badgerRedFlag: 'neutral',
	zooOneFix: 'neutral',
	scamOfTheWeek: 'neutral',
	correction: 'worried',
	sources: 'neutral',
	outroEndScreen: 'happy',
	beat: 'neutral',
	desk: 'neutral',
};

const STORYBOARD_REACTION: Record<string, BadgerReaction> = {neutral: 'slowBlink', worried: 'earsBack', judge: 'judge', lookUp: 'lookUp', happy: 'happy', shocked: 'shocked'};

/** Frames after the end of Zoo's line before Badger reacts: a short moving hold first (MO17). */
export const BEAT_DELAY = 8;
/** A beat scene's reaction starts this many frames after the cut. */
export const BEAT_SCENE_DELAY = 6;
/** Push-ins run only on shots at least this long (MO13: 90-180 f). */
export const PUSH_MIN_FRAMES = 90;
/** A reaction needs this many frames on screen to read (about 0.7 s); a shorter scene tail cannot carry it. */
export const REACTION_MIN_ROOM = 20;

const shotSees = (format: Format, shot: ShotName): boolean => shot !== 'none' && shotFor(format, shot).cast.includes('badger');

export type ScenePlan = {shot: ShotName; expression: Expression; reveals: Reveals; hasCard: boolean};

export type ShowPlan = {
	format: Format;
	fps: number;
	frames: number;
	seed: string;
	spans: ShowSpan[];
	scenes: ScenePlan[]; // parallel to spans
	beats: Beat[];
	zoo: ZooSchedule;
	badger: BadgerSchedule;
	onAirFrom: number;
};

const hasCard = (sc: ShowScene, seg: ShowSegment): boolean => {
	if (seg === 'desk') return !!(str(sc, 'title') || list(sc, 'bullets').length || list(sc, 'steps').length || str(sc, 'quote'));
	return !['coldOpen', 'beat'].includes(seg) || (seg === 'coldOpen' && !!str(sc, 'kicker'));
};

export const shotForScene = (format: Format, sc: ShowScene, seg: ShowSegment): ShotName => {
	if (seg === 'desk' && format === 'landscape') return hasCard(sc, seg) ? 'zooR' : 'wide';
	return BASE_SHOT[format][seg];
};

const reactionOf = (sc: ShowScene): BadgerReaction | null => {
	const r = sc.badger?.reaction;
	return r ? (STORYBOARD_REACTION[r] ?? null) : null;
};

/** Badger's beats in one scene (global frames). */
export const sceneBeats = (sc: ShowScene, span: ShowSpan, words: TimelineWord[], reveals: Reveals, fps: number, lang: string): Beat[] => {
	const seg = span.segment;
	const last = span.from + span.durationInFrames - 1;
	const clamp = (f: number) => Math.max(span.from, Math.min(last, f));
	const lineEnd = (after: 'end' | number | string | undefined): number => {
		const ms = lineEndMs(words, after, lang);
		return ms === null ? span.from + BEAT_SCENE_DELAY : span.from + msToFrame(ms, fps) + BEAT_DELAY;
	};
	const beat = (at: number, reaction: BadgerReaction, source: Beat['source'], hold?: number): Beat => ({at: clamp(at), reaction, hold: hold ?? REACTION_HOLD[reaction], sceneId: sc.id, source});
	if (sc.badger?.present === false) return [];
	if (seg === 'beat') {
		const r = sc.badgerBeats?.[0]?.reaction ?? reactionOf(sc) ?? 'judge';
		const hold = sc.badgerBeats?.[0]?.hold ?? Math.max(18, Math.min(REACTION_HOLD[r], span.durationInFrames - BEAT_SCENE_DELAY - 4));
		return [beat(span.from + BEAT_SCENE_DELAY, r, 'beatScene', hold)];
	}
	if (sc.badgerBeats?.length) return sc.badgerBeats.map((b) => beat(lineEnd(b.after), b.reaction, 'badgerBeats', b.hold));
	const r = reactionOf(sc);
	if (r) return [beat(lineEnd('end'), r, 'reaction')];
	if (seg === 'badgerRedFlag') return [beat(span.from + reveals.card + 10, 'judge', 'default'), beat(lineEnd('end'), 'slowBlink', 'default')];
	const d = SEGMENT_SPECS[seg].defaultReaction;
	return d ? [beat(lineEnd('end'), d, 'default')] : [];
};

export type PlanInput = {sb: ShowStoryboard; tl: Timeline; spans: ShowSpan[]; format: Format; fps: number; frames: number; seed: string};

export const planShow = (p: PlanInput): ShowPlan => {
	const {sb, tl, spans, format, fps, frames, seed} = p;
	const scenes: ScenePlan[] = [];
	const words: TimelineWord[] = [];
	const mouth: MouthShape[] = Array(frames).fill('closed');
	const gestures: Gesture[] = [];
	const glances: Glance[] = [];
	const browBeats: number[] = [];
	let beats: Beat[] = [];
	spans.forEach((span) => {
		const sc = sb.scenes[span.index];
		const ts = tl.scenes[span.index];
		const seg = span.segment;
		const shot = shotForScene(format, sc, seg);
		const reveals = sceneReveals(sc, seg, ts.words, ts.speechMs, fps, sb.lang);
		scenes.push({shot, expression: sc.zoo?.expression ?? DEFAULT_EXPRESSION[seg], reveals, hasCard: hasCard(sc, seg)});
		// the global voice track: words and mouth shapes of this scene, placed at its composition frame
		const offMs = frameToMs(span.from, fps);
		for (const w of ts.words) {
			if (msToFrame(w.startMs, fps) >= span.durationInFrames) break;
			words.push({...w, startMs: w.startMs + offMs, endMs: w.endMs + offMs, ...(w.stressMs !== undefined ? {stressMs: w.stressMs + offMs} : {})});
		}
		for (let i = 0; i < span.durationInFrames && i < ts.mouth.length; i++) if (span.from + i < frames) mouth[span.from + i] = ts.mouth[i];
		// Zoo's hands and eyes meet the graphics (front view only; the point arm goes to screen right)
		const card = span.from + reveals.card;
		if (shot === 'zooL' && seg === 'howItWorked' && reveals.items.length) {
			const a = span.from + reveals.items[0];
			// point as the first node lands (held at most 1.5 s), then glance back at each later node
			gestures.push({frame: a, hold: Math.min(span.durationInFrames - (a - span.from) - 20, 45)});
			reveals.items.slice(1).forEach((r) => {
				if (span.from + r > a + 45 + 15 + 6) glances.push({frame: span.from + r + 2, lookX: 0.8, lookY: 0, hold: 14});
			});
		} else if (shot === 'zooL' && seg === 'zooOneFix') gestures.push({frame: card + 8, hold: Math.min(48, span.durationInFrames - reveals.card - 30)});
		if (shot === 'zooR' && scenes[scenes.length - 1].hasCard) glances.push({frame: card + 6, lookX: -0.8, lookY: 0.1, hold: 14});
		if (format === 'vertical' && scenes[scenes.length - 1].hasCard && shot !== 'badger') glances.push({frame: card + 6, lookX: 0, lookY: -0.85, hold: 12});
		const sb_ = sceneBeats(sc, span, ts.words, reveals, fps, sb.lang);
		beats.push(...sb_);
		if (seg === 'coldOpen' && !sb_.length && ts.words.length) browBeats.push(span.from + msToFrame(ts.words[ts.words.length - 1].endMs, fps) + 4);
	});
	// A default or storyboard reaction that would show for less than REACTION_MIN_ROOM frames before a cut to a shot
	// without Badger cannot be seen: drop it (and its no-blink hold on Zoo). Authored beats (beat scenes, badgerBeats) stay.
	beats = beats.filter((b) => {
		if (b.source === 'beatScene' || b.source === 'badgerBeats') return true;
		const k = spans.findIndex((s) => b.at >= s.from && b.at < s.from + s.durationInFrames);
		if (k < 0) return false;
		const room = spans[k].from + spans[k].durationInFrames - b.at;
		const seenHere = shotSees(format, scenes[k].shot);
		const seenNext = k + 1 < spans.length && shotSees(format, scenes[k + 1].shot);
		return (seenHere && room >= REACTION_MIN_ROOM) || (seenHere && seenNext);
	});
	const badger = scheduleBadger(beats, frames, `${seed}:badger`);
	beats = badger.beats;
	// Zoo looks at Badger after some of Badger's judging beats, when the shot holds both of them
	beats.forEach((b, k) => {
		const span = spans.find((s) => b.at >= s.from && b.at < s.from + s.durationInFrames);
		if (!span) return;
		const shot = scenes[spans.indexOf(span)].shot;
		const two = shot !== 'none' && shotFor(format, shot).cast.length === 2;
		if (two && (b.reaction === 'judge' || b.reaction === 'slowBlink' || b.reaction === 'lookUp') && rand(`${seed}:zooLook:${k}`) < 0.6)
			glances.push({frame: b.at + 10, lookX: format === 'landscape' ? 0.85 : 0.8, lookY: 0.25, hold: 16});
	});
	const zoo = scheduleZoo({
		fps,
		frames,
		seed: `${seed}:zoo`,
		words,
		mouth,
		expression: 'neutral',
		view: 'front',
		gestures: gestures.filter((g) => g.hold > 12),
		glances: glances.sort((a, b) => a.frame - b.frame),
		browBeats,
	});
	// MO17: Zoo holds still through Badger's beat (breathing only): drop his natural blinks there
	zoo.blinks = zoo.blinks.filter((bl) => bl.long || !beats.some((b) => bl.start + 7 >= b.at - 14 && bl.start <= b.at + b.hold));
	const onAirFrom = spans[0]?.segment === 'coldOpen' ? 6 : 0;
	return {format, fps, frames, seed, spans, scenes, beats, zoo, badger, onAirFrom};
};

/** Zoo's rig channels at frame f, drawn by the scene of span `k` (its expression holds until its own cut). */
export const zooStateAt = (plan: ShowPlan, k: number, frame: number): ZooState => {
	const z = zooAt(plan.zoo, frame);
	return {
		mouth: z.mouth,
		blink: z.blink,
		headTilt: z.headTilt,
		browLift: z.browLift,
		lookX: z.lookX,
		lookY: z.lookY,
		pose: z.pose,
		poseAmount: z.poseAmount,
		pointWindup: z.pointWindup,
		expression: plan.scenes[k]?.expression ?? 'neutral',
	};
};

export const badgerStateAt = (plan: ShowPlan, frame: number): BadgerState => badgerAt(plan.badger, frame);

/** Push-in factor of span k at a composition frame (ART_GUIDE MO13: sine in-out over the shot). */
export const pushAt = (plan: ShowPlan, k: number, frame: number): number => {
	const span = plan.spans[k];
	const shot = plan.scenes[k].shot;
	if (!span || shot === 'none') return 1;
	const s = shotFor(plan.format, shot);
	if (s.push <= 1 || span.durationInFrames < PUSH_MIN_FRAMES) return 1;
	return 1 + (s.push - 1) * EASE.sinInOut((frame - span.from) / span.durationInFrames);
};
