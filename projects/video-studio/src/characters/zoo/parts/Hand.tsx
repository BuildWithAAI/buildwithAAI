/**
 * Hands. The front-view hands are authored for the ANATOMICAL LEFT hand (screen right) in wrist-local units (origin =
 * wrist pivot, +y down the hand, +x toward the little-finger side); the anatomical right hand is its anatomical mirror
 * within the front view (hands are an unmarked pair, decision ZOO-S1). Every other view draws its own hands
 * (views/Back.tsx, views/threeQuarter/Body34.tsx, views/side/BodySide.tsx) with HandDrawing below; no view maps
 * another view's hand drawing (repair round 2).
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, smooth, type Pt} from '../geometry';
import {POINT_HAND_FRAME} from '../rig';
import {ZOO_LINE} from '../lines';
import {Clipped, Shape, Stroke, useLineScale} from './Shape';

export type HandShape = 'relaxed' | 'point' | 'curl';

/**
 * Relaxed front hand (repair round 2, skin edges row-scanned on zoo_turn_front.png, wrist at the cuff centre). ONE
 * silhouette: the back of the hand tapers out of the cuff, the curled fingers step down and in toward the thigh with the
 * index tip lowest (y ~93), and the thumb is a slender lobe on the inner side, parted from the index finger by a NARROW
 * OPEN NOTCH (apex y ~44, tip y ~69; background shows in it, as on the sheet). The outline is one centred near-black
 * line around the silhouette only; round 1 drew the thumb and palm as two outlined shapes plus a full-weight thumb hook,
 * which filled the notch with black and read as a claw.
 */
const RELAXED: Pt[] = [
	[-17, -8], [12, -8], [12.2, 6], [12.6, 20], [13.8, 31], [15, 40], [14.6, 48], [13, 54.6], [10.6, 59.6], [8.4, 62.4, 'c'],
	[8, 66.2], [6.4, 70.2], [4.2, 72.8, 'c'], [3.2, 76.6], [1, 80.2], [-2, 83, 'c'], [-3.6, 86.2], [-7.2, 89.2], [-12, 91.6],
	[-17.4, 92.8], [-21.4, 92.8], [-24.2, 90.6], [-24.8, 87], [-23.2, 83.2], [-20.8, 79.6], [-18.8, 75.8], [-17.6, 71.6],
	[-16.8, 66.6], [-16.4, 61], [-16.2, 55.6], [-16.4, 50.6], [-17.6, 46.2, 'c'], [-19, 50.4], [-19.4, 55.4], [-19.8, 60.4],
	[-20.8, 64.8], [-22.6, 68.2], [-25.4, 70], [-28.4, 69.4], [-30.2, 65.6], [-30.6, 57], [-30.2, 47], [-29.2, 37], [-27.6, 28.6],
	[-25, 20.6], [-21.4, 12.8], [-18.6, 4], [-17.4, -2],
];
/** Finger separations: short warm-brown lines running up from the fingertip notches along the curled fingers (sheet
 * ~#8F614C). Round 1 drew 18-24 u near-black lines that read as talons at small scale. */
const RELAXED_SEPARATIONS: Pt[][] = [
	[[8.4, 62.4], [5.8, 56.4], [3.2, 51.4]],
	[[4.2, 72.8], [1.2, 66], [-1.6, 60.6]],
	[[-2, 83], [-5.2, 76.2], [-8.2, 70.8]],
];
/** One flat skin-shadow plane on the index finger, under the thumb (thumb-side terminator). */
const RELAXED_SHADOW: Pt[] = [[-36, 66], [-27.4, 71.6], [-22.4, 77.4], [-19.4, 83], [-16.6, 88.8], [-12.6, 94], [-24, 100], [-36, 96]];

// Pointing, in a pose frame: wrist at origin, index along +x, thumb up (-y), other fingers curled below.
// One silhouette (thumb + index + three curled knuckles) with interior creases, scaled 1.12.
const PS = 1.12;
const sc = (pts: Pt[]): Pt[] => pts.map((p) => (p.length === 3 ? [p[0] * PS, p[1] * PS, 'c'] : [p[0] * PS, p[1] * PS]));
const P_HAND: Pt[] = sc([
	[-2, -14], [8, -17], [16, -22], [26, -25.5], [37, -25.6], [43.6, -23.2], [45, -19.6], [41.4, -16.4, 'c'], [48, -14.6], [62, -13.8],
	[76, -13.2], [84, -12], [88, -8.6], [87, -4.8], [83, -2.8], [70, -2.4], [56, -1.8], [48.4, -0.6, 'c'], [49.2, 4], [47.6, 9.4],
	[42.6, 11.6], [38.4, 10.4, 'c'], [40, 15.2], [38, 20.4], [32.6, 21.8], [28.6, 20, 'c'], [29, 24.6], [26, 28.6], [20, 28.8],
	[15, 26], [6, 23], [-2, 17],
]);
const P_LINES: Pt[][] = [
	sc([[41.4, -16.4], [32, -17.6], [21, -16.6]]), // thumb resting on the hand
	sc([[48.4, -0.6], [41, 1.8]]), // index base
	sc([[38.4, 10.4], [31, 8.6]]), // middle / ring
	sc([[28.6, 20], [21, 17.6]]), // ring / little finger
];
const P_SHADOW = smooth(sc([[10, 8], [30, 6], [47, 1], [50, 32], [0, 32]]));

/**
 * Loose fist, the transition between the relaxed hand and the point (repair round 1, ZOO-P2): the pointing silhouette
 * with the index curled like the other fingers, shown for the middle of the gesture so the hand never reads as a flat
 * open "karate" hand on its way up and the switch to the pointer is not a pop.
 */
const C_HAND: Pt[] = sc([
	[-2, -14], [8, -17], [16, -22], [26, -25.5], [37, -25.6], [43.6, -23.2], [45, -19.6], [41.4, -16.4, 'c'], [47.4, -14.2], [51, -9],
	[50.6, -3.4], [48.4, -0.6, 'c'], [49.2, 4], [47.6, 9.4], [42.6, 11.6], [38.4, 10.4, 'c'], [40, 15.2], [38, 20.4], [32.6, 21.8],
	[28.6, 20, 'c'], [29, 24.6], [26, 28.6], [20, 28.8], [15, 26], [6, 23], [-2, 17],
]);
const C_LINES: Pt[][] = [
	sc([[41.4, -16.4], [32, -17.6], [21, -16.6]]),
	sc([[48.4, -0.6], [41, 1.8]]),
	sc([[38.4, 10.4], [31, 8.6]]),
	sc([[28.6, 20], [21, 17.6]]),
];

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
export type HandDrawingSpec = {outline: Pt[]; shadow?: Pt[]; lines?: Pt[][]; lineColor?: string; lineWidth?: number};
export const HandDrawing: React.FC<{hand: HandDrawingSpec; map?: (p: Pt) => Pt; name?: string}> = ({hand, map, name}) => {
	const m = (pts: Pt[]) => (map ? pts.map(map) : pts);
	return (
		<g data-part={name ?? 'handShape'}>
			<Shape d={smooth(m(hand.outline))} fill={ZOO_COLORS.skin} shadow={hand.shadow ? {d: smooth(m(hand.shadow)), fill: ZOO_COLORS.skinShadow} : undefined} />
			{(hand.lines ?? []).map((l, i) => (
				<Stroke key={i} d={line(m(l))} width={hand.lineWidth ?? HAND_LINE} color={hand.lineColor ?? ZOO_COLORS.noseLine} />
			))}
		</g>
	);
};

export const RELAXED_HAND: HandDrawingSpec = {outline: RELAXED, shadow: RELAXED_SHADOW, lines: RELAXED_SEPARATIONS};

/** Point map for placing a view's own hand drawing: translate by (x, y), optional mirror about the drawing's x = 0 (only for
 * the other hand of a pair inside the same view), uniform scale s. */
export const placeHand =
	(x: number, y: number, {mirror = false, s = 1}: {mirror?: boolean; s?: number} = {}) =>
	(p: Pt): Pt => {
		const q: [number, number] = [x + (mirror ? -p[0] : p[0]) * s, y + p[1] * s];
		return p.length === 3 ? [q[0], q[1], 'c'] : q;
	};
