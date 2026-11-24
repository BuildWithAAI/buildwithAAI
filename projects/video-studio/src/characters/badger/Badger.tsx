import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {BadgerHead, BadgerProps, BadgerView, Expression} from '../types';
import {Head, HeadState} from './parts/heads/Head';
import {Leg, LegAngles} from './parts/Leg';
import {CollarLeft, NeckLeft} from './parts/Neck';
import {LEFT_RIG} from './parts/rigLeft';
import {PartShape, clamp01, tr, useUid} from './parts/shared';
import {SpotShapes} from './parts/SpotShapes';
import {Tail} from './parts/Tail';
import {spotsFor} from './spots';

/** Optional extras on top of the shared BadgerProps contract (all optional, nothing renamed). */
export type BadgerExtraProps = {
	/** Iris direction, -1..1 (screen). */
	lookX?: number;
	lookY?: number;
	/** Extra neck rotation in degrees (+ raises the head toward vertical in the left view). */
	neckTurn?: number;
};

export type BadgerAllProps = BadgerProps & BadgerExtraProps;

/** Views implemented in rig v1. Other views fall back to 'left' (never a mirrored body). */
export const IMPLEMENTED_VIEWS: readonly BadgerView[] = ['left'];

/** Default head for each body view (left: the size-comparison panel shows a slight turn toward camera-left). */
export const DEFAULT_HEAD: Record<BadgerView, BadgerHead> = {
	left: 'threeQuarterLeftScreen',
	right: 'threeQuarterRightScreen',
	front: 'front',
	back: 'front',
	threeQuarter: 'threeQuarterRightScreen',
};

/**
 * Where each replaceable head sits on the LEFT-view neck: neck rotation (deg, about the neck base) and
 * the head pivot offset from the neck's head mount (neck-local units). Tuned against the sheet panels.
 */
export const LEFT_HEAD_MOUNT: Record<BadgerHead, {neck: number; dx: number; dy: number; rot: number}> = {
	front: {neck: 7, dx: -21, dy: 18, rot: 0},
	threeQuarterLeftScreen: {neck: 7, dx: -21, dy: 18, rot: 0},
	threeQuarterRightScreen: {neck: 7, dx: -8, dy: 16, rot: 0},
	profileLeftScreen: {neck: 0, dx: 0, dy: 0, rot: 0},
	profileRightScreen: {neck: 9, dx: 12, dy: 4, rot: 0},
	upLeftScreen: {neck: 12, dx: 0, dy: 0, rot: 0},
	upRightScreen: {neck: 14, dx: 10, dy: 2, rot: 0},
};

const DEFAULT_EARS_BACK: Record<Expression, number> = {neutral: 0, happy: 0, worried: 0.7, shocked: 0.15};

const REST: LegAngles = {upper: 0, lower: 0, paw: 0};

/** BADGER, left-side standing view (anatomical LEFT side toward camera, facing screen left). */
const BadgerLeft: React.FC<{
	head: BadgerHead;
	headState: HeadState;
	headTilt: number;
	tailWag: number;
	breath: number;
	neckTurn: number;
}> = ({head, headState, headTilt, tailWag, breath, neckTurn}) => {
	const uid = useUid('bl');
	const R = LEFT_RIG;
	const M = R.mounts;
	const hm = LEFT_HEAD_MOUNT[head];
	const neckAngle = hm.neck + neckTurn;
	const neckT = `${tr(M.neck, neckAngle)} translate(0 ${(-breath * 0.6).toFixed(2)})`;
	const headT = `${neckT} translate(${R.neck.headMount.x + hm.dx} ${R.neck.headMount.y + hm.dy}) rotate(${hm.rot + headTilt})`;
	// breathing: the chest rises and falls about the back line; legs keep their ground contact
	const breathT = `translate(0 -72) scale(1 ${(1 + breath * 0.006).toFixed(4)}) translate(0 72)`;
	// restrained wag: a swing about the root plus follow-through curl toward the tip
	const ph = tailWag * Math.PI * 2;
	const wag = tailWag ? 9 * Math.sin(ph) : 0;
	const bend = tailWag ? 10 * Math.sin(ph - 0.9) : 0;
	return (
		<g transform={tr(R.torso.pivot)}>
			<Leg geom={R.legHind} mount={M.legHindFar} angles={REST} uid={`${uid}-hf`} far />
			<Leg geom={R.legFront} mount={M.legFrontFar} angles={REST} uid={`${uid}-ff`} far />
			<Tail geom={R.tail} mount={M.tail} wag={wag} bend={bend} uid={uid} />
			<g transform={neckT}>
				<NeckLeft uid={uid} />
			</g>
			<g transform={breathT}>
				<PartShape geom={R.torso} clipId={`${uid}-torso`}>
					<SpotShapes spots={spotsFor('torso')} />
				</PartShape>
			</g>
			<Leg geom={R.legHind} mount={M.legHindNear} angles={REST} uid={`${uid}-hn`} spots={spotsFor('legHindNear')} />
			<Leg geom={R.legFront} mount={M.legFrontNear} angles={REST} uid={`${uid}-fn`} spots={spotsFor('legFrontNear')} />
			<g transform={neckT}>
				<CollarLeft neckAngle={neckAngle} />
			</g>
			<g transform={headT}>
				<Head view={head} state={headState} />
			</g>
		</g>
	);
};

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
		expression = 'neutral',
		headTilt = 0,
		tailWag = 0,
		breathe = true,
		lookX = 0,
		lookY = 0,
		neckTurn = 0,
	} = props;
	const bodyView: BadgerView = IMPLEMENTED_VIEWS.includes(view) ? view : 'left';
	const head = props.head ?? (props.pose === 'lookUp' ? 'upLeftScreen' : DEFAULT_HEAD[bodyView]);
	const headState: HeadState = {
		expression,
		blink: clamp01(props.blink),
		judge: clamp01(props.judge),
		earsBack: clamp01(props.earsBack, DEFAULT_EARS_BACK[expression]),
		lookX: Math.max(-1, Math.min(1, lookX)),
		lookY: Math.max(-1, Math.min(1, lookY)),
	};
	const breath = breathe ? Math.sin(((frame / fps) * Math.PI * 2) / 3.4) : 0;
	return (
		<g transform={`translate(${x} ${y}) scale(${scale})`} data-character="badger" data-view={bodyView}>
			<BadgerLeft head={head} headState={headState} headTilt={headTilt} tailWag={tailWag} breath={breath} neckTurn={neckTurn} />
		</g>
	);
};

/** Convenience: a full-frame transparent <svg> layer containing one Badger (for use directly in an AbsoluteFill). */
export const BadgerLayer: React.FC<BadgerAllProps & {width: number; height: number}> = ({width, height, ...rest}) => (
	<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', inset: 0}}>
		<Badger {...rest} />
	</svg>
);
