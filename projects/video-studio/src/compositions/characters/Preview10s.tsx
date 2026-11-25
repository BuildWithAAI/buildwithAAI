/**
 * Preview10s: the 10-second character proof (1920x1080, 30 fps, 300 frames, silent, #E6E8EB).
 * Staging reproduces the size-comparison panel (Zoo screen left, Badger view 'left' screen right, one ground line at
 * 85% height, one shared scale; spacing per decision INT-P2), with a flat contact shadow under each character
 * (decision INT-C1). Beats (Prompt 2), re-timed in integration rounds 1-4:
 *   0-3 s   stand together. Zoo blinks (f38) and lifts one brow (f60-82). Badger leans his head slightly toward Zoo as in
 *           the panel, blinks (f22) and flicks his ears (f68-76).
 *   3-6 s   Zoo points to screen right: eyes lead (f84-89), wind-up (f85-90), swing f90-106 timed along the hand's arc
 *           (gesture.ts, decision INT-T1), a 1-2 deg settle (f106-113), then a moving hold (f113-181, decision INT-T2):
 *           the raised arm sinks ~0.08 poseAmount on one slow ease (the hand drops ~8 px) and Zoo gives one small nod
 *           toward the point with a blink (f124-142). The anticipation tuck is passed only on the raise (INT-T3); the rig's
 *           upper-arm lead (ZOO-P6) keeps the elbow out at least 0.3 x the forearm's swing on the way up and down, so no
 *           frame carries the forearm level with the elbow at the waist (25-29 deg out at the level crossings f98-99 and
 *           f186). Badger's eyes follow the hand (f89-94) and close as the fist passes over his head; his head is
 *           replaced by threeQuarterRightScreen at f97 under that blink, entering low and nose-down where the front head
 *           left the skull, then his neck and gaze rise along the point (f97-112). After Zoo's nod he answers with a
 *           small curious head tilt (f140-180) and one blink (f158).
 *   6-10 s  Zoo lowers the arm (f181-197, no tuck) back to deadpan. Badger looks up at him: eyes and neck lead (f183-190);
 *           with his eyes closed (blink f188-199) the head turns through two held in-betweens, the front head (f190-192)
 *           and the 3/4-left head with its nose lifting (f193-194), to upLeftScreen (f195), then the neck eases up
 *           (decision INT-A2). After a beat he gives the judging look: the neck eases down on the up head (f234-240) as a
 *           slow blink closes, and with the eyes closed the head turns through a held threeQuarterLeftScreen in-between
 *           (f241-243) to the front head (f244); the eyes open on Zoo, the brows flatten, the ears fold and the head tilts
 *           about 8 deg. Zoo blinks once (f264) and the shot holds to the end.
 *           One slow push-in (1.00 -> 1.04, f196-299, ART_GUIDE MO13) anchored on Badger's eyes carries the attention.
 * No audio: the proof is silent. Breathing on both characters is driven by the frame.
 * zooTrack and badgerTrack are exported so tools can rebuild any frame's character props (clearance checks, QA).
 */
import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame} from 'remotion';
import {Badger} from '../../characters/badger/Badger';
import {ZooRig} from '../../characters/zoo/Zoo';
import {BRAND} from '../../characters/palette';
import type {BadgerHead, BadgerPose} from '../../characters/types';
import {ContactShadow, FOOTPRINTS} from './contact';
import {pointPath} from './gesture';
import {blinkAt, track} from './keys';
import {BADGER_X, EASE, FRAME, GROUND_Y, PAIR_LINE_SCALE, PAIR_SCALE, ZOO_X} from './stage';

/** Frame numbers of the beats (30 fps). */
export const BEATS = {
	zooBlinks: [38, 125, 186, 264],
	browLift: [60, 67, 74, 82],
	eyesLead: [84, 89],
	windup: [85, 90, 96],
	swing: [90, 106],
	settle: [106, 113],
	hold: [113, 181],
	/** Zoo's nod toward the point inside the moving hold: down to the deepest tilt, back up. */
	zooNod: [124, 131, 142],
	armDown: [181, 197],
	badgerBlink: 22,
	badgerEarFlick: [68, 70, 76],
	badgerTurn: 97,
	badgerTurnBlink: 94,
	/** Badger's curious tilt in answer to the nod: in, held, out. */
	badgerTilt: [140, 152, 168, 180],
	badgerHoldBlink: 158,
	/**
	 * Look-up: eyes lead, the blink closes, the front breakdown is held f190-192 (3 frames), the 3/4-left head with its nose
	 * lifting f193-194 (2 frames), the up head from f195 (decision INT-A2).
	 */
	badgerLookUp: {eyes: [183, 188], blink: 188, toFront: 190, toThreeQuarter: 193, toUp: 195},
	/**
	 * Judging look: the neck eases down on the up head (neckDown), the slow blink closes, the 3/4-left in-between holds
	 * f241-243 (3 frames), the front head arrives at `swap` with the eyes still closed, then brows, ears and tilt.
	 */
	judge: {neckDown: [234, 240], blink: 236, toThreeQuarter: 241, swap: 244, brows: [246, 256], ears: [247, 259], tilt: [245, 263]},
	pushIn: [196, 299],
} as const;

/**
 * The single camera move of the shot (ART_GUIDE MO13): a slow push-in over the look-up and the judging look, eased in and
 * out with a sine, anchored on Badger's eyes so his face stays put while the frame tightens on it. Float transform, never
 * rounded. Relative scale is untouched (both characters are inside the same group).
 */
export const PUSH = {to: 1.04, anchor: {x: BADGER_X - 130, y: GROUND_Y - 360}} as const;
export const pushScale = (f: number) =>
	track(
		f,
		[
			[BEATS.pushIn[0], 1],
			[BEATS.pushIn[1], PUSH.to],
		],
		Easing.inOut(Easing.sin),
	);

/**
 * Poses of the point gesture, as poseAmount. The swing ends past the hold pose and settles back 1-2 deg (`settle`); the
 * moving hold then lets the raised arm sink to `sunk` on one slow sine ease (decision INT-T2). Near the end key the
 * shoulder and wrist carry that change (~3 deg each; the elbow stays put), so the hand drops ~8 px at the proof scale
 * (round 1 drifted 0.008, under 2 px, and the gesture froze; round 4: 0.93 -> 0.91, because the rig's upper-arm lead
 * moved less of the drop into the shoulder).
 * The anticipation tuck (ZooRig pointTuck, the rig's elbow gather while the arm rises; decision INT-T3) is passed only on
 * the raise: full up to poseAmount tuckRelease[0], released by tuckRelease[1], 0 through the hold and the lowering (the
 * rig would play it in reverse). Since repair round 4 the rig's upper-arm lead (ZOO-P6: abduction >= 0.3 x the forearm's
 * swing) sets the upper arm on every frame of this raise, so the tuck no longer changes an angle here (identical joint
 * angles with pointTuck 1 and 0 on f88-104); the contract stays for scenes with other timings. The lowering takes 16
 * frames like the raise; both are timed on the arc-length table of the path the rig actually draws (gesture.ts
 * pointPath), so the hand peaks at ~48 px/frame both ways.
 */
export const POINT = {overshoot: 1, settle: 0.993, sunk: 0.91, tuckRelease: [0.165, 0.205]} as const;
const holdEase = Easing.inOut(Easing.sin);
const smoothstep = (t: number) => {
	const x = Math.max(0, Math.min(1, t));
	return x * x * (3 - 2 * x);
};
/** pointTuck on the raise as a function of poseAmount (INT-T3). */
export const raiseTuck = (poseAmount: number) => 1 - smoothstep((poseAmount - POINT.tuckRelease[0]) / (POINT.tuckRelease[1] - POINT.tuckRelease[0]));
const RAISE_PATH = pointPath(raiseTuck);
const LOWER_PATH = pointPath(0);

/** poseAmount of the point at frame f: swing along the arc, settle, moving hold, then the same arc back down. */
const pointAmount = (f: number): number => {
	const [s0, s1] = BEATS.swing;
	const [h0, h1] = BEATS.hold;
	const [d0, d1] = BEATS.armDown;
	if (f < s1) {
		// Arc-length timing: the hand's on-screen speed follows EASE.swing (peak ~45 px/frame at the proof scale).
		return RAISE_PATH.poseAmountForPath(EASE.swing(Math.max(0, Math.min(1, (f - s0) / (s1 - s0)))));
	}
	if (f < h0) {
		return track(
			f,
			[
				[BEATS.settle[0], POINT.overshoot],
				[BEATS.settle[1], POINT.settle],
			],
			EASE.inOut,
		);
	}
	if (f < d0) {
		return track(
			f,
			[
				[h0, POINT.settle],
				[h1, POINT.sunk],
			],
			holdEase,
		);
	}
	// Lower along the same arc from wherever the hold left the arm (velocity is zero at both ends of the hold ease).
	const u0 = LOWER_PATH.pathForPoseAmount(POINT.sunk);
	return LOWER_PATH.poseAmountForPath(u0 * (1 - EASE.swing(Math.max(0, Math.min(1, (f - d0) / (d1 - d0))))));
};

export const zooTrack = (f: number) => {
	const [d0, d1] = BEATS.armDown;
	const [n0, n1, n2] = BEATS.zooNod;
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
		// Anticipation counter-tilt, a lean into the point, one small nod toward it (~1.7 deg, with the blink that
		// starts it), a slow drift through the rest of the hold, back to level with the arm.
		headTilt: track(
			f,
			[
				[BEATS.eyesLead[0], 0],
				[BEATS.windup[1], -1.2],
				[BEATS.swing[1], 1.4],
				[n0, 1.6],
				[n1, 3.3],
				[n2, 1.5],
				[168, 1.8],
				[d0, 1.6],
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
		// The anticipation tuck belongs to the raise (INT-T3), never the hold or the lowering (the rig would play it in
		// reverse). With the rig's upper-arm lead (ZOO-P6) it changes no angle on this raise; see POINT.
		pointTuck: f < BEATS.swing[1] ? raiseTuck(pointAmount(f)) : 0,
		poseAmount: pointAmount(f),
	};
};

export type BadgerState = {
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

/**
 * Neck values at the head swaps, chosen so the skull stays as close as it can to where the old head left it (measured on
 * Badger-only renders: the centroid of the skull's top 70 px of coat and of the head's top 120 px; integration rounds
 * 3-5). Round 5 re-tuned them for the rescaled heads (BADGER-D55: front x0.90, 3/4 x0.95). Two limits shape the values:
 * - The 3/4-right head sits on the left body about 10 px higher than the front head at any neck and tilt (its mount,
 *   LEFT_HEAD_MOUNT.threeQuarterRightScreen dy 16 against the front head's 25, plus the drawings), and neck and tilt move
 *   the skull mostly sideways, so the two swaps with that head (f97, f190) keep a ~9-10 px skull move; f97 enters the
 *   3/4 head low and nose-down and lets it rise with the point instead of popping up 12 px.
 * - On the left rig a neckTurn of about 2.5-5 deg (up to ~6.5 under the push-in; and below -13) opens 1-2 px of the
 *   neck's back corner at the collar (an open seam in rigLeft.ts, reported by the round-5 Badger repair), so the front
 *   and 3/4-left heads never hold or pass through that band here.
 */
export const SWAP = {
	/** 3/4-right head entering at the turn (f97): low and nose-down where the front head left the skull, then it rises. */
	threeQuarterRightIn: {neck: -3, tilt: -4},
	/** 3/4-right head, end of its rise before the look-up (f190). */
	threeQuarterRight: 8,
	/**
	 * Front breakdown of the look-up (neck, headTilt; + = up / nose up on this body): it starts under the 3/4 head's
	 * skull with a counter-tilt and rolls toward Zoo.
	 */
	breakdown: {neck: [14, 10], tilt: [-8, 6]},
	/**
	 * The look-up's 3/4-left in-between (round 4): it enters where the front breakdown left the skull and, round 5, rises
	 * on the neck toward the up head (9 -> 13 deg) while its tilt eases (2 -> -0.5), so the head still lifts (total 11 ->
	 * 12.5) and the up head's higher skull is met halfway.
	 */
	lookUpThreeQuarter: {neck: [9, 13], tilt: [2, -0.5]},
	/** The up head enters where the in-between left the skull and the neck eases up from here (round 5: -1.5, was -1). */
	upStart: -1.5,
	/**
	 * Judging look: the up head lowers to `upDown` (round 4: -12, was -8, so its nose comes down ~12 px more before the
	 * swap), then the 3/4-left in-between and the front head take over.
	 */
	upDown: -12,
	/**
	 * The in-between starts where the lowered up head left the skull and lifts its nose toward the front head's (round 5:
	 * neck 2, below the band; tilt -3 -> 6, which brings its skull 1.5 px nearer the up head's than round 4's (-1, 3)).
	 */
	threeQuarterLeft: {neck: [2, 2], tilt: [-3, 6]},
	/**
	 * Front head: neck and total head rotation (neck + headTilt) at the swap, then the judging pose. Round 5: the front
	 * head enters at neck 7.5, above the band (it reaches ~6.5 deg under the push-in), with total 10, so the judging rise
	 * (to neck 10) never crosses it; round 4 entered at neck 1, total 13.
	 */
	front: {neck: 7.5, total: 10},
	judge: {neck: 10, total: 8.5},
} as const;

export const badgerTrack = (f: number): BadgerState => {
	const LU = BEATS.badgerLookUp;
	const J = BEATS.judge;
	const blink = Math.max(
		blinkAt(f, BEATS.badgerBlink, 2, 1, 3, EASE.inOut),
		blinkAt(f, BEATS.badgerTurnBlink, 2, 3, 3, EASE.inOut),
		blinkAt(f, BEATS.badgerHoldBlink, 2, 1, 3, EASE.inOut),
		// The look-up blink holds the eyes closed across the front breakdown and the up head's first frame.
		blinkAt(f, LU.blink, 2, LU.toUp - LU.blink - 2, 4, EASE.inOut),
		// The judging look's slow blink: deliberate close, held across both swaps, a slow open on the front head.
		blinkAt(f, J.blink, J.toThreeQuarter - J.blink, J.swap + 1 - J.toThreeQuarter, 8, EASE.inOut),
	);
	if (f < BEATS.badgerTurn) {
		// The panel's slight lean toward Zoo (front head, +3 deg); an ear flick during Zoo's brow lift; the eyes start to
		// follow the hand as the gesture begins and the lean relaxes; they close as the fist swings over his head.
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
		// After Zoo's nod, a small curious tilt; before the look-up the eyes swing toward Zoo and the neck leads.
		const [t0, t1, t2, t3] = BEATS.badgerTilt;
		const headTilt = track(
			f,
			[
				[BEATS.badgerTurn, SWAP.threeQuarterRightIn.tilt],
				[BEATS.badgerTurn + 7, 0.6],
				[BEATS.badgerTurn + 13, 0],
				[t0, 0],
				[t1, 2.5],
				[t2, 2.5],
				[t3, 0],
			],
			EASE.inOut,
		);
		const neckTurn = track(
			f,
			[
				[BEATS.badgerTurn, SWAP.threeQuarterRightIn.neck],
				[112, 5],
				[LU.eyes[0], 5],
				[LU.toFront, SWAP.threeQuarterRight],
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
	if (f < LU.toThreeQuarter) {
		// Breakdown through the front head with the eyes closed, held 3 frames and rolling toward Zoo, so the turn from
		// the 3/4 head (looking away) toward Zoo reads as a turn through camera, not a pop.
		const k = [LU.toFront, LU.toThreeQuarter - 1] as const;
		const neckTurn = track(
			f,
			[
				[k[0], SWAP.breakdown.neck[0]],
				[k[1], SWAP.breakdown.neck[1]],
			],
			EASE.inOut,
		);
		const headTilt = track(
			f,
			[
				[k[0], SWAP.breakdown.tilt[0]],
				[k[1], SWAP.breakdown.tilt[1]],
			],
			EASE.inOut,
		);
		return {head: 'front', pose: 'stand', blink, headTilt, neckTurn, judge: 0, earsBack: 0, lookX: -0.4, lookY: -0.6};
	}
	if (f < LU.toUp) {
		// Second in-between, eyes still closed: the 3/4-left head with its nose lifting, so the face keeps turning toward
		// Zoo and starts to rise before the pitched-up profile takes over (decision INT-A2, round 4).
		const k = [LU.toThreeQuarter, LU.toUp - 1] as const;
		const neckTurn = track(
			f,
			[
				[k[0], SWAP.lookUpThreeQuarter.neck[0]],
				[k[1], SWAP.lookUpThreeQuarter.neck[1]],
			],
			EASE.inOut,
		);
		const headTilt = track(
			f,
			[
				[k[0], SWAP.lookUpThreeQuarter.tilt[0]],
				[k[1], SWAP.lookUpThreeQuarter.tilt[1]],
			],
			EASE.inOut,
		);
		return {head: 'threeQuarterLeftScreen', pose: 'stand', blink, headTilt, neckTurn, judge: 0, earsBack: 0, lookX: -0.6, lookY: -0.6};
	}
	if (f < J.toThreeQuarter) {
		// Looking up at Zoo: the up head starts where the in-between left the skull, and the neck eases up as the eyes
		// open. After the beat the neck eases back down (the nose comes down toward level) as the slow blink closes.
		const neckTurn =
			f < J.neckDown[0]
				? track(
						f,
						[
							[LU.toUp, SWAP.upStart],
							[LU.toUp + 9, 0.8],
							[LU.toUp + 14, 0],
						],
						EASE.out,
					)
				: track(
						f,
						[
							[J.neckDown[0], 0],
							[J.neckDown[1], SWAP.upDown],
						],
						EASE.inOut,
					);
		return {head: 'upLeftScreen', pose: 'lookUp', blink, headTilt: 0, neckTurn, judge: 0, earsBack: 0, lookX: 0, lookY: 0};
	}
	if (f < J.swap) {
		// In-between of the judging turn, eyes closed: the 3/4-left head (face turning from Zoo toward camera), held 3
		// frames and still settling, so the profile-up to front change reads as a head turn.
		const t = [J.toThreeQuarter, J.swap - 1] as const;
		const neckTurn = track(
			f,
			[
				[t[0], SWAP.threeQuarterLeft.neck[0]],
				[t[1], SWAP.threeQuarterLeft.neck[1]],
			],
			EASE.inOut,
		);
		const headTilt = track(
			f,
			[
				[t[0], SWAP.threeQuarterLeft.tilt[0]],
				[t[1], SWAP.threeQuarterLeft.tilt[1]],
			],
			EASE.inOut,
		);
		return {head: 'threeQuarterLeftScreen', pose: 'stand', blink, headTilt, neckTurn, judge: 0, earsBack: 0, lookX: -0.6, lookY: -0.5};
	}
	// The judging look, on the frontal head so the lids and brows read: eyes stay on Zoo (side-eye), the brows flatten,
	// the ears fold a little and the head tilts ~8 deg. The neck rises from where the 3/4 head held the cranium.
	const neckTurn = track(
		f,
		[
			[J.swap, SWAP.front.neck],
			[J.tilt[1], SWAP.judge.neck],
		],
		EASE.inOut,
	);
	const totalTilt = track(
		f,
		[
			[J.swap, SWAP.front.total],
			[J.tilt[0], SWAP.front.total],
			[J.tilt[1], SWAP.judge.total],
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
					{/* The ground line, then a flat contact shadow over it under each character (INT-C1), then the characters. */}
					<line x1={-200} y1={GROUND_Y + 1.5} x2={FRAME.width + 200} y2={GROUND_Y + 1.5} stroke={BRAND.silver} strokeWidth={3} />
					<ContactShadow x={ZOO_X} y={GROUND_Y} scale={PAIR_SCALE} print={FOOTPRINTS.zooFront} />
					<ContactShadow x={BADGER_X} y={GROUND_Y} scale={PAIR_SCALE} print={FOOTPRINTS.badgerLeft} />
					<ZooRig
						x={ZOO_X}
						y={GROUND_Y}
						scale={PAIR_SCALE}
						lineScale={PAIR_LINE_SCALE}
						view="front"
						pose="point"
						poseAmount={z.poseAmount}
						pointWindup={z.pointWindup}
						pointTuck={z.pointTuck}
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
