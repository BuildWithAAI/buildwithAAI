import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {INKNOIR as C, InknoirCharacter, type InknoirExpression, type InknoirPose} from './Character';

export type InknoirSheetFigure = {
	label: string;
	note: string;
	expression: InknoirExpression;
	mouthOpen: number;
	blink: number;
	pose: InknoirPose;
	lookX: number;
	pointSide?: 'left' | 'right';
	lightFrom?: 'left' | 'right';
};

export type InknoirSheetProps = {
	title: string;
	subtitle: string;
	figures: InknoirSheetFigure[];
};

export const inknoirSheetDefaults: InknoirSheetProps = {
	title: 'INK NOIR',
	subtitle: 'Host character "YOU"  ·  expression sheet  ·  all figures at the same scale',
	figures: [
		{label: 'NEUTRAL', note: "expression='neutral'", expression: 'neutral', mouthOpen: 0, blink: 0, pose: 'idle', lookX: 0},
		{label: 'HAPPY', note: "expression='happy'", expression: 'happy', mouthOpen: 0, blink: 0, pose: 'idle', lookX: 0},
		{label: 'WORRIED', note: "expression='worried'", expression: 'worried', mouthOpen: 0, blink: 0, pose: 'idle', lookX: 0},
		{label: 'SHOCKED', note: "expression='shocked'", expression: 'shocked', mouthOpen: 0, blink: 0, pose: 'idle', lookX: 0},
		{label: 'POINT', note: "pose='point'  ·  mouthOpen 0.6", expression: 'neutral', mouthOpen: 0.6, blink: 0, pose: 'point', lookX: 0.45},
	],
};

const SCALE = 0.8;
const BASELINE = 975;
const XS = [180, 500, 820, 1140, 1470];

const SWATCHES: Array<[string, string]> = [
	[C.ink, '#0B0C0F'],
	[C.slate, '#161A21'],
	[C.silverDark, '#8C939E'],
	[C.silver, '#C9CED6'],
	[C.white, '#F4F6F8'],
	[C.accent, '#FF4D6D'],
];

export const InknoirSheet: React.FC<InknoirSheetProps> = ({title, subtitle, figures}) => {
	return (
		<AbsoluteFill style={{backgroundColor: C.slate}}>
			<svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
				<defs>
					<pattern id="sheet-dots" width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
						<circle cx={3.5} cy={3.5} r={1.1} fill={C.ink} />
					</pattern>
					<radialGradient id="sheet-spot" cx="50%" cy="45%" r="55%">
						<stop offset="0%" stopColor="#2A303A" />
						<stop offset="100%" stopColor={C.slate} stopOpacity={0} />
					</radialGradient>
					<linearGradient id="sheet-floor" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor={C.ink} stopOpacity={0} />
						<stop offset="100%" stopColor={C.ink} stopOpacity={0.9} />
					</linearGradient>
				</defs>
				<rect x={0} y={0} width={1920} height={1080} fill="url(#sheet-dots)" opacity={0.35} />
				{figures.slice(0, 5).map((f, i) => (
					<ellipse key={f.label + i} cx={XS[i] + (f.pose === 'point' ? 40 : 0)} cy={620} rx={230} ry={420} fill="url(#sheet-spot)" />
				))}
				<rect x={0} y={BASELINE + 4} width={1920} height={1080 - BASELINE} fill="url(#sheet-floor)" />
				<line x1={60} x2={1860} y1={BASELINE + 4} y2={BASELINE + 4} stroke={C.silverDark} strokeWidth={1} opacity={0.5} />
			</svg>

			{figures.slice(0, 5).map((f, i) => (
				<InknoirCharacter
					key={f.label + i}
					x={XS[i]}
					y={BASELINE}
					scale={SCALE}
					expression={f.expression}
					mouthOpen={f.mouthOpen}
					blink={f.blink}
					pose={f.pose}
					lookX={f.lookX}
					pointSide={f.pointSide}
					lightFrom={f.lightFrom}
				/>
			))}

			{/* header */}
			<div style={{position: 'absolute', left: 64, top: 44, display: 'flex', alignItems: 'baseline', gap: 28}}>
				<div style={{fontFamily: FONTS.display, fontSize: 64, color: C.white, letterSpacing: 2, lineHeight: 1}}>{title}</div>
				<div style={{width: 10, height: 10, background: C.accent, alignSelf: 'center'}} />
				<div style={{fontFamily: FONTS.body, fontWeight: 500, fontSize: 24, color: C.silver}}>{subtitle}</div>
			</div>
			<div style={{position: 'absolute', right: 64, top: 52, display: 'flex', gap: 14}}>
				{SWATCHES.map(([fill, hex]) => (
					<div key={hex} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6}}>
						<div style={{width: 44, height: 28, background: fill, border: `1px solid ${C.steel}`}} />
						<div style={{fontFamily: FONTS.body, fontWeight: 600, fontSize: 13, color: C.silverDark}}>{hex}</div>
					</div>
				))}
			</div>

			{/* labels */}
			{figures.slice(0, 5).map((f, i) => (
				<div
					key={`l${f.label}${i}`}
					style={{
						position: 'absolute',
						left: XS[i] + (f.pose === 'point' ? 60 : 0) - 200,
						width: 400,
						top: BASELINE + 22,
						textAlign: 'center',
						fontFamily: FONTS.body,
					}}
				>
					<div style={{fontWeight: 800, fontSize: 26, letterSpacing: 4, color: C.white}}>{f.label}</div>
					<div style={{fontWeight: 500, fontSize: 17, color: C.silverDark, marginTop: 4}}>{f.note}</div>
				</div>
			))}
		</AbsoluteFill>
	);
};
