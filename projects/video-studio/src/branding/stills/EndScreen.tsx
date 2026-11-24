/**
 * End-screen template, 1920x1080, 20 s (YouTube end screens use the last 5-20 s of a video of 25 s or more;
 * answer/6388789). The zones for YouTube's elements use EXACTLY the episode engine's geometry
 * (src/episode/layout/specs.ts LAYOUTS.endscreen.landscape; a test keeps them equal), so one Studio end-screen
 * layout fits every video: two 16:9 zones for video or playlist elements and one circle for the subscribe element.
 * The zones are drawn as finished frames, so the render still looks complete where YouTube shows no elements.
 *
 * Motion is a moving hold (ART_GUIDE MO6): zones settle in over the first half second, then only breathing and
 * seeded blinks. The PNG template is frame END_SCREEN_STILL_FRAME.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {Badger, ZooRig} from '../../characters';
import {BRAND} from '../../characters/palette';
import {ShowLogo, ZooraLockup} from '../marks/Lockups';
import {blinkAt, blinkStarts, decel, progress} from '../motion';
import {ContactShadow, roundedRect} from '../scene/Stage';
import {END_LABELS, END_LAYOUT, END_SCREEN_FRAMES, END_ZONES} from '../layout';
import {OUTLINE, RADIUS, SHOW, ZOORA, type ChannelKey} from '../tokens';

export {END_ZONES};

export type EndScreenProps = {channel: ChannelKey; watchNext?: string; subscribe?: string};

const Zones: React.FC<{channel: ChannelKey; frame: number}> = ({channel, frame}) => {
	const dark = channel === 'zoora-ai';
	const p = progress(frame, 4, 16, decel);
	const ring = dark ? ZOORA.line : BRAND.nearBlack;
	const fill = dark ? ZOORA.bg : SHOW.card;
	const S = END_ZONES.subscribe;
	const z0 = END_ZONES.slots[0];
	const z1 = END_ZONES.slots[1];
	// native SVG clip paths (CSS clip-path percentages on SVG groups resolve against an unreliable reference box)
	const revealX = z0.x - OUTLINE + (1 - p) * (z0.w + 2 * OUTLINE);
	return (
		<g data-part="zones">
			<clipPath id={`endSlots-${channel}`}>
				<rect x={revealX} y={z0.y - OUTLINE} width={z0.w + 2 * OUTLINE} height={z1.y + z1.h - z0.y + 2 * OUTLINE} />
			</clipPath>
			<clipPath id={`endSub-${channel}`}>
				<circle cx={S.cx} cy={S.cy} r={(S.r + OUTLINE) * p} />
			</clipPath>
			<g clipPath={`url(#endSlots-${channel})`} transform={`translate(${(1 - p) * 40} 0)`}>
				{END_ZONES.slots.map((z, i) => (
					<path key={i} d={roundedRect(z.x, z.y, z.w, z.h, RADIUS.l)} fill={fill} stroke={ring} strokeWidth={OUTLINE} />
				))}
			</g>
			<g clipPath={`url(#endSub-${channel})`}>
				<circle cx={S.cx} cy={S.cy} r={S.r} fill={fill} stroke={ring} strokeWidth={OUTLINE} />
			</g>
		</g>
	);
};

const Labels: React.FC<{channel: ChannelKey; watchNext: string; subscribe: string; frame: number}> = ({channel, watchNext, subscribe, frame}) => {
	const color = channel === 'zoora-ai' ? ZOORA.text : SHOW.ink;
	const p = progress(frame, 8, 20, decel);
	const S = END_ZONES.subscribe;
	const z0 = END_ZONES.slots[0];
	const style: React.CSSProperties = {position: 'absolute', fontFamily: FONTS.heading, fontWeight: 800, color, whiteSpace: 'nowrap', lineHeight: 1};
	return (
		<>
			<div style={{...style, left: z0.x, top: z0.y - 60, fontSize: 36, clipPath: `inset(-20% ${(1 - p) * 100}% -20% 0)`}}>{watchNext}</div>
			<div style={{...style, left: S.cx, top: S.cy + S.r + 22, fontSize: 30, transform: 'translateX(-50%)', clipPath: `inset(-20% ${(1 - p) * 100}% -20% 0)`}}>{subscribe}</div>
		</>
	);
};

export const EndScreen: React.FC<EndScreenProps> = ({channel, watchNext = END_LABELS.watchNext, subscribe = END_LABELS.subscribe}) => {
	const frame = useCurrentFrame();
	const zooBlink = blinkAt(frame, blinkStarts(`end-${channel}-zoo`, END_SCREEN_FRAMES));
	const badgerBlink = blinkAt(frame, blinkStarts(`end-${channel}-badger`, END_SCREEN_FRAMES));
	if (channel === 'zoora-ai') {
		const L = END_LAYOUT['zoora-ai'];
		const P = L.portal;
		const pr = L.pair;
		return (
			<AbsoluteFill style={{backgroundColor: ZOORA.bg}}>
				<svg width={1920} height={1080} viewBox="0 0 1920 1080">
					<circle cx={P.cx} cy={P.cy} r={P.r} fill={ZOORA.stage} />
					<clipPath id="endPortal">
						<circle cx={P.cx} cy={P.cy} r={P.r} />
					</clipPath>
					<g clipPath="url(#endPortal)">
						<ContactShadow cx={pr.zooX} cy={pr.groundY} rx={118 * pr.scale} ry={16 * pr.scale} />
						<ContactShadow cx={pr.badgerX} cy={pr.groundY} rx={92 * pr.scale} ry={14 * pr.scale} />
						<ZooRig x={pr.zooX} y={pr.groundY} scale={pr.scale} blink={zooBlink} browLift={0.2} />
						<Badger view="front" x={pr.badgerX} y={pr.groundY} scale={pr.scale} blink={badgerBlink} judge={0.25} />
					</g>
					<circle cx={P.cx} cy={P.cy} r={P.r} fill="none" stroke={ZOORA.line} strokeWidth={8} />
					<Zones channel={channel} frame={frame} />
				</svg>
				<ZooraLockup x={L.lockup.x} y={L.lockup.y} scale={L.lockup.scale} />
				<Labels channel={channel} watchNext={watchNext} subscribe={subscribe} frame={frame} />
			</AbsoluteFill>
		);
	}
	const L = END_LAYOUT['zoora-security'];
	const pr = L.pair;
	return (
		<AbsoluteFill style={{backgroundColor: SHOW.bg}}>
			<svg width={1920} height={1080} viewBox="0 0 1920 1080">
				<ContactShadow cx={pr.zooX} cy={pr.groundY} rx={118 * pr.scale} ry={16 * pr.scale} />
				<ContactShadow cx={pr.badgerX} cy={pr.groundY} rx={150 * pr.scale} ry={14 * pr.scale} />
				<ZooRig x={pr.zooX} y={pr.groundY} scale={pr.scale} blink={zooBlink} browLift={0.2} />
				<Badger view="left" head="front" x={pr.badgerX} y={pr.groundY} scale={pr.scale} blink={badgerBlink} judge={0.3} />
				<Zones channel={channel} frame={frame} />
			</svg>
			<ShowLogo x={L.logo.x} y={L.logo.y} scale={L.logo.scale} />
			<Labels channel={channel} watchNext={watchNext} subscribe={subscribe} frame={frame} />
		</AbsoluteFill>
	);
};
