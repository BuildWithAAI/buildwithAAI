/**
 * BadgerSheet: a still of the reusable Badger asset (1920x1080, #E6E8EB), rendered from the rig itself.
 * Row 1: the size-panel side view ('left', anatomical left toward camera) and the turnaround (front, 3/4,
 * right side, back). Row 2: poses (sitting, lying, walking, looking up). Row 3: expressions (front busts)
 * plus the 'judge' reaction. No labels are copied from the approved model sheet.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {Badger} from '../../characters/badger/Badger';
import {Head} from '../../characters/badger/parts/heads/Head';
import {NeckFront} from '../../characters/badger/parts/Neck';
import {BRAND} from '../../characters/palette';
import type {BadgerPose, BadgerView, Expression} from '../../characters/types';

const ROW1 = {ground: 420, scale: 0.78} as const;
const VIEWS: readonly {view: BadgerView; x: number}[] = [
	{view: 'left', x: 250},
	{view: 'front', x: 580},
	{view: 'threeQuarter', x: 830},
	{view: 'right', x: 1250},
	{view: 'back', x: 1700},
];

const ROW2 = {ground: 742, scale: 0.56} as const;
const POSES: readonly {pose: BadgerPose; x: number; walkPhase?: number}[] = [
	{pose: 'sit', x: 250},
	{pose: 'lie', x: 640},
	{pose: 'walk', x: 1130, walkPhase: 0},
	{pose: 'lookUp', x: 1600},
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
const ROW3 = {y: 1000, scale: 1.5, x0: 230, gap: 345} as const;

export const BadgerSheet: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: BRAND.background}}>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080">
			<line x1={40} y1={ROW1.ground + 1.5} x2={1880} y2={ROW1.ground + 1.5} stroke={BRAND.nearBlack} strokeWidth={2} />
			{VIEWS.map((v) => (
				<Badger key={v.view} view={v.view} x={v.x} y={ROW1.ground} scale={ROW1.scale} breathe={false} />
			))}
			<line x1={40} y1={ROW2.ground + 1.5} x2={1880} y2={ROW2.ground + 1.5} stroke={BRAND.nearBlack} strokeWidth={2} />
			{POSES.map((p) => (
				<Badger key={p.pose} view="right" pose={p.pose} walkPhase={p.walkPhase} x={p.x} y={ROW2.ground} scale={ROW2.scale} breathe={false} />
			))}
			{BUSTS.map((b, i) => (
				<g key={`${b.expression}${b.judge ?? 0}`} transform={`translate(${ROW3.x0 + i * ROW3.gap} ${ROW3.y}) scale(${ROW3.scale})`}>
					<Bust expression={b.expression} judge={b.judge} />
				</g>
			))}
			<text x={1880} y={1062} textAnchor="end" fontFamily={FONTS.body} fontWeight={600} fontSize={20} fill={BRAND.nearBlack}>
				BADGER · character asset v1.0.0
			</text>
		</svg>
	</AbsoluteFill>
);
