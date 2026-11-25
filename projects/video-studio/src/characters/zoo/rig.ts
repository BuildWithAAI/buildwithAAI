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
import {HAPPY_MOUTH, SHOCKED_MOUTH, type MouthSpec} from './mouth';

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
	upperArm: 138.5, // shoulder pivot to elbow pivot (repair round 2: elbow pivot at the sleeve centre)
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
 * Point (repair round 2, decision ZOO-P4; measured on zoo_pose_point.png with a world grid): the panel's elbow is an OPEN
 * bend (~95 deg inside), the forearm rises ~42 deg, the index points almost horizontally (~3 deg up) and its tip is at
 * h ~733, ~55 u above the cuff, because the index rides on top of an upright fist. Round 1 bent the elbow to an acute
 * V (~67 deg) and tilted the index 26 deg up to reach that height, which read as an upward jab. On the turnaround arm
 * (longer than the panel's) this end key gives upper arm 49 deg out from vertical, forearm rising 48 deg, elbow ~91 deg
 * inside, index ~6 deg up and the fingertip at h ~719 with the panel-shaped pointing hand (parts/Hand.tsx).
 */
export type ArmAngles = {shoulder: number; elbow: number; wrist: number};
export const ARM_REST: ArmAngles = {shoulder: 0, elbow: 0, wrist: 0};
export const ARM_POINT: ArmAngles = {shoulder: -44, elbow: -93, wrist: 22};
/**
 * Anticipation for the point (optional prop `pointWindup` 0..1, added for the v1 preview): before the
 * arm swings out, the hand draws in slightly toward the hip and the wrist cocks. Deltas at windup 1.
 * Positive shoulder/elbow = clockwise = toward the body for the anatomical-left arm.
 */
export const ARM_POINT_WINDUP: ArmAngles = {shoulder: 3, elbow: 6, wrist: -8};
/**
 * In-between key of the point gesture at poseAmount 0.5 (repair round 2, ZOO-P4; was INT-Z3/ZOO-P2's elbow-tucked key
 * {10, -146, 38}): the upper arm is already abducted ~24 deg, so the elbow sits ~70 u OUTSIDE the overshirt's side, the
 * forearm rises ~25 deg above horizontal and the wrist is nearly straight. Round 1 kept the elbow behind the torso, so
 * only a forearm stub stuck out of the side at waist height (the "chicken wing") with the open hand drooping 45-60 deg.
 * With the monotone interpolation and POINT_OVERLAP timing in armAnglesFor the hand travels up and out without reversing.
 * Round 3: {-20, -92, 5} -> {-24, -90, 5}, re-timed with POINT_OVERLAP (searched together for the widest fist clearance
 * to Badger's head in the proof staging that still opens the upper arm >= 10 deg by the forearm's horizontal crossing).
 */
export const ARM_POINT_MID: ArmAngles = {shoulder: -24, elbow: -90, wrist: 5};
/**
 * poseAmount at which the loose fist opens into the pointer: the forearm is then ~12 deg above horizontal at chest height
 * and the index ~13 deg below horizontal, so it extends almost along the line to the target (v1: 0.75, round 1: 0.5).
 */
export const POINT_HAND_SWITCH = 0.4;
/**
 * poseAmount from which the pointing arm shows the loose fist whatever its joint angles (a backstop; repair round 4,
 * ZOO-P6). The swap from the relaxed hand is driven by the forearm's swing (POINT_FIST_SWING, pointHandFor), which closes
 * the hand at poseAmount ~0.012 on the proof track and keeps it closed on the way down until the arm is near the hang.
 * Round 2-3: 0.08, as the only rule (so the open hand came back while the forearm was still swung out on the lowering);
 * round 1: 0.28.
 */
export const POINT_HAND_CURL = 0.2;
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
 * Shape-preserving (monotone, C1) cubic through (0, 0), (0.5, m) and (1, t): Fritsch-Carlson / PCHIP tangents. Unlike a
 * quadratic through the key, it never overshoots when the key already holds most of the motion, so a joint that reaches
 * its pose early (the elbow) does not bend past it and back (repair round 2: the quadratic arc took the elbow 11 deg
 * past the end key and swung the hand out, in and out again).
 */
const monotoneThrough = (m: number, t: number, a: number): number => {
	const d0 = 2 * m;
	const d1 = 2 * (t - m);
	const sign = Math.sign;
	const mid = d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1);
	const end = (d: number, other: number) => {
		const v = (3 * d - other) / 2;
		if (sign(v) !== sign(d)) return 0;
		if (sign(d) !== sign(other) && Math.abs(v) > 3 * Math.abs(d)) return 3 * d;
		return v;
	};
	const [x0, y0, y1, m0, m1] = a <= 0.5 ? [0, 0, m, end(d0, d1), mid] : [0.5, m, t, mid, end(d1, d0)];
	const s = (a - x0) / 0.5;
	const s2 = s * s;
	const s3 = s2 * s;
	return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * 0.5 * m0 + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * 0.5 * m1;
};

/**
 * Overlapping action on the first half of a keyed gesture (repair round 2, ZOO-P4; round 3 re-timed). The elbow LEADS
 * (its curve runs on 0.5 x (2a)^elbowLead, ahead of poseAmount), the shoulder LAGS (0.5 x (2a)^shoulderLag) and, while the
 * arm RISES, first gathers the elbow in by up to `tuck` deg (sin^2 bump, gone by `tuckUntil`; armAnglesFor's `tuck`
 * option scales it), so the forearm lifts before the upper arm opens and the hand rises before it travels out. Both
 * warps meet poseAmount at 0.5, so ARM_POINT_MID is still exactly the pose at 0.5. Why: in the proof staging (decision
 * INT-P2, Badger 560 u away) an arm that opens while the forearm is still low sweeps the fist past Badger's forehead.
 * Round 3 (with ARM_POINT_MID {-24, -90, 5}): shoulderLag 2.5 -> 1.5, elbowLead 0.65 -> 0.6, tuckUntil 0.4 -> 0.32. At 2.5
 * the upper arm still hung (0-7 deg) when the forearm crossed horizontal, so for 3-4 frames the elbow stayed pinned at the
 * waist under a level forearm (a "tray-carry" in-between); now it is abducted ~10 deg at the crossing (11 deg in the proof
 * frame where the forearm is level) and opens with the forearm. The cost is fist clearance: opening the arm earlier moves
 * the fist out sooner, so in the proof staging its closest pass to Badger's head drops from ~31 to ~24 u (21 px at 0.88;
 * a grid over lag, lead, tuck and the mid key found no timing with >= 10 deg that keeps more).
 */
export const POINT_OVERLAP = {elbowLead: 0.6, shoulderLag: 1.5, tuck: 6, tuckUntil: 0.32} as const;
const leadLag = (a: number, p: number) => (a >= 0.5 ? a : 0.5 * Math.pow(2 * a, p));

/**
 * Upper-arm lead (repair round 4, decision ZOO-P6). Once the forearm has swung `full` deg (20) or more away from the hang,
 * the upper arm is abducted at least `ratio` (0.3) x that swing, whatever the shoulder curve, the anticipation tuck or the
 * wind-up would give; below `full` the floor eases in (leadSwing). The R3 review measured the proof's in-betweens with the
 * elbow still at the waist (abduction -1.7 / -0.9 deg) under a forearm swung 44-62 deg (f95-f96) and 42-57 deg on the way
 * down (f188-f189): a tray-carry. The swing is the forearm's rotation from the hang (shoulder + elbow), so the rule holds
 * on the raise and on the lowering alike; it never acts at rest or in the end pose (ARM_POINT has 44 deg for a 137 deg
 * swing). It also lifts ARM_POINT_MID's 24 deg to ~38.5 deg (0.3 x its 114-128 deg swing): the upper arm is almost out
 * by mid-raise and the forearm finishes the reach. Cost, in the proof staging (INT-P2, PAIR_SPACING 570): the elbow is
 * out ~11 deg sooner, so on Zoo-only and Badger-only renders the fist passes Badger's pale ear 1.0 px apart at f96 and
 * 10.4 px at f187 (round 3: 27.2 / 29.1 px). Shifting Badger's frames right, ~600 u (+30 u) keeps every raise and
 * lowering frame >= 24 px; the integrator widens the spacing and re-checks.
 */
export const POINT_LEAD = {ratio: 0.3, full: 20} as const;
/**
 * The lead's swing measure: the swing itself from `full` up; below it full x (2u^2 - u^3), u = swing / full, which meets
 * the swing with the same value and slope at `full` and starts flat at the hang. Its slope never exceeds 4/3, so the
 * floor's slope (ratio x 4/3 = 0.4) stays well below 1 and the abduction follows the elbow smoothly (a steeper ramp makes
 * A = ratio x g(A + flex) amplify small elbow changes into a snap of the upper arm near the hang).
 */
const leadSwing = (swing: number): number => {
	const {full} = POINT_LEAD;
	if (swing >= full) return swing;
	const u = Math.max(0, swing) / full;
	return full * u * u * (2 - u);
};
/** Lowest abduction (deg, >= 0) the lead allows for elbow flexion `flex` (deg, >= 0): the least A >= `abduction` with A >= ratio x leadSwing(A + flex). */
export const leadAbduction = (abduction: number, flex: number): number => {
	let a = abduction;
	// a contraction (slope <= 0.4), monotone from below: 16 steps leave < 1e-5 deg
	for (let i = 0; i < 16; i++) a = Math.max(abduction, POINT_LEAD.ratio * leadSwing(a + flex));
	return a;
};
/** Applies the upper-arm lead to a left-arm angle set (shoulder < 0 abducts; elbow < 0 flexes). */
export const withUpperArmLead = (ang: ArmAngles): ArmAngles => {
	const abd = leadAbduction(-ang.shoulder, Math.max(0, -ang.elbow));
	return {...ang, shoulder: Math.min(ang.shoulder, -abd)};
};
/**
 * Forearm swing (deg) below which the pointing arm shows the relaxed hand (repair round 4, ZOO-P6): the hand closes into
 * the loose fist as soon as the forearm swings this far from the hang and opens again only when it is back near the hang,
 * on the raise and on the lowering alike (round 3 switched by poseAmount, so on the way down the open hand reappeared at
 * the end of a forearm still swung ~42 deg out: a "presenting" palm).
 */
export const POINT_FIST_SWING = 16;
/** The pointing arm's hand shape for a poseAmount and its (final) joint angles: relaxed near the hang, loose fist, pointer. */
export const pointHandFor = (poseAmount: number, ang: ArmAngles): 'relaxed' | 'curl' | 'point' => {
	if (poseAmount >= POINT_HAND_SWITCH) return 'point';
	const swing = -(ang.shoulder + ang.elbow);
	return swing >= POINT_FIST_SWING || poseAmount >= POINT_HAND_CURL ? 'curl' : 'relaxed';
};

/** Options for armAnglesFor. */
export type ArmAngleOptions = {
	/**
	 * Fraction (0..1) of the anticipation tuck (POINT_OVERLAP.tuck) to apply; default 1. The tuck belongs to the RAISE:
	 * pass 0 while the arm comes back down (ZooRig `pointTuck`), or the elbow pulls in toward the body at the end of the
	 * lowering (the tuck played in reverse). It only acts below poseAmount POINT_OVERLAP.tuckUntil, so switching it while
	 * the arm is above that (e.g. during the hold) never pops.
	 */
	tuck?: number;
};

/**
 * Joint angles along the gesture. With an in-between key (ARM_POINT_MID for ARM_POINT) each joint follows a monotone
 * cubic from rest through the key at 0.5 to the target (monotoneThrough): one smooth arc, no stop at the key and no
 * overshoot, with POINT_OVERLAP timing on the first half. Without one: a slightly overlapping blend (shoulder leads,
 * wrist last).
 */
export const armAnglesFor = (
	target: ArmAngles,
	amount: number,
	mid: ArmAngles | null = target === ARM_POINT ? ARM_POINT_MID : null,
	opts: ArmAngleOptions = {},
): ArmAngles => {
	const a = clamp01(amount);
	if (mid) {
		const o = POINT_OVERLAP;
		const k = clamp01(opts.tuck ?? 1);
		const tuck = a < o.tuckUntil ? k * o.tuck * Math.pow(Math.sin((Math.PI * a) / o.tuckUntil), 2) : 0;
		return withUpperArmLead({
			shoulder: monotoneThrough(mid.shoulder, target.shoulder, leadLag(a, o.shoulderLag)) + tuck,
			elbow: monotoneThrough(mid.elbow, target.elbow, leadLag(a, o.elbowLead)),
			wrist: monotoneThrough(mid.wrist, target.wrist, a),
		});
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
/**
 * Mouth modifiers applied on top of a library shape. cornerR / moustacheLiftR act on the SCREEN-right side (anatomical left),
 * cornerL / moustacheLiftL on the screen-left side. moustacheLiftL is optional (repair round 4).
 */
export type MouthMod = {cornerL: number; cornerR: number; openScale: number; widthScale: number; wave: number; moustacheLiftR: number; moustacheLiftL?: number};

export type ExpressionSpec = {
	browL: BrowPose; // anatomical left (screen right)
	browR: BrowPose; // anatomical right (screen left)
	eyes: EyePose;
	mouth: 'closed' | 'slightlyOpen' | 'ah' | 'ee' | 'oh' | 'mbp';
	/**
	 * Optional: the expression's own drawing of its default `mouth` (repair round 4, decision ZOO-E3), used only when no
	 * explicit mouth is passed. The six-shape lip-sync library is unchanged; lip-sync (an explicit mouth) uses the library.
	 */
	mouthSpec?: MouthSpec;
	mod: MouthMod;
	crease: number; // 0..1 worry crease between the brows
	/** Optional 0..1 smile crease on the screen-right cheek, beside the lifted moustache end (repair round 4, ZOO-E4). */
	cheek?: number;
};

const B0: BrowPose = {lift: 0, inner: 0, outer: 0, arch: 0};
const E0: EyePose = {lidTop: 0, lidBottom: 0, scale: 1, iris: 1};
export const MOD0: MouthMod = {cornerL: 0, cornerR: 0, openScale: 1, widthScale: 1, wave: 0, moustacheLiftR: 0};

/** Expressions measured from zoo_expr_*.png (repair round 1 re-measure). Restrained and adult. */
export const EXPRESSIONS: Record<Expression, ExpressionSpec> = {
	// Deadpan: flat straight mouth; the anatomical-left (screen-right) brow is subtly raised in its base shape.
	neutral: {browL: B0, browR: B0, eyes: E0, mouth: 'closed', mod: MOD0, crease: 0},
	// Small asymmetric smirk (repair round 5, decision ZOO-E5; zoo_expr_happy.png): the eyes stay as open as neutral (Prompt 1:
	// "eyes open and alert"; the panel keeps ~94% of the neutral eye white) with only a 0.6 u lower-lid lift, and the brows rise
	// a little. Its own closed mouth (HAPPY_MOUTH) is a thin ~33 u smile line tucked under the moustache: the screen-left corner
	// rises ~1.5 u and the screen-right ~3 u above its lowest point (the panel: ~33 u wide, 1.5-3 u deep), with a thin lower-lip
	// arc; the moustache ends lift 2 / 3 u without curling and the cheek stays smooth (no crease on the panel). Round 4 (ZOO-E4)
	// squinted the eyes to slits (lids -0.8 / 3.8) and drew a 40 u U-grin (corners 4 / 9 u, moustache tips 4 / 8 u, a shaded lip
	// crescent and a cheek crease), which read as a smug grin; rounds 1-3 were illegible (ZOO-E2: no head yaw).
	happy: {
		browL: {lift: 2.8, inner: 0, outer: 1, arch: 0.8},
		browR: {lift: 3.4, inner: 0.4, outer: 0.6, arch: 0.8},
		eyes: {lidTop: 0, lidBottom: 0.7, scale: 1, iris: 1},
		mouth: 'closed',
		mouthSpec: HAPPY_MOUTH,
		mod: {...MOD0, cornerL: 1.5, cornerR: 3, moustacheLiftR: 3, moustacheLiftL: 2},
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
	// Shocked: brows high and arched, eyes wide with smaller irises, and its own open mouth (repair round 4, ZOO-E3): a gasp
	// oval with an arched top and low corners (SHOCKED_MOUTH, mouth.ts), not the library ah squashed to 60% x 95% (rounds 1-3),
	// which kept ah's flat top and read as an open grin.
	shocked: {
		browL: {lift: 7.6, inner: 0.6, outer: 0, arch: 3},
		browR: {lift: 8.2, inner: 0.6, outer: 0, arch: 3},
		eyes: {lidTop: 4.2, lidBottom: -1.8, scale: 1.1, iris: 0.72},
		mouth: 'ah',
		mouthSpec: SHOCKED_MOUTH,
		mod: MOD0,
		crease: 0,
	},
};
