/**
 * ZOO mouth library (matches reference/crops/zoo_mouth_*.png). Coordinates are mouth-local units:
 * origin = PIVOTS.jaw (0, -769.6), the line where the closed mouth sits just under the moustache.
 * Sizes are matched RELATIVE TO THE MOUSTACHE (decision ZOO-M1: the mouth panels draw the lower face ~19% narrower
 * than the turnaround; measured that way 'oh' is 17 x 15.5 u vs the panel's 16.7 x 14.9 and 'ah' 28 x 19 vs 25 x 19.6).
 * Repair round 1 (ZOO-M2): line shapes are thin dark-brown lip lines (beardShadow), open shapes have a thin rim.
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
			/**
			 * The dark upper cavity above the tongue (repair round 4), drawn in the hair/brow ink (ZOO_COLORS.brow, the face's
			 * near-black brown accent, as in the front crown hollow, ZOO-H1) and clipped to the opening.
			 */
			cavity?: Pt[];
			teeth?: {shape: Pt[]; divider: Pt[]};
			hole: number;
			jaw: number;
	  };

export const MOUTHS: Record<MouthShape, MouthSpec> = {
	closed: {
		kind: 'line',
		line: [[-12.5, 0.15], [-6, 0], [0, 0], [6, 0], [13, 0.15]],
		width: 1.6,
		hole: 0,
		jaw: 0,
	},
	slightlyOpen: {
		kind: 'open',
		top: [[-12.2, -0.3, 'c'], [-6, -1.3], [0, -1.5], [6, -1.3], [12.6, -0.3, 'c']],
		bottom: [[8, 2.7], [0, 3.9], [-8, 2.7]],
		hole: 1,
		jaw: 0.5,
	},
	// Repair round 4 (decision ZOO-M3; re-traced from zoo_mouth_ah.png): an oval with an ARCHED top, narrowest at its top row,
	// the corners at ~47% of the opening's height and the widest row at ~57%, a round bottom; ~28 x 16 u with the rim (the
	// panel's 24 x 16.5 widened to the turnaround moustache, ZOO-M1/M2). The arch sits ~2 u under the moustache's lower edge
	// so it shows as an arch with skin around it, as on the panel. Round 1-3's ah was a flat-topped D, widest at its top row
	// with straight sides (32 cols at 8-17% of its height), which read as an open grin. The cavity above the tongue is
	// near-black, as on the panel.
	ah: {
		kind: 'open',
		top: [[-13.4, 3.4], [-12.4, 0.6], [-8.4, -2], [0, -3.8], [8.4, -2], [12.4, 0.6], [13.4, 3.4]],
		bottom: [[13.6, 6.4], [12, 9.2], [7.6, 11], [0, 11.6], [-7.6, 11], [-12, 9.2], [-13.6, 6.4]],
		tongue: [[-12.6, 10.2], [-6.2, 6.4], [0, 5.6], [6.2, 6.4], [12.6, 10.2], [0, 15.6]],
		cavity: [[-16, -7], [16, -7], [16, 8], [12, 8], [6.2, 5.2], [0, 4.4], [-6.2, 5.2], [-12, 8], [-16, 8]],
		// the panel's lip patch drops ~6 u and its chin not at all (chin outline -741.6 vs closed -742.1): round 1-3 dropped the
		// chin 2.5 u
		hole: 6.8,
		jaw: 1,
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
	// Repair round 4 (ZOO-M3; zoo_mouth_oh.png): an egg, narrow at the top and widest at ~55% of its height, ~13.4 x 13 u with
	// the rim (panel ~13 x 12.5); round 1-3's oh widened to full width within 6 px of its top and kept straight sides (a
	// tombstone, 14.8 x 14 u).
	oh: {
		kind: 'open',
		top: [[-5.8, 1.6], [-5, -1.4], [-2.8, -3.4], [0.3, -4], [3.4, -3.4], [5.6, -1.4], [6.4, 1.6]],
		bottom: [[6.6, 3.8], [5.6, 6.2], [3.2, 7.8], [0.3, 8.3], [-2.6, 7.8], [-5, 6.2], [-6, 3.8]],
		tongue: [[-6.4, 6.6], [0.3, 3.4], [7, 6.6], [0.3, 10.6]],
		cavity: [[-9, -6], [9.6, -6], [9.6, 4.6], [5, 4.6], [0.3, 2.4], [-4.4, 4.6], [-9, 4.6]],
		hole: 4.4,
		jaw: 0.6,
	},
	mbp: {
		kind: 'line',
		line: [[-12, -0.3], [-6, 0.35], [0, 0.55], [6, 0.35], [12.4, -0.3]],
		width: 1.9,
		lowerLip: [[-6.5, 3.5], [0, 4.3], [6.5, 3.5]],
		hole: -0.8,
		jaw: -0.3,
	},
};

/**
 * The shocked expression's own open mouth (repair round 4, decision ZOO-E3; zoo_expr_shocked.png at 0.699 u/px): a gasp, not
 * a grin. An arched top that is narrowest at its top row, low corners and the widest rows in the lower half (43-83% of the
 * height), a broad round bottom; ~23 x 11.5 u with the rim. It is a drawing of the "ah" library shape as the shocked panel
 * performs it, used only when the expression is shocked and no explicit mouth is passed, so the fixed six-shape lip-sync
 * library is unchanged. Round 1-3 squashed the library ah (60% open, 95% wide), which kept ah's flat top and read as an
 * excited open smile.
 */
export const SHOCKED_MOUTH: MouthSpec = {
	kind: 'open',
	top: [[-11.2, 3.2], [-10.4, 0.4], [-7.8, -2], [-4.4, -3.3], [0, -3.6], [4.4, -3.3], [7.8, -2], [10.4, 0.4], [11.2, 3.2]],
	bottom: [[11, 5], [7.8, 5.8], [0, 6.1], [-7.8, 5.8], [-11, 5]],
	tongue: [[-10.4, 6.4], [-5, 3.6], [0, 3], [5, 3.6], [10.4, 6.4], [0, 9.6]],
	cavity: [[-14, -7], [14, -7], [14, 3.2], [8, 3.2], [5, 2.2], [0, 1.6], [-5, 2.2], [-8, 3.2], [-14, 3.2]],
	hole: 4,
	jaw: 0.6,
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
