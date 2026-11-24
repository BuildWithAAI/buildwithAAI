/**
 * Hands. The front-view hands are authored for the ANATOMICAL LEFT hand (screen right) in wrist-local units (origin =
 * wrist pivot, +y down the hand, +x toward the little-finger side); the anatomical right hand is its anatomical mirror
 * within the front view (hands are an unmarked pair, decision ZOO-S1). Every other view draws its own hands
 * (views/Back.tsx, views/threeQuarter/Body34.tsx, views/side/BodySide.tsx) with HandDrawing below; no view maps
 * another view's hand drawing (repair round 2).
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, smooth, smoothRange, type Pt} from '../geometry';
import {POINT_HAND_FRAME} from '../rig';
import {ZOO_LINE} from '../lines';
import {Clipped, Outline, Shape, Stroke, useLineScale} from './Shape';

export type HandShape = 'relaxed' | 'point' | 'curl';

/**
 * Relaxed front hand (repair round 2, row-scanned on zoo_turn_front.png in hand-local units, wrist at the cuff centre).
 * ONE silhouette: the back of the hand is as wide as the cuff, the four fingers hang and curl in toward the thigh, their
 * tips stepping down from the little finger (outer, y ~69) to the index (inner, y ~93), and the thumb is a slender lobe
 * on the inner side (tip y ~68). Between the thumb and the fingers the sheet shows an OPEN gap ~6 u wide below a short
 * dark apex at y ~43; here the notch's path gap is ~6.4 u and its two edges are stroked at the detail width
 * (RELAXED_THIN), so background shows in it at every lineScale. Round 1's notch was 3 u, narrower than the 3.5 u
 * outline, so it filled solid black and read as a hooked talon (5.6 u wide at the asset sheet's lineScale).
 */
const RELAXED: Pt[] = [
	[-17, -8], [12, -8], [12.4, 6], [12.8, 20], [14, 31], [14.8, 40], [14.4, 48], [13.2, 55], [12, 60.5], [10.8, 65], [9.4, 68.6],
	[7.4, 71.2, 'c'], [6.6, 74.2], [4.6, 77.2], [2.4, 79.4, 'c'], [0.6, 81.6], [-2.2, 83.8], [-5.4, 85.4, 'c'], [-8.6, 87.2],
	[-12.4, 89.6], [-16.4, 92], [-20.2, 93.4], [-23.4, 91.8], [-25, 87.6], [-24.6, 83], [-22.8, 79], [-20.4, 75.4], [-18.2, 72.4],
	[-16.4, 69.2], [-14.4, 64.6], [-13.4, 59], [-13.2, 53.6], [-13.8, 48.6], [-15.4, 44.6], [-17.6, 43.2, 'c'], [-19.4, 47.4],
	[-19.8, 53], [-20, 58.4], [-20.8, 63], [-22.4, 66.6], [-25.2, 68.6], [-28.2, 68], [-30, 64.6], [-30.4, 57], [-30, 47],
	[-29.4, 37], [-28.2, 28.6], [-26, 21], [-22.6, 14], [-19.2, 7.6], [-17.6, 0],
];
/** The inside of the notch between the thumb and the index (key points 28..39 of RELAXED): drawn at the detail width. */
const RELAXED_THIN = {from: 28, to: 39} as const;
/**
 * Finger separations (repair round 2): ~12 u fine warm-brown lines from the three tip notches up ALONG the fingers, which
 * lean in toward the thigh, so each line rises toward the outer edge ("/" on the screen-right hand, as on the sheet).
 * Round 1's lines ran across the fingers.
 */
const RELAXED_SEPARATIONS: Pt[][] = [
	[[7.4, 71.2], [8.2, 67], [8.8, 63]],
	[[2.4, 79.4], [3.8, 73.6], [4.8, 68]],
	[[-5.4, 85.4], [-3.4, 79.4], [-2, 73.6]],
];
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
 */
export type HandDrawingSpec = {outline: Pt[]; shadow?: Pt[]; lines?: Pt[][]; lineColor?: string; lineWidth?: number; thin?: {from: number; to: number}};
export const HandDrawing: React.FC<{hand: HandDrawingSpec; map?: (p: Pt) => Pt; name?: string}> = ({hand, map, name}) => {
	const m = (pts: Pt[]) => (map ? pts.map(map) : pts);
	const pts = m(hand.outline);
	const d = smooth(pts);
	const shadow = hand.shadow ? {d: smooth(m(hand.shadow)), fill: ZOO_COLORS.skinShadow} : undefined;
	return (
		<g data-part={name ?? 'handShape'}>
			<Shape d={d} fill={ZOO_COLORS.skin} shadow={shadow} stroke={hand.thin ? 0 : ZOO_LINE.outline} />
			{hand.thin ? (
				<>
					<Outline d={smoothRange(pts, hand.thin.to, hand.thin.from)} />
					<Outline d={smoothRange(pts, hand.thin.from, hand.thin.to)} width={ZOO_LINE.detail} />
				</>
			) : null}
			{(hand.lines ?? []).map((l, i) => (
				<Stroke key={i} d={line(m(l))} width={hand.lineWidth ?? HAND_LINE} color={hand.lineColor ?? ZOO_COLORS.noseLine} />
			))}
		</g>
	);
};

export const RELAXED_HAND: HandDrawingSpec = {outline: RELAXED, shadow: RELAXED_SHADOW, lines: RELAXED_SEPARATIONS, lineWidth: ZOO_LINE.fine, thin: RELAXED_THIN};

/** Point map for placing a view's own hand drawing: translate by (x, y), optional mirror about the drawing's x = 0 (only for
 * the other hand of a pair inside the same view), uniform scale s. */
export const placeHand =
	(x: number, y: number, {mirror = false, s = 1}: {mirror?: boolean; s?: number} = {}) =>
	(p: Pt): Pt => {
		const q: [number, number] = [x + (mirror ? -p[0] : p[0]) * s, y + p[1] * s];
		return p.length === 3 ? [q[0], q[1], 'c'] : q;
	};
