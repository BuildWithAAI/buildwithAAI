/**
 * Zoora AI intro sting, 1920x1080, 30 fps, 4 s by default (3-5 s with a jingle; see ./audio.tsx). Silent unless a
 * jingle is passed. Beats (frames): the bell draws 6-36, the highlight 20-40, the tentacle traces 30-52, the nodes
 * pop 46-58 and the teal accent lands on HIT 54; the mark settles into the lockup 56-72, then the name wipes in
 * 70-86 and the tagline 78-94; a gentle bell pulse holds; the last 15 frames fade to black.
 * Restrained motion (ART_GUIDE P5): eased curves, no bounce except the nodes' small pop (MO3 'pop', props only).
 */
import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {BRAND} from '../../characters/palette';
import {JellyfishMark} from '../marks/JellyfishMark';
import {WORDMARK_INK, ZOORA_LOCKUP, ZOORA_STING_BEATS, ZOORA_STING_LAYOUT} from '../layout';
import {decel, minJerk, progress} from '../motion';
import {CircuitField, type Trace} from '../stills/circuit';
import {ZOORA} from '../tokens';
import {StingAudio, type StingAudioProps} from './audio';

export {WORDMARK_INK, ZOORA_STING_BEATS, ZOORA_STING_LAYOUT};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Corner circuit traces (slate on near-black): background only, kept away from the centred lockup. */
const STING_TRACES: readonly Trace[] = [
	{pts: [[0, 150], [250, 150], [350, 250], [350, 300]], nodeEnd: true},
	{pts: [[0, 330], [150, 330], [230, 410]], nodeEnd: true},
	{pts: [[300, 0], [300, 70], [380, 150], [520, 150]], nodeEnd: true},
	{pts: [[1920, 170], [1690, 170], [1600, 260], [1600, 310]], nodeEnd: true},
	{pts: [[1620, 0], [1620, 60], [1540, 140], [1400, 140]], nodeEnd: true},
	{pts: [[1920, 360], [1780, 360], [1700, 440]], nodeEnd: true},
	{pts: [[0, 900], [260, 900], [360, 800], [360, 760]], nodeEnd: true},
	{pts: [[340, 1080], [340, 1000], [420, 920], [560, 920]], nodeEnd: true},
	{pts: [[1920, 880], [1660, 880], [1560, 780], [1560, 740]], nodeEnd: true},
	{pts: [[1580, 1080], [1580, 1010], [1500, 930], [1360, 930]], nodeEnd: true},
];

export type ZooraStingProps = StingAudioProps & {tagline?: string};

export const ZooraSting: React.FC<ZooraStingProps> = ({tagline = 'Crypto and AI stories, starring you.', ...audio}) => {
	const frame = useCurrentFrame();
	const {fps, durationInFrames} = useVideoConfig();
	const B = ZOORA_STING_BEATS;
	const L = ZOORA_STING_LAYOUT;
	const settle = progress(frame, B.settle[0], B.settle[1], minJerk);
	const cx = lerp(L.markStart.cx, L.markEnd.cx, settle);
	const cy = lerp(L.markStart.cy, L.markEnd.cy, settle);
	const h = lerp(L.markStart.h, L.markEnd.h, settle);
	const nodes = spring({frame: frame - B.nodes[0], fps, config: {stiffness: 200, damping: 14}, durationInFrames: B.nodes[1] - B.nodes[0]});
	const accent = progress(frame, B.hit, B.hit + 4, decel);
	// one slow swim pulse during the hold (0 -> 0.018 -> 0), only after the settle
	const holdStart = B.settle[1] + 4;
	const holdEnd = durationInFrames - B.fadeFrames;
	const pulseT = progress(frame, holdStart, Math.max(holdStart + 1, holdEnd), (t) => t);
	const pulse = 0.018 * Math.sin(Math.PI * pulseT) ** 2;
	const fade = 1 - progress(frame, durationInFrames - B.fadeFrames, durationInFrames - 1, (t) => t);
	const word = progress(frame, B.word[0], B.word[1], decel);
	const tag = progress(frame, B.tag[0], B.tag[1], decel);
	const bg = progress(frame, B.background[0], B.background[1], minJerk);
	return (
		<AbsoluteFill style={{backgroundColor: ZOORA.bg}}>
			<StingAudio {...audio} />
			<AbsoluteFill style={{opacity: fade}}>
				<svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position: 'absolute'}}>
					{bg > 0 ? (
						<>
							<clipPath id="zooraStingBg">
								<circle cx={960} cy={540} r={bg * 1120} />
							</clipPath>
							<g clipPath="url(#zooraStingBg)">
								<CircuitField traces={STING_TRACES} color={BRAND.slate} width={6} nodeR={11} />
							</g>
						</>
					) : null}
					<JellyfishMark
						cx={cx}
						cy={cy}
						height={h}
						color={ZOORA.line}
						accent={ZOORA.accent}
						pulse={pulse}
						draw={{
							bell: progress(frame, B.bell[0], B.bell[1], minJerk),
							inner: progress(frame, B.inner[0], B.inner[1], minJerk),
							traces: progress(frame, B.traces[0], B.traces[1], minJerk),
							nodes: frame < B.nodes[0] ? 0 : nodes,
							accent,
						}}
					/>
				</svg>
				<div
					style={{
						position: 'absolute',
						left: L.word.left,
						top: L.word.top,
						fontFamily: FONTS.heading,
						fontWeight: 900,
						fontSize: L.word.size,
						lineHeight: 0.92,
						letterSpacing: `${ZOORA_LOCKUP.wordTracking}em`,
						color: ZOORA.text,
						whiteSpace: 'nowrap',
						clipPath: `inset(-20% ${(1 - word) * 100}% -20% 0)`,
					}}
				>
					Zoora <span style={{color: ZOORA.line}}>AI</span>
				</div>
				<div
					style={{
						position: 'absolute',
						left: L.tag.x,
						top: L.tag.y,
						transform: 'translate(-50%, -50%)',
						fontFamily: FONTS.body,
						fontWeight: 600,
						fontSize: L.tag.size,
						color: ZOORA.textMuted,
						whiteSpace: 'nowrap',
						clipPath: `inset(-20% ${(1 - tag) * 100}% -20% 0)`,
					}}
				>
					{tagline}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
