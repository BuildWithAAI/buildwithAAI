/**
 * Eyes: almond whites, heavy upper-lid line, brown irises with pupils and one small highlight.
 * Irises (lookX/lookY) are clipped inside the eye shape; the upper lid is a skin shape that slides
 * down over the eye for `blink`. The two eyes are an anatomical mirror pair; the highlight and the
 * look direction are applied in screen space so both eyes agree.
 */
import React, {useId} from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {clamp, clamp01, lerp, lerpPts, line, safeId, smooth, type Pt} from '../geometry';
import {PIVOTS, type EyePose} from '../rig';

// Eye-local units: origin at the eye centre, +x toward the OUTER corner, y down.
export const OUTER: Pt = [10.8, 1.2, 'c'];
export const INNER: Pt = [-10.6, -0.2, 'c'];
export const UPPER: Pt[] = [[8, -3.5], [1, -5.5], [-6.5, -4.9]]; // outer -> inner
export const LOWER: Pt[] = [[-7.5, 3.7], [0, 4.9], [7, 3.9]]; // inner -> outer
export const CLOSED: Pt[] = [[8, 2.4], [1, 3.5], [-6.5, 2.7]]; // lid edge when fully closed
export const IRIS = {x: -1.2, y: 0.5, r: 5.5, pupil: 3};

type EyeProps = {side: 1 | -1; pose: EyePose; blink: number; lookX: number; lookY: number};

const Eye: React.FC<EyeProps> = ({side, pose, blink, lookX, lookY}) => {
	const clipId = safeId(useId(), 'eye');
	const c = side === 1 ? PIVOTS.eyeL : PIVOTS.eyeR;
	const s = pose.scale;
	// local -> world (mirror x for the anatomical right eye)
	const W = (p: Pt): Pt => {
		const x = c.x + side * p[0] * s;
		const y = c.y + p[1] * s;
		return p.length === 3 ? [x, y, 'c'] : [x, y];
	};
	const upper = UPPER.map((p, i) => [p[0], p[1] - pose.lidTop * (i === 1 ? 1 : 0.75)] as Pt);
	const lower = LOWER.map((p, i) => [p[0], p[1] - pose.lidBottom * (i === 1 ? 1 : 0.8)] as Pt);
	const shape = [OUTER, ...upper, INNER, ...lower].map(W);
	const b = clamp01(blink);
	const lid = lerpPts(upper, CLOSED.map((p, i) => [p[0], Math.min(p[1], lower[2 - i][1] - 1.1)] as Pt), b);
	const lidEdge = [OUTER, ...lid, INNER].map(W);
	const lidFill = [...lidEdge, W([-14, -16]), W([14, -16])];
	// iris in screen space
	const ix = c.x + side * IRIS.x * s + clamp(lookX, -1, 1) * 4.2;
	const iy = c.y + IRIS.y * s + clamp(lookY, -1, 1) * 1.8;
	const r = IRIS.r * s * pose.iris;
	const crease: Pt[] = [W([-5, -7.4 - pose.lidTop * 0.6]), W([1.5, -8.2 - pose.lidTop * 0.6]), W([7, -6.6 - pose.lidTop * 0.6])];
	return (
		<g data-part={side === 1 ? 'eyeL' : 'eyeR'}>
			<clipPath id={clipId}>
				<path d={smooth(shape)} />
			</clipPath>
			<path d={smooth(shape)} fill={ZOO_COLORS.eyeWhite} />
			<g clipPath={`url(#${clipId})`}>
				<circle data-part="iris" cx={ix} cy={iy} r={r} fill={ZOO_COLORS.eyeIris} />
				<circle data-part="pupil" cx={ix} cy={iy} r={IRIS.pupil * s * lerp(1, pose.iris, 0.6)} fill={ZOO_COLORS.pupil} />
				<circle data-part="highlight" cx={ix + 1.8} cy={iy - 2} r={1.15} fill={ZOO_COLORS.eyeWhite} />
				{b > 0.001 ? <path data-part="upperLid" d={smooth(lidFill)} fill={ZOO_COLORS.skin} /> : null}
			</g>
			<path d={line([W([-5.5, lower[1][1] - 0.3]), W([0.5, lower[1][1] + 0.4]), W([6, lower[2][1] + 0.1])])} fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={1.3} strokeLinecap="round" />
			<path d={line(crease)} fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={1.2} strokeLinecap="round" />
			<path data-part="lidLine" d={line(lidEdge)} fill="none" stroke={LINE.color} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
			<path d={line([W([10.4, 1.2]), W([12.6, -0.6])])} fill="none" stroke={LINE.color} strokeWidth={1.8} strokeLinecap="round" />
		</g>
	);
};

export const Eyes: React.FC<{pose: EyePose; blink: number; lookX: number; lookY: number}> = (p) => (
	<g data-part="eyes">
		<Eye side={1} {...p} />
		<Eye side={-1} {...p} />
	</g>
);
