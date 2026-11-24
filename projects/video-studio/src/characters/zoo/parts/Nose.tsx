/**
 * Nose, front view: prominent and softly angular. Repair round 1, matched to zoo_expr_neutral.png and the mouth
 * panels (heights moved to the front-view feature line, decision ZOO-F2): a thin bridge line on the shaded
 * (screen-left) side in the warm nose-line brown (sheet median #906C55; not near-black), two small separate
 * near-black nostril commas ~10 u apart, and no outline around the tip. One flat skin-shadow plane along the
 * bridge and a small one under the tip.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {smooth, tapered, type Pt} from '../geometry';
import {featureScale, ZOO_LINE} from '../lines';
import {useLineScale} from './Shape';

const SIDE_PLANE = smooth([
	[-1.2, -819], [-1.9, -809], [-3, -799.4], [-4.8, -793.4], [-7.2, -790.6], [-8.2, -793], [-6.4, -798.4], [-4.2, -808.6], [-2.6, -818],
]);
const UNDER_TIP = smooth([[-4.6, -786.2], [-0.6, -784.6], [4.6, -784.8], [8.8, -787.2], [4, -786.2], [-0.8, -786]]);

export const BRIDGE: Pt[] = [[-1.2, -820.4], [-1.6, -811], [-2.4, -802], [-3.6, -796.2], [-5, -792]];
/** Screen-left nostril (anatomical right) and screen-right nostril (anatomical left): thick outer end -> thin inner end. */
export const NOSTRIL_SL: Pt[] = [[-5.6, -788.8], [-3.4, -787.3], [-0.6, -786.5]];
export const NOSTRIL_SR: Pt[] = [[9.4, -789], [7.2, -787.9], [4.8, -787.2]];

/** Bridge: thin at the brow, fullest low on the nose. Nostrils: commas, thick outer end. */
export const bridgeWidth = (w: number) => (t: number) => w * (0.35 + 0.65 * Math.min(1, t / 0.55));
export const nostrilWidth = (w: number) => (t: number) => w * (1.15 - 0.85 * t);

export const Nose: React.FC = () => {
	// Feature shapes keep their drawn size at close-ups (ZOO-L2): bridge up to ~1.7 u, nostril commas ~1.9 u at the outer end.
	const fs = featureScale(useLineScale());
	return (
		<g data-part="nose">
			<path d={SIDE_PLANE} fill={ZOO_COLORS.skinShadow} />
			<path d={UNDER_TIP} fill={ZOO_COLORS.skinShadow} />
			<path data-part="noseBridge" d={tapered(BRIDGE, bridgeWidth(ZOO_LINE.fine * 1.2 * fs))} fill={ZOO_COLORS.noseLine} />
			<path data-part="nostrilR" d={tapered(NOSTRIL_SL, nostrilWidth(ZOO_LINE.feature * fs))} fill={LINE.color} />
			<path data-part="nostrilL" d={tapered(NOSTRIL_SR, nostrilWidth(ZOO_LINE.feature * fs))} fill={LINE.color} />
		</g>
	);
};
