/**
 * Set pieces of "The Zoo & Badger Show", drawn in stage units (src/show/layout/stage.ts) in the character style:
 * flat fills, one flat shadow tone per colour on the side away from the key light (upper left, ART_GUIDE LS1), the
 * near-black outline last. Colours come only from the palette tokens (CV1): BRAND, PROP_COLORS and the CV2
 * backgroundShadow. Teal appears only as small decoration (the ON AIR lamp).
 */
import React from 'react';
import {BRAND, LINE, PROP_COLORS} from '../../characters/palette';
import {FONTS} from '../../brand/fonts';
import {Outlined, rr, rrTop, useUid} from './shapes';
import type {MicSpec, Rect, StageSpec} from '../layout/stage';
import {BG_SHADOW} from '../graphics/theme';

/** Background lines are detail lines (2-4 px at output), lighter than the 3.5-unit outline of the characters and props. */
const WALL_LINE = 2.5;

/** Acoustic wall panels behind the desk: plain flat shapes, no texture (P1). */
export const WallPanels: React.FC<{panels: StageSpec['panels']}> = ({panels}) => {
	const id = useUid('wall');
	return (
		<g data-part="wall">
			{panels.map((p, i) => (
				<Outlined key={i} id={`${id}-${i}`} d={rr(p.x, p.y, p.w, p.h, 24)} fill={p.tone === 'light' ? BRAND.offWhite : BG_SHADOW} stroke={WALL_LINE} />
			))}
		</g>
	);
};

/**
 * A chair back: the top of a padded chair seen from the front, its seat hidden by the desk. One seam line inside,
 * shadow on the screen-right side.
 */
export const ChairBack: React.FC<{r: Rect & {r: number}; fill: string; shade: string; bottom: number}> = ({r, fill, shade, bottom}) => {
	const id = useUid('chair');
	const h = bottom - r.y;
	const d = rrTop(r.x, r.y, r.w, h, r.r);
	const inset = 22;
	const seam = rrTop(r.x + inset, r.y + inset, r.w - 2 * inset, h, Math.max(8, r.r - inset));
	const shadowD = `M ${r.x + r.w * 0.78} ${r.y - 10} H ${r.x + r.w + 10} V ${bottom + 10} H ${r.x + r.w * 0.78} Z`;
	return (
		<g data-part="chair">
			<Outlined id={id} d={d} fill={fill} shadow={{d: shadowD, fill: shade}} />
			<path d={seam} fill="none" stroke={BRAND.nearBlack} strokeWidth={LINE.detailWidth} strokeLinejoin="round" />
		</g>
	);
};

export const ZooChair: React.FC<{st: StageSpec}> = ({st}) => <ChairBack r={st.zooChair} fill={PROP_COLORS.desk} shade={PROP_COLORS.deskShadow} bottom={st.deskTop + 4} />;
export const BadgerChair: React.FC<{st: StageSpec}> = ({st}) => <ChairBack r={st.badgerChair} fill={PROP_COLORS.chair} shade={PROP_COLORS.chairShadow} bottom={st.deskTop + 4} />;

/**
 * The desk, front view: a slate top slab over an off-white front panel with one flat silver shadow band at its foot
 * (the same construction as the channel banner's desk, src/branding/scene/Stage.tsx, so the set matches the art).
 */
export const Desk: React.FC<{st: StageSpec}> = ({st}) => {
	const id = useUid('desk');
	const {x0, x1} = st.desk;
	const panel = rr(x0 + 24, st.deskTop + st.deskSlab - 4, x1 - x0 - 48, st.floor - st.deskTop - st.deskSlab + 4, 10);
	const band = `M ${x0} ${st.floor - 120} H ${x1} V ${st.floor + 20} H ${x0} Z`;
	const top = rr(x0, st.deskTop, x1 - x0, st.deskSlab, st.deskSlab / 2);
	return (
		<g data-part="desk">
			<Outlined id={`${id}p`} d={panel} fill={BRAND.offWhite} shadow={{d: band, fill: BRAND.silver}} />
			<Outlined id={`${id}t`} d={top} fill={BRAND.slate} />
		</g>
	);
};

/**
 * A podcast microphone on a desk stand: base on the desk top, a pole, a yoke and a capsule tilted toward the
 * speaker's mouth (tilt in degrees, + leans the top to screen right). Slate body, silver grille band.
 */
export const Mic: React.FC<{m: MicSpec}> = ({m}) => {
	const id = useUid('mic');
	const s = m.size;
	const baseW = 78 * s;
	const baseH = 16 * s;
	const poleW = 10 * s;
	const top = m.base - m.height * s;
	const capW = 44 * s;
	const capH = 104 * s;
	const capsule = rr(-capW / 2, -capH, capW, capH, capW / 2);
	const grille = `M ${-capW} ${-capH - 4} H ${capW} V ${-capH * 0.56} H ${-capW} Z`;
	const yr = capW / 2 + 10 * s;
	const yoke = `M ${-yr} ${-capH * 0.5} V ${-capH * 0.2} A ${yr} ${yr} 0 0 0 ${yr} ${-capH * 0.2} V ${-capH * 0.5}`;
	return (
		<g data-part="mic">
			<Outlined id={`${id}pole`} d={rr(m.x - poleW / 2, top, poleW, m.base - top, poleW / 2)} fill={BRAND.slate} />
			<Outlined id={`${id}base`} d={rr(m.x - baseW / 2, m.base - baseH / 2, baseW, baseH, baseH / 2)} fill={BRAND.slate} />
			<g transform={`translate(${m.x} ${top + 8 * s}) rotate(${m.tilt})`}>
				{/* the yoke: a slate band with a near-black outline (stroked twice: outline width, then the fill width) */}
				<path d={yoke} fill="none" stroke={BRAND.nearBlack} strokeWidth={9 * s + 2 * LINE.width} strokeLinecap="round" strokeLinejoin="round" />
				<path d={yoke} fill="none" stroke={BRAND.slate} strokeWidth={9 * s} strokeLinecap="round" strokeLinejoin="round" />
				<Outlined id={`${id}cap`} d={capsule} fill={BRAND.slate} shadow={{d: grille, fill: BRAND.silver}} />
				<path d={`M ${-capW / 2 + 6 * s} ${-capH * 0.72} H ${capW / 2 - 6 * s}`} stroke={BRAND.nearBlack} strokeWidth={LINE.detailWidth} strokeLinecap="round" />
				<path d={`M ${-capW / 2} ${-capH * 0.56} H ${capW / 2}`} stroke={BRAND.nearBlack} strokeWidth={LINE.detailWidth} />
			</g>
		</g>
	);
};

/**
 * The ON AIR sign, wall-mounted: a slate plate with off-white type and a small teal lamp. `on` switches it: off is a grey lamp and
 * silver type; the switch is a hard state change on one frame (no glow, no fade, ART_GUIDE P1).
 */
export const OnAirSign: React.FC<{x: number; y: number; h: number; on: boolean}> = ({x, y, h, on}) => {
	const id = useUid('onair');
	const font = h * 0.5;
	const textW = font * 4.05; // "ON AIR" in Montserrat 900 with tracking, measured at 33 px: 133.6 px
	const lamp = h * 0.2;
	const padX = h * 0.38;
	const w = padX + lamp * 2 + h * 0.3 + textW + padX; // = layout/stage.ts onAirRect
	const left = x - w / 2;
	return (
		<g data-part="onAir">
			<Outlined id={id} d={rr(left, y, w, h, h * 0.24)} fill={BRAND.slate} />
			<circle cx={left + padX + lamp} cy={y + h / 2} r={lamp} fill={on ? BRAND.teal : PROP_COLORS.chair} stroke={BRAND.nearBlack} strokeWidth={LINE.detailWidth} />
			<text
				x={left + padX + lamp * 2 + h * 0.3}
				y={y + h / 2}
				dominantBaseline="central"
				fontFamily={FONTS.heading}
				fontWeight={900}
				fontSize={font}
				letterSpacing={font * 0.12}
				fill={on ? BRAND.offWhite : BRAND.silver}
			>
				ON AIR
			</text>
		</g>
	);
};

/** A name plate hanging on the desk front: slate plate, off-white name (the hosts' names are not translated). */
export const Nameplate: React.FC<{r: Rect; name: string}> = ({r, name}) => {
	const id = useUid('plate');
	return (
		<g data-part="nameplate">
			<Outlined id={id} d={rr(r.x, r.y, r.w, r.h, 12)} fill={BRAND.slate} />
			<text x={r.x + r.w / 2} y={r.y + r.h / 2 + 1} textAnchor="middle" dominantBaseline="central" fontFamily={FONTS.heading} fontWeight={900} fontSize={r.h * 0.56} letterSpacing={r.h * 0.02} fill={BRAND.offWhite}>
				{name}
			</text>
		</g>
	);
};
