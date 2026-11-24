/**
 * Hands. The front-view hands are authored for the ANATOMICAL LEFT hand (screen right) in wrist-local units (origin =
 * wrist pivot, +y down the hand, +x toward the little-finger side); the anatomical right hand is its anatomical mirror
 * within the front view (hands are an unmarked pair, decision ZOO-S1). Every other view draws its own hands
 * (views/Back.tsx, views/threeQuarter/Body34.tsx, views/side/BodySide.tsx) with HandDrawing below; no view maps
 * another view's hand drawing (repair round 2).
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, smooth, smoothRange, tapered, type Pt} from '../geometry';
import {POINT_HAND_FRAME} from '../rig';
import {ZOO_LINE} from '../lines';
import {Clipped, Outline, Shape, Stroke, useLineScale} from './Shape';

export type HandShape = 'relaxed' | 'point' | 'curl';

/**
 * Relaxed front hand (repair round 3; silhouette row-scanned on zoo_turn_front.png in hand-local units, wrist at the cuff
 * centre, both sheet hands compared in this frame). ONE silhouette: the back of the hand is as wide as the cuff, the four
 * fingers hang and curl in toward the thigh, and their tips step down from the little finger (outer, y ~70) to the index
 * (inner, y ~93) as four rounded lobes parted by ~3 u notches (round 2's notches were corner flags on one smooth diagonal,
 * < 0.5 u deep, so the tips read as one "sock toe"). The thumb is a slender lobe on the inner side (tip y ~69). As on the
 * sheet, the thumb and the index are CLOSED from the web down to y ~62 (a crease, RELAXED_CREASES) and part only in a
 * small V below it (open from y ~65): round 2 left a 4-5 u open slot from y ~46, so the thumb read as a separate prong
 * and the hand as a mitten; round 1's 3 u black notch read as a talon.
 */
const RELAXED: Pt[] = [
	[-17, -8], [12, -8], [12.4, 6], [12.8, 20], [14, 31], [14.8, 40], [14.4, 48], [13.2, 55], [12, 60.5],
	// little finger
	[11, 64.8], [10.1, 68.3], [8.4, 70.4], [6.1, 68.9, 'c'],
	// ring finger
	[6, 72.4], [5.2, 76], [3.6, 78.4], [1.6, 79.2], [-0.3, 77.8, 'c'],
	// middle finger
	[-1, 81], [-2.4, 84.2], [-4.6, 86.4], [-7.4, 87.3], [-10.1, 85.7, 'c'],
	// index finger, round its tip and up its inner side to the web notch
	[-11, 88.2], [-13.2, 90.8], [-16.4, 92.6], [-20.2, 93.4], [-23.4, 91.8], [-25, 87.6], [-24.6, 83], [-22.8, 79], [-20.6, 75],
	[-19, 70.8], [-18, 66.2], [-17.6, 61.2, 'c'],
	// thumb: tip, then its outer edge back up to the wrist
	[-21.2, 63.6], [-24, 67], [-26.4, 69.4], [-28.6, 68.4], [-30, 64.6], [-30.4, 57], [-30, 47], [-29.4, 37], [-28.2, 28.6],
	[-26, 21], [-22.6, 14], [-19.2, 7.6], [-17.6, 0],
];
/** The small V between the thumb tip and the index (key points 32..35 of RELAXED): drawn at the detail width. */
const RELAXED_THIN = {from: 32, to: 35} as const;
/**
 * Finger separations and the thumb crease (repair round 3), as on zoo_turn_front.png: tapered warm-brown creases at
 * ZOO_LINE.detail from each tip notch up ALONG the fingers, which lean in toward the thigh ("/" on the screen-right hand),
 * ~15 / 23 / 31 u long (sheet ~11-31 u; round 2's were 8-12 u at the fine width, 1.2 px in the proof, and only one read).
 * The last line is the thumb/index seam from the web notch up to the web (sheet: a mid-tone crease from y ~43 to ~62).
 */
const RELAXED_SEPARATIONS: Pt[][] = [
	[[6.1, 68.9], [8.6, 62.2], [10.6, 55]],
	[[-0.3, 77.8], [3, 66.8], [6.6, 56]],
	[[-10.1, 85.7], [-4.2, 71], [0.6, 56.4]],
	// the thumb seam runs the other way: full width at the web (where the fold is deepest), easing toward the V notch
	[[-17.3, 46], [-17.8, 53.4], [-17.6, 61.2]],
];
/** The shadowed web at the top of the thumb crease: a small near-black teardrop (the sheet's dark apex at y ~42-48). */
const RELAXED_WEB = {pts: [[-17, 42.6], [-17.2, 45.2], [-17.3, 48.2]] as Pt[], width: 2.4};
/** One flat skin-shadow plane on the index finger, under the thumb (thumb-side terminator). */
const RELAXED_SHADOW: Pt[] = [[-36, 66], [-26, 72], [-21.6, 77.4], [-19.4, 82.6], [-17, 88.4], [-13.6, 94], [-24, 100], [-36, 96]];

/**
 * Pointing hand, in a pose frame: wrist pivot (cuff end centre) at the origin, index along +x, the top of the hand at -y.
 * Repair round 2 (decision ZOO-P4): traced on zoo_pose_point.png with a world grid, relative to the cuff end centre and
 * the panel's index line. The hand is an UPRIGHT fist: its back rises from the cuff at ~45 deg, the index runs straight
 * out from the TOP of the hand (its tip ~48 u above the wrist line), and under it the thumb tip rests on the three
 * curled fingers, whose knuckle lobes step back toward the little finger. Round 1's hand put the index only ~9 u above
 * the wrist with the thumb on top, so the rig had to tilt the whole hand ~26 deg up to reach the panel's height (an
 * upward jab). Drawn at PS = 0.92 of the panel (the panel draws hands ~25% large, like its head, ZOO-T1): ~111 u from
 * the wrist to the index tip, 13% longer than round 1's pointer, as the review asked.
 */
const PS = 0.92;
const sc = (pts: Pt[]): Pt[] => pts.map((p) => (p.length === 3 ? [p[0] * PS, p[1] * PS, 'c'] : [p[0] * PS, p[1] * PS]));
/**
 * The back of the hand from under the cuff to the index knuckle (shared by the pointer and the loose fist). The first and
 * last key points sit inside the cuff for every wrist angle the posed hands use (hand-frame rotation 110..132 deg), so no
 * part of the hand base shows past the cuff's corners.
 */
const P_BACK: Pt[] = [[-13.6, -5.8], [-9, -14], [-3, -22], [3, -30], [10, -38], [18, -46], [27, -52], [37, -55.5]];
/** Thumb tip and the three curled fingers' knuckle lobes, down to the palm edge and back under the cuff (shared). */
const P_UNDER: Pt[] = [
	[74, -23], [69, -21, 'c'], [72.2, -17], [71, -13], [67, -10.5, 'c'], [68, -6], [66.2, -2], [63, 0, 'c'], [64, 4], [59, 7.5],
	[47, 8.6], [32, 8.2], [17, 11.5], [9, 13], [-1.3, 14.7],
];
const P_HAND: Pt[] = sc([
	...P_BACK, [52, -56.4], [82, -56.6], [100, -56], [107.6, -53.6], [111.4, -48], [107.6, -42], [96, -39.6], [80, -39.2], [65, -37, 'c'],
	[74, -35], [78, -29], ...P_UNDER,
]);
/** Creases between the index and the thumb and between the curled fingers, from each notch back toward the knuckles. */
const P_FINGER_LINES: Pt[][] = [
	[[69, -21], [57, -21.4], [45, -19.6]], // thumb / middle finger
	[[67, -10.5], [57, -10], [47, -8.2]], // middle / ring
	[[63, 0], [55, 1], [47, 2.8]], // ring / little
];
const P_INDEX_LINE: Pt[] = [[65, -37], [52, -37.4], [39, -35.4]]; // index underside into the hand
const P_LINES: Pt[][] = [P_INDEX_LINE, ...P_FINGER_LINES].map(sc);
/** One flat skin-shadow plane under the curled fingers and along the palm edge. */
const P_SHADOW = smooth(sc([[0, 5], [30, 3.4], [50, 0.6], [61, -3.4], [92, -3.4], [92, 30], [0, 30]]));

/**
 * Loose fist, the transition between the relaxed hand and the point (ZOO-P2/ZOO-P4): the pointing silhouette with the
 * index curled into a knuckle lobe in front of the thumb, shown for the first part of the gesture so no open hand
 * dangles and the index simply extends at POINT_HAND_SWITCH.
 */
const C_HAND: Pt[] = sc([...P_BACK, [53, -55.6], [66, -51.6], [74.4, -45], [78.4, -38], [76.4, -33.4, 'c'], [79.2, -28.6], ...P_UNDER]);
const C_INDEX_LINE: Pt[] = [[76.4, -33.4], [63, -34.2], [49, -32.4]]; // curled index over the thumb
const C_LINES: Pt[][] = [C_INDEX_LINE, ...P_FINGER_LINES].map(sc);

/** Closed outlines of the posed hands (point, curl), for the arm's shared outline underlay. */
export const handOutlines = (shape: HandShape): string[] => (shape === 'relaxed' ? [] : [smooth(shape === 'curl' ? C_HAND : P_HAND)]);

const frame = (shape: HandShape) => (shape === 'relaxed' ? undefined : `rotate(${POINT_HAND_FRAME})`);

/**
 * Outline underlay (2x width; the visible half sits outside the fill) for the posed hands. The relaxed hand draws its own
 * centred outline in HandFill, so its narrow thumb notch stays open.
 */
export const HandUnderlay: React.FC<{shape: HandShape}> = ({shape}) => {
	const ls = useLineScale();
	return (
		<g transform={frame(shape)}>
			{handOutlines(shape).map((d, i) => (
				<path key={i} d={d} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.outline * 2 * ls} strokeLinejoin="round" />
			))}
		</g>
	);
};

export const HandFill: React.FC<{shape: HandShape}> = ({shape}) => {
	const ls = useLineScale();
	if (shape === 'relaxed') {
		return (
			<g data-part="hand" data-shape={shape}>
				<HandDrawing hand={RELAXED_HAND} />
			</g>
		);
	}
	const palm = smooth(shape === 'curl' ? C_HAND : P_HAND);
	const lines = shape === 'curl' ? C_LINES : P_LINES;
	return (
		<g data-part="hand" data-shape={shape} transform={frame(shape)}>
			<path d={palm} fill={ZOO_COLORS.skin} />
			<Clipped clip={palm}>
				<path d={P_SHADOW} fill={ZOO_COLORS.skinShadow} />
			</Clipped>
			{lines.map((l, i) => (
				<path key={i} d={line(l)} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.detail * ls} strokeLinecap="round" />
			))}
		</g>
	);
};

/**
 * A hand drawn for one view: one silhouette with one clipped flat skin-shadow plane and a centred near-black outline
 * (silhouette only), plus thin interior lines (finger separations in the warm nose-line brown at the fine width, as the
 * sheet draws them). `map` places the drawing (and mirrors it for the other hand of a bilateral pair WITHIN one view).
 */
/** Finger-separation width: between the fine and detail widths (the sheet's separations are ~2 u, warm brown). */
export const HAND_LINE = Math.round(((ZOO_LINE.fine + ZOO_LINE.detail) / 2) * 100) / 100;
/**
 * `thin`: optional stretch of the outline (key point `from` forward to `to`) stroked at ZOO_LINE.detail instead of the
 * full outline width, for the inside of a narrow notch, so the notch stays open at small scales.
 * `taper` (repair round 3): draw the interior lines as tapered creases (filled, ART_GUIDE SL7) instead of even strokes:
 * full `lineWidth` at each line's FIRST point (the notch it rises from) easing to `taper` x that width at its last point,
 * so the separations read as folds that start at the silhouette and fade into the back of the hand.
 * `accents`: small near-black teardrops (round end at the first point, tapering to the last), e.g. the shadowed web at the
 * top of a thumb crease. Width in world units at lineScale 1.
 */
export type HandDrawingSpec = {
	outline: Pt[];
	shadow?: Pt[];
	lines?: Pt[][];
	lineColor?: string;
	lineWidth?: number;
	thin?: {from: number; to: number};
	taper?: number;
	accents?: {pts: Pt[]; width: number}[];
};
export const HandDrawing: React.FC<{hand: HandDrawingSpec; map?: (p: Pt) => Pt; name?: string}> = ({hand, map, name}) => {
	const ls = useLineScale();
	const m = (pts: Pt[]) => (map ? pts.map(map) : pts);
	const pts = m(hand.outline);
	const d = smooth(pts);
	const shadow = hand.shadow ? {d: smooth(m(hand.shadow)), fill: ZOO_COLORS.skinShadow} : undefined;
	const lw = hand.lineWidth ?? HAND_LINE;
	const color = hand.lineColor ?? ZOO_COLORS.noseLine;
	const taper = hand.taper;
	return (
		<g data-part={name ?? 'handShape'}>
			{/* Fill and shadow first, then the interior lines, then the outline on top (repair round 3), so each line's end
			    tucks under the silhouette at its notch instead of sitting on the outline as a brown nub. */}
			<Shape d={d} fill={ZOO_COLORS.skin} shadow={shadow} stroke={0} />
			{(hand.lines ?? []).map((l, i) =>
				taper === undefined ? (
					<Stroke key={i} d={line(m(l))} width={lw} color={color} />
				) : (
					<path key={i} data-part="crease" d={tapered(m(l), (t) => lw * ls * (1 - (1 - taper) * Math.pow(t, 2.2)))} fill={color} />
				),
			)}
			{(hand.accents ?? []).map((a, i) => (
				<path key={i} data-part="accent" d={tapered(m(a.pts), (t) => a.width * ls * Math.pow(Math.max(0.03, Math.cos((Math.min(1, t) * Math.PI) / 2)), 0.6))} fill={LINE.color} />
			))}
			{hand.thin ? (
				<>
					<Outline d={smoothRange(pts, hand.thin.to, hand.thin.from)} />
					<Outline d={smoothRange(pts, hand.thin.from, hand.thin.to)} width={ZOO_LINE.detail} />
				</>
			) : (
				<Outline d={d} />
			)}
		</g>
	);
};

export const RELAXED_HAND: HandDrawingSpec = {
	outline: RELAXED,
	shadow: RELAXED_SHADOW,
	lines: RELAXED_SEPARATIONS,
	lineWidth: ZOO_LINE.detail,
	taper: 0.4,
	thin: RELAXED_THIN,
	accents: [RELAXED_WEB],
};

/** Point map for placing a view's own hand drawing: translate by (x, y), optional mirror about the drawing's x = 0 (only for
 * the other hand of a pair inside the same view), uniform scale s. */
export const placeHand =
	(x: number, y: number, {mirror = false, s = 1}: {mirror?: boolean; s?: number} = {}) =>
	(p: Pt): Pt => {
		const q: [number, number] = [x + (mirror ? -p[0] : p[0]) * s, y + p[1] * s];
		return p.length === 3 ? [q[0], q[1], 'c'] : q;
	};
