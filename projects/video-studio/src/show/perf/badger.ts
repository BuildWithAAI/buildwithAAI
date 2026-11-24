/**
 * Badger's performance over a whole render (pure; global frames, so a reaction or a blink runs on through a cut).
 * He is nonverbal: his jokes are reactions that land AFTER Zoo's lines (owner rule), restrained and adult:
 *   judge      the quietly judging brow, ears a little back, a slow head tilt toward Zoo, then a long deadpan blink
 *   slowBlink  one long deadpan blink (18 f) with a hint of the judging brow
 *   lookUp     turns his head to Zoo (3/4 head, swapped on a closed blink) and looks up at him, then back
 *   earsBack   worried brow (swapped on a blink), ears fold back
 *   happy      a restrained smile (swapped on a blink)
 *   shocked    eyes widen on a 3-frame snap, ears flick
 * Between reactions he listens: breathing (in the rig), natural blinks every 2-6 s, and now and then a 2-frame eye dart
 * toward Zoo and back (ART_GUIDE MO12). Expression and head swaps land on a fully closed blink frame (CH5).
 */
import type {BadgerHead, Expression} from '../../characters/types';
import type {BadgerReaction} from '../types.ts';
import {blinkShape, BLINK_LEN, EASE, longBlinkShape, LONG_BLINK_LEN, rand, track} from '../../episode/motion.ts';
import {BADGER_NEUTRAL, type BadgerState} from './state.ts';

export type BeatSource = 'beatScene' | 'badgerBeats' | 'reaction' | 'default';
export type Beat = {at: number; reaction: BadgerReaction; hold: number; sceneId: string; source: BeatSource};

/** Default hold (frames from the reaction to its release) per reaction: about 1.2-1.7 s (MO17 hold + one action). */
export const REACTION_HOLD: Record<BadgerReaction, number> = {judge: 50, slowBlink: 36, lookUp: 48, earsBack: 50, happy: 48, shocked: 40};
/** Two reactions closer than this are one too many: the later one is dropped. */
export const MIN_BEAT_GAP = 40;
const RELEASE = 14;

export type Blink = {start: number; long: boolean};
export type Glance = {frame: number; hold: number};
export type BadgerSchedule = {beats: Beat[]; blinks: Blink[]; glances: Glance[]; frames: number};

/** When two beats crowd each other, the more deliberate one wins: an authored beat scene, then explicit badgerBeats. */
const PRIORITY: Record<BeatSource, number> = {beatScene: 3, badgerBeats: 2, reaction: 1, default: 0};

/**
 * Sort; of two beats closer than MIN_BEAT_GAP keep the higher priority (the earlier on a tie); then cut each hold short
 * so it releases before the next reaction starts.
 */
export const normalizeBeats = (beats: Beat[], frames: number): Beat[] => {
	const sorted = [...beats].filter((b) => b.at >= 0 && b.at < frames).sort((a, b) => a.at - b.at || PRIORITY[b.source] - PRIORITY[a.source]);
	const kept: Beat[] = [];
	for (const b of sorted) {
		const prev = kept[kept.length - 1];
		if (prev && b.at - prev.at < MIN_BEAT_GAP) {
			if (PRIORITY[b.source] > PRIORITY[prev.source]) kept[kept.length - 1] = {...b};
			continue;
		}
		kept.push({...b});
	}
	for (let i = 0; i + 1 < kept.length; i++) kept[i].hold = Math.max(18, Math.min(kept[i].hold, kept[i + 1].at - kept[i].at - RELEASE - 2));
	return kept;
};

const window = (b: Beat): [number, number] => [b.at - 12, b.at + b.hold + RELEASE + 6];

export const scheduleBadger = (beatsIn: Beat[], frames: number, seed: string): BadgerSchedule => {
	const beats = normalizeBeats(beatsIn, frames);
	const forced: Blink[] = [];
	for (const b of beats) {
		const swaps = b.reaction === 'lookUp' || b.reaction === 'earsBack' || b.reaction === 'happy';
		if (swaps) forced.push({start: b.at - 2, long: false});
		if (swaps || b.reaction === 'shocked') forced.push({start: b.at + b.hold - 2, long: false}); // swap back, closed at at+hold
		if (b.reaction === 'judge') forced.push({start: b.at + 22, long: true});
		if (b.reaction === 'slowBlink') forced.push({start: b.at, long: true});
	}
	const inBeat = (f: number, pad = 0) => beats.some((b) => {
		const [a, z] = window(b);
		return f > a - pad && f < z + pad;
	});
	const blinks: Blink[] = [...forced];
	const clash = (s: number) => blinks.some((b) => s < b.start + (b.long ? LONG_BLINK_LEN : BLINK_LEN) + 30 && b.start < s + BLINK_LEN + 30);
	let f = Math.round(30 + rand(`${seed}:b0`) * 50);
	for (let i = 1; f < frames + 30; i++) {
		if (!clash(f) && !inBeat(f)) blinks.push({start: f, long: false});
		f += Math.round(60 + rand(`${seed}:b${i}`) * 120);
	}
	blinks.sort((a, b) => a.start - b.start);
	// listening: eye darts toward Zoo now and then, never during a reaction or a blink
	const glances: Glance[] = [];
	let g = Math.round(90 + rand(`${seed}:g0`) * 60);
	for (let i = 1; g < frames; i++) {
		const hold = Math.round(18 + rand(`${seed}:gh${i}`) * 12);
		const busy = inBeat(g, 8) || inBeat(g + hold, 8) || blinks.some((b) => b.start < g + hold + 3 && b.start + BLINK_LEN > g - 2);
		if (!busy) glances.push({frame: g, hold});
		g += Math.round(120 + rand(`${seed}:g${i}`) * 90);
	}
	return {beats, blinks, glances, frames};
};

/** Eye dart: 80% of the travel on the first frame, settled on the second, hold, back (MO12). */
const dart = (f: number, at: number, hold: number, to: number): number => {
	const d = f - at;
	if (d < 0 || d > hold + 2) return 0;
	if (d === 0) return to * 0.8;
	if (d <= hold) return to;
	return d === hold + 1 ? to * 0.2 : 0;
};

/** The beat whose reaction (or its release) covers frame f, if any. */
export const activeBeat = (s: BadgerSchedule, f: number): Beat | null => {
	let hit: Beat | null = null;
	for (const b of s.beats) if (f >= b.at - 2 && f < b.at + b.hold + RELEASE + 2) hit = b;
	return hit;
};

export const badgerAt = (s: BadgerSchedule, frame: number): BadgerState => {
	const f = Math.max(0, frame);
	let blink = 0;
	for (const b of s.blinks) {
		const d = f - b.start;
		if (d >= 0 && d <= (b.long ? LONG_BLINK_LEN : BLINK_LEN)) blink = Math.max(blink, b.long ? longBlinkShape(d) : blinkShape(d));
	}
	const out: BadgerState = {...BADGER_NEUTRAL, blink};
	const b = activeBeat(s, f);
	if (!b) {
		for (const g of s.glances) {
			const dx = dart(f, g.frame, g.hold, -0.55);
			if (dx !== 0) {
				out.lookX = dx;
				out.lookY = dart(f, g.frame, g.hold, -0.2);
				break;
			}
		}
		return out;
	}
	const {at, hold: H} = b;
	const during = f >= at && f < at + H;
	let expression: Expression = 'neutral';
	let head: BadgerHead = 'front';
	switch (b.reaction) {
		case 'judge':
			out.judge = track(f, [[at, 0], [at + 8, 1], [at + H, 1], [at + H + RELEASE, 0]], EASE.inOut);
			out.earsBack = track(f, [[at + 2, 0], [at + 14, 0.25], [at + H, 0.25], [at + H + RELEASE, 0]], EASE.inOut);
			out.headTilt = track(f, [[at + 4, 0], [at + 20, -3.5], [at + H, -3.5], [at + H + RELEASE, 0]], EASE.inOut);
			break;
		case 'slowBlink':
			out.judge = track(f, [[at, 0], [at + 6, 0.35], [at + H, 0.35], [at + H + 10, 0]], EASE.inOut);
			break;
		case 'lookUp':
			if (during) {
				head = 'threeQuarterLeftScreen';
				out.lookX = -0.25;
				out.lookY = -0.45;
			}
			out.headTilt = track(f, [[at, 0], [at + 10, 2.5], [at + H - 6, 2.5], [at + H, 0]], EASE.inOut);
			break;
		case 'earsBack':
			if (during) expression = 'worried';
			out.earsBack = track(f, [[at, 0], [at + 10, 0.7], [at + H, 0.7], [at + H + RELEASE, 0]], EASE.inOut);
			break;
		case 'happy':
			if (during) expression = 'happy';
			break;
		case 'shocked':
			if (during) expression = 'shocked';
			out.earsBack = track(f, [[at, 0], [at + 3, 0.15], [at + H, 0.15], [at + H + 8, 0]], [EASE.quadOut, EASE.linear, EASE.inOut]);
			out.headTilt = track(f, [[at, 0], [at + 3, 2], [at + 14, 0]], [EASE.quadOut, EASE.inOut]);
			break;
	}
	out.expression = expression;
	out.head = head;
	return out;
};
