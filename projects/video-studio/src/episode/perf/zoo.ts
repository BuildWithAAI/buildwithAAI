/**
 * ZOO's performance in one scene (pure; ART_GUIDE sections 6-7). A schedule is computed once per scene, then zooAt()
 * gives the rig channels for any scene frame:
 *   mouth      timeline.mouth[frame] (visemes from the voice step; 'closed' outside it)
 *   blink      seeded natural blinks every 2-6 s, plus blinks forced at phrase-end pauses (>= 11 f) and at every
 *              expression/view swap (the swap lands on the fully closed frame, CH5); never on an accent apex
 *   headTilt   small accents (1-2 deg) on stressed words: rise 3 f, settle 9 f, about half of the phrases (MO11)
 *   browLift   a small deadpan raise with some accents and at reaction beats
 *   point      restrained point gesture (front view only): eyes lead, wind-up, 12 f swing, hold, 15 f lowering
 *   look       2-frame eye darts toward content, then back to camera (MO12)
 */
import type {Expression, MouthShape, ZooView} from '../../characters/types';
import type {TimelineWord} from '../types.ts';
import {blinkShape, BLINK_LEN, EASE, longBlinkShape, LONG_BLINK_LEN, msToFrame, rand, track} from '../motion.ts';
import {normWord} from '../cues.ts';

export type Gesture = {frame: number; hold: number}; // frame: the hand ARRIVES (the item appears); hold in frames
export type Glance = {frame: number; lookX: number; lookY: number; hold: number};
export type ZooChange = {frame: number; expression?: Expression; view?: ZooView}; // swap hidden in a blink at `frame`

export type ZooPlan = {
	fps: number;
	frames: number; // scene length (frames past it hold the last state)
	seed: string;
	words: TimelineWord[];
	mouth: MouthShape[];
	expression: Expression;
	view: ZooView;
	gestures?: Gesture[];
	glances?: Glance[];
	changes?: ZooChange[];
	browBeats?: number[]; // extra deadpan brow raises (reaction holds)
	longBlinks?: number[]; // 18 f deadpan blinks (reaction beats)
	baseLook?: {lookX: number; lookY: number};
};

export type ZooSchedule = {
	plan: ZooPlan;
	blinks: Array<{start: number; long: boolean}>;
	accents: Array<{apex: number; amp: number; brow: boolean}>;
	gestures: Gesture[];
};

export type ZooFrame = {
	mouth: MouthShape;
	blink: number;
	headTilt: number;
	browLift: number;
	lookX: number;
	lookY: number;
	pose: 'stand' | 'point';
	poseAmount: number;
	pointWindup: number;
	expression: Expression;
	view: ZooView;
};

const PHRASE_END = /[.,!?;:…。，！？；：、]$/;
const ACCENT_MIN_GAP = 40; // frames between accents
const GESTURE_WINDUP = 17; // frames before arrival: windup starts
const GESTURE_SWING = 12;
const GESTURE_LOWER = 15;

/** Stressed-word apexes (frames): the voice step's stressMs when present, else an estimate on the phrase's key word. */
export const accentApexes = (words: TimelineWord[], fps: number, seed: string): Array<{apex: number; amp: number; brow: boolean}> => {
	const phrases: TimelineWord[][] = [];
	let cur: TimelineWord[] = [];
	words.forEach((w, i) => {
		cur.push(w);
		const next = words[i + 1];
		if (!next || PHRASE_END.test(w.text) || next.startMs - w.endMs >= 250) {
			phrases.push(cur);
			cur = [];
		}
	});
	const out: Array<{apex: number; amp: number; brow: boolean}> = [];
	let sign = rand(`${seed}:sign`) < 0.5 ? 1 : -1;
	let last = -Infinity;
	phrases.forEach((p, k) => {
		if (p.length < 2) return;
		if (k > 0 && rand(`${seed}:keep:${k}`) < 0.45) return; // accent about half of the phrases (MO11)
		const stressed = [...p].reverse().find((w) => w.stressMs !== undefined);
		let apexMs: number;
		if (stressed && stressed.stressMs !== undefined) apexMs = stressed.stressMs;
		else {
			const tail = p.slice(-3);
			const key = [...tail].reverse().find((w) => normWord(w.text).length >= 5) ?? tail.reduce((a, b) => (normWord(b.text).length > normWord(a.text).length ? b : a));
			apexMs = key.startMs + Math.min(150, 0.35 * (key.endMs - key.startMs));
		}
		const apex = msToFrame(apexMs, fps);
		if (apex - last < ACCENT_MIN_GAP) return;
		last = apex;
		out.push({apex, amp: sign * (1.2 + 0.8 * rand(`${seed}:amp:${k}`)), brow: out.length % 3 === 1});
		sign = -sign;
	});
	return out;
};

/** Merge point gestures that would overlap into one held point (the arm stays up between close items). */
const mergeGestures = (gs: Gesture[]): Gesture[] => {
	const sorted = [...gs].sort((a, b) => a.frame - b.frame);
	const out: Gesture[] = [];
	for (const g of sorted) {
		const prev = out[out.length - 1];
		if (prev && g.frame - GESTURE_WINDUP <= prev.frame + prev.hold + GESTURE_LOWER + 4) prev.hold = Math.max(prev.hold, g.frame + g.hold - prev.frame);
		else out.push({...g});
	}
	return out;
};

export const scheduleZoo = (plan: ZooPlan): ZooSchedule => {
	const {fps, frames, seed} = plan;
	const accents = accentApexes(plan.words, fps, seed);
	const gestures = plan.view === 'front' ? mergeGestures(plan.gestures ?? []) : [];
	const forced: Array<{start: number; long: boolean}> = [];
	for (const c of plan.changes ?? []) forced.push({start: c.frame - 2, long: false}); // closed on frame c
	for (const f of plan.longBlinks ?? []) forced.push({start: f, long: true});
	// phrase-end pauses of 11 f or more (LP7)
	const pauses: number[] = [];
	plan.words.forEach((w, i) => {
		const next = plan.words[i + 1];
		const gapEnd = next ? next.startMs : null;
		if (gapEnd !== null && msToFrame(gapEnd - w.endMs, fps) >= 11) pauses.push(msToFrame(w.endMs, fps) + 2);
	});
	// natural blinks, 2-6 s apart (60-180 f), seeded
	const natural: number[] = [];
	let f = Math.round(18 + rand(`${seed}:b0`) * 36);
	for (let i = 1; f < frames + 30; i++) {
		natural.push(f);
		f += Math.round(60 + rand(`${seed}:b${i}`) * 120);
	}
	const busy = (s: number, len: number, list: Array<{start: number; long: boolean}>, pad: number) =>
		list.some((b) => s < b.start + (b.long ? LONG_BLINK_LEN : BLINK_LEN) + pad && b.start < s + len + pad);
	const nearAccent = (s: number) => accents.some((a) => s + 2 >= a.apex - 3 && s + 2 <= a.apex + 3);
	const blinks = [...forced];
	for (const p of pauses) if (!busy(p, BLINK_LEN, blinks, 30) && !nearAccent(p)) blinks.push({start: p, long: false});
	for (let s of natural) {
		if (nearAccent(s)) s += 6;
		if (!busy(s, BLINK_LEN, blinks, 36)) blinks.push({start: s, long: false});
	}
	blinks.sort((a, b) => a.start - b.start);
	return {plan, blinks, accents, gestures};
};

const accentShape = (d: number): number => (d < -3 || d > 9 ? 0 : d <= 0 ? EASE.quadOut((d + 3) / 3) : 1 - EASE.sinInOut(d / 9));

const lastChange = <K extends 'expression' | 'view'>(changes: ZooChange[] | undefined, f: number, key: K): ZooChange[K] | undefined => {
	let v: ZooChange[K] | undefined;
	for (const c of changes ?? []) if (c.frame <= f && c[key] !== undefined) v = c[key];
	return v;
};

/** Eye dart: 80% of the travel on the first frame, settled on the second, hold, dart back (MO12). */
const dart = (f: number, at: number, hold: number, to: number): number => {
	const d = f - at;
	if (d < 0 || d > hold + 2) return 0;
	if (d === 0) return to * 0.8;
	if (d <= hold) return to;
	return d === hold + 1 ? to * 0.2 : 0;
};

export const zooAt = (s: ZooSchedule, frame: number): ZooFrame => {
	const p = s.plan;
	const f = Math.max(0, frame);
	// blink
	let blink = 0;
	for (const b of s.blinks) {
		const d = f - b.start;
		if (d >= 0 && d <= (b.long ? LONG_BLINK_LEN : BLINK_LEN)) blink = Math.max(blink, b.long ? longBlinkShape(d) : blinkShape(d));
	}
	// head accents + brow
	let headTilt = 0;
	let browLift = 0;
	for (const a of s.accents) {
		const v = accentShape(f - a.apex);
		headTilt += a.amp * v;
		if (a.brow) browLift = Math.max(browLift, 0.55 * v);
	}
	for (const b of p.browBeats ?? []) browLift = Math.max(browLift, track(f, [[b, 0], [b + 4, 1], [b + 20, 1], [b + 30, 0]], EASE.inOut));
	// point gesture
	let poseAmount = 0;
	let pointWindup = 0;
	let lean = 0;
	let gestureLook = 0;
	for (const g of s.gestures) {
		const a = g.frame; // arrival
		const s0 = a - GESTURE_SWING; // swing start
		const w0 = a - GESTURE_WINDUP;
		const down = a + g.hold;
		if (f < w0 - 2 || f > down + GESTURE_LOWER + 10) continue;
		poseAmount = Math.max(poseAmount, f < down ? track(f, [[s0, 0], [a, 1]], EASE.gesture) : track(f, [[down, 1], [down + GESTURE_LOWER, 0]], EASE.inOut));
		pointWindup = Math.max(pointWindup, track(f, [[w0, 0], [s0, 1], [s0 + 6, 0]], EASE.inOut));
		lean = track(f, [[w0, 0], [s0, -1.0], [a + 2, 1.4], [down, 1.4], [down + GESTURE_LOWER, 0]], EASE.inOut);
		gestureLook = track(f, [[w0 + 1, 0], [w0 + 3, 0.75], [down, 0.75], [down + 6, 0]], EASE.inOut);
	}
	headTilt += lean;
	// look: gesture eyes lead the hand; otherwise eye darts; otherwise the base look (camera)
	let lookX = p.baseLook?.lookX ?? 0;
	let lookY = p.baseLook?.lookY ?? 0;
	for (const g of p.glances ?? []) {
		const dx = dart(f, g.frame, g.hold, g.lookX - lookX);
		const dy = dart(f, g.frame, g.hold, g.lookY - lookY);
		if (dx !== 0 || dy !== 0) {
			lookX += dx;
			lookY += dy;
			break;
		}
	}
	if (gestureLook > 0) lookX = gestureLook;
	const mouth: MouthShape = f < p.mouth.length ? p.mouth[f] : 'closed';
	return {
		mouth,
		blink,
		headTilt: Math.max(-8, Math.min(8, headTilt)),
		browLift: Math.min(1, browLift),
		lookX,
		lookY,
		pose: s.gestures.length ? 'point' : 'stand',
		poseAmount,
		pointWindup,
		expression: lastChange(p.changes, f, 'expression') ?? p.expression,
		view: lastChange(p.changes, f, 'view') ?? p.view,
	};
};
