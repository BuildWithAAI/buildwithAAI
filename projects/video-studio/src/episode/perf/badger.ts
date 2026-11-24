/**
 * Badger's performance in one scene (pure). Calm and quietly judging (PROJECT_INSTRUCTIONS): seeded natural blinks,
 * breathing (in the rig), and ONE restrained reaction from the storyboard at the scene's reaction beat:
 *   judge    judging look (lids and brow), ears ease back a little, slow chin tilt, then a long deadpan blink
 *   lookUp   looks up at ZOO: replacement head swapped on a closed blink, neck eases up (side views)
 *   happy    restrained smile (swapped on a blink) and a short, slow tail wag that settles
 *   worried  worried brows (swapped on a blink), ears fold back
 *   shocked  eyes widen on a 2-3 f snap, ears flick
 * Expression swaps land on a fully closed blink frame (ART_GUIDE CH5), except the shocked snap.
 */
import type {BadgerHead, BadgerPose, Expression} from '../../characters/types';
import type {StoryboardScene} from '../types.ts';
import type {BadgerPlace} from '../layout/specs.ts';
import {blinkShape, BLINK_LEN, EASE, longBlinkShape, LONG_BLINK_LEN, rand, track} from '../motion.ts';

export type BadgerReaction = NonNullable<NonNullable<StoryboardScene['badger']>['reaction']>;

export type BadgerPlan = {
	fps: number;
	frames: number;
	seed: string;
	reaction: BadgerReaction;
	at: number; // reaction frame
	place: BadgerPlace;
};

export type BadgerFrame = {
	expression: Expression;
	blink: number;
	judge: number;
	earsBack: number;
	headTilt: number;
	tailWag: number;
	head?: BadgerHead;
	pose: BadgerPose;
	neckTurn: number;
	lookX: number;
	lookY: number;
};

export type BadgerSchedule = {plan: BadgerPlan; blinks: Array<{start: number; long: boolean}>};

const WAG_START = 0.65 / (2 * Math.PI); // turns

const isSide = (p: BadgerPlace) => (p.view === 'left' || p.view === 'right') && (p.pose ?? 'stand') === 'stand';

export const scheduleBadger = (plan: BadgerPlan): BadgerSchedule => {
	const {at, reaction, seed, frames} = plan;
	const forced: Array<{start: number; long: boolean}> = [];
	if (reaction === 'lookUp' || reaction === 'happy' || reaction === 'worried') forced.push({start: at - 2, long: false});
	if (reaction === 'judge') forced.push({start: at + 22, long: true});
	const blinks = [...forced];
	let f = Math.round(30 + rand(`${seed}:b0`) * 50);
	for (let i = 1; f < frames + 30; i++) {
		const clash = blinks.some((b) => f < b.start + (b.long ? LONG_BLINK_LEN : BLINK_LEN) + 30 && b.start < f + BLINK_LEN + 30);
		const inReaction = f > at - 12 && f < at + 30;
		if (!clash && !inReaction) blinks.push({start: f, long: false});
		f += Math.round(60 + rand(`${seed}:b${i}`) * 120);
	}
	blinks.sort((a, b) => a.start - b.start);
	return {plan, blinks};
};

export const badgerAt = (s: BadgerSchedule, frame: number): BadgerFrame => {
	const {at, reaction, place} = s.plan;
	const f = Math.max(0, frame);
	let blink = 0;
	for (const b of s.blinks) {
		const d = f - b.start;
		if (d >= 0 && d <= (b.long ? LONG_BLINK_LEN : BLINK_LEN)) blink = Math.max(blink, b.long ? longBlinkShape(d) : blinkShape(d));
	}
	const out: BadgerFrame = {
		expression: 'neutral',
		blink,
		judge: 0,
		earsBack: 0,
		headTilt: 0,
		tailWag: 0,
		head: place.head,
		pose: place.pose ?? 'stand',
		neckTurn: 0,
		lookX: 0,
		lookY: 0,
	};
	const after = f >= at;
	switch (reaction) {
		case 'judge': {
			out.judge = track(f, [[at, 0], [at + 8, 1]], EASE.inOut);
			out.earsBack = track(f, [[at + 2, 0], [at + 14, 0.25]], EASE.inOut);
			out.headTilt = track(f, [[at + 4, 0], [at + 20, place.view === 'right' ? 4 : -4]], EASE.inOut);
			break;
		}
		case 'lookUp': {
			const up = place.view === 'right' ? 'upRightScreen' : 'upLeftScreen';
			if (isSide(place)) {
				if (after) {
					out.head = up;
					out.pose = 'lookUp';
					out.neckTurn = track(f, [[at, -9], [at + 7, 0.8], [at + 12, 0]], EASE.out);
				} else if (f >= at - 2) {
					out.lookY = -0.6;
					out.lookX = place.view === 'right' ? 0.4 : -0.4;
				}
			} else if (after) {
				// front / 3/4 / sit bodies have no look-up head: eyes up and a small chin lift instead
				out.lookY = -0.85;
				out.headTilt = track(f, [[at, 0], [at + 10, place.view === 'right' ? -3 : 3]], EASE.inOut);
			}
			break;
		}
		case 'happy': {
			if (after) out.expression = 'happy';
			// A slow wag (0.9 per second) to the end of the scene. The rig's wag is discontinuous at phase 0 (its bend
			// term is non-zero there), so it starts at the phase where swing and bend are equal and smallest (~2.7 deg).
			if (f > at + 2) out.tailWag = WAG_START + ((f - at - 2) / s.plan.fps) * 0.9;
			break;
		}
		case 'worried': {
			if (after) out.expression = 'worried';
			out.earsBack = track(f, [[at, 0], [at + 10, 0.7]], EASE.inOut);
			break;
		}
		case 'shocked': {
			if (after) out.expression = 'shocked';
			out.earsBack = track(f, [[at, 0], [at + 3, 0.15]], EASE.quadOut);
			out.headTilt = track(f, [[at, 0], [at + 3, place.view === 'right' ? -2 : 2], [at + 14, 0]], [EASE.quadOut, EASE.inOut]);
			break;
		}
		default:
			break;
	}
	return out;
};

/** The default reaction beat (frame): about 12 f after the last word (MO17), or late in the scene if speech fills it. */
export const defaultReactionFrame = (frames: number, speechEndFrame: number): number => {
	const afterSpeech = speechEndFrame + 12;
	if (afterSpeech + 30 <= frames) return afterSpeech;
	return Math.max(8, Math.min(frames - 40, Math.round(frames * 0.7)));
};
