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

// Relaxed: back of the hand toward the viewer, fingers gently curled, thumb in front on the inner side.
const PALM: Pt[] = [
	[12.5, -6], [14.8, 12], [14.6, 30], [12.8, 45], [11.4, 55], [8.6, 61.6], [4.4, 62.8], [2.2, 58.4, 'c'], [1.6, 65.6], [-1.4, 71.8],
	[-5.6, 72.8], [-7.6, 68, 'c'], [-8.4, 75.4], [-11.8, 82], [-16.4, 83], [-18.4, 78, 'c'], [-19.6, 84.6], [-23.2, 91],
	[-27.8, 90.8], [-29.8, 84.4], [-28.8, 72], [-26, 56], [-24, 32], [-22.6, 12], [-21, -6],
];
const THUMB: Pt[] = [[-20.5, 1], [-26.2, 15], [-28.8, 31], [-27.8, 46], [-24.6, 56.6], [-20.4, 58.8], [-17.2, 54.8], [-18, 41], [-17, 25], [-14.6, 10]];
const FINGER_LINES: Pt[][] = [
	[[7.4, 38], [4.6, 49], [2.2, 58.4]],
	[[-0.6, 42], [-4, 56], [-7.6, 68]],
	[[-9.4, 46], [-14, 63], [-18.4, 78]],
];
const PALM_SHADOW = smooth([[-25, 14], [-15, 24], [-14, 60], [-19, 82], [-31, 88], [-31, 10]]);

// Pointing, in a pose frame: wrist at origin, index along +x, thumb up (-y), other fingers curled below.
const P_HAND: Pt[] = [
	[-2, -15], [10, -17.4], [24, -16.4], [35, -12.6], [44, -10.6], [58, -10.4], [72, -10.2], [79.6, -9.2], [83.8, -6], [83.4, -2.4],
	[79.4, -0.4], [70, 0.2], [54, 0.7], [44.6, 1.4], [46.4, 5.8], [45.8, 10.6], [41, 12.4], [36.6, 11.2, 'c'], [38.8, 15.8], [37,
	20.4], [32, 21.4], [28.4, 19.6, 'c'], [29.2, 24], [26.6, 27.8], [21.4, 27.8], [17.2, 24.6], [8, 22], [-2, 17],
];
const P_THUMB: Pt[] = [[6, -14], [14, -21.6], [26, -23.8], [37.6, -21], [42.6, -17.2], [39.8, -13.4], [28, -12.2], [16, -10]];
const P_LINES: Pt[][] = [
	[[44.6, 1.4], [37.6, 4.2]],
	[[36.6, 11.2], [30, 9.4]],
	[[28.4, 19.6], [22, 17.4]],
];
const P_SHADOW = smooth([[10, 8], [30, 6], [44, 2], [46, 30], [0, 30]]);

/** Closed outlines of the hand, for the arm's shared outline underlay. */
export const handOutlines = (shape: HandShape): string[] =>
	shape === 'relaxed' ? [smooth(PALM), smooth(THUMB)] : [smooth(P_HAND), smooth(P_THUMB)];

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
	const thumb = smooth(relaxed ? THUMB : P_THUMB);
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
			<path d={thumb} fill={ZOO_COLORS.skin} stroke={LINE.color} strokeWidth={LINE.width} strokeLinejoin="round" />
		</g>
	);
};
