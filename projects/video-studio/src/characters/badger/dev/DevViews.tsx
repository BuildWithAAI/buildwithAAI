import React from 'react';
import {AbsoluteFill, Composition, useCurrentFrame} from 'remotion';
import {BRAND} from '../../palette';
import type {BadgerHead, BadgerPose, BadgerView, Expression} from '../../types';
import {Badger, RIGHT_HEAD_MOUNT} from '../Badger';
import {WALK} from '../parts/gait';
import {RIGHT_RIG} from '../parts/rigRight';
import {RIGHT_SPOTS, BadgerSpot} from '../spots';

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
	/** Line weight multiplier (BadgerExtraProps.lineScale); 1 = LINE widths. */
	lineScale?: number;
};

const One: React.FC<OneProps> = ({view, pose, head, scale, ox, oy, walkPhase, expression, tailWag, lineScale}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 1100 860">
			<Badger x={ox} y={oy} scale={scale} view={view} pose={pose} head={head} walkPhase={walkPhase} expression={expression} tailWag={tailWag} breathe={false} lineScale={lineScale} />
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

const Label: React.FC<{x: number; y: number; text: string}> = ({x, y, text}) => (
	<text x={x} y={y} textAnchor="middle" fontFamily="sans-serif" fontSize={30} fontWeight={600} fill={BRAND.nearBlack}>
		{text}
	</text>
);

/** Turnaround as on the sheet: front, 3/4, side (right), back on one ground line, scale 1 (1 unit = 1 px). */
const Turnaround: React.FC<{expression: Expression}> = ({expression}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 1920 700">
			<line x1={60} y1={600} x2={1860} y2={600} stroke={BRAND.nearBlack} strokeWidth={2} />
			{(
				[
					['front', 250, 'Front'],
					['threeQuarter', 640, '3/4'],
					['right', 1140, 'Side'],
					['back', 1640, 'Back'],
				] as const
			).map(([v, x, t]) => (
				<g key={v}>
					<Badger x={x} y={600} scale={1} view={v} expression={expression} breathe={false} />
					<Label x={x} y={660} text={t} />
				</g>
			))}
		</svg>
	</AbsoluteFill>
);

/** Poses as on the sheet (face screen right, right-side markings; view 'left' = the left-facing set): sit, lie, walk 0 / 0.5, look up. */
const Poses: React.FC<{view: BadgerView}> = ({view}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 2600 640">
			<line x1={40} y1={540} x2={2560} y2={540} stroke={BRAND.nearBlack} strokeWidth={2} />
			{(
				[
					['sit', 0, 230, 'Sitting'],
					['lie', 0, 700, 'Lying down'],
					['walk', 0, 1240, 'Walking (phase 0)'],
					['walk', 0.5, 1740, 'Walking (phase 0.5)'],
					['lookUp', 0, 2260, 'Looking up'],
				] as const
			).map(([p, ph, x, t]) => (
				<g key={`${p}${ph}`}>
					<Badger x={x} y={540} scale={0.95} view={view} pose={p} walkPhase={ph} breathe={false} />
					<Label x={x} y={600} text={t} />
				</g>
			))}
		</svg>
	</AbsoluteFill>
);

const numbers = (d: string) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
const centre = (d: string) => {
	const n = numbers(d);
	const xs = n.filter((_, i) => i % 2 === 0);
	const ys = n.filter((_, i) => i % 2 === 1);
	return {x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2};
};

/** World position (stand, right view) of a right-view spot centre, for labelling. */
const rightSpotWorld = (s: BadgerSpot) => {
	const c = centre(s.path);
	const T = RIGHT_RIG.torso.pivot;
	const M = RIGHT_RIG.mounts;
	if (s.part === 'torso') return {x: T.x + c.x, y: T.y + c.y};
	if (s.part === 'neck') {
		const a = (RIGHT_HEAD_MOUNT.profileRightScreen.neck * Math.PI) / 180;
		return {x: T.x + M.neck.x + c.x * Math.cos(a) - c.y * Math.sin(a), y: T.y + M.neck.y + c.x * Math.sin(a) + c.y * Math.cos(a)};
	}
	const m = M[s.part as 'legFrontNear' | 'legHindNear'];
	return {x: T.x + m.x + c.x, y: T.y + m.y + c.y};
};

const SpotsRight: React.FC<{scale: number; ox: number; oy: number}> = ({scale, ox, oy}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 1100 860">
			<Badger x={ox} y={oy} scale={scale} view="right" breathe={false} />
			{RIGHT_SPOTS.map((s, i) => {
				const w = rightSpotWorld(s);
				const px = ox + w.x * scale;
				const py = oy + w.y * scale;
				const up = s.id === 'L-WITHERS' || s.id === 'R-02' || s.id === 'R-NECK';
				const dx = up ? -30 : 26;
				const dy = up ? -34 : -22 - (i % 2) * 8;
				return (
					<g key={s.id}>
						<line x1={px} y1={py} x2={px + dx} y2={py + dy} stroke="#D0342C" strokeWidth={1.5} />
						<text
							x={px + dx + (dx < 0 ? -2 : 2)}
							y={py + dy - 2}
							textAnchor={dx < 0 ? 'end' : 'start'}
							fontFamily="sans-serif"
							fontSize={15}
							fontWeight={700}
							fill="#D0342C"
							stroke="#FFFFFF"
							strokeWidth={3}
							paintOrder="stroke"
						>
							{s.id}
						</text>
					</g>
				);
			})}
			<text x={20} y={34} fontFamily="sans-serif" fontSize={18} fill={BRAND.nearBlack}>
				{`BADGER right side: ${RIGHT_SPOTS.filter((s) => s.side === 'right').length} R- spots + the right lobe of L-WITHERS (coat_right + coat_top, decision D16) + the far forearm's L-09 edge record`}
			</text>
		</svg>
	</AbsoluteFill>
);

export const ViewCompositions: React.FC = () => (
	<>
		<Composition id="BadgerTurnaround" component={Turnaround} durationInFrames={1} fps={30} width={1920} height={700} defaultProps={{expression: 'neutral' as Expression}} />
		<Composition id="BadgerPoses" component={Poses} durationInFrames={1} fps={30} width={2600} height={640} defaultProps={{view: 'right' as BadgerView}} />
		<Composition id="BadgerSpotsRight" component={SpotsRight} durationInFrames={1} fps={30} width={1100} height={860} defaultProps={{scale: 1.6, ox: 550, oy: 800}} />
		<Composition id="BadgerWalkStrip" component={WalkStrip} durationInFrames={1} fps={30} width={2400} height={1000} defaultProps={{view: 'right' as BadgerView}} />
		<Composition id="BadgerWalkTravel" component={WalkTravel} durationInFrames={108} fps={30} width={1920} height={700} defaultProps={{view: 'right' as BadgerView, scale: 1}} />
		<Composition id="BadgerOne" component={One} durationInFrames={1} fps={30} width={1100} height={860} defaultProps={oneDefaults} />
	</>
);
