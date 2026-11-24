import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {BRAND} from '../../palette';
import type {BadgerView} from '../../types';
import {LEFT_HEAD_MOUNT, RIGHT_HEAD_MOUNT} from '../Badger';
import {walkPose} from '../parts/gait';
import {LEFT_RIG} from '../parts/rigLeft';
import {RIGHT_RIG} from '../parts/rigRight';
import {SideBody, SidePose, SideRig, STAND_POSE, spotsByPart} from '../parts/SideBody';
import {LEFT_SPOTS, RIGHT_SPOTS} from '../spots';

/**
 * Dev-only stress renders of the side rigs (not part of src/Root.tsx): the rear half of the body at the extremes of
 * the walk and the happy tail, so every edge a rotating part can expose is checked for an outline.
 */
const BG = BRAND.background;
const LEFT_PARTS = spotsByPart(LEFT_SPOTS);
const RIGHT_PARTS = spotsByPart(RIGHT_SPOTS);
const HEAD_STATE = {expression: 'neutral' as const, blink: 0, judge: 0, earsBack: 0, lookX: 0, lookY: 0};

const Body: React.FC<{side: 'left' | 'right'; pose: SidePose; tailWag?: number}> = ({side, pose, tailWag = 0}) =>
	side === 'left' ? (
		<SideBody
			rig={LEFT_RIG as unknown as SideRig}
			dir={-1}
			spots={LEFT_PARTS}
			backLineY={-72}
			head="profileLeftScreen"
			headMount={LEFT_HEAD_MOUNT.profileLeftScreen}
			headState={HEAD_STATE}
			headTilt={0}
			tailWag={tailWag}
			breath={0}
			neckTurn={0}
			pose={pose}
			uidPrefix="dl"
		/>
	) : (
		<SideBody
			rig={RIGHT_RIG as unknown as SideRig}
			dir={1}
			spots={RIGHT_PARTS}
			backLineY={-78}
			head="profileRightScreen"
			headMount={RIGHT_HEAD_MOUNT.profileRightScreen}
			headState={HEAD_STATE}
			headTilt={0}
			tailWag={tailWag}
			breath={0}
			neckTurn={0}
			pose={pose}
			uidPrefix="dr"
		/>
	);

type Cell = {label: string; pose: SidePose; tailWag?: number};

/** A grid of rear-half crops (world box x0..x1, y0..y1 per facing) at `k` px per unit. */
const Grid: React.FC<{side: 'left' | 'right'; cells: Cell[]; cols: number; k: number}> = ({side, cells, cols, k}) => {
	const box = side === 'left' ? {x: -20, y: -330, w: 300, h: 340} : {x: -280, y: -330, w: 300, h: 340};
	const cw = box.w * k;
	const ch = box.h * k;
	return (
		<AbsoluteFill style={{background: BG}}>
			<svg width="100%" height="100%" viewBox={`0 0 ${cols * cw} ${Math.ceil(cells.length / cols) * (ch + 30)}`}>
				{cells.map((c, i) => {
					const cx = (i % cols) * cw;
					const cy = Math.floor(i / cols) * (ch + 30);
					return (
						<g key={i}>
							<svg x={cx} y={cy} width={cw} height={ch} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
								<Body side={side} pose={c.pose} tailWag={c.tailWag} />
							</svg>
							<text x={cx + 8} y={cy + ch + 22} fontFamily="sans-serif" fontSize={20} fill={BRAND.nearBlack}>
								{c.label}
							</text>
						</g>
					);
				})}
			</svg>
		</AbsoluteFill>
	);
};

const withLeg = (key: 'hindNear' | 'hindFar', upper: number, lower: number, shiftY: number, tail: number): SidePose => ({
	...STAND_POSE,
	legs: {...STAND_POSE.legs, [key]: {upper, lower, paw: -upper - lower}},
	mountShift: {[key]: {x: 0, y: shiftY}},
	tail,
});

/** Extremes: hind thigh -22..45 deg with the pelvis slide, tail 0 / 34 / 34 + wag. */
const stressCells = (): Cell[] => {
	const out: Cell[] = [];
	for (const [u, sy] of [
		[-22, 16],
		[-12, 0],
		[0, 0],
		[16, -14],
		[30, 0],
		[45, 2],
	] as const) {
		out.push({label: `hindNear ${u} / tail 34`, pose: withLeg('hindNear', u, 20, sy, 34)});
	}
	out.push({label: 'tail 0', pose: withLeg('hindNear', 0, 0, 0, 0)});
	out.push({label: 'tail 34 wag .25', pose: withLeg('hindNear', 0, 0, 0, 34), tailWag: 0.25});
	out.push({label: 'tail 34 wag .75', pose: withLeg('hindNear', 0, 0, 0, 34), tailWag: 0.75});
	out.push({label: 'tail 0 wag .25', pose: withLeg('hindNear', 0, 0, 0, 0), tailWag: 0.25});
	out.push({label: 'tail 0 wag .75', pose: withLeg('hindNear', 0, 0, 0, 0), tailWag: 0.75});
	out.push({label: 'tail 45', pose: withLeg('hindNear', 0, 0, 0, 45)});
	return out;
};

const walkCells = (side: 'left' | 'right', phases: number[]): Cell[] =>
	phases.map((ph) => ({
		label: `walk ${ph.toFixed(3)}`,
		pose: walkPose((side === 'left' ? LEFT_RIG : RIGHT_RIG) as unknown as SideRig, side === 'left' ? -1 : 1, ph, side),
	}));

const RearStress: React.FC<{view: BadgerView}> = ({view}) => <Grid side={view === 'right' ? 'right' : 'left'} cells={stressCells()} cols={6} k={1.6} />;
const RearWalk: React.FC<{view: BadgerView; n: number; phases?: number[]; k?: number; cols?: number}> = ({view, n, phases, k = 1.6, cols}) => {
	const ph = phases ?? Array.from({length: n}, (_, i) => i / n);
	return <Grid side={view === 'right' ? 'right' : 'left'} cells={walkCells(view === 'right' ? 'right' : 'left', ph)} cols={cols ?? Math.min(8, ph.length)} k={k} />;
};

export const RigCompositions: React.FC = () => (
	<>
		<Composition id="BadgerRearStress" component={RearStress} durationInFrames={1} fps={30} width={2880} height={1150} defaultProps={{view: 'left' as BadgerView}} />
		<Composition id="BadgerRearWalk" component={RearWalk} durationInFrames={1} fps={30} width={3840} height={1150} defaultProps={{view: 'left' as BadgerView, n: 16}} />
	</>
);
