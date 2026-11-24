import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {BRAND} from '../../palette';
import type {BadgerHead, Expression} from '../../types';
import {Badger, LEFT_HEAD_MOUNT} from '../Badger';
import {Head} from '../parts/heads/Head';
import {NeckFront} from '../parts/Neck';
import {LEFT_RIG} from '../parts/rigLeft';
import {LEFT_SPOTS, BadgerSpot} from '../spots';

/**
 * Dev-only compositions for QA renders of the Badger rig. Not registered in src/Root.tsx.
 * Render: npx remotion still src/characters/badger/dev/index.ts <Id> out/chars/<name>.png --frame=0
 * Every scene uses a fixed px-per-unit so renders can be overlaid on the sheet crops.
 */
const BG = BRAND.background;

type StandProps = {head: BadgerHead; scale: number; ox: number; oy: number; expression: Expression; judge: number; tailWag: number; breathe: boolean};

const Stand: React.FC<StandProps> = ({head, scale, ox, oy, expression, judge, tailWag, breathe}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 1100 860">
			<Badger x={ox} y={oy} scale={scale} view="left" head={head} expression={expression} judge={judge} tailWag={tailWag} breathe={breathe} />
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

/** World position of a spot centre at rest pose (legs/tail at 0 deg) for labelling. */
const spotWorld = (s: BadgerSpot, head: BadgerHead) => {
	const c = centre(s.path);
	const T = LEFT_RIG.torso.pivot;
	const M = LEFT_RIG.mounts;
	if (s.part === 'torso') return {x: T.x + c.x, y: T.y + c.y};
	if (s.part === 'neck') {
		const a = (LEFT_HEAD_MOUNT[head].neck * Math.PI) / 180;
		return {x: T.x + M.neck.x + c.x * Math.cos(a) - c.y * Math.sin(a), y: T.y + M.neck.y + c.x * Math.sin(a) + c.y * Math.cos(a)};
	}
	const m = M[s.part as 'legFrontNear' | 'legHindNear'];
	return {x: T.x + m.x + c.x, y: T.y + m.y + c.y};
};

const SpotsLeft: React.FC<{head: BadgerHead; scale: number; ox: number; oy: number}> = ({head, scale, ox, oy}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 1100 860">
			<Badger x={ox} y={oy} scale={scale} view="left" head={head} breathe={false} />
			{LEFT_SPOTS.map((s) => {
				const w = spotWorld(s, head);
				const px = ox + w.x * scale;
				const py = oy + w.y * scale;
				return (
					<g key={s.id}>
						<line x1={px} y1={py} x2={px + 26} y2={py - 22} stroke="#D0342C" strokeWidth={1.5} />
						<text x={px + 28} y={py - 24} fontFamily="sans-serif" fontSize={15} fontWeight={700} fill="#D0342C">
							{s.id}
						</text>
					</g>
				);
			})}
			<text x={20} y={34} fontFamily="sans-serif" fontSize={18} fill={BRAND.nearBlack}>
				{`BADGER left side: ${LEFT_SPOTS.length} body spots (sheet count 11)`}
			</text>
		</svg>
	</AbsoluteFill>
);

export const HEAD_VIEWS: BadgerHead[] = [
	'front',
	'threeQuarterLeftScreen',
	'threeQuarterRightScreen',
	'profileLeftScreen',
	'profileRightScreen',
	'upLeftScreen',
	'upRightScreen',
];

const Heads: React.FC = () => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 2100 420">
			{HEAD_VIEWS.map((v, i) => (
				<g key={v} transform={`translate(${150 + i * 300} 300) scale(2)`}>
					<Head view={v} state={{expression: 'neutral', blink: 0, judge: 0, earsBack: 0, lookX: 0, lookY: 0}} />
				</g>
			))}
			{HEAD_VIEWS.map((v, i) => (
				<text key={v} x={150 + i * 300} y={400} textAnchor="middle" fontFamily="sans-serif" fontSize={20} fill={BRAND.nearBlack}>
					{v}
				</text>
			))}
		</svg>
	</AbsoluteFill>
);

const EXPRS: {label: string; expression: Expression; judge: number}[] = [
	{label: 'neutral', expression: 'neutral', judge: 0},
	{label: 'happy', expression: 'happy', judge: 0},
	{label: 'worried', expression: 'worried', judge: 0},
	{label: 'shocked', expression: 'shocked', judge: 0},
	{label: 'judge (neutral + judge=1)', expression: 'neutral', judge: 1},
];

/** Front bust: front-neck/collar + front head, at 3.6 px per unit (close to the expression crops). */
export const Bust: React.FC<{expression: Expression; judge: number; blink?: number; earsBack?: number}> = ({expression, judge, blink = 0, earsBack}) => (
	<g>
		<NeckFront />
		<g transform="translate(0 -19.5)">
			<Head
				view="front"
				state={{expression, blink, judge, earsBack: earsBack ?? (expression === 'worried' ? 0.7 : expression === 'shocked' ? 0.15 : 0), lookX: 0, lookY: 0}}
			/>
		</g>
	</g>
);

const Expressions: React.FC = () => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 2200 520">
			{EXPRS.map((e, i) => (
				<g key={e.label}>
					<g transform={`translate(${220 + i * 440} 250) scale(1.9)`}>
						<Bust expression={e.expression} judge={e.judge} />
					</g>
					<text x={220 + i * 440} y={505} textAnchor="middle" fontFamily="sans-serif" fontSize={24} fill={BRAND.nearBlack}>
						{e.label}
					</text>
				</g>
			))}
		</svg>
	</AbsoluteFill>
);

const SingleBust: React.FC<{expression: Expression; judge: number}> = ({expression, judge}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 410 400">
			<g transform="translate(208 250) scale(1.8)">
				<Bust expression={expression} judge={judge} />
			</g>
		</svg>
	</AbsoluteFill>
);

const standDefaults: StandProps = {head: 'front', scale: 1.6, ox: 600, oy: 800, expression: 'neutral', judge: 0, tailWag: 0, breathe: false};

export const DevRoot: React.FC = () => (
	<>
		<Composition id="BadgerLeft" component={Stand} durationInFrames={60} fps={30} width={1100} height={860} defaultProps={standDefaults} />
		<Composition
			id="BadgerLeftProfile"
			component={Stand}
			durationInFrames={60}
			fps={30}
			width={1100}
			height={860}
			defaultProps={{...standDefaults, head: 'profileLeftScreen'}}
		/>
		<Composition
			id="BadgerLeftDefault"
			component={Stand}
			durationInFrames={60}
			fps={30}
			width={1100}
			height={860}
			defaultProps={{...standDefaults, head: 'threeQuarterLeftScreen'}}
		/>
		<Composition
			id="BadgerSpotsLeft"
			component={SpotsLeft}
			durationInFrames={1}
			fps={30}
			width={1100}
			height={860}
			defaultProps={{head: 'profileLeftScreen' as BadgerHead, scale: 1.6, ox: 600, oy: 800}}
		/>
		<Composition id="BadgerHeads" component={Heads} durationInFrames={1} fps={30} width={2100} height={420} />
		<Composition id="BadgerExpressions" component={Expressions} durationInFrames={1} fps={30} width={2200} height={520} />
		<Composition
			id="BadgerBust"
			component={SingleBust}
			durationInFrames={1}
			fps={30}
			width={410}
			height={400}
			defaultProps={{expression: 'neutral' as Expression, judge: 0}}
		/>
		<Composition
			id="BadgerWag"
			component={Stand}
			durationInFrames={60}
			fps={30}
			width={1100}
			height={860}
			defaultProps={{...standDefaults, expression: 'happy' as Expression, tailWag: 0.25, breathe: true}}
		/>
	</>
);
