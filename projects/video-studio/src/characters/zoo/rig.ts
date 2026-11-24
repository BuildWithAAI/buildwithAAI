/**
 * ZOO front-view rig constants. All coordinates are WORLD UNITS at scale 1 in the rig's root space
 * (origin = ground contact point between the feet, y grows downward). Every part is authored in
 * this root space at its rest position, so a part's own coordinate space equals root space at rest
 * and each pivot below is valid in both. Measured from reference/crops/zoo_turn_front.png
 * (630 px figure = 900 units, 1 px = 1.4286 u) and zoo_expr_neutral.png (1 px = 0.699 u).
 *
 * Anatomical LEFT = screen RIGHT (+x) in the front view. Part names ending in L / R are anatomical.
 */
import type {Expression} from '../types';
import {clamp01, lerp, smoothstep} from './geometry';

export const FRONT = {
	totalHeight: 900, // sole (y=0) to top of hair (y=-900)
	headTop: -900,
	chin: -740, // bottom of the beard at the chin
	headHeight: 160, // hair top to chin
	headsTall: 900 / 160, // 5.63
	faceWidth: 87, // outer edge to outer edge of the outline at cheekbone level
	headWidthWithHair: 157, // lower-left wing tip to right tuft tip
	neckWidth: 56,
	shoulderWidth: 246, // outer edge of left deltoid to outer edge of right deltoid
	waistHem: -420, // overshirt hem
	hipWidth: 160, // trouser outer edges at the hip
	crotch: -392,
	legLength: 392, // crotch to sole
	trouserHem: -54,
	upperArm: 140, // shoulder pivot to elbow pivot
	forearm: 114, // elbow pivot to wrist pivot
	handLength: 96, // wrist pivot to fingertips (relaxed)
	handWidth: 48, // thumb to little-finger edge (relaxed, front view)
	shoeWidth: 90, // front-view width of one sneaker, outline included
	eyeSpacing: 44.4, // eye-shape centre to eye-shape centre (iris centres 42 u apart; sheet 41-42.5, repair round 1)
	eyeLine: -816.5,
	mouthLine: -769.6, // closed-mouth line (repair round 1: raised 1.3 u to the sheet's gap under the moustache)
} as const;

export type PivotName =
	| 'root'
	| 'legs'
	| 'torso'
	| 'neck'
	| 'head'
	| 'jaw'
	| 'eyeL'
	| 'eyeR'
	| 'browL'
	| 'browR'
	| 'shoulderL'
	| 'elbowL'
	| 'wristL'
	| 'shoulderR'
	| 'elbowR'
	| 'wristR';

export const PIVOTS: Record<PivotName, {x: number; y: number; parent: PivotName | null; note: string}> = {
	root: {x: 0, y: 0, parent: null, note: 'ground contact point; placement x/y/scale apply here'},
	legs: {x: 0, y: -392, parent: 'root', note: 'static in the front view (crotch)'},
	torso: {x: 0, y: -420, parent: 'root', note: 'breathing scale origin at the hem; upper body rides on it'},
	neck: {x: 0, y: -716, parent: 'torso', note: 'base of the neck at the tee neckline'},
	head: {x: 0, y: -748, parent: 'neck', note: 'headTilt rotates the whole head here'},
	jaw: {x: 0, y: -769.6, parent: 'head', note: 'mouth anchor; mouth shapes and chin-beard drop are measured from here'},
	eyeL: {x: 22.2, y: -816.5, parent: 'head', note: 'anatomical left eye (screen right); iris centre x 21.0'},
	eyeR: {x: -22.2, y: -816.5, parent: 'head', note: 'anatomical right eye (screen left); iris centre x -21.0'},
	browL: {x: 25, y: -834, parent: 'head', note: 'anatomical left brow (screen right); sits higher at rest'},
	browR: {x: -24, y: -831, parent: 'head', note: 'anatomical right brow (screen left)'},
	shoulderL: {x: 100, y: -672, parent: 'torso', note: 'anatomical left shoulder (screen right)'},
	elbowL: {x: 111.5, y: -534, parent: 'shoulderL', note: 'sleeve centre at the elbow (repair round 2: was 122.5, near the outer edge)'},
	wristL: {x: 113.8, y: -420, parent: 'elbowL', note: 'cuff bottom centre (repair round 2: the cuff spans 98.2..129.4 between path edges)'},
	shoulderR: {x: -100, y: -672, parent: 'torso', note: 'anatomical right shoulder (screen left)'},
	elbowR: {x: -111.5, y: -534, parent: 'shoulderR', note: ''},
	wristR: {x: -113.8, y: -420, parent: 'elbowR', note: 'cuff bottom centre'},
};

/**
 * Arm joint angles are DELTAS from the rest pose in degrees (SVG rotate convention: negative turns
 * counter-clockwise on screen). Values are for the anatomical LEFT arm (screen right). The
 * anatomical right arm uses the negated values about its mirrored pivots.
 * Point (repair round 1, decision ZOO-P2): zoo_pose_point.png measures upper arm ~42 deg out from vertical, forearm
 * rising ~52 deg, index ~25 deg up and ~45 u above the shoulder. On the turnaround body (shorter arm than the panel,
 * ZOO-P1) the end key below gives upper arm 43 deg, forearm 57 deg, index ~22 deg up, index tip at h ~720 (v1: 691).
 */
export type ArmAngles = {shoulder: number; elbow: number; wrist: number};
export const ARM_REST: ArmAngles = {shoulder: 0, elbow: 0, wrist: 0};
export const ARM_POINT: ArmAngles = {shoulder: -34, elbow: -117, wrist: 14};
/**
 * Anticipation for the point (optional prop `pointWindup` 0..1, added for the v1 preview): before the
 * arm swings out, the hand draws in slightly toward the hip and the wrist cocks. Deltas at windup 1.
 * Positive shoulder/elbow = clockwise = toward the body for the anatomical-left arm.
 */
export const ARM_POINT_WINDUP: ArmAngles = {shoulder: 3, elbow: 6, wrist: -8};
/**
 * In-between key of the point gesture at poseAmount 0.5 (INT-Z3, revised in repair round 1 as ZOO-P2): the elbow stays
 * tucked at the side and the forearm lifts the hand up in front of the chest with a moderate wrist drag (38 deg; v1's
 * 75 deg read as a limp "chicken wing"), then the upper arm opens and the hand extends into the point. Checked on the
 * joint chain against the proof staging (Badger 560 u away, his head front at x ~300 for h 400-465): the hand stays
 * at x <= 283 in that band (v1: 256), so it never reaches his head.
 */
export const ARM_POINT_MID: ArmAngles = {shoulder: 10, elbow: -146, wrist: 38};
/** poseAmount at which the hand swaps to the pointer: mid-swing, where the motion is fastest (v1: 0.75). */
export const POINT_HAND_SWITCH = 0.5;
/** poseAmount from which the relaxed hand is replaced by the loose fist until POINT_HAND_SWITCH (ZOO-P2). */
export const POINT_HAND_CURL = 0.28;
/**
 * pose="point" defaults (used only when the caller does not pass lookX / headTilt): the eyes and head lean toward the
 * point, scaled by poseAmount (zoo_pose_point.png angles the head toward the hand).
 */
export const POINT_LOOK = {lookX: 0.5, headTilt: 1.5} as const;
/** pose="typing" defaults (only when the caller does not pass them): eyes on the screen, head tipped toward it. */
export const TYPING_LOOK = {lookX: 0.6, lookY: 0.3, headTilt: 3} as const;
/**
 * Fraction of the left arm's shoulder angle that the overshirt's shoulder region follows (per-point weights in
 * Torso.tsx). Rotating about the shoulder pivot slides the top contour along itself and swings the side seam out with
 * the sleeve, so a raised sleeve grows out of the shoulder (ZOO-P2).
 */
export const SHOULDER_FOLLOW = 1;
/** Rotation (deg) that maps the pointing-hand drawing (index along +x) into the hand's local frame. */
export const POINT_HAND_FRAME = 110;

/**
 * Joint angles along the gesture. With an in-between key (ARM_POINT_MID for ARM_POINT) the angles follow a quadratic
 * Bezier from rest through the key at 0.5 to the target: one smooth arc with a small elbow overshoot and wrist
 * follow-through and no stop at the key. Without one: a slightly overlapping blend (shoulder leads, wrist last).
 */
export const armAnglesFor = (target: ArmAngles, amount: number, mid: ArmAngles | null = target === ARM_POINT ? ARM_POINT_MID : null): ArmAngles => {
	const a = clamp01(amount);
	if (mid) {
		const q = (m: number, t: number) => 2 * a * (1 - a) * (2 * m - t / 2) + a * a * t;
		return {shoulder: q(mid.shoulder, target.shoulder), elbow: q(mid.elbow, target.elbow), wrist: q(mid.wrist, target.wrist)};
	}
	const s = smoothstep(a / 0.85);
	const e = smoothstep((a - 0.05) / 0.85);
	const w = smoothstep((a - 0.15) / 0.85);
	return {shoulder: lerp(0, target.shoulder, s), elbow: lerp(0, target.elbow, e), wrist: lerp(0, target.wrist, w)};
};

/**
 * Idle breathing: shoulders rise `amplitude` units, period 3.5 s. Repair round 1: 1.5 -> 3 u (1.3 px at the 0.88 pair
 * scale was invisible; ART_GUIDE MO10 asks for 2-4 px of chest motion at full-body 1080p).
 */
export const BREATH = {amplitude: 3, periodSeconds: 3.5} as const;
export const breathOffset = (frame: number, fps: number) => {
	const t = frame / (BREATH.periodSeconds * fps);
	return -BREATH.amplitude * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
};

/**
 * Brow controls (units). inner/outer raise the ends; arch bows the middle; lift moves the whole brow; curl (optional)
 * is the sharp upturn of the inner end (worried panel).
 */
export type BrowPose = {lift: number; inner: number; outer: number; arch: number; curl?: number};
/**
 * browLift 0..1 -> per-side raise in units. The deadpan raise is ONE brow (Prompt 1: "subtly raised brow"): the
 * anatomical-left brow (screen right) leads and the other follows a little (repair round 1; v1 raised both by 3.5).
 */
export const BROW_LIFT = {left: 4.5, right: 1.6} as const;
/** Eye controls. lidTop > 0 opens wider; lidBottom > 0 raises the lower lid (smile squint). */
export type EyePose = {lidTop: number; lidBottom: number; scale: number; iris: number};
/** Mouth modifiers applied on top of a library shape. */
export type MouthMod = {cornerL: number; cornerR: number; openScale: number; widthScale: number; wave: number; moustacheLiftR: number};

export type ExpressionSpec = {
	browL: BrowPose; // anatomical left (screen right)
	browR: BrowPose; // anatomical right (screen left)
	eyes: EyePose;
	mouth: 'closed' | 'slightlyOpen' | 'ah' | 'ee' | 'oh' | 'mbp';
	mod: MouthMod;
	crease: number; // 0..1 worry crease between the brows
};

const B0: BrowPose = {lift: 0, inner: 0, outer: 0, arch: 0};
const E0: EyePose = {lidTop: 0, lidBottom: 0, scale: 1, iris: 1};
export const MOD0: MouthMod = {cornerL: 0, cornerR: 0, openScale: 1, widthScale: 1, wave: 0, moustacheLiftR: 0};

/** Expressions measured from zoo_expr_*.png (repair round 1 re-measure). Restrained and adult. */
export const EXPRESSIONS: Record<Expression, ExpressionSpec> = {
	// Deadpan: flat straight mouth; the anatomical-left (screen-right) brow is subtly raised in its base shape.
	neutral: {browL: B0, browR: B0, eyes: E0, mouth: 'closed', mod: MOD0, crease: 0},
	// Small asymmetric smirk: a soft closed U-smile with the screen-right corner and moustache lifting more; lower lids
	// rise (smile squint) while the upper lids stay open.
	happy: {
		browL: {lift: 2.6, inner: 0, outer: 0.4, arch: 0.6},
		browR: {lift: 2.2, inner: 0.4, outer: 0, arch: 0.4},
		eyes: {lidTop: 0.2, lidBottom: 2.4, scale: 1, iris: 1},
		mouth: 'closed',
		mod: {...MOD0, cornerL: 3.2, cornerR: 6.4, moustacheLiftR: 3.6},
		crease: 0,
	},
	// Worried (zoo_expr_worried.png): both inner ends rise ~6-7.5 u with a sharp upturn (curl), the screen-right brow's
	// arch inverts (~-4 u at its middle), the tails rise ~1.5-2 u; inner-to-tail drop >= 11 u. Mouth slightly down.
	worried: {
		browL: {lift: 0, inner: 1.5, outer: 1.4, arch: -5, curl: 5},
		browR: {lift: 0, inner: 2, outer: 2, arch: -2, curl: 5.5},
		eyes: {lidTop: 0.7, lidBottom: 0, scale: 1, iris: 0.96},
		mouth: 'closed',
		mod: {...MOD0, cornerL: -1.3, cornerR: -1.1, wave: 0.7},
		crease: 1,
	},
	// Shocked: brows high and arched, eyes wide with smaller irises, a wide open oval (ah at 60% height, 95% width).
	shocked: {
		browL: {lift: 7.6, inner: 0.6, outer: 0, arch: 3},
		browR: {lift: 8.2, inner: 0.6, outer: 0, arch: 3},
		eyes: {lidTop: 4.2, lidBottom: -1.8, scale: 1.1, iris: 0.72},
		mouth: 'ah',
		mod: {...MOD0, openScale: 0.6, widthScale: 0.95},
		crease: 0,
	},
};
