import React from 'react';
import {AbsoluteFill, Composition, useCurrentFrame} from 'remotion';
import {BRAND} from '../../palette';
import type {BadgerHead, BadgerPose, BadgerView, Expression} from '../../types';
import {Badger} from '../Badger';
import {WALK} from '../parts/gait';

/**
 * Dev compositions for the extra views and poses (right, front, back, threeQuarter; sit, lie, walk, lookUp).
 * Fixed px-per-unit scenes so renders can be warped onto the sheet crops for overlays.
 */
const BG = BRAND.background;

type OneProps = {
	view: BadgerView;
	pose: BadgerPose;
	head?: BadgerHead;
	scale: number;
	ox: number;
	oy: number;
	walkPhase: number;
	expression: Expression;
	tailWag: number;
};

const One: React.FC<OneProps> = ({view, pose, head, scale, ox, oy, walkPhase, expression, tailWag}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 1100 860">
			<Badger x={ox} y={oy} scale={scale} view={view} pose={pose} head={head} walkPhase={walkPhase} expression={expression} tailWag={tailWag} breathe={false} />
		</svg>
	</AbsoluteFill>
);

const oneDefaults: OneProps = {view: 'right', pose: 'stand', scale: 1.6, ox: 550, oy: 800, walkPhase: 0, expression: 'neutral', tailWag: 0};

/** 8 walk phases side by side (QA of joints and gait). */
const WalkStrip: React.FC<{view: BadgerView}> = ({view}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 2400 1000">
			{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
				<g key={i}>
					<Badger x={300 + (i % 4) * 600} y={440 + Math.floor(i / 4) * 500} scale={0.95} view={view} pose="walk" walkPhase={i / 8} breathe={false} />
					<text x={90 + (i % 4) * 600} y={480 + Math.floor(i / 4) * 500} fontFamily="sans-serif" fontSize={24} fill={BRAND.nearBlack}>
						{`phase ${i}/8`}
					</text>
				</g>
			))}
		</svg>
	</AbsoluteFill>
);

/**
 * Walk with root motion: the root advances WALK.stride per gait cycle (1 cycle = 36 frames), so planted paws
 * stay fixed on the ground. A ground tick marks every 50 units.
 */
const WalkTravel: React.FC<{view: BadgerView; scale: number}> = ({view, scale}) => {
	const frame = useCurrentFrame();
	const cycles = frame / 36;
	const dir = view === 'right' ? 1 : -1;
	const x0 = view === 'right' ? 330 : 1590;
	return (
		<AbsoluteFill style={{background: BG}}>
			<svg width="100%" height="100%" viewBox="0 0 1920 700">
				<line x1={0} y1={600} x2={1920} y2={600} stroke={BRAND.nearBlack} strokeWidth={1} />
				<Badger x={x0 + dir * cycles * WALK.stride * scale} y={600} scale={scale} view={view} pose="walk" walkPhase={cycles} breathe={false} />
			</svg>
		</AbsoluteFill>
	);
};

export const ViewCompositions: React.FC = () => (
	<>
		<Composition id="BadgerWalkStrip" component={WalkStrip} durationInFrames={1} fps={30} width={2400} height={1000} defaultProps={{view: 'right' as BadgerView}} />
		<Composition id="BadgerWalkTravel" component={WalkTravel} durationInFrames={108} fps={30} width={1920} height={700} defaultProps={{view: 'right' as BadgerView, scale: 1}} />
		<Composition id="BadgerOne" component={One} durationInFrames={1} fps={30} width={1100} height={860} defaultProps={oneDefaults} />
	</>
);
