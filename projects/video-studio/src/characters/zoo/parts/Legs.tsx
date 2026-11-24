/**
 * Legs: near-black straight trousers and off-white low-top sneakers. The legs and shoes are a
 * symmetric garment pair (no markings), authored for the anatomical LEFT side (screen right) and
 * mirrored for the right. Measured from zoo_turn_front.png: outer edge +-80 at the hip to +-86 at
 * the ankle, inseam from the crotch (-392) to +-27 at the hem (-54), sneakers ~95 wide.
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, type Pt} from '../geometry';
import {ZOO_LINE} from '../lines';
import {Clipped, Outline, Shape, Stroke} from './Shape';

// Repair round 1: the hem drapes over the shoe tongue. Repair round 2: the break is raised 8 u (-44.6 -> -52.6 in the middle),
// so ~52 u of sneaker shows below it as on zoo_turn_front.png (~55; round 1 showed ~46).
// Repair round 3: the outer top point is a corner. As a smooth point the spline bulged ~5 u outward just under the overshirt
// hem (trouser edge at ~85 at y -425 against the sheet's ~78), which showed once the hem corner was rounded.
const LEG: Pt[] = [
	[0, -434], [78, -434, 'c'], [78.2, -380], [77.6, -300], [79.4, -200], [80.6, -120], [81.8, -70], [81.4, -58.2, 'c'], [66, -54.2],
	[52, -52.6], [36, -54], [26.4, -56, 'c'], [22.2, -100], [15.6, -170], [10.2, -250], [5, -320], [1.6, -372], [0, -392],
];
/** Under the shirt hem, and along the inseam. */
const LEG_SHADOWS: Pt[][] = [
	[[0, -440], [84, -440], [84, -405], [40, -399], [12, -397], [0, -395]],
	[[0, -392], [2, -372], [5.6, -320], [10.8, -250], [16.4, -170], [22, -100], [25.4, -44], [34, -44], [29, -170], [18, -320], [7, -390]],
];

/**
 * Path bottom sits at y = -1.75 so the outline's outer edge touches the ground (y = 0). Repair round 1 (row scan of
 * zoo_turn_front.png): a rounded low-top, narrow at the ankle (outer edge ~82 at y -50) with a convex toe box that
 * flares to ~109 only near the sole (v1 was a straight trapezoid, 8-13 u wider at y -50..-30).
 */
// Repair round 2: the inner edge flares in slightly toward the sole too (x ~30 at -40 to ~24 at the sole), as on the sheet
// (round 1's inner edge was vertical, so the shoe flared only outward).
const SHOE: Pt[] = [
	[34, -62], [58, -63.8], [79.8, -61.6], [82.6, -49], [84.4, -40], [89.6, -30.4], [96.6, -24], [102.8, -19.4], [107, -12.6],
	[109.2, -6.4], [106.6, -2.4], [96, -1.75], [60, -1.75], [27.2, -2.2], [25, -7.6], [26.8, -22], [29.8, -40], [31.4, -52],
];
const SOLE: Pt[] = [[112, -11.6], [100, -10.8], [60, -10.4], [22, -11], [22, 2], [112, 2]];
/** One flat shadow tone: a narrow terminator along the inner edge (no full-height band). */
const SHOE_SHADOW: Pt[] = [[20, -66], [37.6, -66], [36, -40], [33, -22], [31.6, -12], [20, -12]];
const SOLE_LINE: Pt[] = [[108.6, -11.4], [96, -10.8], [60, -10.4], [25, -11]];
/** Toe cap seam and three crossing lace bars on the tongue. */
const TOE_LINE: Pt[] = [[100.6, -21.6], [86, -18.2], [66, -17], [46, -17.6]];
const LACES: Pt[][] = [
	[[49.4, -47.6], [61.4, -45.6], [73.6, -47.2]],
	[[50.2, -41.2], [62, -39.2], [74.2, -40.8]],
	[[52.4, -34.8], [62.4, -33.2], [72, -34.6]],
];

const mirrorIf = (side: 1 | -1) => (p: Pt[]) => (side === 1 ? p : mirrorX(p));

const Leg: React.FC<{side: 1 | -1}> = ({side}) => {
	const m = mirrorIf(side);
	return (
		<Shape
			name={side === 1 ? 'legL' : 'legR'}
			d={smooth(m(LEG))}
			fill={ZOO_COLORS.trousers}
			shadow={{d: LEG_SHADOWS.map((s) => smooth(m(s))).join(' '), fill: ZOO_COLORS.trousersShadow}}
		/>
	);
};

const Shoe: React.FC<{side: 1 | -1}> = ({side}) => {
	const m = mirrorIf(side);
	const shoe = smooth(m(SHOE));
	return (
		<g data-part={side === 1 ? 'shoeL' : 'shoeR'}>
			<path d={shoe} fill={ZOO_COLORS.sneaker} />
			<Clipped clip={shoe}>
				<path d={smooth(m(SHOE_SHADOW))} fill={ZOO_COLORS.sneakerShadow} />
				<path d={smooth(m(SOLE))} fill={ZOO_COLORS.sneakerSole} />
			</Clipped>
			<Outline d={shoe} />
			<Stroke d={line(m(SOLE_LINE))} width={ZOO_LINE.detail} />
			<Stroke d={line(m(TOE_LINE))} width={ZOO_LINE.fine} />
			{LACES.map((l, i) => (
				<Stroke key={i} d={line(m(l))} width={ZOO_LINE.fine} />
			))}
		</g>
	);
};

export const Legs: React.FC = () => (
	<g data-part="legs">
		<Shoe side={1} />
		<Shoe side={-1} />
		<Leg side={1} />
		<Leg side={-1} />
	</g>
);
