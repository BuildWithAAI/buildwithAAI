/**
 * BadgerSheet: a still of the reusable Badger asset (1920x1080, #E6E8EB), rendered from the rig itself.
 * Row 1: the size-panel side view ('left', anatomical left toward camera) and the turnaround (front, 3/4, right side,
 * back). Row 2: poses: sitting and lying in both facings (the left-facing bodies carry the LEFT coat-map markings,
 * decision BADGER-D23), walking and looking up. The left-facing sit and lie are PROVISIONAL until the owner accepts
 * D23 (their silhouette is the right-facing pose mirrored, BADGER_PROVISIONAL_POSES), so each carries a small, quiet
 * caption under its ground line. Every full figure stands in a flat contact shadow (decision INT-C1).
 * Row 3: expressions (front busts) plus the 'judge' reaction.
 * Line weights per decision INT-L1: SL5 for the full-body rows, the sheet's close-up weight for the busts.
 * No labels are copied from the approved model sheet.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {Badger} from '../../characters/badger/Badger';
import {isProvisionalBadgerPose} from '../../characters/badger/provisional';
import {Head} from '../../characters/badger/parts/heads/Head';
import {NeckFront} from '../../characters/badger/parts/Neck';
import {LineScaleContext} from '../../characters/badger/parts/shared';
import {BRAND} from '../../characters/palette';
import type {BadgerPose, BadgerView, Expression} from '../../characters/types';
import {PROVISIONAL_CAPTION} from './captions';
import {ContactShadow, FOOTPRINTS, type Footprint} from './contact';
import {closeLineScale, fullLineScale} from './stage';

const ROW1 = {ground: 424, scale: 0.78} as const;
const VIEWS: readonly {view: BadgerView; x: number; print: Footprint}[] = [
	{view: 'left', x: 250, print: FOOTPRINTS.badgerLeft},
	{view: 'front', x: 580, print: FOOTPRINTS.badgerFront},
	{view: 'threeQuarter', x: 830, print: FOOTPRINTS.badgerThreeQuarter},
	{view: 'right', x: 1250, print: FOOTPRINTS.badgerRight},
	{view: 'back', x: 1700, print: FOOTPRINTS.badgerBack},
];

/** Six poses on one ground line; the sit and lie pairs face each other so their different markings sit side by side. */
const ROW2 = {ground: 736, scale: 0.5} as const;
const POSES: readonly {pose: BadgerPose; view: BadgerView; x: number; walkPhase?: number; print: Footprint; captionDx?: number}[] = [
	{pose: 'sit', view: 'right', x: 160, print: FOOTPRINTS.badgerSitRight},
	{pose: 'sit', view: 'left', x: 345, print: FOOTPRINTS.badgerSitLeft, captionDx: 23},
	{pose: 'lie', view: 'right', x: 680, print: FOOTPRINTS.badgerLieRight},
	{pose: 'lie', view: 'left', x: 1000, print: FOOTPRINTS.badgerLieLeft, captionDx: 13},
	{pose: 'walk', view: 'right', x: 1395, walkPhase: 0, print: FOOTPRINTS.badgerWalkRight},
	{pose: 'lookUp', view: 'right', x: 1745, print: FOOTPRINTS.badgerLookUpRight},
];

/**
 * Caption under a provisional pose drawing (decision BADGER-D23): small and quiet, below the row's ground line.
 * A pose's `captionDx` centres its caption on the drawing rather than on the root (the footprint centre): measured on
 * the render, the left-facing sit spans x 291-446 px (root 345) and the left-facing lie 877-1150 px (root 1000).
 */
const CAPTION = {dy: 27, size: 17} as const;

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
/**
 * Bust row. Round 5: BADGER-D55 drew the front head (and the bust neck with it) 10% smaller, so the row is drawn 1/0.90
 * larger (1.42 -> 1.58) to keep round 4's on-screen bust size and line weight (3 px, closeLineScale).
 */
export const BADGER_SHEET_BUSTS = {y: 990, scale: 1.58, x0: 290, gap: 335} as const;
const ROW3 = BADGER_SHEET_BUSTS;

export const BadgerSheet: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: BRAND.background}}>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080">
			{/* Contact shadows under the figures (INT-C1); the sheet's near-black baselines run over them. */}
			{VIEWS.map((v) => (
				<ContactShadow key={`shadow-${v.view}`} x={v.x} y={ROW1.ground} scale={ROW1.scale} print={v.print} />
			))}
			<line x1={40} y1={ROW1.ground + 1.5} x2={1880} y2={ROW1.ground + 1.5} stroke={BRAND.nearBlack} strokeWidth={2} />
			{VIEWS.map((v) => (
				<Badger key={v.view} view={v.view} x={v.x} y={ROW1.ground} scale={ROW1.scale} breathe={false} lineScale={fullLineScale(ROW1.scale)} />
			))}
			{POSES.map((p) => (
				<ContactShadow key={`shadow-${p.pose}-${p.view}`} x={p.x} y={ROW2.ground} scale={ROW2.scale} print={p.print} />
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
			{POSES.filter((p) => isProvisionalBadgerPose(p.view, p.pose)).map((p) => (
				<text
					key={`provisional-${p.pose}-${p.view}`}
					data-qa-role="badge"
					x={p.x + (p.captionDx ?? 0)}
					y={ROW2.ground + CAPTION.dy}
					textAnchor="middle"
					fontFamily={FONTS.body}
					fontWeight={400}
					fontSize={CAPTION.size}
					fill={BRAND.slate}
				>
					{PROVISIONAL_CAPTION}
				</text>
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
