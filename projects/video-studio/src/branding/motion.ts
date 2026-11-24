/**
 * Motion helpers for the branding animations: pure functions of the frame (30 fps), seeded randomness only
 * (ART_GUIDE section 6: seeded randomness only, never component state). Curves and timings follow ART_GUIDE MO1-MO3, LP6, LP7.
 */
import {Easing, interpolate, random} from 'remotion';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** Minimum-jerk ease (MO1) for character moves. */
export const minJerk = (t: number) => {
	const x = Math.max(0, Math.min(1, t));
	return x * x * x * (x * (6 * x - 15) + 10);
};

/** 0..1 progress of a move from frame a to frame b with the given easing. */
export const progress = (frame: number, a: number, b: number, easing: (t: number) => number = minJerk) =>
	interpolate(frame, [a, b], [0, 1], {...clamp, easing});

/** Decelerate-only curve for text and UI entering after a cut (MO2). */
export const decel = Easing.bezier(0.16, 1, 0.3, 1);

/** Standard 7-frame blink (LP6): close over 2 f (ease-in), shut 1 f, open over 4 f (ease-out). 0 open .. 1 shut. */
export const blinkCurve = (t: number): number => {
	if (t <= 0 || t >= 7) return 0;
	if (t < 2) return (t / 2) ** 2;
	if (t <= 3) return 1;
	const p = (t - 3) / 4;
	return (1 - p) ** 2;
};

/** Seeded blink starts, 45-150 f apart (LP7). */
export const blinkStarts = (seed: string, total: number, minGap = 45, maxGap = 150): number[] => {
	const out: number[] = [];
	let f = Math.round(20 + random(`${seed}-0`) * 40);
	let i = 1;
	while (f < total) {
		out.push(f);
		f += Math.round(minGap + random(`${seed}-${i++}`) * (maxGap - minGap));
	}
	return out;
};

/** Blink amount (0 open .. 1 shut) at `frame` for a precomputed schedule. */
export const blinkAt = (frame: number, starts: readonly number[]) => starts.reduce((v, s) => Math.max(v, blinkCurve(frame - s)), 0);
