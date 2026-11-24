/**
 * Ears: a bilateral pair (left and right ears are anatomical mirror images; no markings), tucked under the
 * short side hair at the top and behind the face edge at the attachment. Repair round 1: re-measured on
 * zoo_expr_neutral.png / zoo_turn_front.png at front-view heights (decision ZOO-F2): top -811, lobe -780 (v1 reached
 * -818); outer edge x ~55 (the sheet's ears span -59.4 / +53.8 around the face centre; this mirror pair uses their
 * mean, 56.6 u to the outline's outer edge). One soft fold line in the warm nose-line brown (the sheet draws no black
 * strokes inside the ear) and a thin inner crescent of skin shadow.
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, type Pt} from '../geometry';
import {ZOO_LINE} from '../lines';
import {Shape, Stroke} from './Shape';

/** Anatomical left ear (screen right), clockwise from the hidden attachment top. */
// Repair round 2: the lobe is a rounded C that tucks back into the face at ~-786 (round 1 ended the closed spline at
// (40.7,-780.6) outside the face edge, which hung a pointed 'elf' tip over the jaw line).
export const EAR_L: Pt[] = [
	[41.4, -811.8], [46.4, -812.6], [50.7, -811.4], [53.6, -807.8], [55.0, -802.4], [54.9, -796.2], [53.7, -790.4], [51.4, -785.4],
	[48.4, -781.8], [44.6, -780.6], [41, -782.4], [38.2, -786], [37.6, -792], [38.4, -800], [39.6, -807],
];
const EAR_L_SHADOW: Pt[] = [[40.0, -809], [44.8, -808.4], [46.7, -803.6], [46.7, -795.6], [45.2, -788.4], [42.1, -784], [38.3, -784]];
const EAR_L_FOLD: Pt[] = [[50.1, -807.2], [51.5, -803], [51.2, -797.8], [49.5, -793.6], [47.1, -791.4]];

const Ear: React.FC<{side: 1 | -1}> = ({side}) => {
	const m = (p: Pt[]) => (side === 1 ? p : mirrorX(p));
	return (
		<g data-part={side === 1 ? 'earL' : 'earR'}>
			<Shape d={smooth(m(EAR_L))} fill={ZOO_COLORS.skin} shadow={{d: smooth(m(EAR_L_SHADOW)), fill: ZOO_COLORS.skinShadow}} />
			<Stroke d={line(m(EAR_L_FOLD))} width={ZOO_LINE.fine} color={ZOO_COLORS.noseLine} />
		</g>
	);
};

export const Ears: React.FC = () => (
	<g data-part="ears">
		<Ear side={1} />
		<Ear side={-1} />
	</g>
);
