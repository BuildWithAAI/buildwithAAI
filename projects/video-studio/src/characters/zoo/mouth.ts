/**
 * ZOO mouth library (matches reference/crops/zoo_mouth_*.png). Coordinates are mouth-local units:
 * origin = PIVOTS.jaw (0, -768.3), the line where the closed mouth sits just under the moustache.
 * `hole` drops the top edge of the chin beard (lower-lip skin patch) and `jaw` drops the chin
 * outline, so the beard and jaw stay one coherent shape when the mouth opens.
 */
import type {MouthShape} from '../types';
import type {Pt} from './geometry';

export type MouthSpec =
	| {kind: 'line'; line: Pt[]; width: number; lowerLip?: Pt[]; hole: number; jaw: number}
	| {
			kind: 'open';
			/** Upper edge, left corner -> right corner. */
			top: Pt[];
			/** Lower edge, right -> left (corners excluded). */
			bottom: Pt[];
			tongue?: Pt[];
			teeth?: {shape: Pt[]; divider: Pt[]};
			hole: number;
			jaw: number;
	  };

export const MOUTHS: Record<MouthShape, MouthSpec> = {
	closed: {
		kind: 'line',
		line: [[-12.5, 0.3], [-6, -0.15], [0, -0.3], [6, -0.15], [13, 0.3]],
		width: 2.25,
		hole: 0,
		jaw: 0,
	},
	slightlyOpen: {
		kind: 'open',
		top: [[-12.2, -0.3, 'c'], [-6, -1.1], [0, -1.25], [6, -1.1], [12.6, -0.3, 'c']],
		bottom: [[8, 2.4], [0, 3.5], [-8, 2.4]],
		hole: 1,
		jaw: 0.5,
	},
	ah: {
		kind: 'open',
		top: [[-11.2, -2.6], [-6.8, -4.5], [0, -4.9], [6.8, -4.5], [11.8, -2.6]],
		bottom: [[12.6, 2.6], [10.6, 8.8], [5.6, 12.8], [0, 13.8], [-5.6, 12.8], [-10.2, 8.8], [-12.2, 2.6]],
		tongue: [[-11, 11.5], [-5.5, 7], [0, 6.3], [5.5, 7], [11.5, 11.5], [0, 17]],
		hole: 6.5,
		jaw: 2.5,
	},
	ee: {
		kind: 'open',
		top: [[-15.6, -2.4], [-12, -3.9], [0, -4.3], [12, -3.9], [16.1, -2.4]],
		bottom: [[16.9, 1.2], [13, 5], [0, 5.8], [-12.5, 5], [-16.4, 1.2]],
		teeth: {
			shape: [[-13.4, -3.3], [0, -3.7], [13.8, -3.3], [15, 1], [12.8, 4.4], [0, 5.1], [-12.3, 4.4], [-14.6, 1]],
			divider: [[-13.6, 0.7], [0, 1.1], [14.1, 0.7]],
		},
		hole: 2,
		jaw: 1,
	},
	oh: {
		kind: 'open',
		top: [[-4.9, -2.4], [0.3, -4.1], [5.5, -2.4]],
		bottom: [[7, 2.6], [5.8, 8.2], [0.3, 10.8], [-5.2, 8.2], [-6.4, 2.6]],
		tongue: [[-6, 8.6], [0.3, 5.8], [6.6, 8.6], [0.3, 13]],
		hole: 5,
		jaw: 2,
	},
	mbp: {
		kind: 'line',
		line: [[-12, 0.5], [-6, -0.1], [0, -0.45], [6, -0.1], [12.4, 0.5]],
		width: 2.8,
		lowerLip: [[-6.5, 3.5], [0, 4.3], [6.5, 3.5]],
		hole: -0.8,
		jaw: -0.3,
	},
};

/** Openness order used by amplitude-driven sync. */
const LEVELS: MouthShape[] = ['closed', 'slightlyOpen', 'oh', 'ah'];
const THRESHOLDS = [0.1, 0.3, 0.55]; // boundaries between consecutive LEVELS
const HYSTERESIS = 0.05;

const levelOf = (s: MouthShape | undefined | null): number | null => {
	if (!s) return null;
	if (s === 'mbp') return 0;
	if (s === 'ee') return 2;
	const i = LEVELS.indexOf(s);
	return i < 0 ? null : i;
};

/**
 * Pick a mouth shape for an audio amplitude (0..1, e.g. a smoothed RMS envelope).
 * Returns one of closed / slightlyOpen / oh / ah. `prevShape` adds hysteresis so the mouth does
 * not flicker between neighbours when the amplitude hovers on a threshold.
 */
export const amplitudeToMouth = (amplitude: number, prevShape?: MouthShape | null): MouthShape => {
	const a = Number.isFinite(amplitude) ? Math.max(0, Math.min(1, amplitude)) : 0;
	let raw = 0;
	while (raw < THRESHOLDS.length && a >= THRESHOLDS[raw]) raw++;
	const prev = levelOf(prevShape);
	if (prev !== null && Math.abs(raw - prev) === 1) {
		const boundary = THRESHOLDS[Math.min(raw, prev)];
		if (Math.abs(a - boundary) < HYSTERESIS) return LEVELS[prev];
	}
	return LEVELS[raw];
};
