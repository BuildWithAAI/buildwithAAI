/**
 * Nose: prominent and softly angular. A long bridge line just left of centre (the shaded side),
 * turning into an angular tip and the left nostril wing, plus a short right nostril arc. One flat
 * skin-shadow plane on the screen-left side of the bridge and under the tip.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, smooth} from '../geometry';
import {Stroke} from './Shape';

const SIDE_PLANE = smooth([
	[-1.4, -823], [-2.2, -809], [-3.4, -798], [-6, -792], [-8.8, -789.5], [-9.6, -793], [-7.2, -799], [-4.4, -810],
]);
const UNDER_TIP = smooth([[-6.5, -787.6], [-2, -785.4], [4, -785.6], [9.2, -788.6], [4.5, -787.3], [-1.5, -787]]);

const BRIDGE = line([[-1.2, -820], [-1.7, -811], [-2.5, -802], [-3.6, -796.5], [-5.6, -792.2], [-7.2, -789.6]]);
const TIP = line([[-7.2, -789.6], [-6.4, -787.6], [-3.6, -786.6], [-0.6, -787]]);
const RIGHT_WING = line([[3.6, -786.9], [7, -787.7], [9.4, -790.6]]);

export const Nose: React.FC = () => (
	<g data-part="nose">
		<path d={SIDE_PLANE} fill={ZOO_COLORS.skinShadow} />
		<path d={UNDER_TIP} fill={ZOO_COLORS.skinShadow} />
		<Stroke d={BRIDGE} width={1.4} />
		<Stroke d={TIP} width={LINE.detailWidth} />
		<Stroke d={RIGHT_WING} width={LINE.detailWidth} />
	</g>
);
