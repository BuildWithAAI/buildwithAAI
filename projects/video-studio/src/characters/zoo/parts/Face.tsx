/**
 * Face skin with the jaw outline. Narrow face; sides nearly vertical from the temples to the
 * cheek, then a rounded jaw to a broad chin (measured from zoo_expr_neutral.png, scaled to the
 * front-view head). `jawDrop` lowers the chin outline for open mouth shapes.
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, type Pt} from '../geometry';
import {Shape} from './Shape';

/** Right half (screen right), top -> chin. The face is symmetric; the hair carries the asymmetry. */
const FACE_HALF: Pt[] = [
	[26, -879], [39, -866], [43, -848], [43.2, -828], [42.2, -810], [40.8, -795], [38.8, -782], [36.6, -770],
	[33.6, -761], [29.6, -753.5], [23.6, -747.4], [16.2, -742.9], [8, -740.6], [0, -740],
];

const halves = (jawDrop: number) => {
	const drop = (p: Pt): Pt => {
		const w = Math.max(0, Math.min(1, (p[1] + 790) / 45));
		return [p[0], p[1] + jawDrop * w];
	};
	const right = FACE_HALF.map(drop);
	const left = mirrorX(right.slice(0, right.length - 1)).reverse(); // chin-adjacent -> top
	return {right, left};
};

export const facePoints = (jawDrop = 0): Pt[] => {
	const {right, left} = halves(jawDrop);
	return [[0, -881], ...right, ...left];
};

export const facePath = (jawDrop = 0) => smooth(facePoints(jawDrop));

/** Temple-to-temple outline of the face sides and jaw (drawn over the beard: one clean jaw line). */
export const jawOutline = (jawDrop = 0) => {
	const {right, left} = halves(jawDrop);
	return line([...right.slice(2), ...left.slice(0, left.length - 2)]);
};

/** Skin shadow: screen-left cheek plane and under the hairline at the temples. */
const FACE_SHADOW = smooth([
	[-48, -846], [-35, -842], [-33, -826], [-35.5, -806], [-35, -790], [-30, -772], [-24, -760], [-40, -750], [-52, -790],
]);

export const FaceSkin: React.FC<{jawDrop: number}> = ({jawDrop}) => (
	<Shape name="face" d={facePath(jawDrop)} fill={ZOO_COLORS.skin} shadow={{d: FACE_SHADOW, fill: ZOO_COLORS.skinShadow}} stroke={0} />
);
