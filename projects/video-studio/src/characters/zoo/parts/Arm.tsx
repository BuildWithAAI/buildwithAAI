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
import {ZOO_LINE} from '../lines';
import {useLineScale} from './Shape';

// Repair round 2 (line centres row-scanned on zoo_turn_front.png; the arm outline is drawn OUTSIDE these paths, so each
// visible edge sits 1.75 u outside the path): the sleeve is ~46 u wide. Its inner edge runs under the overshirt's body
// side down to y ~-495 and then hangs free of it (sheet: inner edge ~93 at -480, ~95 at -460, cuff 96.6..131 at the
// bottom), so background shows between the cuff and the hem. Round 1's sleeve was ~35 u with its inner edge at ~101-105,
// fused to the wide panel. Elbow pivot moved to the sleeve centre (111.5) and the wrist pivot to the cuff centre (113.8).
const UPPER_L: Pt[] = [
	[84, -695], [96, -691.6], [104, -687.8], [109.4, -684], [111.8, -679.6], [113.4, -673], [115, -665], [116.6, -656], [118.2, -647],
	[120.2, -636], [122, -625], [123.8, -613], [125.6, -600], [127.4, -587], [129.4, -572], [131, -558], [132.8, -545], [134, -533],
	[131, -521], [122, -513], [111.5, -510.6], [101, -513], [92, -521], [86, -533], [84.4, -560], [84.6, -600], [85.2, -640],
	[85.6, -670],
];
/** One shadow band along the sleeve's inner side (the visible part runs from the overshirt's side ~8 u onto the sleeve). */
const UPPER_SHADOW_L: Pt[] = [[80, -698], [98, -690], [104.6, -666], [100, -640], [97, -600], [96.4, -560], [96.6, -515], [80, -515]];
const FORE_L: Pt[] = [
	[88.6, -534], [91.6, -546], [100, -554.6], [111.5, -557.4], [123, -554.6], [131.4, -546], [134.4, -533], [135.8, -523],
	[137.4, -512], [138.6, -502], [138.2, -492], [136.6, -482], [134.6, -470], [133.2, -459], [131.4, -449], [129.8, -440],
	[129.4, -421, 'c'], [113.8, -418.4], [97.8, -421, 'c'], [97.8, -432], [98, -443], [97.6, -452], [96.4, -461], [95.6, -473],
	[94.4, -485], [91.6, -496], [88.4, -505], [86.6, -518],
];
const FORE_SHADOW_L: Pt[] = [[80, -560], [99, -556], [102, -520], [103.6, -490], [104.4, -462], [105.4, -415], [80, -415]];
const CUFF_SEAM_L: Pt[] = [[97.9, -448.4], [114, -449.4], [130.4, -447.8]];
const CUFF_EDGE_L: Pt[] = [[97.8, -421.2], [113.8, -418.6], [129.4, -421.2]];
/** The elbow crease runs up and out from the body side (sheet: (88,-517) -> (107,-540)); round 1 had it mirrored. */
const ELBOW_CREASE_L: Pt[] = [[90.4, -518.4], [97.6, -527.4], [106.6, -539.6]];

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
	// Rounded elbow (ZOO-P2): a disk at the elbow pivot inside the forearm, so a bent arm has a round outer elbow
	// instead of a V where the two sleeve segments cross. At rest it lies inside the sleeve.
	const er = 21 + 2 * Math.min(1, Math.abs(angles.elbow) / 90);
	const elbowDisk = `M${E.x - er} ${E.y} a${er} ${er} 0 1 0 ${2 * er} 0 a${er} ${er} 0 1 0 ${-2 * er} 0 Z`;

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
	const ls = useLineScale();
	const under = (d: string) => <path d={d} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.outline * 2 * ls} strokeLinejoin="round" />;
	const uid = safeId(useId(), `arm${side}`);
	const clipU = `${uid}-u`;
	const clipF = `${uid}-f`;
	return (
		<g data-part={side === 'L' ? 'armL' : 'armR'}>
			{chain({upper: under(upper), fore: <>{under(fore)}{under(elbowDisk)}</>, hand: <HandUnderlay shape={hand} />}, 'under')}
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
							<path d={elbowDisk} fill={ZOO_COLORS.overshirt} />
							<path d={fore} fill={ZOO_COLORS.overshirt} />
							<path d={smooth(m(FORE_SHADOW_L))} fill={ZOO_COLORS.overshirtShadow} clipPath={`url(#${clipF})`} />
							<path d={line(m(CUFF_SEAM_L))} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.detail * ls} strokeLinecap="round" />
							<path d={line(m(CUFF_EDGE_L))} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.outline * ls} strokeLinecap="round" />
							<path d={line(m(ELBOW_CREASE_L))} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.detail * ls} strokeLinecap="round" />
						</g>
					),
				},
				'fore',
			)}
		</g>
	);
};
