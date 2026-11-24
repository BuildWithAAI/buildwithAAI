import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {FLATBOLD as C, FlatboldCharacter, type FlatboldFigureProps} from './Character';

type Entry = {label: string; sub: string; width: number; props: FlatboldFigureProps; cx: number};

const SCALE = 0.66;
const CARD_TOP = 180;
const CARD_H = 830;
const FEET_Y = CARD_TOP + CARD_H - 120;

const ENTRIES: Entry[] = [
	{label: 'NEUTRAL', sub: 'mouthOpen 0', width: 296, cx: 0.5, props: {expression: 'neutral', mouthOpen: 0}},
	{label: 'HAPPY', sub: 'mouthOpen 0.35', width: 296, cx: 0.5, props: {expression: 'happy', mouthOpen: 0.35}},
	{label: 'WORRIED', sub: 'mouthOpen 0.15', width: 296, cx: 0.5, props: {expression: 'worried', mouthOpen: 0.15}},
	{label: 'SHOCKED', sub: 'mouthOpen 0.8', width: 296, cx: 0.5, props: {expression: 'shocked', mouthOpen: 0.8}},
	{
		label: 'POINT',
		sub: "pose 'point' · happy · mouthOpen 0.6",
		width: 540,
		cx: 0.31,
		props: {expression: 'happy', pose: 'point', pointSide: 'right', mouthOpen: 0.6, lookX: 0.4},
	},
];

const SWATCHES: Array<[string, string]> = [
	['#0B0C0F', 'near-black'],
	['#161A21', 'slate'],
	['#C9CED6', 'silver'],
	['#8C939E', 'silver dk'],
	['#F4F6F8', 'white'],
	['#FFB020', 'amber accent'],
];

export const FlatboldSheet: React.FC = () => {
	const gap = 20;
	const total = ENTRIES.reduce((a, e) => a + e.width, 0) + gap * (ENTRIES.length - 1);
	let left = (1920 - total) / 2;
	const cards = ENTRIES.map((e) => {
		const c = {...e, left};
		left += e.width + gap;
		return c;
	});
	return (
		<AbsoluteFill style={{background: C.ink, fontFamily: FONTS.body}}>
			{/* header */}
			<div style={{position: 'absolute', left: 100, top: 48, display: 'flex', alignItems: 'baseline', gap: 24}}>
				<div style={{fontFamily: FONTS.display, fontSize: 84, color: C.white, lineHeight: 1}}>YOU</div>
				<div style={{fontFamily: FONTS.heading, fontWeight: 800, fontSize: 30, color: C.amber, letterSpacing: 2}}>FLAT BOLD</div>
				<div style={{fontWeight: 500, fontSize: 26, color: C.silverDark}}>Zoora AI host · expression sheet · same scale</div>
			</div>
			<div style={{position: 'absolute', right: 100, top: 62, display: 'flex', gap: 18}}>
				{SWATCHES.map(([hex, name]) => (
					<div key={hex} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6}}>
						<div style={{width: 44, height: 44, borderRadius: 22, background: hex, boxShadow: `0 0 0 2px ${C.slate}`}} />
						<div style={{fontSize: 14, fontWeight: 600, color: C.silverDark}}>{name}</div>
					</div>
				))}
			</div>

			{cards.map((c) => (
				<div
					key={c.label}
					style={{position: 'absolute', left: c.left, top: CARD_TOP, width: c.width, height: CARD_H, background: C.slate, borderRadius: 24}}
				/>
			))}
			{cards.map((c) => (
				<React.Fragment key={c.label}>
					<svg style={{position: 'absolute', left: 0, top: 0}} width={1920} height={1080}>
						<ellipse cx={c.left + c.width * c.cx} cy={FEET_Y + 4} rx={130 * SCALE * 1.4} ry={14} fill={C.ink} opacity={0.7} />
					</svg>
					<FlatboldCharacter x={c.left + c.width * c.cx} y={FEET_Y} scale={SCALE} {...c.props} />
					<div style={{position: 'absolute', left: c.left, top: FEET_Y + 34, width: c.width, textAlign: 'center'}}>
						<div style={{fontWeight: 800, fontSize: 30, color: C.white, letterSpacing: 3}}>{c.label}</div>
						<div style={{fontWeight: 500, fontSize: 19, color: C.silverDark, marginTop: 6}}>{c.sub}</div>
					</div>
				</React.Fragment>
			))}
		</AbsoluteFill>
	);
};
