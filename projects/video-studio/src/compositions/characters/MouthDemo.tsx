/**
 * MouthDemo: ZOO's fixed six-shape mouth library, one shape per second (1920x1080, 30 fps, 6 s, silent).
 * This is a library demonstration, NOT lip-sync: there is no audio track. Shapes are replacements, so
 * each one switches on its second boundary.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {ZooRig} from '../../characters/zoo/Zoo';
import {BRAND} from '../../characters/palette';
import type {MouthShape} from '../../characters/types';
import {blinkAt} from './keys';
import {EASE} from './stage';

export const MOUTH_ORDER: readonly {shape: MouthShape; label: string}[] = [
	{shape: 'closed', label: 'Closed'},
	{shape: 'slightlyOpen', label: 'Slightly open'},
	{shape: 'ah', label: 'Ah'},
	{shape: 'ee', label: 'Ee'},
	{shape: 'oh', label: 'Oh'},
	{shape: 'mbp', label: 'M / B / P'},
];

/** Head-and-shoulders framing (world units), centred on the face. */
const BUST_VB = '-125 -918 250 250';
/** Mouth close-up framing (world units), as the zoo_mouth_* crops. */
const MOUTH_VB = '-69.97 -804.76 139.94 90.55';

const CHIP = {w: 236, h: 153, gapX: 24, gapY: 64, x0: 1080, y0: 520} as const;

export const MouthDemo: React.FC = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const index = Math.min(MOUTH_ORDER.length - 1, Math.floor(frame / fps));
	const current = MOUTH_ORDER[index];
	const blink = blinkAt(frame, 88, 2, 1, 3, EASE.inOut);
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background, fontFamily: FONTS.body, color: BRAND.nearBlack}}>
			<svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0}}>
				{/* Large bust: the current shape on the full rig, so the beard and jaw follow the mouth. */}
				<svg x={60} y={70} width={900} height={900} viewBox={BUST_VB}>
					<ZooRig mouth={current.shape} blink={blink} />
				</svg>
				{/* The library: six close-ups, the current one framed. */}
				{MOUTH_ORDER.map((m, i) => {
					const col = i % 3;
					const row = Math.floor(i / 3);
					const x = CHIP.x0 + col * (CHIP.w + CHIP.gapX);
					const y = CHIP.y0 + row * (CHIP.h + CHIP.gapY);
					const active = i === index;
					return (
						<g key={m.shape}>
							<svg x={x} y={y} width={CHIP.w} height={CHIP.h} viewBox={MOUTH_VB}>
								<ZooRig mouth={m.shape} breathe={false} />
							</svg>
							<rect
								x={x - 1}
								y={y - 1}
								width={CHIP.w + 2}
								height={CHIP.h + 2}
								rx={6}
								fill="none"
								stroke={active ? BRAND.nearBlack : BRAND.silver}
								strokeWidth={active ? 5 : 2}
							/>
							<text x={x + CHIP.w / 2} y={y + CHIP.h + 36} textAnchor="middle" fontFamily={FONTS.body} fontWeight={active ? 800 : 600} fontSize={26} fill={BRAND.nearBlack}>
								{m.label}
							</text>
						</g>
					);
				})}
			</svg>
			<div style={{position: 'absolute', left: 1080, top: 150, width: 760}}>
				<div style={{fontSize: 34, fontWeight: 600, letterSpacing: 0.5}}>ZOO mouth library · {index + 1} / 6</div>
				<div style={{fontSize: 120, fontWeight: 800, lineHeight: 1.1, marginTop: 18}}>{current.label}</div>
			</div>
			<div
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					bottom: 42,
					textAlign: 'center',
					fontSize: 34,
					fontWeight: 600,
				}}
			>
				Mouth library demo — silent, not lip-synced
			</div>
		</AbsoluteFill>
	);
};
