/**
 * Arm chain: upper arm (shoulder pivot) -> forearm with cuff (elbow pivot) -> hand (wrist pivot).
 * Geometry is authored for the ANATOMICAL LEFT arm (screen right) in root space at rest; the
 * anatomical right arm is its garment/anatomical mirror (sleeves and hands carry no markings).
 * The three segments share one outline underlay, so the elbow and wrist joints read as one
 * continuous sleeve when they rotate; seams and creases are drawn as detail lines on top.
 */
import React, {useId} from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, mirrorX, safeId, smooth, type Pt} from '../geometry';
import {PIVOTS, type ArmAngles} from '../rig';
import {HandFill, HandUnderlay, type HandShape} from './Hand';

const UPPER_L: Pt[] = [
	[84, -705], [97, -700], [107.5, -694.2], [115, -685], [120.2, -670], [124.6, -648], [128, -616], [132, -584], [135.6, -553],
	[138.4, -530], [130, -517.5], [119, -515], [108, -523], [105.6, -560], [103.4, -600], [97.6, -640], [89.6, -680],
];
const UPPER_SHADOW_L: Pt[] = [[86, -704], [99, -684], [108, -640], [112, -560], [108, -515], [96, -520], [92, -600]];
const FORE_L: Pt[] = [
	[106, -534], [110.4, -547], [122.5, -552], [134.8, -547], [139.4, -534], [141.8, -508], [142.4, -484], [140, -463], [138.2, -446],
	[136.8, -432], [136, -421, 'c'], [118.6, -418.2], [101.6, -421, 'c'], [101.6, -436], [102.2, -456], [104, -490], [105, -515],
];
const FORE_SHADOW_L: Pt[] = [[96, -560], [112, -556], [111.5, -470], [110.5, -415], [95, -415]];
const CUFF_SEAM_L: Pt[] = [[102.2, -456.6], [119, -459.2], [138.6, -456.2]];
const CUFF_EDGE_L: Pt[] = [[101.8, -421.2], [118.6, -418.4], [135.8, -421.2]];
const ELBOW_CREASE_L: Pt[] = [[107.5, -546.5], [113.4, -538.2], [118.6, -529.6]];

export type ArmSide = 'L' | 'R';

type ArmProps = {side: ArmSide; angles: ArmAngles; hand: HandShape};

/** Renders the arm in passes: shared outline underlay, fills (hand under the cuff), then details. */
export const Arm: React.FC<ArmProps> = ({side, angles, hand}) => {
	const sgn = side === 'L' ? 1 : -1;
	const m = (p: Pt[]) => (side === 'L' ? p : mirrorX(p));
	const S = side === 'L' ? PIVOTS.shoulderL : PIVOTS.shoulderR;
	const E = side === 'L' ? PIVOTS.elbowL : PIVOTS.elbowR;
	const Wr = side === 'L' ? PIVOTS.wristL : PIVOTS.wristR;
	const a = {shoulder: angles.shoulder * sgn, elbow: angles.elbow * sgn, wrist: angles.wrist * sgn};
	const upper = smooth(m(UPPER_L));
	const fore = smooth(m(FORE_L));

	const chain = (layer: {upper?: React.ReactNode; fore?: React.ReactNode; hand?: React.ReactNode}, key: string) => (
		<g key={key} transform={`rotate(${a.shoulder} ${S.x} ${S.y})`}>
			{layer.upper}
			<g transform={`rotate(${a.elbow} ${E.x} ${E.y})`}>
				{layer.fore}
				<g transform={`rotate(${a.wrist} ${Wr.x} ${Wr.y})`}>
					{layer.hand ? <g transform={`translate(${Wr.x} ${Wr.y}) scale(${sgn} 1)`}>{layer.hand}</g> : null}
				</g>
			</g>
		</g>
	);
	const under = (d: string) => <path d={d} fill="none" stroke={LINE.color} strokeWidth={LINE.width * 2} strokeLinejoin="round" />;
	const uid = safeId(useId(), `arm${side}`);
	const clipU = `${uid}-u`;
	const clipF = `${uid}-f`;
	return (
		<g data-part={side === 'L' ? 'armL' : 'armR'}>
			{chain({upper: under(upper), fore: under(fore), hand: <HandUnderlay shape={hand} />}, 'under')}
			{chain({hand: <HandFill shape={hand} />}, 'hand')}
			{chain(
				{
					upper: (
						<g data-part={side === 'L' ? 'upperArmL' : 'upperArmR'}>
							<clipPath id={clipU}>
								<path d={upper} />
							</clipPath>
							<path d={upper} fill={ZOO_COLORS.overshirt} />
							<path d={smooth(m(UPPER_SHADOW_L))} fill={ZOO_COLORS.overshirtShadow} clipPath={`url(#${clipU})`} />
						</g>
					),
				},
				'upper',
			)}
			{chain(
				{
					fore: (
						<g data-part={side === 'L' ? 'forearmL' : 'forearmR'}>
							<clipPath id={clipF}>
								<path d={fore} />
							</clipPath>
							<path d={fore} fill={ZOO_COLORS.overshirt} />
							<path d={smooth(m(FORE_SHADOW_L))} fill={ZOO_COLORS.overshirtShadow} clipPath={`url(#${clipF})`} />
							<path d={line(m(CUFF_SEAM_L))} fill="none" stroke={LINE.color} strokeWidth={LINE.detailWidth} strokeLinecap="round" />
							<path d={line(m(CUFF_EDGE_L))} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinecap="round" />
							<path d={line(m(ELBOW_CREASE_L))} fill="none" stroke={LINE.color} strokeWidth={LINE.detailWidth} strokeLinecap="round" />
						</g>
					),
				},
				'fore',
			)}
		</g>
	);
};
