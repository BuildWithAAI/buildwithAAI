import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {BadgerHead, BadgerPose, BadgerProps, BadgerView, Expression} from '../types';
import {Head, HeadState, headGeom} from './parts/heads/Head';
import {ViewBody, ViewRig} from './parts/ViewBody';
import {POSE_RIGS} from './parts/poseRigs';
import {VIEW_RIGS} from './parts/viewRigs';
import {LEFT_RIG} from './parts/rigLeft';
import {RIGHT_RIG} from './parts/rigRight';
import {plantLegs, walkPose} from './parts/gait';
import {HeadMount, SideBody, SidePose, STAND_POSE, spotsByPart} from './parts/SideBody';
import {LineScaleContext, clamp01, lineScaleFor} from './parts/shared';
import {BACK_SPOTS, FRONT_SPOTS, LEFT_SPOTS, LIE_LEFT_SPOTS, LIE_SPOTS, RIGHT_SPOTS, SIT_LEFT_SPOTS, SIT_SPOTS, THREE_QUARTER_SPOTS} from './spots';

/** Optional extras on top of the shared BadgerProps contract (all optional, nothing renamed). */
export type BadgerExtraProps = {
	/** Iris direction, -1..1 (screen). */
	lookX?: number;
	lookY?: number;
	/** Extra neck raise in degrees (+ raises the head toward vertical in the side views). */
	neckTurn?: number;
	/**
	 * 0..1 mouth opening for Badger's real-dog sound clips (drive it from the clip's amplitude; owner request): the
	 * head view's own open mouth grows from the upper lip and the ears lift slightly. 0 (default) = the expression's mouth.
	 */
	mouthOpen?: number;
	/**
	 * Line weight multiplier (default 1 = the palette's LINE widths in world units), the same contract as ZooRig's
	 * lineScale: every outline and detail width is multiplied by it. Pass badgerLineScaleFor(pxPerUnit) (ART_GUIDE SL5:
	 * outline 3-6 px at output) and give Zoo the same value in a two-shot so the pair keeps one line weight.
	 */
	lineScale?: number;
};

/** ART_GUIDE SL5 line scale for a framing (output px per world unit); the same formula as Zoo's lineScaleFor. */
export const badgerLineScaleFor = lineScaleFor;

export type BadgerAllProps = BadgerProps & BadgerExtraProps;

/** Body views implemented (all five). Nothing is produced by mirroring another view. */
export const IMPLEMENTED_VIEWS: readonly BadgerView[] = ['left', 'right', 'front', 'back', 'threeQuarter'];

/** Spot set per non-side body (view or pose body). */
const BODY_SPOTS = {
	front: FRONT_SPOTS,
	back: BACK_SPOTS,
	threeQuarter: THREE_QUARTER_SPOTS,
	sit: SIT_SPOTS,
	lie: LIE_SPOTS,
	sitLeft: SIT_LEFT_SPOTS,
	lieLeft: LIE_LEFT_SPOTS,
} as const;

/**
 * Eyes-and-nose centroid of a replaceable head (head-local). The front / 3/4 views and the pose bodies mount the
 * head so this centroid lands on the sheet's own face centroid (pivot 'headCentroid' of each traced body).
 */
export const headLandmark = (view: BadgerHead): {x: number; y: number} => {
	const g = headGeom(view);
	const n = (g.nose.d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
	const xs = n.filter((_, i) => i % 2 === 0);
	const ys = n.filter((_, i) => i % 2 === 1);
	const nose = {x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2};
	const pts = [nose, ...g.eyes.map((e) => e.c)];
	return {x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length};
};

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
	upRightScreen: {neck: -12, dx: -7, dy: 1, rot: 0},
	upLeftScreen: {neck: -14, dx: -10, dy: 2, rot: 0},
};

const LEFT_PARTS = spotsByPart(LEFT_SPOTS);
const RIGHT_PARTS = spotsByPart(RIGHT_SPOTS);

const DEFAULT_EARS_BACK: Record<Expression, number> = {neutral: 0, happy: 0, worried: 0.7, shocked: 0.15};

/** Tail carriage for 'happy' in the side views (deg above the standing carriage): the happy panel's inset. */
const HAPPY_TAIL = 32;

/**
 * Right stand: badger_coat_right.png and badger_turn_side.png show ONE front leg (row scans give a single pair of
 * edges from the elbow to the paw), so the far (anatomical LEFT) front leg stands exactly behind the near one and is
 * hidden by it (decision BADGER-D15, revised; any forward offset doubled the near leg's front outline).
 */
const RIGHT_STAND: SidePose = {...STAND_POSE, legs: plantLegs(RIGHT_RIG, 1, STAND_POSE.body, {frontFar: {x: 0, y: 0}})};

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
/** The sheet's sitting and lying poses turn the head three-quarters toward the camera. */
const POSE_HEAD: BadgerHead = 'threeQuarterRightScreen';
/** Left-facing sit / lie: the 3/4 head turned to screen left (dark LEFT ear near). */
const POSE_HEAD_LEFT: BadgerHead = 'threeQuarterLeftScreen';
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
	// walk and look-up are side-view poses: a front / back / 3/4 view walks or looks up in the sheet's facing
	// (screen right). sit and lie face screen right (the panels, right-side markings) or, with view 'left', screen left:
	// the unmarked pose silhouette carrying the LEFT coat-map markings (decision BADGER-D23; no marking is flipped).
	const sideOnly = pose === 'walk' || pose === 'lookUp';
	const poseBodyPose = pose === 'sit' || pose === 'lie';
	const bodyView: BadgerView = !IMPLEMENTED_VIEWS.includes(view)
		? 'left'
		: poseBodyPose
			? view === 'left'
				? 'left'
				: 'right'
			: sideOnly && view !== 'left' && view !== 'right'
				? 'right'
				: view;
	const dir: 1 | -1 = bodyView === 'right' ? 1 : -1;
	const head =
		props.head ??
		(pose === 'lookUp'
			? lookUpHead(dir)
			: pose === 'walk'
				? walkHead(dir)
				: poseBodyPose
					? dir === 1
						? POSE_HEAD
						: POSE_HEAD_LEFT
					: DEFAULT_HEAD[bodyView]);
	const headState: HeadState = {
		expression,
		blink: clamp01(props.blink),
		judge: clamp01(props.judge),
		earsBack: clamp01(props.earsBack, DEFAULT_EARS_BACK[expression]),
		lookX: Math.max(-1, Math.min(1, lookX)),
		lookY: Math.max(-1, Math.min(1, lookY)),
		mouthOpen: clamp01(props.mouthOpen),
	};
	const breath = breathe ? Math.sin(((frame / fps) * Math.PI * 2) / 3.4) : 0;
	const basePose = sidePoseFor(pose, dir === 1 ? 'right' : 'left', props.walkPhase ?? 0);
	// happy carries the tail high (the happy panel's inset); the wag itself stays restrained (SideBody)
	const sidePose: SidePose = expression === 'happy' ? {...basePose, tail: Math.max(basePose.tail, HAPPY_TAIL)} : basePose;
	const poseBody = poseBodyPose ? (dir === 1 ? pose : pose === 'sit' ? 'sitLeft' : 'lieLeft') : null;
	const isSide = !poseBody && (bodyView === 'left' || bodyView === 'right');
	let body: React.ReactNode = null;
	if (!isSide) {
		const key = poseBody ?? (bodyView as 'front' | 'back' | 'threeQuarter');
		const rig = (poseBody ? POSE_RIGS[poseBody] : VIEW_RIGS[bodyView as 'front' | 'back' | 'threeQuarter']) as unknown as ViewRig;
		const c = rig.pivots.headCentroid;
		const lm = c ? headLandmark(head) : {x: 0, y: 0};
		// head tilt / neck turn keep the side views' sense in the left-facing pose bodies (they are the right ones' mirror)
		const leftPoseBody = poseBody === 'sitLeft' || poseBody === 'lieLeft';
		const tilt = key === 'front' || leftPoseBody ? headTilt : -headTilt;
		const headNode = c ? (
			<g transform={`translate(${(c.x - lm.x).toFixed(2)} ${(c.y - lm.y).toFixed(2)}) rotate(${tilt})`}>
				<Head view={head} state={headState} />
			</g>
		) : null;
		body = (
			<ViewBody
				rig={rig}
				spots={BODY_SPOTS[key]}
				tailWag={tailWag}
				tailBase={0}
				breath={breath}
				neckTurn={leftPoseBody ? -neckTurn : neckTurn}
				uidPrefix={`bv${key}`}
				inserts={headNode ? [{after: 'tagShadow', group: 'head', node: headNode}] : []}
			/>
		);
	}
	const lineScale = Math.max(0.05, Number.isFinite(props.lineScale) ? (props.lineScale as number) : 1);
	return (
		<LineScaleContext.Provider value={lineScale}>
			<g transform={`translate(${x} ${y}) scale(${scale})`} data-character="badger" data-view={bodyView} data-pose={pose}>
				{!isSide ? body : dir === -1 ? (
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
		</LineScaleContext.Provider>
	);
};

/** Convenience: a full-frame transparent <svg> layer containing one Badger (for use directly in an AbsoluteFill). */
export const BadgerLayer: React.FC<BadgerAllProps & {width: number; height: number}> = ({width, height, ...rest}) => (
	<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', inset: 0}}>
		<Badger {...rest} />
	</svg>
);
