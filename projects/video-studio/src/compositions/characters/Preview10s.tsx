/**
 * Preview10s: the 10-second character proof (1920x1080, 30 fps, 300 frames, silent, #E6E8EB).
 * Staging reproduces the size-comparison panel (ZOO screen left, Badger view 'left' screen right, one
 * ground line at 85% height, one shared scale). Beats (Prompt 2):
 *   0-3 s   stand together; ZOO blinks (~f39) and lifts his brow (f60-80).
 *   3-6 s   ZOO points to screen right (wind-up f88-92, swing f92-104, hold); Badger's head is replaced
 *           by threeQuarterRightScreen at f97 (5 frames after the swing starts), covered by a blink.
 *           Badger stands in front of ZOO in depth, so the arm's sweep passes behind his head.
 *   6-10 s  ZOO lowers the arm (f182-197) back to deadpan; Badger looks up at him (front-head breakdown f198-199,
 *           upLeftScreen at f200 with an eased neck raise), holds, then judges (judge f234-242, ears f236-248, chin tilt f238-254,
 *           slow blink f252-268) and holds to the end (about 1 s).
 * No audio. Breathing on both characters is driven by the frame.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Badger} from '../../characters/badger/Badger';
import {ZooRig} from '../../characters/zoo/Zoo';
import {BRAND} from '../../characters/palette';
import type {BadgerHead, BadgerPose} from '../../characters/types';
import {blinkAt, track} from './keys';
import {BADGER_X, EASE, FRAME, GROUND_Y, PAIR_SCALE, ZOO_X} from './stage';

/** Frame numbers of the beats (30 fps). */
export const BEATS = {
	zooBlink: 38,
	browLift: [60, 67, 72, 80],
	windup: [88, 92],
	pointStart: 92,
	pointEnd: 104,
	badgerTurn: 97,
	badgerBlink: 94,
	armDown: [182, 197],
	zooBlink2: 184,
	badgerLookUp: 200,
	judge: [234, 242],
	ears: [236, 248],
	tilt: [238, 254],
	slowBlink: 252,
} as const;

const zooTrack = (f: number) => ({
	blink: Math.max(blinkAt(f, BEATS.zooBlink, 2, 1, 3, EASE.inOut), blinkAt(f, BEATS.zooBlink2, 2, 1, 3, EASE.inOut)),
	browLift: track(
		f,
		[
			[BEATS.browLift[0], 0],
			[BEATS.browLift[1], 1],
			[BEATS.browLift[2], 1],
			[BEATS.browLift[3], 0],
		],
		EASE.inOut,
	),
	// The eyes lead the gesture, then return to camera with the arm.
	lookX: track(
		f,
		[
			[85, 0],
			[90, 0.75],
			[BEATS.armDown[0], 0.75],
			[BEATS.armDown[0] + 8, 0],
		],
		EASE.inOut,
	),
	// A small counter-tilt (anticipation), then a slight lean of the head into the point.
	headTilt: track(
		f,
		[
			[85, 0],
			[BEATS.windup[1], -1.2],
			[BEATS.pointEnd + 2, 1.4],
			[BEATS.armDown[0], 1.4],
			[BEATS.armDown[1], 0],
		],
		EASE.inOut,
	),
	pointWindup: track(
		f,
		[
			[BEATS.windup[0], 0],
			[BEATS.windup[1], 1],
			[BEATS.windup[1] + 6, 0],
		],
		EASE.inOut,
	),
	poseAmount:
		f < BEATS.armDown[0]
			? track(
					f,
					[
						[BEATS.pointStart, 0],
						[BEATS.pointEnd, 1],
					],
					EASE.gesture,
				)
			: track(
					f,
					[
						[BEATS.armDown[0], 1],
						[BEATS.armDown[1], 0],
					],
					EASE.inOut,
				),
});

type BadgerState = {
	head: BadgerHead;
	pose: BadgerPose;
	blink: number;
	headTilt: number;
	neckTurn: number;
	judge: number;
	earsBack: number;
	lookX: number;
	lookY: number;
};

const badgerTrack = (f: number): BadgerState => {
	const blink = Math.max(blinkAt(f, BEATS.badgerBlink, 2, 2, 3, EASE.inOut), blinkAt(f, BEATS.slowBlink, 5, 3, 8, EASE.inOut));
	const judge = track(
		f,
		[
			[BEATS.judge[0], 0],
			[BEATS.judge[1], 1],
		],
		EASE.inOut,
	);
	const earsBack = track(
		f,
		[
			[BEATS.ears[0], 0],
			[BEATS.ears[1], 0.25],
		],
		EASE.inOut,
	);
	if (f < BEATS.badgerTurn) {
		return {head: 'front', pose: 'stand', blink, headTilt: 0, neckTurn: 0, judge: 0, earsBack: 0, lookX: 0, lookY: 0};
	}
	if (f < BEATS.badgerLookUp) {
		// Head replacement toward the gesture with a tiny settle; the neck starts to rise just before the look-up.
		const headTilt = track(
			f,
			[
				[BEATS.badgerTurn, 1.6],
				[BEATS.badgerTurn + 6, -0.4],
				[BEATS.badgerTurn + 12, 0],
			],
			EASE.inOut,
		);
		const neckTurn = track(
			f,
			[
				[BEATS.badgerLookUp - 7, 0],
				[BEATS.badgerLookUp, 4],
			],
			EASE.in,
		);
		// Two-frame breakdown through the front head (eyes already travelling up toward ZOO) before the look-up,
		// so the replacement turns through camera instead of popping from screen right to up-left.
		if (f >= BEATS.badgerLookUp - 2) {
			return {head: 'front', pose: 'stand', blink, headTilt: 0, neckTurn, judge: 0, earsBack: 0, lookX: -0.4, lookY: -0.6};
		}
		return {head: 'threeQuarterRightScreen', pose: 'stand', blink, headTilt, neckTurn, judge: 0, earsBack: 0, lookX: 0.3, lookY: 0};
	}
	// Look up at ZOO: upLeftScreen mounts the neck 13 deg higher than the 3/4 head; ease that rise in.
	const neckTurn = track(
		f,
		[
			[BEATS.badgerLookUp, -9],
			[BEATS.badgerLookUp + 7, 0.8],
			[BEATS.badgerLookUp + 12, 0],
		],
		EASE.out,
	);
	const headTilt = track(
		f,
		[
			[BEATS.tilt[0], 0],
			[BEATS.tilt[1], -4],
		],
		EASE.inOut,
	);
	return {head: 'upLeftScreen', pose: 'lookUp', blink, headTilt, neckTurn, judge, earsBack, lookX: 0, lookY: 0};
};

export const Preview10s: React.FC = () => {
	const frame = useCurrentFrame();
	const z = zooTrack(frame);
	const b = badgerTrack(frame);
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			<svg width={FRAME.width} height={FRAME.height} viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}>
				<line x1={0} y1={GROUND_Y + 1.5} x2={FRAME.width} y2={GROUND_Y + 1.5} stroke={BRAND.silver} strokeWidth={3} />
				<ZooRig
					x={ZOO_X}
					y={GROUND_Y}
					scale={PAIR_SCALE}
					view="front"
					pose="point"
					poseAmount={z.poseAmount}
					pointWindup={z.pointWindup}
					expression="neutral"
					blink={z.blink}
					browLift={z.browLift}
					lookX={z.lookX}
					headTilt={z.headTilt}
				/>
				{/* Badger is drawn in front of ZOO: the pointing arm's sweep passes BEHIND his head (decision INT-P2). */}
				<Badger
					x={BADGER_X}
					y={GROUND_Y}
					scale={PAIR_SCALE}
					view="left"
					pose={b.pose}
					head={b.head}
					expression="neutral"
					blink={b.blink}
					judge={b.judge}
					earsBack={b.earsBack}
					headTilt={b.headTilt}
					neckTurn={b.neckTurn}
					lookX={b.lookX}
					lookY={b.lookY}
				/>
			</svg>
		</AbsoluteFill>
	);
};
