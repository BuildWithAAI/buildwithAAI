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
		line: [[-12.5, 0.15], [-6, 0], [0, 0], [6, 0], [13, 0.15]],
		width: 2.1,
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
		top: [[-12, -2.6], [-7.2, -4.5], [0, -4.9], [7.2, -4.5], [12.6, -2.6]],
		bottom: [[13.4, 2.6], [11.4, 8.8], [6, 12.8], [0, 13.8], [-6, 12.8], [-11, 8.8], [-13, 2.6]],
		tongue: [[-11, 11.5], [-5.5, 7], [0, 6.3], [5.5, 7], [11.5, 11.5], [0, 17]],
		hole: 6.5,
		jaw: 2.5,
	},
	ee: {
		kind: 'open',
		top: [[-15.6, -2.4], [-12, -3.9], [0, -4.3], [12, -3.9], [16.1, -2.4]],
		bottom: [[16.9, 0.6], [13, 4.6], [0, 6.4], [-12.5, 4.6], [-16.4, 0.6]],
		teeth: {
			shape: [[-14, -3.6], [0, -4], [14.4, -3.6], [15.6, 0.6], [12.6, 4.2], [0, 5.9], [-12.2, 4.2], [-15.1, 0.6]],
			divider: [[-13.6, 0.4], [0, 1.4], [14.1, 0.4]],
		},
		hole: 2,
		jaw: 1,
	},
	oh: {
		kind: 'open',
		top: [[-5.6, -2.2], [0.3, -4], [6.2, -2.2]],
		bottom: [[7.8, 2.8], [6.4, 7.8], [0.3, 10.2], [-5.8, 7.8], [-7.2, 2.8]],
		tongue: [[-6.6, 8.2], [0.3, 5.6], [7.2, 8.2], [0.3, 12.6]],
		hole: 5,
		jaw: 2,
	},
	mbp: {
		kind: 'line',
		line: [[-12, -0.3], [-6, 0.35], [0, 0.55], [6, 0.35], [12.4, -0.3]],
		width: 2.5,
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
