/**
 * Zoora AI channel banner, 2560x1440 PNG. The jellyfish brand: silver line art on black (PROJECT_INSTRUCTIONS,
 * content/zoora-ai/CHANNEL.md). Zoo and Badger stand in a light "porthole" (a window into an episode), because
 * Zoo's clothes are L* 9-24 and need L* >= 60 behind them (ART_GUIDE CV4b). Everything a viewer must read sits
 * inside YouTube's 1546x423 safe area (spec.ts); the porthole and the circuit traces fill the TV view.
 *
 * layer 'key' renders only the key content (lockup + head boxes) on transparency for the QA safe-area check.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Badger, ZooRig} from '../../characters';
import {BRAND} from '../../characters/palette';
import {ZooraLockup} from '../marks/Lockups';
import {ContactShadow} from '../scene/Stage';
import {BANNER, type Rect} from '../spec';
import {ZOORA_BANNER, zooraBannerHeads} from '../layout';
import {ZOORA} from '../tokens';
import {CircuitField, ZOORA_TRACES} from './circuit';

export type BannerLayer = 'all' | 'key';
export type BannerZooraProps = {layer?: BannerLayer; tagline?: readonly string[]};

export {ZOORA_BANNER, zooraBannerHeads};

export const DEFAULT_ZOORA_TAGLINE = ['Crypto and AI stories,', 'starring you.'] as const;

const HeadBoxes: React.FC<{boxes: Rect[]}> = ({boxes}) => (
	<>
		{boxes.map((b, i) => (
			<rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="#FF00FF" />
		))}
	</>
);

export const BannerZoora: React.FC<BannerZooraProps> = ({layer = 'all', tagline = DEFAULT_ZOORA_TAGLINE}) => {
	const L = ZOORA_BANNER;
	const key = layer === 'key';
	const {portal: P, pair} = L;
	return (
		<AbsoluteFill style={{backgroundColor: key ? 'transparent' : ZOORA.bg}}>
			<svg width={BANNER.width} height={BANNER.height} viewBox={`0 0 ${BANNER.width} ${BANNER.height}`}>
				{key ? (
					<HeadBoxes boxes={zooraBannerHeads()} />
				) : (
					<>
						<CircuitField traces={ZOORA_TRACES} color={BRAND.slate} width={8} nodeR={14} />
						<circle cx={P.cx} cy={P.cy} r={P.r} fill={ZOORA.stage} />
						<clipPath id="zooraPortal">
							<circle cx={P.cx} cy={P.cy} r={P.r} />
						</clipPath>
						<g clipPath="url(#zooraPortal)">
							<ContactShadow cx={pair.zooX} cy={pair.groundY} rx={118 * pair.scale} ry={16 * pair.scale} />
							<ContactShadow cx={pair.badgerX} cy={pair.groundY} rx={92 * pair.scale} ry={14 * pair.scale} />
							<ZooRig x={pair.zooX} y={pair.groundY} scale={pair.scale} breathe={false} browLift={0.2} />
							<Badger view="front" x={pair.badgerX} y={pair.groundY} scale={pair.scale} breathe={false} judge={0.25} />
						</g>
						<circle cx={P.cx} cy={P.cy} r={P.r} fill="none" stroke={ZOORA.line} strokeWidth={P.ring} />
					</>
				)}
			</svg>
			<ZooraLockup x={L.lockup.x} y={L.lockup.y} scale={L.lockup.scale} tagline={tagline} />
		</AbsoluteFill>
	);
};
