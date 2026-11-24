/**
 * ZooSheet: a still of the reusable Zoo asset (1920x1080, #E6E8EB), rendered from the rig itself.
 * Row 1: turnaround (front, 3/4, side, back) and the two poses (point, seated typing) on one ground line, each with a
 * flat contact shadow (decision INT-C1).
 * Row 2: the four expressions (head-and-shoulders) and the six-shape mouth library.
 * Line weights per decision INT-L1: SL5 for the full-body row, the sheet's close-up weight for busts and mouths.
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
import {LineScaleContext} from '../../characters/zoo/parts/Shape';
import {ContactShadow, FOOTPRINTS, type Footprint} from './contact';
import {MOUTH_ORDER} from './MouthDemo';
import {closeLineScale, fullLineScale} from './stage';

const GROUND = 575;
const S = 0.54;
const TURN: readonly {view: ZooView; x: number; print: Footprint}[] = [
	{view: 'front', x: 150, print: FOOTPRINTS.zooFront},
	{view: 'threeQuarter', x: 372, print: FOOTPRINTS.zooThreeQuarter},
	{view: 'side', x: 588, print: FOOTPRINTS.zooSide},
	{view: 'back', x: 800, print: FOOTPRINTS.zooBack},
];
const POINT_X = 1070;
const TYPING_X = 1585;

/** Head-and-shoulders framing as zoo_expr_* (world units). */
const EXPR_VB = '-151.68 -915.38 279.6 279.6';
/** Mouth close-up framing as zoo_mouth_* (world units). */
const MOUTH_VB = '-69.97 -804.76 139.94 90.55';
const EXPRS: readonly Expression[] = ['neutral', 'happy', 'worried', 'shocked'];

const BUST = {size: 322, x0: 24, gap: 4, y: 640} as const;
const CHIP = {w: 176, h: 114, x0: 1338, y0: 672, gapX: 10, gapY: 24} as const;
/** Line scales: full-body row at S px per unit; busts 322 px for 279.6 units; chips 176 px for 139.94 units. */
const BODY_LINE = fullLineScale(S);
const BUST_LINE = closeLineScale(BUST.size / 279.6);
const CHIP_LINE = closeLineScale(CHIP.w / 139.94);

export const ZooSheet: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: BRAND.background}}>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080">
			{/* Contact shadows under the figures (INT-C1); the sheet's near-black baseline runs over them. */}
			{TURN.map((t) => (
				<ContactShadow key={`shadow-${t.view}`} x={t.x} y={GROUND} scale={S} print={t.print} />
			))}
			<ContactShadow x={POINT_X} y={GROUND} scale={S} print={FOOTPRINTS.zooFront} />
			<ContactShadow x={TYPING_X} y={GROUND} scale={S} print={FOOTPRINTS.zooTyping} />
			<line x1={40} y1={GROUND + 1.5} x2={1880} y2={GROUND + 1.5} stroke={BRAND.nearBlack} strokeWidth={2} />
			{TURN.map((t) => (
				<ZooRig key={t.view} view={t.view} x={t.x} y={GROUND} scale={S} breathe={false} lineScale={BODY_LINE} />
			))}
			<ZooRig pose="point" poseAmount={1} x={POINT_X} y={GROUND} scale={S} breathe={false} lineScale={BODY_LINE} />
			{/* The props share the rig's line system: the chair sits outside the rig, so it gets the scale from context. */}
			<LineScaleContext.Provider value={BODY_LINE}>
			<g transform={`translate(${TYPING_X} ${GROUND}) scale(${S})`}>
				<Chair x={L.chair.x} y={L.chair.y} />
				<ZooRig
					pose="typing"
					breathe={false}
					lineScale={BODY_LINE}
					between={
						<>
							<Desk x={L.desk.x} y={L.desk.y} />
							<Monitor x={L.monitor.x} y={L.monitor.y} />
							<Keyboard x={L.keyboard.x} y={L.keyboard.y} />
						</>
					}
				/>
			</g>
			</LineScaleContext.Provider>
			{EXPRS.map((e, i) => (
				<svg key={e} x={BUST.x0 + i * (BUST.size + BUST.gap)} y={BUST.y} width={BUST.size} height={BUST.size} viewBox={EXPR_VB}>
					<ZooRig expression={e} breathe={false} lineScale={BUST_LINE} />
				</svg>
			))}
			{MOUTH_ORDER.map((m, i) => {
				const x = CHIP.x0 + (i % 3) * (CHIP.w + CHIP.gapX);
				const y = CHIP.y0 + Math.floor(i / 3) * (CHIP.h + CHIP.gapY);
				return (
					<g key={m.shape}>
						<svg x={x} y={y} width={CHIP.w} height={CHIP.h} viewBox={MOUTH_VB}>
							<ZooRig mouth={m.shape} breathe={false} lineScale={CHIP_LINE} />
						</svg>
						<rect x={x} y={y} width={CHIP.w} height={CHIP.h} rx={5} fill="none" stroke={BRAND.silver} strokeWidth={2} />
					</g>
				);
			})}
			<text x={1880} y={44} textAnchor="end" fontFamily={FONTS.body} fontWeight={600} fontSize={20} fill={BRAND.nearBlack}>
				Zoo · character asset v1.0.0
			</text>
		</svg>
	</AbsoluteFill>
);
