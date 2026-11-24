/**
 * <Zoo/>: the reusable ZOO character (v1.0.0). Implements ZooProps from ../types exactly.
 * World units: ZOO is 900 units tall at scale 1; (x, y) is the screen position of his ground
 * contact point. Views: front (parts/), threeQuarter, side and back (views/). Pose 'typing' is a
 * seated 3/4 pose with props (views/Typing.tsx, props/). See manifest.ts for pivots and decisions.
 */
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {BRAND} from '../palette';
import type {ZooProps} from '../types';
import {clamp} from './geometry';
import {LineScaleContext} from './parts/Shape';
import {ARM_POINT, ARM_POINT_WINDUP, ARM_REST, armAnglesFor, breathOffset, PIVOTS, POINT_HAND_CURL, POINT_HAND_SWITCH, POINT_LOOK, TYPING_LOOK} from './rig';
import {Arm} from './parts/Arm';
import {Head} from './parts/Head';
import {Legs} from './parts/Legs';
import {Neck} from './parts/Neck';
import {CollarBack, Torso} from './parts/Torso';
import {ZooThreeQuarter} from './views/ThreeQuarter';
import {ZooSide} from './views/Side';
import {ZooBack} from './views/Back';
import {ZooTyping, type TypingLayer} from './views/Typing';
import {PIVOTS_34, PIVOTS_BACK, PIVOTS_SIDE, PIVOTS_TYPING} from './views/pivots';
import type {ViewHeadProps} from './views/types';

export type ZooExtraProps = {
	/** Dev aid: draw the rig pivots as small markers. */
	showPivots?: boolean;
	/** Return a bare <g> for embedding in a parent <svg> instead of a full-frame <svg>. */
	embed?: boolean;
	/** Overrides the frame used for idle breathing (e.g. to hold a still). */
	breathFrame?: number;
	/** pose="typing": animate finger taps from the current frame. */
	typing?: boolean;
	/**
	 * Which part to draw. 'back' = everything behind a desk (body, legs, head); 'front' = the parts in
	 * front of a desk (pose="typing": forearms and hands; other poses: nothing). Default 'all'.
	 */
	layer?: TypingLayer;
	/** Drawn in ZOO's world space between the back and front layers (e.g. a desk and keyboard). */
	between?: React.ReactNode;
	/**
	 * Multiplier for every stroke width (default 1 = LINE widths, right for full-body framing). The sheet keeps a
	 * near-constant SCREEN line weight, so close-ups want thinner world-unit lines: pass lineScaleFor(pxPerUnit)
	 * (lines.ts, ART_GUIDE SL5), e.g. ~0.53 for a 1080p bust where 1 unit = 3.2 px.
	 */
	lineScale?: number;
	/**
	 * pose="point", front view: 0..1 anticipation before the gesture (the hand draws in toward the hip and
	 * the wrist cocks, ARM_POINT_WINDUP). Animate it up just before poseAmount starts and back to 0 as the arm
	 * swings out. Default 0.
	 */
	pointWindup?: number;
	/**
	 * pose="point", front view: how much of the anticipation tuck (POINT_OVERLAP.tuck, the elbow gathering in before the
	 * upper arm opens) to use, 0..1. Default 1, right for the RAISE. Pass 0 while LOWERING the arm (repair round 3): the
	 * tuck acts only below poseAmount 0.4, so set it at any frame where the arm is above that (e.g. during the hold).
	 */
	pointTuck?: number;
};

const BreathingBody: React.FC<Required<Pick<ZooProps, 'expression' | 'blink' | 'browLift' | 'lookX' | 'lookY' | 'headTilt' | 'poseAmount'>> &
	Pick<ZooProps, 'mouth' | 'pose'> & {breathe: boolean; breathFrame?: number; showPivots?: boolean; pointWindup: number; pointTuck: number}> = (p) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const bf = p.breathFrame ?? frame;
	const dy = p.breathe ? breathOffset(bf, fps) : 0;
	// The arms follow the chest 3 frames late (overlap, ART_GUIDE MO8).
	const dyArms = p.breathe ? breathOffset(bf - 3, fps) : 0;
	const hem = PIVOTS.torso.y;
	const sy = 1 + -dy / (hem - PIVOTS.shoulderL.y);
	const pointing = p.pose === 'point';
	const base = pointing ? armAnglesFor(ARM_POINT, p.poseAmount, undefined, {tuck: p.pointTuck}) : ARM_REST;
	const w = pointing ? p.pointWindup : 0;
	const leftAngles = {
		shoulder: base.shoulder + ARM_POINT_WINDUP.shoulder * w,
		elbow: base.elbow + ARM_POINT_WINDUP.elbow * w,
		wrist: base.wrist + ARM_POINT_WINDUP.wrist * w,
	};
	const leftHand = !pointing ? 'relaxed' : p.poseAmount >= POINT_HAND_SWITCH ? 'point' : p.poseAmount >= POINT_HAND_CURL ? 'curl' : 'relaxed';
	return (
		<>
			{/* Sleeves emerge from under the overshirt's shoulder and side contour, so the arms sit behind the torso. */}
			<g data-part="arms" transform={`translate(0 ${dyArms})`}>
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
				<Torso shoulderL={leftAngles.shoulder} />
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
	return <ZooBack head={head} breath={breath} />;
};

/** The seated typing pose is authored in 3/4 facing screen right (as on the sheet) for every view. */
const TypingPose: React.FC<{head: ViewHeadProps; breathe: boolean; breathFrame?: number; typing: boolean; layer: TypingLayer; between?: React.ReactNode}> = (p) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const breath = p.breathe ? breathOffset(p.breathFrame ?? frame, fps) : 0;
	return <ZooTyping head={p.head} breath={breath} typing={p.typing} layer={p.layer} between={p.between} />;
};

const PivotMarkers: React.FC<{table?: Record<string, {x: number; y: number}>}> = ({table = PIVOTS}) => (
	<g data-part="pivots">
		{Object.entries(table).map(([k, v]) => (
			<g key={k}>
				<circle cx={v.x} cy={v.y} r={3} fill={BRAND.teal} stroke={BRAND.nearBlack} strokeWidth={1} />
			</g>
		))}
	</g>
);
const VIEW_PIVOTS = {threeQuarter: PIVOTS_34, side: PIVOTS_SIDE, back: PIVOTS_BACK} as const;

/** The rig as an SVG group in world units (origin = ground contact point). */
export const ZooRig: React.FC<ZooProps & ZooExtraProps> = (props) => {
	// pose="point": unless the caller animates them, the eyes and head lean toward the point with the arm (POINT_LOOK).
	const amount = Math.max(0, Math.min(1, props.poseAmount ?? 1));
	const pointing = props.pose === 'point' && (props.view ?? 'front') === 'front';
	const typingPose = props.pose === 'typing';
	const lookX = props.lookX ?? (pointing ? POINT_LOOK.lookX * amount : typingPose ? TYPING_LOOK.lookX : undefined);
	const lookY = props.lookY ?? (typingPose ? TYPING_LOOK.lookY : undefined);
	const headTilt = props.headTilt ?? (pointing ? POINT_LOOK.headTilt * amount : typingPose ? TYPING_LOOK.headTilt : undefined);
	return (
		<LineScaleContext.Provider value={Math.max(0.05, props.lineScale ?? 1)}>
			<ZooRigInner {...props} lookX={lookX} lookY={lookY} headTilt={headTilt} />
		</LineScaleContext.Provider>
	);
};

const ZooRigInner: React.FC<ZooProps & ZooExtraProps> = ({
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
	typing = false,
	layer = 'all',
	between,
	pointWindup = 0,
	pointTuck = 1,
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
	if (pose === 'typing') {
		return (
			<g data-character="zoo" data-view="threeQuarter" data-pose="typing" transform={`translate(${x} ${y}) scale(${scale})`}>
				<TypingPose head={head} breathe={breathe} breathFrame={breathFrame} typing={typing} layer={layer} between={between} />
				{showPivots && layer !== 'back' ? <PivotMarkers table={PIVOTS_TYPING} /> : null}
			</g>
		);
	}
	if (layer === 'front') return null;
	if (view !== 'front') {
		return (
			<g data-character="zoo" data-view={view} transform={`translate(${x} ${y}) scale(${scale})`}>
				<OtherView view={view} head={head} breathe={breathe} breathFrame={breathFrame} />
				{layer === 'all' ? between : null}
				{showPivots ? <PivotMarkers table={VIEW_PIVOTS[view]} /> : null}
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
			pointWindup={clamp(pointWindup, 0, 1)}
			pointTuck={clamp(pointTuck, 0, 1)}
		/>
		{layer === 'all' ? between : null}
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
