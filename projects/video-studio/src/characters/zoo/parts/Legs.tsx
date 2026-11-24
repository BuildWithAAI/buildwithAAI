/**
 * Legs: near-black straight trousers and off-white low-top sneakers. The legs and shoes are a
 * symmetric garment pair (no markings), authored for the anatomical LEFT side (screen right) and
 * mirrored for the right. Measured from zoo_turn_front.png: outer edge +-80 at the hip to +-86 at
 * the ankle, inseam from the crotch (-392) to +-27 at the hem (-54), sneakers ~95 wide.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, type Pt} from '../geometry';
import {Clipped, Shape, Stroke} from './Shape';

const LEG: Pt[] = [
	[0, -434], [78, -434], [78.2, -380], [77.6, -300], [79.4, -200], [80.6, -120], [82, -64], [81, -53.5, 'c'], [54, -51.6],
	[24.6, -53.6, 'c'], [21.2, -100], [15.6, -170], [10.2, -250], [5, -320], [1.6, -372], [0, -392],
];
/** Under the shirt hem, and along the inseam. */
const LEG_SHADOWS: Pt[][] = [
	[[0, -440], [84, -440], [84, -405], [40, -399], [12, -397], [0, -395]],
	[[0, -392], [2, -372], [5.6, -320], [10.8, -250], [16.4, -170], [22, -100], [25.4, -53], [34, -53], [29, -170], [18, -320], [7, -390]],
];

/** Path bottom sits at y = -1.75 so the outline's outer edge touches the ground (y = 0). */
const SHOE: Pt[] = [
	[33, -56], [58, -58.6], [83, -56], [93.6, -45], [103.4, -32.6], [110.6, -20.6], [114, -9.6], [111.4, -3.2], [100, -1.75], [60, -1.75],
	[33, -2.2], [28.2, -7], [27.4, -22], [28.6, -40],
];
const SOLE: Pt[] = [[116, -11.6], [100, -10.6], [60, -10.2], [26, -11], [26, 2], [116, 2]];
const SHOE_SHADOW: Pt[] = [[25, -62], [44, -62], [40.6, -30], [35, -12], [24, -12]];
const SOLE_LINE: Pt[] = [[113.6, -11.4], [100, -10.6], [60, -10.2], [27.6, -11]];
const TOE_LINE: Pt[] = [[105, -26.4], [88, -22.6], [64, -21.4], [44, -21]];
const LACES: Pt[][] = [
	[[48, -47.6], [62, -46.4], [76, -47]],
	[[46, -38.4], [63, -36.8], [82, -37.6]],
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
			<path d={shoe} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinejoin="round" />
			<Stroke d={line(m(SOLE_LINE))} width={LINE.detailWidth} />
			<Stroke d={line(m(TOE_LINE))} width={LINE.detailWidth * 0.8} />
			{LACES.map((l, i) => (
				<Stroke key={i} d={line(m(l))} width={LINE.detailWidth * 0.8} />
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
