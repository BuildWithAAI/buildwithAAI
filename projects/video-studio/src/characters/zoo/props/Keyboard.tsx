/**
 * Low keyboard in the character style. Local origin = centre of its underside on the desk top.
 * KEYBOARD.top is the key surface where ZOO's fingertips rest in the typing pose.
 */
import React from 'react';
import {LINE, PROP_COLORS} from '../../palette';
import type {Placement} from '../../types';
import {smooth, type Pt} from '../geometry';
import {Shape, Stroke} from '../parts/Shape';

/** Repair round 1: ~186 u long as on zoo_pose_typing.png (v1: 126 u, the hands straddled it). */
export const KEYBOARD = {width: 186, top: -10} as const;

const BODY: Pt[] = [[-93, -1.75, 'c'], [-91, -9], [-87, -12, 'c'], [87, -12, 'c'], [91, -9], [93, -1.75, 'c']];

export const Keyboard: React.FC<Placement> = ({x = 0, y = 0, scale = 1}) => (
	<g data-prop="keyboard" transform={`translate(${x} ${y}) scale(${scale})`}>
		<Shape name="keyboardBody" d={smooth(BODY)} fill={PROP_COLORS.keyboard} shadow={{d: smooth([[-96, -6], [96, -6], [96, 2], [-96, 2]]), fill: PROP_COLORS.keyboardShadow}} />
		{[-72, -48, -24, 0, 24, 48].map((kx) => (
			<Stroke key={kx} d={`M${kx} -9.6 L${kx + 16} -9.6`} width={LINE.detailWidth * 0.8} color={PROP_COLORS.keyboardShadow} />
		))}
	</g>
);
