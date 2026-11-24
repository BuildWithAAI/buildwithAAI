import {interpolate} from 'remotion';

type EasingFn = (t: number) => number;

/**
 * Keyframe track: [[frame, value], ...] in ascending frame order, eased per segment and held before the
 * first and after the last key. Equal neighbouring values make a hold.
 */
export const track = (frame: number, keys: readonly (readonly [number, number])[], easing?: EasingFn): number => {
	if (keys.length === 1) return keys[0][1];
	return interpolate(
		frame,
		keys.map((k) => k[0]),
		keys.map((k) => k[1]),
		{easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);
};

/** A natural blink: close over `close` frames, hold `hold`, open over `open` (0 open .. 1 closed). */
export const blinkAt = (frame: number, start: number, close = 2, hold = 1, open = 3, easing?: EasingFn): number =>
	track(
		frame,
		[
			[start, 0],
			[start + close, 1],
			[start + close + hold, 1],
			[start + close + hold + open, 0],
		],
		easing,
	);
