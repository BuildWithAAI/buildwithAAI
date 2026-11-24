/**
 * ZooSheet: a still of the reusable ZOO asset (1920x1080, #E6E8EB), rendered from the rig itself.
 * Row 1: turnaround (front, 3/4, side, back) and the two poses (point, seated typing) on one ground line.
 * Row 2: the four expressions (head-and-shoulders) and the six-shape mouth library.
 * No labels are copied from the approved model sheet.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {ZooRig} from '../../characters/zoo/Zoo';
import {Chair, Desk, Keyboard, Monitor} from '../../characters/zoo/props';
import {TYPING_LAYOUT as L} from '../../characters/zoo/views/Typing';
import {BRAND} from '../../characters/palette';
import type {Expression, ZooView} from '../../characters/types';
import {MOUTH_ORDER} from './MouthDemo';

const GROUND = 575;
const S = 0.54;
const TURN: readonly {view: ZooView; x: number}[] = [
	{view: 'front', x: 150},
	{view: 'threeQuarter', x: 372},
	{view: 'side', x: 588},
	{view: 'back', x: 800},
];
const POINT_X = 1070;
const TYPING_X = 1585;

/** Head-and-shoulders framing as zoo_expr_* (world units). */
const EXPR_VB = '-151.68 -915.38 279.6 279.6';
/** Mouth close-up framing as zoo_mouth_* (world units). */
const MOUTH_VB = '-69.97 -804.76 139.94 90.55';
const EXPRS: readonly Expression[] = ['neutral', 'happy', 'worried', 'shocked'];

const BUST = {size: 322, x0: 24, gap: 4, y: 640} as const;
const CHIP = {w: 176, h: 114, x0: 1350, y0: 672, gapX: 12, gapY: 24} as const;

export const ZooSheet: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: BRAND.background}}>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080">
			<line x1={40} y1={GROUND + 1.5} x2={1880} y2={GROUND + 1.5} stroke={BRAND.nearBlack} strokeWidth={2} />
			{TURN.map((t) => (
				<ZooRig key={t.view} view={t.view} x={t.x} y={GROUND} scale={S} breathe={false} />
			))}
			<ZooRig pose="point" poseAmount={1} x={POINT_X} y={GROUND} scale={S} breathe={false} />
			<g transform={`translate(${TYPING_X} ${GROUND}) scale(${S})`}>
				<Chair x={L.chair.x} y={L.chair.y} />
				<ZooRig
					pose="typing"
					breathe={false}
					between={
						<>
							<Desk x={L.desk.x} y={L.desk.y} />
							<Monitor x={L.monitor.x} y={L.monitor.y} />
							<Keyboard x={L.keyboard.x} y={L.keyboard.y} />
						</>
					}
				/>
			</g>
			{EXPRS.map((e, i) => (
				<svg key={e} x={BUST.x0 + i * (BUST.size + BUST.gap)} y={BUST.y} width={BUST.size} height={BUST.size} viewBox={EXPR_VB}>
					<ZooRig expression={e} breathe={false} />
				</svg>
			))}
			{MOUTH_ORDER.map((m, i) => {
				const x = CHIP.x0 + (i % 3) * (CHIP.w + CHIP.gapX);
				const y = CHIP.y0 + Math.floor(i / 3) * (CHIP.h + CHIP.gapY);
				return (
					<g key={m.shape}>
						<svg x={x} y={y} width={CHIP.w} height={CHIP.h} viewBox={MOUTH_VB}>
							<ZooRig mouth={m.shape} breathe={false} />
						</svg>
						<rect x={x} y={y} width={CHIP.w} height={CHIP.h} rx={5} fill="none" stroke={BRAND.silver} strokeWidth={2} />
					</g>
				);
			})}
			<text x={1880} y={44} textAnchor="end" fontFamily={FONTS.body} fontWeight={600} fontSize={20} fill={BRAND.nearBlack}>
				ZOO · character asset v1.0.0
			</text>
		</svg>
	</AbsoluteFill>
);
