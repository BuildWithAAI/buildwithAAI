import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {BRAND} from '../../palette';
import type {BadgerHead, BadgerPose, BadgerView, Expression} from '../../types';
import {Badger} from '../Badger';

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

export const ViewCompositions: React.FC = () => (
	<>
		<Composition id="BadgerOne" component={One} durationInFrames={1} fps={30} width={1100} height={860} defaultProps={oneDefaults} />
	</>
);
