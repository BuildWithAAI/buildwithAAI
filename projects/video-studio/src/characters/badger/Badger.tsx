import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {BadgerHead, BadgerPose, BadgerProps, BadgerView, Expression} from '../types';
import {HeadState} from './parts/heads/Head';
import {LEFT_RIG} from './parts/rigLeft';
import {RIGHT_RIG} from './parts/rigRight';
import {plantLegs, walkPose} from './parts/gait';
import {HeadMount, SideBody, SidePose, STAND_POSE, spotsByPart} from './parts/SideBody';
import {clamp01} from './parts/shared';
import {LEFT_SPOTS, RIGHT_SPOTS} from './spots';

/** Optional extras on top of the shared BadgerProps contract (all optional, nothing renamed). */
export type BadgerExtraProps = {
	/** Iris direction, -1..1 (screen). */
	lookX?: number;
	lookY?: number;
	/** Extra neck raise in degrees (+ raises the head toward vertical in the side views). */
	neckTurn?: number;
};

export type BadgerAllProps = BadgerProps & BadgerExtraProps;

/** Body views implemented. */
export const IMPLEMENTED_VIEWS: readonly BadgerView[] = ['left', 'right'];

/**
 * Default head for each body view. Left: the size-comparison panel shows the face turned to camera with only a
 * slight lean to screen left, which matches 'front' better than the true 3/4 of the turnaround (decision D-07).
 * Right: badger_coat_right.png and the turnaround side view draw the right profile head (pale ear near).
 */
export const DEFAULT_HEAD: Record<BadgerView, BadgerHead> = {
	left: 'front',
	right: 'profileRightScreen',
	front: 'front',
	back: 'front',
	threeQuarter: 'threeQuarterRightScreen',
};

/**
 * Where each replaceable head sits on the LEFT-view neck: neck rotation (SVG deg, about the neck base) and
 * the head pivot offset from the neck's head mount (neck-local units). Tuned against the sheet panels.
 */
export const LEFT_HEAD_MOUNT: Record<BadgerHead, HeadMount> = {
	front: {neck: 7, dx: -13, dy: 25, rot: 0},
	threeQuarterLeftScreen: {neck: 7, dx: -17, dy: 25, rot: 0},
	threeQuarterRightScreen: {neck: 7, dx: -8, dy: 16, rot: 0},
	profileLeftScreen: {neck: 0, dx: 0, dy: 0, rot: 0},
	profileRightScreen: {neck: 9, dx: 12, dy: 4, rot: 0},
	upLeftScreen: {neck: 20, dx: 0, dy: 0, rot: 0},
	upRightScreen: {neck: 14, dx: 10, dy: 2, rot: 0},
};

/** Head placement on the RIGHT-view neck (SVG deg; negative neck = raised for a right-facing dog). */
export const RIGHT_HEAD_MOUNT: Record<BadgerHead, HeadMount> = {
	front: {neck: -7, dx: 13, dy: 25, rot: 0},
	threeQuarterRightScreen: {neck: -7, dx: 17, dy: 25, rot: 0},
	threeQuarterLeftScreen: {neck: -7, dx: 8, dy: 16, rot: 0},
	profileRightScreen: {neck: 0, dx: 0, dy: 0, rot: 0},
	profileLeftScreen: {neck: -9, dx: -12, dy: 4, rot: 0},
	upRightScreen: {neck: -2, dx: -7, dy: 1, rot: 0},
	upLeftScreen: {neck: -14, dx: -10, dy: 2, rot: 0},
};

const LEFT_PARTS = spotsByPart(LEFT_SPOTS);
const RIGHT_PARTS = spotsByPart(RIGHT_SPOTS);

const DEFAULT_EARS_BACK: Record<Expression, number> = {neutral: 0, happy: 0, worried: 0.7, shocked: 0.15};

/**
 * Right stand: the far (anatomical LEFT) front paw stands 23.4 units ahead of the near one. The leg is rotated
 * from its shoulder (IK) rather than shifted, so its top stays hidden behind the chest (decision R-STANCE).
 */
const RIGHT_STAND: SidePose = {...STAND_POSE, legs: plantLegs(RIGHT_RIG, 1, STAND_POSE.body, {frontFar: {x: 23.4, y: 0}})};

/** Pose state for the side rigs (facing-normalised, see SidePose). */
export const sidePoseFor = (pose: BadgerPose, view: 'left' | 'right', walkPhase = 0): SidePose => {
	const dir = view === 'right' ? 1 : -1;
	const rig = view === 'right' ? RIGHT_RIG : LEFT_RIG;
	switch (pose) {
		case 'walk':
			return walkPose(rig, dir, walkPhase, view);
		default:
			return view === 'right' ? RIGHT_STAND : STAND_POSE;
	}
};

const lookUpHead = (dir: 1 | -1): BadgerHead => (dir === 1 ? 'upRightScreen' : 'upLeftScreen');
/** The sheet's walking pose uses the profile head. */
const walkHead = (dir: 1 | -1): BadgerHead => (dir === 1 ? 'profileRightScreen' : 'profileLeftScreen');

/**
 * <Badger/>: renders an SVG <g>; place it inside an <svg> whose user units are pixels.
 * (x, y) is the ground contact point (centre of the footprint); scale 1 = canonical size (ZOO 900 tall).
 */
export const Badger: React.FC<BadgerAllProps> = (props) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const {
		x = 0,
		y = 0,
		scale = 1,
		view = 'left',
		pose = 'stand',
		expression = 'neutral',
		headTilt = 0,
		tailWag = 0,
		breathe = true,
		lookX = 0,
		lookY = 0,
		neckTurn = 0,
	} = props;
	const bodyView: BadgerView = IMPLEMENTED_VIEWS.includes(view) ? view : 'left';
	const dir: 1 | -1 = bodyView === 'right' ? 1 : -1;
	const head = props.head ?? (pose === 'lookUp' ? lookUpHead(dir) : pose === 'walk' ? walkHead(dir) : DEFAULT_HEAD[bodyView]);
	const headState: HeadState = {
		expression,
		blink: clamp01(props.blink),
		judge: clamp01(props.judge),
		earsBack: clamp01(props.earsBack, DEFAULT_EARS_BACK[expression]),
		lookX: Math.max(-1, Math.min(1, lookX)),
		lookY: Math.max(-1, Math.min(1, lookY)),
	};
	const breath = breathe ? Math.sin(((frame / fps) * Math.PI * 2) / 3.4) : 0;
	const sidePose = sidePoseFor(pose, dir === 1 ? 'right' : 'left', props.walkPhase ?? 0);
	return (
		<g transform={`translate(${x} ${y}) scale(${scale})`} data-character="badger" data-view={bodyView} data-pose={pose}>
			{dir === -1 ? (
				<SideBody
					rig={LEFT_RIG}
					dir={-1}
					spots={LEFT_PARTS}
					backLineY={-72}
					head={head}
					headMount={LEFT_HEAD_MOUNT[head]}
					headState={headState}
					headTilt={headTilt}
					tailWag={tailWag}
					breath={breath}
					neckTurn={neckTurn}
					pose={sidePose}
					uidPrefix="bl"
				/>
			) : (
				<SideBody
					rig={RIGHT_RIG}
					dir={1}
					spots={RIGHT_PARTS}
					backLineY={-78}
					head={head}
					headMount={RIGHT_HEAD_MOUNT[head]}
					headState={headState}
					headTilt={headTilt}
					tailWag={tailWag}
					breath={breath}
					neckTurn={neckTurn}
					pose={sidePose}
					uidPrefix="br"
				/>
			)}
		</g>
	);
};

/** Convenience: a full-frame transparent <svg> layer containing one Badger (for use directly in an AbsoluteFill). */
export const BadgerLayer: React.FC<BadgerAllProps & {width: number; height: number}> = ({width, height, ...rest}) => (
	<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', inset: 0}}>
		<Badger {...rest} />
	</svg>
);
