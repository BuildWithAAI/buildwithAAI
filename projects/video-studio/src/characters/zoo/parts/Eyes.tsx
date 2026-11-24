/**
 * Eyes: almond whites, a heavy tapered upper-lid line, dark brown irises with a small pupil and one small
 * highlight. Irises (lookX/lookY) are clipped inside the eye shape; the upper lid is a skin shape that slides
 * down over the eye for `blink`. The two eyes are an anatomical mirror pair; the highlight and the look
 * direction are applied in screen space so both eyes agree.
 *
 * Repair round 1 (zoo_expr_neutral.png, 0.699 u/px): no outer-corner flick (the sheet's lid simply tapers past
 * the outer corner); the lid overlaps the top of the iris; iris r 5.2 near-black brown with a pupil that barely
 * shows; the highlight sits upper-LEFT of each iris (key light from screen left, as on the sheet).
 */
import React, {useId} from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {clamp, clamp01, lerp, lerpPts, line, safeId, smooth, tapered, type Pt} from '../geometry';
import {featureScale, LID_MIN_SCALE, ZOO_LINE} from '../lines';
import {PIVOTS, type EyePose} from '../rig';
import {useLineScale} from './Shape';

// Eye-local units: origin at the eye centre, +x toward the OUTER corner, y down.
export const OUTER: Pt = [11.5, 1.3, 'c'];
export const INNER: Pt = [-11.1, -0.2, 'c'];
export const UPPER: Pt[] = [[8.6, -3.3], [1, -4.9], [-7, -4.5]]; // outer -> inner
export const LOWER: Pt[] = [[-8, 3.7], [0, 4.9], [7.6, 3.9]]; // inner -> outer
export const CLOSED: Pt[] = [[8.6, 2.4], [1, 3.5], [-7, 2.7]]; // lid edge when fully closed
/** Past the outer corner: the lid line continues ~1.4 u along its own tangent and tapers. */
export const OUTER_EXT: Pt = [12.6, 2.4];
export const IRIS = {x: -1.2, y: 0.3, r: 5.2, pupil: 2.2};
/** Highlight offset from the iris centre, SCREEN space (upper left on both eyes). */
export const HIGHLIGHT = {dx: -1.9, dy: -2.1, r: 1.15};

/** Lid-line width profile along the line, t = 0 at the outer tip .. 1 at the inner corner (full width = 1). */
export const lidProfile = (t: number) => (t < 0.12 ? 0.42 + 0.58 * (t / 0.12) : t < 0.58 ? 1 : 1 - 0.58 * ((t - 0.58) / 0.42));

type EyeProps = {side: 1 | -1; pose: EyePose; blink: number; lookX: number; lookY: number};

const Eye: React.FC<EyeProps> = ({side, pose, blink, lookX, lookY}) => {
	const clipId = safeId(useId(), 'eye');
	const ls = useLineScale();
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
	const lidEdge = [OUTER_EXT, OUTER, ...lid, INNER].map(W);
	// Skin lid for blinks: bounded by the lid edge and the open upper edge (+1.8 u), and a little past both
	// corners, drawn UNCLIPPED so no anti-aliased fringe of eye white survives above a closed lid.
	const lidFill = [
		W([OUTER[0] + 1.4, OUTER[1]]),
		...lid.map(W),
		W([INNER[0] - 1.4, INNER[1]]),
		...upper
			.slice()
			.reverse()
			.map((p) => W([p[0], p[1] - 1.8])),
	];
	// iris in screen space
	const ix = c.x + side * IRIS.x * s + clamp(lookX, -1, 1) * 4.2;
	const iy = c.y + IRIS.y * s + clamp(lookY, -1, 1) * 1.8;
	const r = IRIS.r * s * pose.iris;
	const crease: Pt[] = [W([-5, -7.4 - pose.lidTop * 0.6]), W([1.5, -8.2 - pose.lidTop * 0.6]), W([7, -6.6 - pose.lidTop * 0.6])];
	const lidW = ZOO_LINE.lid * 1.1 * featureScale(ls, LID_MIN_SCALE);
	return (
		<g data-part={side === 1 ? 'eyeL' : 'eyeR'}>
			{b < 0.97 ? (
				<>
					<clipPath id={clipId}>
						<path d={smooth(shape)} />
					</clipPath>
					<path d={smooth(shape)} fill={ZOO_COLORS.eyeWhite} />
					<g clipPath={`url(#${clipId})`}>
						<circle data-part="iris" cx={ix} cy={iy} r={r} fill={ZOO_COLORS.eyeIris} />
						<circle data-part="pupil" cx={ix} cy={iy} r={IRIS.pupil * s * lerp(1, pose.iris, 0.6)} fill={ZOO_COLORS.pupil} />
						<circle data-part="highlight" cx={ix + HIGHLIGHT.dx * s} cy={iy + HIGHLIGHT.dy * s} r={HIGHLIGHT.r * s} fill={ZOO_COLORS.eyeWhite} />
					</g>
				</>
			) : null}
			{b > 0.001 ? <path data-part="upperLid" d={smooth(lidFill)} fill={ZOO_COLORS.skin} /> : null}
			<path d={line([W([-5.5, lower[1][1] - 0.3]), W([0.5, lower[1][1] + 0.4]), W([6, lower[2][1] + 0.1])])} fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={ZOO_LINE.fine * ls} strokeLinecap="round" />
			<path d={line(crease)} fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={ZOO_LINE.fine * 0.9 * ls} strokeLinecap="round" />
			<path data-part="lidLine" d={tapered(lidEdge, (t) => lidW * lidProfile(t))} fill={LINE.color} />
		</g>
	);
};

export const Eyes: React.FC<{pose: EyePose; blink: number; lookX: number; lookY: number}> = (p) => (
	<g data-part="eyes">
		<Eye side={1} {...p} />
		<Eye side={-1} {...p} />
	</g>
);
