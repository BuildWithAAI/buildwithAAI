/**
 * Preview10s: the 10-second character proof (1920x1080, 30 fps, 300 frames, silent, #E6E8EB).
 * Staging reproduces the size-comparison panel (Zoo screen left, Badger view 'left' screen right, one ground line at
 * 85% height, one shared scale; spacing per decision INT-P2). Beats (Prompt 2), re-timed in integration round 1:
 *   0-3 s   stand together. Zoo blinks (f38) and lifts one brow (f60-82). Badger leans his head slightly toward Zoo as in
 *           the panel, blinks (f22) and flicks his ears (f68-76).
 *   3-6 s   Zoo points to screen right: eyes lead (f84-89), wind-up (f85-90), swing f90-106 timed along the hand's arc
 *           (gesture.ts, decision INT-T1), a 1-2 deg settle (f106-113) and a moving hold (f113-181). Badger's eyes follow
 *           the hand (f89-94); his head is replaced by threeQuarterRightScreen at f97 under a blink, then his neck and gaze
 *           rise along the point (f99-112). A small curious head tilt and one blink keep the hold alive.
 *   6-10 s  Zoo lowers the arm (f181-197) back to deadpan. Badger looks up at him: eyes and neck lead (f183-190), both
 *           head swaps (3/4 -> front -> upLeftScreen, f190/f192) happen with his eyes closed (blink f188-197), then the
 *           neck eases up. After a beat he gives the judging look: a slow blink (f236-252) covers the swap to the front
 *           head, his eyes stay on Zoo, the brows flatten, the ears fold and the head tilts about 8 deg. Zoo blinks once
 *           (f264) and the shot holds to the end. One slow push-in (1.00 -> 1.04, f196-299, ART_GUIDE MO13) anchored on
 *           Badger's eyes carries the attention to his reaction.
 * No audio: the proof is silent. Breathing on both characters is driven by the frame.
 */
import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame} from 'remotion';
import {Badger} from '../../characters/badger/Badger';
import {ZooRig} from '../../characters/zoo/Zoo';
import {BRAND} from '../../characters/palette';
import type {BadgerHead, BadgerPose} from '../../characters/types';
import {poseAmountForPath, pathForPoseAmount} from './gesture';
import {blinkAt, track} from './keys';
import {BADGER_X, EASE, FRAME, GROUND_Y, PAIR_LINE_SCALE, PAIR_SCALE, ZOO_X} from './stage';

/** Frame numbers of the beats (30 fps). */
export const BEATS = {
	zooBlinks: [38, 186, 264],
	browLift: [60, 67, 74, 82],
	eyesLead: [84, 89],
	windup: [85, 90, 96],
	swing: [90, 106],
	settle: [106, 113],
	hold: [113, 181],
	armDown: [181, 197],
	badgerBlink: 22,
	badgerEarFlick: [68, 70, 76],
	badgerTurn: 97,
	badgerTurnBlink: 94,
	badgerHoldBlink: 150,
	badgerLookUp: {eyes: [183, 188], blink: 188, toFront: 190, toUp: 192},
	judge: {blink: 236, swap: 242, brows: [244, 254], ears: [246, 258], tilt: [244, 262]},
	pushIn: [196, 299],
} as const;

/**
 * The single camera move of the shot (ART_GUIDE MO13): a slow push-in over the look-up and the judging look, eased in and
 * out with a sine, anchored on Badger's eyes so his face stays put while the frame tightens on it. Float transform, never
 * rounded. Relative scale is untouched (both characters are inside the same group).
 */
const PUSH = {to: 1.04, anchor: {x: BADGER_X - 130, y: GROUND_Y - 360}} as const;
const pushScale = (f: number) =>
	track(
		f,
		[
			[BEATS.pushIn[0], 1],
			[BEATS.pushIn[1], PUSH.to],
		],
		Easing.inOut(Easing.sin),
	);

/** Poses of the point gesture, as poseAmount: the swing ends past the hold pose and settles back (1-2 deg). */
const POINT = {overshoot: 1, hold: 0.993, drift: 0.008} as const;

const zooTrack = (f: number) => {
	const [s0, s1] = BEATS.swing;
	const [h0, h1] = BEATS.hold;
	const [d0, d1] = BEATS.armDown;
	let poseAmount: number;
	if (f < s1) {
		// Arc-length timing: the hand's on-screen speed follows EASE.swing (peak ~49 px/frame at the proof scale).
		poseAmount = poseAmountForPath(EASE.swing(Math.max(0, Math.min(1, (f - s0) / (s1 - s0)))));
	} else if (f < h0) {
		poseAmount = track(
			f,
			[
				[BEATS.settle[0], POINT.overshoot],
				[BEATS.settle[1], POINT.hold],
			],
			EASE.inOut,
		);
	} else if (f < d0) {
		// Moving hold: the elbow drifts ~2 deg (shoulder ~1 deg) and comes back over the hold (one slow cosine).
		const t = (f - h0) / (h1 - h0);
		poseAmount = POINT.hold - POINT.drift * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
	} else {
		const u0 = pathForPoseAmount(POINT.hold);
		poseAmount = poseAmountForPath(u0 * (1 - EASE.swing(Math.max(0, Math.min(1, (f - d0) / (d1 - d0))))));
	}
	return {
		blink: Math.max(...BEATS.zooBlinks.map((b) => blinkAt(f, b, 2, 1, 3, EASE.inOut))),
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
				[BEATS.eyesLead[0], 0],
				[BEATS.eyesLead[1], 0.75],
				[d0, 0.75],
				[d0 + 8, 0],
			],
			EASE.inOut,
		),
		// Anticipation counter-tilt, a lean into the point, a slow drift through the hold, back to level with the arm.
		headTilt: track(
			f,
			[
				[BEATS.eyesLead[0], 0],
				[BEATS.windup[1], -1.2],
				[s1, 1.4],
				[140, 1.9],
				[172, 1.5],
				[d0, 1.5],
				[d1, 0],
			],
			EASE.inOut,
		),
		pointWindup: track(
			f,
			[
				[BEATS.windup[0], 0],
				[BEATS.windup[1], 1],
				[BEATS.windup[2], 0],
			],
			EASE.inOut,
		),
		poseAmount,
	};
};

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
	const LU = BEATS.badgerLookUp;
	const J = BEATS.judge;
	const blink = Math.max(
		blinkAt(f, BEATS.badgerBlink, 2, 1, 3, EASE.inOut),
		blinkAt(f, BEATS.badgerTurnBlink, 2, 3, 3, EASE.inOut),
		blinkAt(f, BEATS.badgerHoldBlink, 2, 1, 3, EASE.inOut),
		blinkAt(f, LU.blink, 2, 3, 4, EASE.inOut),
		// The judging look's slow blink: deliberate close, a held beat, a slow open.
		blinkAt(f, J.blink, 5, 3, 8, EASE.inOut),
	);
	if (f < BEATS.badgerTurn) {
		// The panel's slight lean toward Zoo (front head, +3 deg); an ear flick during Zoo's brow lift; the eyes start to
		// follow the hand as the gesture begins and the lean relaxes.
		const [e0, e1, e2] = BEATS.badgerEarFlick;
		return {
			head: 'front',
			pose: 'stand',
			blink,
			headTilt: track(
				f,
				[
					[86, 3],
					[94, 0],
				],
				EASE.inOut,
			),
			neckTurn: 0,
			judge: 0,
			earsBack: track(
				f,
				[
					[e0, 0],
					[e1, 0.3],
					[e2, 0],
				],
				EASE.inOut,
			),
			lookX: track(
				f,
				[
					[89, 0],
					[94, 0.6],
				],
				EASE.inOut,
			),
			lookY: 0,
		};
	}
	if (f < LU.toFront) {
		// Looking where Zoo points: the replacement 3/4 head settles, then the neck and the gaze rise along the point.
		// A small curious tilt mid-hold; before the look-up the eyes swing toward Zoo and the neck leads.
		const headTilt = track(
			f,
			[
				[BEATS.badgerTurn, 1.6],
				[BEATS.badgerTurn + 6, -0.4],
				[BEATS.badgerTurn + 12, 0],
				[132, 0],
				[144, 2.5],
				[168, 2.5],
				[180, 0],
			],
			EASE.inOut,
		);
		const neckTurn = track(
			f,
			[
				[99, 0],
				[112, 5],
				[LU.eyes[0], 5],
				[LU.toFront, 8],
			],
			EASE.inOut,
		);
		const lookX = track(
			f,
			[
				[LU.eyes[0], 0.3],
				[LU.eyes[1], -0.6],
			],
			EASE.inOut,
		);
		const lookY = track(
			f,
			[
				[99, 0],
				[110, -0.5],
				[LU.eyes[0], -0.5],
				[LU.eyes[1], -0.6],
			],
			EASE.inOut,
		);
		return {head: 'threeQuarterRightScreen', pose: 'stand', blink, headTilt, neckTurn, judge: 0, earsBack: 0, lookX, lookY};
	}
	if (f < LU.toUp) {
		// Breakdown through the front head with the eyes closed: the neck value keeps the cranium where the 3/4 head left it.
		return {head: 'front', pose: 'stand', blink, headTilt: 0, neckTurn: 9, judge: 0, earsBack: 0, lookX: -0.4, lookY: -0.6};
	}
	if (f < J.swap) {
		// Looking up at Zoo: the up head starts where the breakdown left the cranium (neck -5), then the neck eases up.
		const neckTurn = track(
			f,
			[
				[LU.toUp, -5],
				[LU.toUp + 8, 0.8],
				[LU.toUp + 13, 0],
			],
			EASE.out,
		);
		return {head: 'upLeftScreen', pose: 'lookUp', blink, headTilt: 0, neckTurn, judge: 0, earsBack: 0, lookX: 0, lookY: 0};
	}
	// The judging look, on the frontal head so the lids and brows read: eyes stay on Zoo (side-eye), the brows flatten,
	// the ears fold a little and the head tilts ~8 deg. The neck settles from where the up head held the cranium.
	const neckTurn = track(
		f,
		[
			[J.swap, 14],
			[J.tilt[1], 10],
		],
		EASE.inOut,
	);
	const totalTilt = track(
		f,
		[
			[J.swap, 1],
			[J.tilt[0], 1],
			[J.tilt[1], 8.5],
		],
		EASE.inOut,
	);
	return {
		head: 'front',
		pose: 'stand',
		blink,
		// neckTurn also turns the head (it rides on the neck), so the head tilt is what remains of the total.
		headTilt: totalTilt - neckTurn,
		neckTurn,
		judge: track(
			f,
			[
				[J.brows[0], 0],
				[J.brows[1], 1],
			],
			EASE.inOut,
		),
		earsBack: track(
			f,
			[
				[J.ears[0], 0],
				[J.ears[1], 0.42],
			],
			EASE.inOut,
		),
		lookX: -0.6,
		lookY: -0.55,
	};
};

export const Preview10s: React.FC = () => {
	const frame = useCurrentFrame();
	const z = zooTrack(frame);
	const b = badgerTrack(frame);
	const k = pushScale(frame);
	const {x: ax, y: ay} = PUSH.anchor;
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			<svg width={FRAME.width} height={FRAME.height} viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}>
				<g transform={`translate(${ax} ${ay}) scale(${k}) translate(${-ax} ${-ay})`}>
				<line x1={-200} y1={GROUND_Y + 1.5} x2={FRAME.width + 200} y2={GROUND_Y + 1.5} stroke={BRAND.silver} strokeWidth={3} />
				<ZooRig
					x={ZOO_X}
					y={GROUND_Y}
					scale={PAIR_SCALE}
					lineScale={PAIR_LINE_SCALE}
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
				{/* Badger is drawn in front of Zoo: the pointing arm's sweep passes BEHIND his head (decision INT-P2). */}
				<Badger
					x={BADGER_X}
					y={GROUND_Y}
					scale={PAIR_SCALE}
					lineScale={PAIR_LINE_SCALE}
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
				</g>
			</svg>
		</AbsoluteFill>
	);
};
