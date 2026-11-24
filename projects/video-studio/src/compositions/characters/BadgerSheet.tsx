/**
 * BadgerSheet: a still of the reusable Badger asset (1920x1080, #E6E8EB), rendered from the rig itself.
 * Row 1: the size-panel side view ('left', anatomical left toward camera) and the turnaround (front, 3/4, right side,
 * back). Row 2: poses: sitting and lying in both facings (the left-facing bodies carry the LEFT coat-map markings,
 * decision BADGER-D23), walking and looking up. Row 3: expressions (front busts) plus the 'judge' reaction.
 * Line weights per decision INT-L1: SL5 for the full-body rows, the sheet's close-up weight for the busts.
 * No labels are copied from the approved model sheet.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {Badger} from '../../characters/badger/Badger';
import {Head} from '../../characters/badger/parts/heads/Head';
import {NeckFront} from '../../characters/badger/parts/Neck';
import {LineScaleContext} from '../../characters/badger/parts/shared';
import {BRAND} from '../../characters/palette';
import type {BadgerPose, BadgerView, Expression} from '../../characters/types';
import {closeLineScale, fullLineScale} from './stage';

const ROW1 = {ground: 424, scale: 0.78} as const;
const VIEWS: readonly {view: BadgerView; x: number}[] = [
	{view: 'left', x: 250},
	{view: 'front', x: 580},
	{view: 'threeQuarter', x: 830},
	{view: 'right', x: 1250},
	{view: 'back', x: 1700},
];

/** Six poses on one ground line; the sit and lie pairs face each other so their different markings sit side by side. */
const ROW2 = {ground: 736, scale: 0.5} as const;
const POSES: readonly {pose: BadgerPose; view: BadgerView; x: number; walkPhase?: number}[] = [
	{pose: 'sit', view: 'right', x: 160},
	{pose: 'sit', view: 'left', x: 345},
	{pose: 'lie', view: 'right', x: 680},
	{pose: 'lie', view: 'left', x: 1000},
	{pose: 'walk', view: 'right', x: 1395, walkPhase: 0},
	{pose: 'lookUp', view: 'right', x: 1745},
];

/** Front bust (neck, collar, tag, front head), origin at the collar line, as the expression panels. */
const Bust: React.FC<{expression: Expression; judge?: number}> = ({expression, judge = 0}) => (
	<g>
		<NeckFront />
		<g transform="translate(0 -19.5)">
			<Head
				view="front"
				state={{expression, blink: 0, judge, earsBack: expression === 'worried' ? 0.7 : expression === 'shocked' ? 0.15 : 0, lookX: 0, lookY: 0}}
			/>
		</g>
	</g>
);
const BUSTS: readonly {expression: Expression; judge?: number}[] = [
	{expression: 'neutral'},
	{expression: 'happy'},
	{expression: 'worried'},
	{expression: 'shocked'},
	{expression: 'neutral', judge: 1},
];
const ROW3 = {y: 982, scale: 1.42, x0: 290, gap: 335} as const;

export const BadgerSheet: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: BRAND.background}}>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080">
			<line x1={40} y1={ROW1.ground + 1.5} x2={1880} y2={ROW1.ground + 1.5} stroke={BRAND.nearBlack} strokeWidth={2} />
			{VIEWS.map((v) => (
				<Badger key={v.view} view={v.view} x={v.x} y={ROW1.ground} scale={ROW1.scale} breathe={false} lineScale={fullLineScale(ROW1.scale)} />
			))}
			<line x1={40} y1={ROW2.ground + 1.5} x2={1880} y2={ROW2.ground + 1.5} stroke={BRAND.nearBlack} strokeWidth={2} />
			{POSES.map((p) => (
				<Badger
					key={`${p.pose}-${p.view}`}
					view={p.view}
					pose={p.pose}
					walkPhase={p.walkPhase}
					x={p.x}
					y={ROW2.ground}
					scale={ROW2.scale}
					breathe={false}
					lineScale={fullLineScale(ROW2.scale)}
				/>
			))}
			{/* The busts draw the head parts directly, so they take the line scale from the shared context. */}
			<LineScaleContext.Provider value={closeLineScale(ROW3.scale)}>
				{BUSTS.map((b, i) => (
					<g key={`${b.expression}${b.judge ?? 0}`} transform={`translate(${ROW3.x0 + i * ROW3.gap} ${ROW3.y}) scale(${ROW3.scale})`}>
						<Bust expression={b.expression} judge={b.judge} />
					</g>
				))}
			</LineScaleContext.Provider>
			<text x={1880} y={44} textAnchor="end" fontFamily={FONTS.body} fontWeight={600} fontSize={20} fill={BRAND.nearBlack}>
				Badger · character asset v1.0.0
			</text>
		</svg>
	</AbsoluteFill>
);
