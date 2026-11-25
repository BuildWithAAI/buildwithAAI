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
	| {
			kind: 'line';
			line: Pt[];
			width: number;
			lowerLip?: Pt[];
			/** Optional filled lower-lip band in skinShadow under the line (the happy smile: a thin arc since round 5, ZOO-E5). */
			band?: Pt[];
			hole: number;
			jaw: number;
	  }
	| {
			kind: 'open';
			/** Upper edge, left corner -> right corner. */
			top: Pt[];
			/** Lower edge, right -> left (corners excluded). */
			bottom: Pt[];
			/**
			 * The tongue, clipped to the opening. The rest of the opening shows the maroon mouthInterior, as on the panels
			 * (repair round 5, ZOO-M4: round 4 painted the cavity above the tongue in the near-black brow ink, which read as a
			 * black hole).
			 */
			tongue?: Pt[];
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
		// Repair round 5 (ZOO-M4; zoo_mouth_slightly_open.png): a symmetric lens, 3.8 u between its top and bottom curves with
		// pointed corners at ~54% of its height, the widest row there (the panel: 25.5 x 4.9 u with its thin rim, widest at 55%).
		// Rounds 1-4 drew a D (a flat top 1.2 u over the corners and a bottom 4.2 u under them), widest at 20-33%.
		top: [[-12.2, 0.75, 'c'], [-6, -0.85], [0, -1.3], [6, -0.85], [12.6, 0.75, 'c']],
		bottom: [[8, 2.0], [0, 2.5], [-8, 2.0]],
		hole: 1,
		jaw: 0.5,
	},
	// Repair round 4 (decision ZOO-M3; re-traced from zoo_mouth_ah.png): an oval with an ARCHED top, narrowest at its top row,
	// the corners at ~47% of the opening's height and the widest row at ~55%, a round bottom. The arch sits ~2 u under the
	// moustache's lower edge so it shows as an arch with skin around it, as on the panel. Round 1-3's ah was a flat-topped D,
	// widest at its top row with straight sides (32 cols at 8-17% of its height), which read as an open grin. Repair round 5
	// (ZOO-M4): narrowed from ~28.8 to ~24.5 u with the rim at the same 16.5 u height (the panel: 23.5 x 16.5 u; round 4 had
	// widened the panel's width to the turnaround moustache but not its height, so it read ~20% squatter) and the bottom
	// rounded (its last row ~30% of the widest, the panel's 26%; round 4: 40%).
	ah: {
		kind: 'open',
		top: [[-11.2, 3.2], [-10.5, 0.7], [-7.4, -1.9], [0, -3.8], [7.4, -1.9], [10.5, 0.7], [11.2, 3.2]],
		bottom: [[11.4, 5.9], [9.9, 8.6], [6.2, 10.7], [0, 11.7], [-6.2, 10.7], [-9.9, 8.6], [-11.4, 5.9]],
		tongue: [[-10.6, 9.4], [-5.2, 6.1], [0, 5.4], [5.2, 6.1], [10.6, 9.4], [0, 15.6]],
		// the panel's lip patch drops ~6 u and its chin not at all (chin outline -741.6 vs closed -742.1): round 1-3 dropped the
		// chin 2.5 u
		hole: 6.8,
		jaw: 1,
	},
	// Repair round 6 (R5 review; zoo_mouth_ee.png measured relative to its moustache): a flatter lozenge, ~31 x 9.8 u with the
	// rim and ~27 x 6.4 u of visible teeth (the panel: 0.55 x 0.14 of its moustache; round 1-5: 35 x 11.7 u), the upper and
	// lower teeth parted by a thin light-grey line (Mouth.tsx `divider`; rounds 1-5 split them with a heavy near-black stroke the
	// panel does not draw).
	ee: {
		kind: 'open',
		top: [[-13.9, -1.8], [-10.6, -3], [0, -3.4], [10.6, -3], [14.3, -1.8]],
		bottom: [[14.9, 0.6], [11.6, 3.6], [0, 4.8], [-11.1, 3.6], [-14.5, 0.6]],
		teeth: {
			shape: [[-12.4, -2.9], [0, -3.2], [12.7, -2.9], [13.9, 0.6], [11.2, 3.3], [0, 4.5], [-10.8, 3.3], [-13.4, 0.6]],
			divider: [[-12.1, 0.6], [0, 1.2], [12.5, 0.6]],
		},
		hole: 1.6,
		jaw: 0.8,
	},
	// Repair round 4 (ZOO-M3; zoo_mouth_oh.png): an egg, narrow at the top and widest at ~55% of its height; round 1-3's oh
	// widened to full width within 6 px of its top and kept straight sides (a tombstone, 14.8 x 14 u). Repair round 6 (R5 review):
	// ~13.3 x 13 u with the rim (0.27 of the moustache's width, as on the panel; round 4-5: 14.0 x 13.6) and a ROUND bottom that
	// narrows into its lowest point (round 4-5 kept ~35% of the widest row at the bottom, a flat-bottomed U).
	oh: {
		kind: 'open',
		top: [[-5.6, 2.6], [-4.35, -0.55], [-2.2, -2.86], [0.3, -3.7], [2.8, -2.86], [4.95, -0.55], [6.2, 2.6]],
		bottom: [[5.6, 4.9], [3.8, 6.6], [1.7, 7.5], [0.3, 7.75], [-1.1, 7.5], [-3.2, 6.6], [-5, 4.9]],
		tongue: [[-6.4, 5.8], [0.3, 3.1], [7, 5.8], [0.3, 9.8]],
		hole: 4.2,
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
	// Repair round 5 (ZOO-M4): the whole gasp sits 2 u lower, so its arch clears the moustache by ~2.6 u as on the panel
	// (~2.9 u; round 4: ~0.6 u), and the lip patch drops with it (hole 4 -> 6).
	top: [[-11.2, 5.2], [-10.4, 2.4], [-7.8, 0], [-4.4, -1.3], [0, -1.6], [4.4, -1.3], [7.8, 0], [10.4, 2.4], [11.2, 5.2]],
	bottom: [[11, 7], [7.8, 7.8], [0, 8.1], [-7.8, 7.8], [-11, 7]],
	tongue: [[-10.4, 8.4], [-5, 5.6], [0, 5], [5, 5.6], [10.4, 8.4], [0, 11.6]],
	hole: 6,
	jaw: 0.6,
};

/**
 * The happy expression's own closed mouth (repair round 5, decision ZOO-E5; re-placed in round 6, ZOO-E6; zoo_expr_happy.png at
 * 0.699 u/px): a thin smile line ~33 u wide under the levelled moustache, its middle 2.5 u above the closed line so it sits
 * ~4.4 u under the moustache's lower edge as on the panel (round 5: 1.4 u, under the old crescent), almost flat before the
 * expression's corner lifts: it falls 0.6 u toward the screen right, so the larger right lift still leaves it <= 3 u deep.
 * With EXPRESSIONS.happy's corners (1.5 / 3 u) it is the locked "small asymmetric smirk": its ends sit ~1.8 u (screen left)
 * and ~2.7 u (screen right) above its lowest point and show ~2.5-3 u under the lifted moustache ends. A thin lower-lip arc
 * (<= 0.8 u, skinShadow) sits ~2.5 u under its middle. It is the happy REST mouth (rig.ts mouthFor: no mouth or 'closed');
 * lip-sync draws the library. Round 4 (ZOO-E4) drew a 40 u U-line dipping 3.4 u with a filled lip crescent up to 4 u thick.
 */
export const HAPPY_MOUTH: MouthSpec = {
	kind: 'line',
	line: [[-15.6, -2.8], [-8, -2.52], [0, -2.5], [8, -2.4], [15.9, -2.2]],
	width: 1.9,
	band: [[-8.6, -0.15, 'c'], [-4, 0.15], [1, 0.25], [6, 0.05], [9.8, -0.4, 'c'], [6, 0.65], [1, 0.95], [-4, 0.8]],
	hole: 0.3,
	jaw: 0,
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
