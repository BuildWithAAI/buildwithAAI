import React from 'react';
import {AbsoluteFill, Composition, interpolate, useCurrentFrame} from 'remotion';
import {BRAND} from '../../palette';
import type {BadgerHead, Expression} from '../../types';
import {Badger, LEFT_HEAD_MOUNT} from '../Badger';
import {ViewCompositions} from './DevViews';
import {RigCompositions} from './DevRig';
import {Head, headGeom} from '../parts/heads/Head';
import {NeckFront} from '../parts/Neck';
import {LEFT_RIG} from '../parts/rigLeft';
import {LineScaleContext} from '../parts/shared';
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
						<text x={px + 28} y={py - 24} fontFamily="sans-serif" fontSize={15} fontWeight={700} fill="#D0342C" stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke">
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

/** Bounding-box centre of a head view (skull + ears) so every view sits centred in its cell. */
const headCentre = (v: BadgerHead) => {
	const g = headGeom(v);
	const ds = [g.skull.fill, ...g.earsFront.flatMap((e) => e.fills.map((f) => f.d)), ...g.earsBehind.flatMap((e) => e.fills.map((f) => f.d))];
	const n = ds.flatMap(numbers);
	const xs = n.filter((_, i) => i % 2 === 0);
	const ys = n.filter((_, i) => i % 2 === 1);
	return {x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2};
};

const Heads: React.FC<{expression: Expression; judge: number}> = ({expression, judge}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 2450 440">
			{HEAD_VIEWS.map((v, i) => {
				const c = headCentre(v);
				return (
					<g key={v} transform={`translate(${175 + i * 350} 200) scale(2) translate(${-c.x} ${-c.y})`}>
						<Head view={v} state={{expression, blink: 0, judge, earsBack: 0, lookX: 0, lookY: 0}} />
					</g>
				);
			})}
			{HEAD_VIEWS.map((v, i) => (
				<text key={v} x={175 + i * 350} y={420} textAnchor="middle" fontFamily="sans-serif" fontSize={22} fill={BRAND.nearBlack}>
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
		<svg width="100%" height="100%" viewBox="0 0 2200 600">
			{EXPRS.map((e, i) => (
				<g key={e.label}>
					<g transform={`translate(${220 + i * 440} 330) scale(1.9)`}>
						<Bust expression={e.expression} judge={e.judge} />
					</g>
					<text x={220 + i * 440} y={585} textAnchor="middle" fontFamily="sans-serif" fontSize={24} fill={BRAND.nearBlack}>
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

/** Animated QA: 0-29 happy + wag, 30-44 blink at 36-40, 45-74 judge ramps in, 75-104 worried (ears back), 105-134 look up. */
const Anim: React.FC = () => {
	const frame = useCurrentFrame();
	const expression: Expression = frame < 30 ? 'happy' : frame >= 75 && frame < 105 ? 'worried' : 'neutral';
	const blink = frame >= 36 && frame <= 40 ? [0.4, 0.9, 1, 0.9, 0.4][frame - 36] : 0;
	const judge = frame >= 45 && frame < 75 ? interpolate(frame, [45, 55], [0, 1], {extrapolateRight: 'clamp'}) : 0;
	const lookUp = frame >= 105;
	return (
		<AbsoluteFill style={{background: BG}}>
			<svg width="100%" height="100%" viewBox="0 0 1100 860">
				<Badger
					x={600}
					y={800}
					scale={1.6}
					view="left"
					pose={lookUp ? 'lookUp' : 'stand'}
					head={lookUp ? undefined : 'front'}
					expression={expression}
					blink={blink}
					judge={judge}
					tailWag={frame < 30 ? frame / 12 : 0}
				/>
				<text x={20} y={34} fontFamily="sans-serif" fontSize={18} fill={BRAND.nearBlack}>
					{`frame ${frame}`}
				</text>
			</svg>
		</AbsoluteFill>
	);
};

type HeadAtProps = {
	view: BadgerHead;
	ox: number;
	oy: number;
	scale: number;
	expression: Expression;
	/** Optional QA controls (round 3): the sound-clip mouth, folded ears, judging look and a line-weight multiplier. */
	mouthOpen?: number;
	earsBack?: number;
	judge?: number;
	lineScale?: number;
};

/** One head view at a known origin/scale (for overlays against the sheet crops and zoomed junction checks). */
const HeadAt: React.FC<HeadAtProps> = ({view, ox, oy, scale, expression, mouthOpen = 0, earsBack, judge = 0, lineScale = 1}) => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 600 500">
			<g transform={`translate(${ox} ${oy}) scale(${scale})`}>
				<LineScaleContext.Provider value={lineScale}>
					<Head
						view={view}
						state={{
							expression,
							blink: 0,
							judge,
							earsBack: earsBack ?? (expression === 'worried' ? 0.7 : expression === 'shocked' ? 0.15 : 0),
							lookX: 0,
							lookY: 0,
							mouthOpen,
						}}
					/>
				</LineScaleContext.Provider>
			</g>
		</svg>
	</AbsoluteFill>
);

/** mouthOpen (sound-clip control) on six head views at 0, 0.3, 0.6 and 1 (round 3: every amount must read as a bark or gasp). */
const MOUTH_HEADS: BadgerHead[] = ['front', 'threeQuarterRightScreen', 'threeQuarterLeftScreen', 'profileRightScreen', 'profileLeftScreen', 'upLeftScreen'];
const MOUTH_AMOUNTS = [0, 0.3, 0.6, 1];
const MouthOpenGrid: React.FC = () => (
	<AbsoluteFill style={{background: BG}}>
		<svg width="100%" height="100%" viewBox="0 0 1940 1700">
			{MOUTH_HEADS.map((v, row) =>
				MOUTH_AMOUNTS.map((amt, col) => {
					const c = headCentre(v);
					return (
						<g key={`${v}${amt}`} transform={`translate(${250 + col * 480} ${140 + row * 265}) scale(1.6) translate(${-c.x} ${-c.y})`}>
							<Head view={v} state={{expression: 'neutral', blink: 0, judge: 0, earsBack: 0, lookX: 0, lookY: 0, mouthOpen: amt}} />
						</g>
					);
				}),
			)}
			{MOUTH_AMOUNTS.map((amt, col) => (
				<text key={amt} x={250 + col * 480} y={1685} textAnchor="middle" fontFamily="sans-serif" fontSize={26} fill={BRAND.nearBlack}>
					{`mouthOpen ${amt}`}
				</text>
			))}
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
		<Composition id="BadgerHeads" component={Heads} durationInFrames={1} fps={30} width={2450} height={440} defaultProps={{expression: 'neutral' as Expression, judge: 0}} />
		<Composition id="BadgerExpressions" component={Expressions} durationInFrames={1} fps={30} width={2200} height={600} />
		<Composition id="BadgerMouthOpen" component={MouthOpenGrid} durationInFrames={1} fps={30} width={1940} height={1700} />
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
			id="BadgerHeadAt"
			component={HeadAt}
			durationInFrames={1}
			fps={30}
			width={600}
			height={500}
			defaultProps={{view: 'profileRightScreen' as BadgerHead, ox: 300, oy: 300, scale: 2, expression: 'neutral' as Expression} as HeadAtProps}
		/>
		<ViewCompositions />
		<RigCompositions />
		<Composition id="BadgerAnim" component={Anim} durationInFrames={135} fps={30} width={1100} height={860} />
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
