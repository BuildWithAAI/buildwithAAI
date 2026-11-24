/**
 * Security channel banner ("The Zoo & Badger Show"), 2560x1440 PNG. The light talk-show set: Zoo stands behind
 * the show desk and Badger sits beside him on a seat the desk hides, so both faces fit YouTube's 423 px-tall safe
 * band at a readable size. A slate studio monitor sits behind Badger's head so his white coat reads against a
 * darker shape (ART_GUIDE CV4a); Zoo keeps the light wall behind his dark clothes (CV4b).
 *
 * The channel's display name is not decided yet, so the banner carries the show's logo, not a channel name.
 * layer 'key' renders only the key content (logo, tagline, head boxes) for the QA safe-area check.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {Badger, ZooRig} from '../../characters';
import {BRAND} from '../../characters/palette';
import {JellyfishMark} from '../marks/JellyfishMark';
import {ShowLogo} from '../marks/Lockups';
import {roundedRect, ShowDesk} from '../scene/Stage';
import {BANNER} from '../spec';
import {SHOW_BANNER, showBannerHeads} from '../layout';
import {SHOW} from '../tokens';
import type {BannerLayer} from './BannerZoora';

export type BannerShowProps = {layer?: BannerLayer; tagline?: readonly string[]};

export {SHOW_BANNER, showBannerHeads};

/** Floor band and the row of wall panels (flat fills, silver outline-free shapes: they are scenery, not props). */
const SetDressing: React.FC = () => {
	const L = SHOW_BANNER;
	const P = L.panels;
	const total = P.count * P.w + (P.count - 1) * P.gap;
	const x0 = (BANNER.width - total) / 2;
	return (
		<g data-part="set">
			<rect x={0} y={L.floorY} width={BANNER.width} height={BANNER.height - L.floorY} fill={SHOW.bgShadow} />
			{Array.from({length: P.count}, (_, i) => (
				<path key={i} d={roundedRect(x0 + i * (P.w + P.gap), P.y, P.w, P.h, P.r)} fill={BRAND.offWhite} />
			))}
		</g>
	);
};

/** The desk's front emblem: a slate plate with the Zoora jellyfish (the network bug), centred on the panel. */
const DeskEmblem: React.FC = () => {
	const L = SHOW_BANNER;
	const E = L.emblem;
	const cx = L.desk.x + L.desk.w / 2;
	const cy = L.deskTop + (L.floorY - L.deskTop) * 0.46;
	return (
		<g data-part="deskEmblem">
			<path d={roundedRect(cx - E.w / 2, cy - E.h / 2, E.w, E.h, E.r)} fill={BRAND.slate} />
			<JellyfishMark cx={cx} cy={cy} height={E.h * 0.66} color={BRAND.silver} accent={SHOW.accent} />
		</g>
	);
};

export const DEFAULT_SHOW_TAGLINE = ['Crypto and AI security news.', 'What happened. How it worked. One fix.'] as const;

export const BannerShow: React.FC<BannerShowProps> = ({layer = 'all', tagline = DEFAULT_SHOW_TAGLINE}) => {
	const L = SHOW_BANNER;
	const key = layer === 'key';
	const outline = 3.5 * L.scale;
	const M = L.monitor;
	return (
		<AbsoluteFill style={{backgroundColor: key ? 'transparent' : SHOW.bg}}>
			<svg width={BANNER.width} height={BANNER.height} viewBox={`0 0 ${BANNER.width} ${BANNER.height}`}>
				{key ? (
					showBannerHeads().map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="#FF00FF" />)
				) : (
					<>
						<SetDressing />
						{/* studio monitor on the back wall, behind Badger */}
						<path d={roundedRect(M.x, M.y, M.w, M.h, M.r)} fill={BRAND.slate} />
						<path d={roundedRect(M.x, M.y, M.w, M.h, M.r)} fill="none" stroke={BRAND.nearBlack} strokeWidth={4} />
						<JellyfishMark cx={M.x + 58} cy={M.y + 58} height={64} color={BRAND.silver} accent={null} />
						{/* Badger sits on a seat hidden by the desk; Zoo stands behind it */}
						<Badger view="right" pose="sit" head="front" x={L.badger.x} y={L.badger.groundY} scale={L.scale} breathe={false} judge={0.3} />
						<ZooRig x={L.zoo.x} y={L.zoo.groundY} scale={L.scale} breathe={false} browLift={0.2} />
						<ShowDesk x={L.desk.x} topY={L.deskTop} w={L.desk.w} h={L.floorY - L.deskTop} outline={outline + 0.5} slab={30} />
						<DeskEmblem />
					</>
				)}
			</svg>
			<ShowLogo x={L.logo.x} y={L.logo.y} scale={L.logo.scale} />
			<div
				style={{
					position: 'absolute',
					left: L.tagline.x,
					top: L.tagline.y,
					transform: 'translate(-50%, -50%)',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: L.tagline.gap,
					fontFamily: FONTS.body,
					fontSize: L.tagline.size,
					lineHeight: 1.15,
					color: SHOW.ink,
					whiteSpace: 'nowrap',
				}}
			>
				{tagline.map((t, i) => (
					<div key={t} style={{fontWeight: i === 0 ? 800 : 600}}>
						{t}
					</div>
				))}
			</div>
		</AbsoluteFill>
	);
};
