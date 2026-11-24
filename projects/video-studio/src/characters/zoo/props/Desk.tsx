/**
 * Simple office desk in the character style (flat fills, one shadow tone, near-black outlines).
 * Matches the "Sitting at a desk typing" panel of zoo_model_sheet_v1.png. Local origin = centre of
 * the desk's footprint on the floor; units are world units (ZOO = 900 tall at scale 1).
 * The desk top surface is at y = DESK.top.
 */
import React from 'react';
import {LINE, PROP_COLORS} from '../../palette';
import type {Placement} from '../../types';
import {smooth, type Pt} from '../geometry';
import {Shape, Stroke} from '../parts/Shape';

export const DESK = {width: 620, top: -344, frontTop: -338, frontBottom: -320, legWidth: 14} as const;

const rect = (x0: number, y0: number, x1: number, y1: number, r = 3): string => {
	const pts: Pt[] = [
		[x0 + r, y0], [x1 - r, y0], [x1, y0 + r, 'c'], [x1, y1 - r], [x1 - r, y1], [x0 + r, y1], [x0, y1 - r], [x0, y0 + r, 'c'],
	];
	return smooth(pts.map((p) => [p[0], p[1], 'c'] as Pt));
};

const Leg: React.FC<{x: number; bottom: number; back?: boolean}> = ({x, bottom, back}) => {
	const w = DESK.legWidth * (back ? 0.85 : 1);
	return (
		<Shape
			name={back ? 'deskLegBack' : 'deskLeg'}
			d={rect(x - w / 2, DESK.frontBottom - 2, x + w / 2, bottom, 2)}
			fill={back ? PROP_COLORS.deskShadow : PROP_COLORS.desk}
			shadow={back ? undefined : {d: rect(x + w / 2 - 4.5, DESK.frontBottom - 4, x + w / 2 + 4, bottom + 4, 0), fill: PROP_COLORS.deskShadow}}
		/>
	);
};

export const Desk: React.FC<Placement> = ({x = 0, y = 0, scale = 1}) => {
	const hw = DESK.width / 2;
	return (
		<g data-prop="desk" transform={`translate(${x} ${y}) scale(${scale})`}>
			<Leg x={70} bottom={-16} back />
			<Leg x={-hw + 15} bottom={-1.75} />
			<Leg x={hw - 25} bottom={-1.75} />
			<Shape name="deskTop" d={rect(-hw, DESK.top, hw, DESK.frontBottom, 3)} fill={PROP_COLORS.desk} shadow={{d: rect(-hw - 4, DESK.frontTop + 9, hw + 4, DESK.frontBottom + 4, 0), fill: PROP_COLORS.deskShadow}} />
			<Stroke d={`M${-hw + 2} ${DESK.frontTop} L${hw - 2} ${DESK.frontTop}`} width={LINE.detailWidth} />
		</g>
	);
};
