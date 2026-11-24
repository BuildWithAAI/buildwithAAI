import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {LINEWORK_COLORS as C, LineworkCharacter, type LineworkExpression, type LineworkPose} from './Character';

type SheetEntry = {
	label: string;
	detail: string;
	expression: LineworkExpression;
	pose: LineworkPose;
	mouthOpen: number;
	lookX: number;
	blink?: number;
	pointSide?: 'left' | 'right';
	rim?: number;
	x: number;
};

export type LineworkSheetProps = {
	title: string;
	subtitle: string;
	scale: number;
	floorY: number;
	showSilhouette: boolean;
	entries: SheetEntry[];
};

export const lineworkSheetDefaults: LineworkSheetProps = {
	title: 'LINEWORK — “YOU”',
	subtitle: 'Host character · expression sheet · same scale for all figures',
	scale: 0.76,
	floorY: 960,
	showSilhouette: true,
	entries: [
		{label: 'Neutral', detail: "expression 'neutral'", expression: 'neutral', pose: 'idle', mouthOpen: 0, lookX: 0, x: 215},
		{label: 'Happy', detail: "expression 'happy'", expression: 'happy', pose: 'idle', mouthOpen: 0, lookX: 0, x: 540},
		{label: 'Worried', detail: "expression 'worried'", expression: 'worried', pose: 'idle', mouthOpen: 0, lookX: 0, x: 865},
		{label: 'Shocked', detail: "expression 'shocked'", expression: 'shocked', pose: 'idle', mouthOpen: 0, lookX: 0, x: 1190},
		{label: 'Point', detail: "pose 'point' · mouthOpen 0.6", expression: 'happy', pose: 'point', mouthOpen: 0.6, lookX: 0.6, x: 1490},
	],
};

export const LineworkSheet: React.FC<LineworkSheetProps> = ({title, subtitle, scale, floorY, showSilhouette, entries}) => {
	const FLOOR_Y = floorY;
	return (
		<AbsoluteFill style={{background: C.night, fontFamily: FONTS.body}}>
			{/* faint engineering grid */}
			<svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
				<defs>
					<pattern id="lw-sheet-grid" width={40} height={40} patternUnits="userSpaceOnUse">
						<path d="M 40 0 L 0 0 0 40" fill="none" stroke={C.slate} strokeWidth={1.5} />
					</pattern>
				</defs>
				<rect width={1920} height={1080} fill="url(#lw-sheet-grid)" />
				<line x1={60} x2={1860} y1={FLOOR_Y + 2} y2={FLOOR_Y + 2} stroke={C.steel} strokeOpacity={0.35} strokeWidth={2} />
				{entries.map((en) => (
					<ellipse key={en.label} cx={en.x} cy={FLOOR_Y + 2} rx={110} ry={10} fill={C.slate} />
				))}
			</svg>

			{/* header */}
			<div style={{position: 'absolute', left: 64, top: 40, display: 'flex', alignItems: 'center', gap: 18}}>
				<svg width={34} height={34} viewBox="0 0 34 34">
					<circle cx={17} cy={17} r={7} fill={C.cyan} />
					<circle cx={17} cy={17} r={14} fill="none" stroke={C.silver} strokeWidth={2.5} />
				</svg>
				<div style={{fontFamily: FONTS.heading, fontWeight: 900, fontSize: 40, letterSpacing: 2, color: C.white}}>{title}</div>
			</div>
			<div style={{position: 'absolute', left: 116, top: 92, fontSize: 22, fontWeight: 500, color: C.steel}}>{subtitle}</div>

			{/* silhouette test: the figure flattened to one tone at icon size */}
			{showSilhouette ? (
				<>
					<div style={{position: 'absolute', left: 860, top: 58, width: 200, textAlign: 'right', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: C.steel}}>
						SILHOUETTE TEST
					</div>
					<AbsoluteFill style={{filter: 'brightness(0) invert(0.8)'}}>
						<LineworkCharacter x={1110} y={136} scale={0.115} breathe={false} />
						<LineworkCharacter x={1200} y={136} scale={0.115} pose="point" breathe={false} />
					</AbsoluteFill>
				</>
			) : null}

			{/* palette chips */}
			<div style={{position: 'absolute', right: 64, top: 46, display: 'flex', gap: 14}}>
				{[C.night, C.slate, C.steel, C.silver, C.white, C.cyan].map((col) => (
					<div key={col} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6}}>
						<div style={{width: 46, height: 46, borderRadius: 23, background: col, border: `2px solid ${C.steel}`}} />
						<div style={{fontSize: 13, fontWeight: 600, color: C.steel, letterSpacing: 0.5}}>{col}</div>
					</div>
				))}
			</div>

			{entries.map((en) => (
				<LineworkCharacter
					key={en.label}
					expression={en.expression}
					pose={en.pose}
					mouthOpen={en.mouthOpen}
					lookX={en.lookX}
					blink={en.blink ?? 0}
					pointSide={en.pointSide ?? 'right'}
					rim={en.rim ?? 0}
					rimSide={en.pointSide ?? 'right'}
					x={en.x}
					y={FLOOR_Y}
					scale={scale}
				/>
			))}

			{entries.map((en) => (
				<div
					key={`${en.label}-label`}
					style={{position: 'absolute', left: en.x - 160, width: 320, top: Math.min(FLOOR_Y + 26, 990), textAlign: 'center'}}
				>
					<div style={{fontWeight: 800, fontSize: 30, letterSpacing: 3, color: C.white, textTransform: 'uppercase'}}>{en.label}</div>
					<div style={{fontWeight: 500, fontSize: 17, color: C.steel, marginTop: 4}}>{en.detail}</div>
				</div>
			))}
		</AbsoluteFill>
	);
};
