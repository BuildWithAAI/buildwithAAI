/**
 * Pure motion helpers for the episode engine (ART_GUIDE section 6). No Remotion import, so the Node tests can run the
 * exact functions the components use. Everything is a function of the frame; randomness only from seeded `rand`.
 */

export type EaseFn = (t: number) => number;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** CSS-style cubic-bezier easing (x1, x2 in [0, 1]); Newton steps with a bisection fallback. */
export const bezier = (x1: number, y1: number, x2: number, y2: number): EaseFn => {
	const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
	const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
	const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
	const sy = (t: number) => ((ay * t + by) * t + cy) * t;
	const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
	return (x: number) => {
		if (x <= 0) return 0;
		if (x >= 1) return 1;
		let t = x;
		for (let i = 0; i < 8; i++) {
			const e = sx(t) - x;
			if (Math.abs(e) < 1e-6) return sy(t);
			const d = dx(t);
			if (Math.abs(d) < 1e-6) break;
			t -= e / d;
		}
		let lo = 0, hi = 1;
		t = x;
		for (let i = 0; i < 30; i++) {
			const v = sx(t);
			if (Math.abs(v - x) < 1e-6) break;
			if (v < x) lo = t;
			else hi = t;
			t = (lo + hi) / 2;
		}
		return sy(t);
	};
};

/** Easing presets. Body moves ease in and out (MO1); decelerate-only curves are for text and UI entering (MO2). */
export const EASE = {
	inOut: bezier(0.45, 0, 0.25, 1), // same curve as the character proof (src/compositions/characters/stage.ts)
	minJerk: (t: number) => {
		const u = clamp01(t);
		return u * u * u * (u * (6 * u - 15) + 10);
	},
	sinInOut: (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t)),
	gesture: bezier(0.35, 0, 0.15, 1), // quick start, long soft settle (point gesture)
	decel: bezier(0.16, 1, 0.3, 1), // text/UI entering after a cut (MO2)
	quadIn: (t: number) => clamp01(t) ** 2,
	quadOut: (t: number) => 1 - (1 - clamp01(t)) ** 2,
	linear: (t: number) => clamp01(t),
} as const;

/**
 * Keyframe track: [[frame, value], ...] ascending; eased per segment; held before the first and after the last key.
 * `ease` may be one function for every segment or one per segment.
 */
export const track = (frame: number, keys: ReadonlyArray<readonly [number, number]>, ease: EaseFn | EaseFn[] = EASE.inOut): number => {
	if (!keys.length) return 0;
	if (frame <= keys[0][0]) return keys[0][1];
	const last = keys[keys.length - 1];
	if (frame >= last[0]) return last[1];
	for (let k = 0; k < keys.length - 1; k++) {
		const [f0, v0] = keys[k];
		const [f1, v1] = keys[k + 1];
		if (frame >= f0 && frame <= f1) {
			if (f1 === f0) return v1;
			const e = Array.isArray(ease) ? ease[k] ?? EASE.inOut : ease;
			return v0 + (v1 - v0) * e((frame - f0) / (f1 - f0));
		}
	}
	return last[1];
};

/** Deterministic PRNG in [0, 1) from a string seed (FNV-1a hash into mulberry32). */
export const rand = (seed: string): number => {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	let a = h >>> 0;
	a = (a + 0x6d2b79f5) >>> 0;
	let t = a;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Standard blink, 7 f: close 2 (ease-in), shut 1, open 4 (ease-out) (ART_GUIDE LP6). t = frames since the blink start. */
export const blinkShape = (t: number): number => track(t, [[0, 0], [2, 1], [3, 1], [7, 0]], [EASE.quadIn, EASE.linear, EASE.quadOut]);
/** Long deadpan blink, 18 f: close 4, shut 6, open 8 (LP6). */
export const longBlinkShape = (t: number): number => track(t, [[0, 0], [4, 1], [10, 1], [18, 0]], [EASE.sinInOut, EASE.linear, EASE.sinInOut]);
export const BLINK_LEN = 7;
export const LONG_BLINK_LEN = 18;

export const msToFrame = (ms: number, fps: number): number => Math.round((ms * fps) / 1000);
export const frameToMs = (f: number, fps: number): number => (f * 1000) / fps;
