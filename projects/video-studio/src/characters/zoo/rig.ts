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
	eyeSpacing: 46, // eye centre to eye centre
	eyeLine: -816.5,
	mouthLine: -768.3,
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
	jaw: {x: 0, y: -768.3, parent: 'head', note: 'mouth anchor; mouth shapes and chin-beard drop are measured from here'},
	eyeL: {x: 23.2, y: -816.5, parent: 'head', note: 'anatomical left eye (screen right)'},
	eyeR: {x: -23.2, y: -816.5, parent: 'head', note: 'anatomical right eye (screen left)'},
	browL: {x: 25, y: -834, parent: 'head', note: 'anatomical left brow (screen right); sits higher at rest'},
	browR: {x: -24, y: -831, parent: 'head', note: 'anatomical right brow (screen left)'},
	shoulderL: {x: 100, y: -672, parent: 'torso', note: 'anatomical left shoulder (screen right)'},
	elbowL: {x: 122.5, y: -534, parent: 'shoulderL', note: ''},
	wristL: {x: 118.6, y: -420, parent: 'elbowL', note: ''},
	shoulderR: {x: -100, y: -672, parent: 'torso', note: 'anatomical right shoulder (screen left)'},
	elbowR: {x: -122.5, y: -534, parent: 'shoulderR', note: ''},
	wristR: {x: -118.6, y: -420, parent: 'elbowR', note: ''},
};

/**
 * Arm joint angles are DELTAS from the rest pose in degrees (SVG rotate convention: negative turns
 * counter-clockwise on screen). Values are for the anatomical LEFT arm (screen right). The
 * anatomical right arm uses the negated values about its mirrored pivots.
 * Point targets measured from zoo_pose_point.png: upper arm swings out ~30 deg from vertical,
 * forearm rises to ~43 deg above horizontal, index finger points slightly above horizontal.
 */
export type ArmAngles = {shoulder: number; elbow: number; wrist: number};
export const ARM_REST: ArmAngles = {shoulder: 0, elbow: 0, wrist: 0};
export const ARM_POINT: ArmAngles = {shoulder: -36, elbow: -107, wrist: 21};
/**
 * Anticipation for the point (optional prop `pointWindup` 0..1, added for the v1 preview): before the
 * arm swings out, the hand draws in slightly toward the hip and the wrist cocks. Deltas at windup 1.
 * Positive shoulder/elbow = clockwise = toward the body for the anatomical-left arm.
 */
export const ARM_POINT_WINDUP: ArmAngles = {shoulder: 3, elbow: 6, wrist: -8};
/**
 * In-between key of the point gesture at poseAmount 0.5 (integration decision INT-Z3, 2026-11-24): the elbow stays
 * in at the side while the forearm lifts and the hand trails at the wrist (drag); then the upper arm opens and the
 * hand follows through into the point. Badger stands beside ZOO's hand, and a straight sideways swing passed through
 * his head; this path keeps the hand above head height before it travels right (it clears a dog whose ground point
 * is >= 554 units to screen right at any scale, checked numerically on the joint chain).
 */
export const ARM_POINT_MID: ArmAngles = {shoulder: 6, elbow: -125, wrist: 75};
/** poseAmount at which the hand swaps from relaxed to pointing (the index is then near horizontal, not pointing down). */
export const POINT_HAND_SWITCH = 0.75;
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

/** Idle breathing: 1.5 units rise of the shoulders, period 3.5 s. */
export const BREATH = {amplitude: 1.5, periodSeconds: 3.5} as const;
export const breathOffset = (frame: number, fps: number) => {
	const t = frame / (BREATH.periodSeconds * fps);
	return -BREATH.amplitude * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
};

/** Brow controls (units). inner/outer raise the ends; arch bows the middle; lift moves the whole brow. */
export type BrowPose = {lift: number; inner: number; outer: number; arch: number};
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

/** Expressions measured from zoo_expr_*.png. Restrained and adult. */
export const EXPRESSIONS: Record<Expression, ExpressionSpec> = {
	// Deadpan: flat straight mouth; the anatomical-left (screen-right) brow is subtly raised in its base shape.
	neutral: {browL: B0, browR: B0, eyes: E0, mouth: 'closed', mod: MOD0, crease: 0},
	// Small asymmetric smirk: screen-right mouth corner and moustache lift; slight lower-lid squint.
	happy: {
		browL: {lift: 2.6, inner: 0, outer: 0.4, arch: 0.6},
		browR: {lift: 2.2, inner: 0.4, outer: 0, arch: 0.4},
		eyes: {lidTop: 0.2, lidBottom: 1.1, scale: 1, iris: 1},
		mouth: 'closed',
		mod: {...MOD0, cornerL: 1.4, cornerR: 6.4, moustacheLiftR: 3.4},
		crease: 0,
	},
	// Worried: inner brow ends up, outer ends down, eyes a touch wider, mouth slightly downturned.
	worried: {
		browL: {lift: -0.6, inner: 4.6, outer: -1.8, arch: 0},
		browR: {lift: 1.0, inner: 4.8, outer: -1.6, arch: 0},
		eyes: {lidTop: 0.7, lidBottom: 0, scale: 1, iris: 0.96},
		mouth: 'closed',
		mod: {...MOD0, cornerL: -1.3, cornerR: -1.1, wave: 0.7},
		crease: 1,
	},
	// Shocked: brows high, eyes wide with smaller irises, medium open mouth.
	shocked: {
		browL: {lift: 6.0, inner: 0.6, outer: 0, arch: 2.4},
		browR: {lift: 7.4, inner: 0.6, outer: 0, arch: 2.6},
		eyes: {lidTop: 4.2, lidBottom: -1.8, scale: 1.1, iris: 0.72},
		mouth: 'ah',
		mod: {...MOD0, openScale: 0.7, widthScale: 0.82},
		crease: 0,
	},
};
