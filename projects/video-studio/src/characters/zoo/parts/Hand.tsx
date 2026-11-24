/**
 * Hands. Authored for the ANATOMICAL LEFT hand (screen right) in wrist-local units (origin = wrist
 * pivot, +y down the hand, +x toward the little-finger side). The anatomical right hand is its
 * anatomical mirror (hands are a mirror pair with no markings). Fingers are separate lobes with
 * separation lines, so the hand never reads as a mitten.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, smooth, type Pt} from '../geometry';
import {POINT_HAND_FRAME} from '../rig';
import {Clipped} from './Shape';

export type HandShape = 'relaxed' | 'point';

// Relaxed: back of the hand toward the viewer, fingers gently curled with their tips stepping down
// toward the thumb side, a sturdy thumb in front on the inner side (zoo_turn_front.png).
const PALM: Pt[] = [
	[14.4, -6], [16.2, 12], [16, 32], [14.6, 47], [13.6, 56], [10.6, 63], [5.6, 65.6], [3, 63.6, 'c'], [3.6, 69], [0.8, 74.6],
	[-4.4, 76.2], [-6.6, 73.8, 'c'], [-6.4, 79.6], [-9.6, 85.4], [-15, 86.8], [-17.4, 84.2, 'c'], [-17.6, 89.6], [-21, 94.4],
	[-26.4, 94.6], [-29.4, 90.4], [-29.6, 82], [-28.4, 66], [-26.4, 48], [-24.6, 30], [-23.4, 12], [-21.6, -6],
];
const THUMB: Pt[] = [[-21, 0], [-28.6, 14], [-31, 30], [-30, 45], [-26.6, 56.6], [-21.6, 60], [-17.6, 56], [-17.8, 42], [-16.6, 26], [-14, 10]];
const FINGER_LINES: Pt[][] = [
	[[3, 63.6], [5, 56.6]],
	[[-6.6, 73.8], [-4.6, 66.6]],
	[[-17.4, 84.2], [-15.4, 76.4]],
];
const PALM_SHADOW = smooth([[-30, 40], [-16, 46], [-13, 70], [-21, 97], [-34, 97]]);

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

/** Closed outlines of the hand, for the arm's shared outline underlay. */
export const handOutlines = (shape: HandShape): string[] =>
	shape === 'relaxed' ? [smooth(PALM), smooth(THUMB)] : [smooth(P_HAND)];

const frame = (shape: HandShape) => (shape === 'point' ? `rotate(${POINT_HAND_FRAME})` : undefined);

/** Outline underlay (2x width; the visible half sits outside the fill). */
export const HandUnderlay: React.FC<{shape: HandShape}> = ({shape}) => (
	<g transform={frame(shape)}>
		{handOutlines(shape).map((d, i) => (
			<path key={i} d={d} fill="none" stroke={LINE.color} strokeWidth={LINE.width * 2} strokeLinejoin="round" />
		))}
	</g>
);

export const HandFill: React.FC<{shape: HandShape}> = ({shape}) => {
	const relaxed = shape === 'relaxed';
	const palm = smooth(relaxed ? PALM : P_HAND);
	const thumb = relaxed ? smooth(THUMB) : null;
	const lines = relaxed ? FINGER_LINES : P_LINES;
	return (
		<g data-part="hand" data-shape={shape} transform={frame(shape)}>
			<path d={palm} fill={ZOO_COLORS.skin} />
			<Clipped clip={palm}>
				<path d={relaxed ? PALM_SHADOW : P_SHADOW} fill={ZOO_COLORS.skinShadow} />
			</Clipped>
			{lines.map((l, i) => (
				<path key={i} d={line(l)} fill="none" stroke={LINE.color} strokeWidth={LINE.detailWidth} strokeLinecap="round" />
			))}
			{thumb ? <path d={thumb} fill={ZOO_COLORS.skin} stroke={LINE.color} strokeWidth={LINE.width} strokeLinejoin="round" /> : null}
		</g>
	);
};
