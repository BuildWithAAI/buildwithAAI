/**
 * Video watermark (Studio: Customization > Profile > Video watermark): 150x150 PNG, square, under 1 MB
 * (answer/10456525). The player draws it small over the bottom-right of the video, so it is a solid disc with a
 * ring (it must separate from both our light sets and dark frames) and transparent corners.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Badger} from '../../characters';
import {BRAND} from '../../characters/palette';
import {BADGER_HEAD, boxCentre} from '../characterFrames';
import {JellyfishMark} from '../marks/JellyfishMark';
import {WATERMARK} from '../spec';
import {SHOW, ZOORA} from '../tokens';
import {AVATAR_FRAMING} from '../layout';

export type WatermarkProps = {channel: 'zoora-ai' | 'zoora-security'; size?: number};

export const WatermarkArt: React.FC<{channel: WatermarkProps['channel']; size: number}> = ({channel, size}) => {
	const c = size / 2;
	const ring = Math.max(3, size * 0.03);
	const r = c - ring / 2 - 0.5;
	const k = size / 800; // the avatar's framing, scaled from its 800 px canvas
	const id = `wm-${channel}-${size}`;
	if (channel === 'zoora-ai') {
		return (
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<circle cx={c} cy={c} r={r} fill={ZOORA.bg} />
				<JellyfishMark cx={c} cy={c + 6 * k} height={size * 0.66} color={ZOORA.line} accent={ZOORA.accent} strokeBoostPx={size * 0.012} />
				<circle cx={c} cy={c} r={r} fill="none" stroke={ZOORA.line} strokeWidth={ring} />
			</svg>
		);
	}
	const f = AVATAR_FRAMING.badger;
	const s = f.scale * k;
	const hc = boxCentre(BADGER_HEAD);
	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
			<clipPath id={id}>
				<circle cx={c} cy={c} r={r} />
			</clipPath>
			<circle cx={c} cy={c} r={r} fill={SHOW.line} />
			<g clipPath={`url(#${id})`}>
				<Badger view="front" x={f.headCentre.x * k - hc.x * s} y={f.headCentre.y * k - hc.y * s} scale={s} breathe={false} judge={0.35} />
			</g>
			<circle cx={c} cy={c} r={r} fill="none" stroke={BRAND.nearBlack} strokeWidth={ring} />
		</svg>
	);
};

export const Watermark: React.FC<WatermarkProps> = ({channel, size = WATERMARK.width}) => (
	<AbsoluteFill style={{backgroundColor: 'transparent'}}>
		<WatermarkArt channel={channel} size={size} />
	</AbsoluteFill>
);
