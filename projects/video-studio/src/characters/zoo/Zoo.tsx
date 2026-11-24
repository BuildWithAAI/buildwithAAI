/**
 * <Zoo/>: the reusable ZOO character (v1.0.0). Implements ZooProps from ../types exactly.
 * World units: ZOO is 900 units tall at scale 1; (x, y) is the screen position of his ground
 * contact point. This rig version draws the FRONT view; other views are built separately and the
 * front view is used as the fallback (see manifest.ts, knownGaps).
 */
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {BRAND} from '../palette';
import type {ZooProps} from '../types';
import {clamp} from './geometry';
import {ARM_POINT, ARM_REST, armAnglesFor, breathOffset, PIVOTS, POINT_HAND_SWITCH} from './rig';
import {Arm} from './parts/Arm';
import {Head} from './parts/Head';
import {Legs} from './parts/Legs';
import {Neck} from './parts/Neck';
import {CollarBack, Torso} from './parts/Torso';
import {ZooThreeQuarter} from './views/ThreeQuarter';
import {ZooSide} from './views/Side';
import type {ViewHeadProps} from './views/types';

export type ZooExtraProps = {
	/** Dev aid: draw the rig pivots as small markers. */
	showPivots?: boolean;
	/** Return a bare <g> for embedding in a parent <svg> instead of a full-frame <svg>. */
	embed?: boolean;
	/** Overrides the frame used for idle breathing (e.g. to hold a still). */
	breathFrame?: number;
};

const BreathingBody: React.FC<Required<Pick<ZooProps, 'expression' | 'blink' | 'browLift' | 'lookX' | 'lookY' | 'headTilt' | 'poseAmount'>> &
	Pick<ZooProps, 'mouth' | 'pose'> & {breathe: boolean; breathFrame?: number; showPivots?: boolean}> = (p) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const dy = p.breathe ? breathOffset(p.breathFrame ?? frame, fps) : 0;
	const hem = PIVOTS.torso.y;
	const sy = 1 + -dy / (hem - PIVOTS.shoulderL.y);
	const pointing = p.pose === 'point';
	const leftAngles = pointing ? armAnglesFor(ARM_POINT, p.poseAmount) : ARM_REST;
	const leftHand = pointing && p.poseAmount >= POINT_HAND_SWITCH ? 'point' : 'relaxed';
	return (
		<>
			{/* Sleeves emerge from under the overshirt's shoulder and side contour, so the arms sit behind the torso. */}
			<g data-part="arms" transform={`translate(0 ${dy})`}>
				<Arm side="R" angles={ARM_REST} hand="relaxed" />
				<Arm side="L" angles={leftAngles} hand={leftHand} />
			</g>
			<g data-part="torsoGroup" transform={`translate(0 ${hem}) scale(1 ${sy}) translate(0 ${-hem})`}>
				<CollarBack />
			</g>
			<g data-part="neckGroup" transform={`translate(0 ${dy})`}>
				<Neck />
			</g>
			<g data-part="torsoGroup" transform={`translate(0 ${hem}) scale(1 ${sy}) translate(0 ${-hem})`}>
				<Torso />
			</g>
			<g data-part="upperBody" transform={`translate(0 ${dy})`}>
				<Head expression={p.expression} mouth={p.mouth} blink={p.blink} browLift={p.browLift} lookX={p.lookX} lookY={p.lookY} headTilt={p.headTilt} />
				{p.showPivots ? <PivotMarkers /> : null}
			</g>
		</>
	);
};

/** Non-front views share the breathing clock and head controls; each view draws its own parts. */
const OtherView: React.FC<{view: Exclude<ZooProps['view'], 'front' | undefined>; head: ViewHeadProps; breathe: boolean; breathFrame?: number}> = ({view, head, breathe, breathFrame}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const breath = breathe ? breathOffset(breathFrame ?? frame, fps) : 0;
	if (view === 'threeQuarter') return <ZooThreeQuarter head={head} breath={breath} />;
	if (view === 'side') return <ZooSide head={head} breath={breath} />;
	return null;
};

const PivotMarkers: React.FC = () => (
	<g data-part="pivots">
		{Object.entries(PIVOTS).map(([k, v]) => (
			<g key={k}>
				<circle cx={v.x} cy={v.y} r={3} fill={BRAND.teal} stroke={BRAND.nearBlack} strokeWidth={1} />
			</g>
		))}
	</g>
);

/** The rig as an SVG group in world units (origin = ground contact point). */
export const ZooRig: React.FC<ZooProps & ZooExtraProps> = ({
	x = 0,
	y = 0,
	scale = 1,
	view = 'front',
	pose = 'stand',
	poseAmount = 1,
	expression = 'neutral',
	mouth,
	blink = 0,
	browLift = 0,
	lookX = 0,
	lookY = 0,
	headTilt = 0,
	breathe = true,
	breathFrame,
	showPivots,
}) => {
	const head: ViewHeadProps = {
		expression,
		mouth,
		blink: clamp(blink, 0, 1),
		browLift: clamp(browLift, 0, 1),
		lookX: clamp(lookX, -1, 1),
		lookY: clamp(lookY, -1, 1),
		headTilt: clamp(headTilt, -12, 12),
	};
	if (view !== 'front') {
		return (
			<g data-character="zoo" data-view={view} transform={`translate(${x} ${y}) scale(${scale})`}>
				<OtherView view={view} head={head} breathe={breathe} breathFrame={breathFrame} />
			</g>
		);
	}
	return (
	<g data-character="zoo" data-view="front" transform={`translate(${x} ${y}) scale(${scale})`}>
		<Legs />
		<BreathingBody
			expression={expression}
			mouth={mouth}
			blink={clamp(blink, 0, 1)}
			browLift={clamp(browLift, 0, 1)}
			lookX={clamp(lookX, -1, 1)}
			lookY={clamp(lookY, -1, 1)}
			headTilt={clamp(headTilt, -12, 12)}
			pose={pose}
			poseAmount={clamp(poseAmount, 0, 1)}
			breathe={breathe}
			breathFrame={breathFrame}
			showPivots={showPivots}
		/>
	</g>
	);
};

/** Full-frame transparent SVG layer containing ZOO (drop it into any AbsoluteFill). */
export const Zoo: React.FC<ZooProps & ZooExtraProps> = (props) => {
	const {width, height} = useVideoConfig();
	if (props.embed) return <ZooRig {...props} />;
	return (
		<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
			<ZooRig {...props} />
		</svg>
	);
};
