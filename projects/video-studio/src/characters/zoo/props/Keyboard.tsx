/**
 * Low keyboard in the character style. Local origin = centre of its underside on the desk top.
 * KEYBOARD.top is the key surface where ZOO's fingertips rest in the typing pose.
 */
import React from 'react';
import {LINE, PROP_COLORS} from '../../palette';
import type {Placement} from '../../types';
import {smooth, type Pt} from '../geometry';
import {Shape, Stroke} from '../parts/Shape';

export const KEYBOARD = {width: 126, top: -10} as const;

const BODY: Pt[] = [[-63, -1.75, 'c'], [-61, -9], [-57, -12, 'c'], [57, -12, 'c'], [61, -9], [63, -1.75, 'c']];

export const Keyboard: React.FC<Placement> = ({x = 0, y = 0, scale = 1}) => (
	<g data-prop="keyboard" transform={`translate(${x} ${y}) scale(${scale})`}>
		<Shape name="keyboardBody" d={smooth(BODY)} fill={PROP_COLORS.keyboard} shadow={{d: smooth([[-66, -6], [66, -6], [66, 2], [-66, 2]]), fill: PROP_COLORS.keyboardShadow}} />
		{[-42, -18, 6, 30].map((kx) => (
			<Stroke key={kx} d={`M${kx} -9.6 L${kx + 16} -9.6`} width={LINE.detailWidth * 0.8} color={PROP_COLORS.keyboardShadow} />
		))}
	</g>
);
