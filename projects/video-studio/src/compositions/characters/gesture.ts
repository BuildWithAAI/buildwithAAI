/**
 * Arc-length timing for Zoo's point gesture (decision INT-T1).
 *
 * `poseAmount` is not uniform in screen space. The rig's joint path (armAnglesFor: a monotone cubic per joint through
 * ARM_POINT_MID at 0.5, with POINT_OVERLAP's elbow lead and shoulder lag on the first half; repair rounds 2-3, ZOO-P4 and
 * ZOO-P5) moves the hand about 80% of its ~410-unit path in the first half of poseAmount and only about 20% in the second
 * half, where the arm mostly rises at the shoulder. Easing poseAmount directly therefore front-loads the swing (v1: 123 px
 * in one frame). This module maps a path fraction u (0..1, the fraction of the hand's travel along the arc) to the
 * poseAmount that puts the hand there, so a composition can ease u with any symmetric curve and the hand's on-screen speed
 * follows that curve exactly (Preview10s: bezier(0.38, 0, 0.4, 1) over 16 frames peaks at ~45 px/frame at scale 0.88).
 *
 * The hand point is the centre of the hand (48 units below the wrist pivot in the hand's rest frame), driven through the
 * rig's own pivots and angle function, so the table follows any later change to the rig (POINT_PATH_LENGTH reports it).
 *
 * The path depends on how much of the rig's anticipation tuck is used (armAnglesFor's `tuck`, ZooRig's `pointTuck`;
 * repair round 3), so every table is built for a tuck: a constant (the rig's default is 1) or a function of poseAmount
 * (integration round 3, decision INT-T3: Preview10s keeps the tuck while the fist passes Badger's head and releases it
 * before the forearm nears level). Time the gesture on the table of the tuck the composition actually passes, or the hand
 * speeds up and slows down where the paths differ (up to ~60 px in one frame).
 */
import {ARM_POINT, armAnglesFor, PIVOTS} from '../../characters/zoo/rig';

type Pt = {x: number; y: number};
/** pointTuck as a constant or as a function of poseAmount (0..1 either way). */
export type TuckSpec = number | ((poseAmount: number) => number);

const rotateAbout = (p: Pt, c: Pt, deg: number): Pt => {
	const r = (deg * Math.PI) / 180;
	const x = p.x - c.x;
	const y = p.y - c.y;
	return {x: c.x + x * Math.cos(r) - y * Math.sin(r), y: c.y + x * Math.sin(r) + y * Math.cos(r)};
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const tuckValue = (tuck: TuckSpec, poseAmount: number) => clamp01(typeof tuck === 'function' ? tuck(poseAmount) : tuck);

/** Hand centre in Zoo's world units for a given poseAmount of the point gesture (front view, no wind-up). */
export const pointHandAt = (poseAmount: number, tuck: TuckSpec = 1): Pt => {
	const a = armAnglesFor(ARM_POINT, poseAmount, undefined, {tuck: tuckValue(tuck, poseAmount)});
	const S = PIVOTS.shoulderL;
	const E = PIVOTS.elbowL;
	const W = PIVOTS.wristL;
	let p: Pt = {x: W.x, y: W.y + 48};
	p = rotateAbout(p, W, a.wrist);
	p = rotateAbout(p, E, a.elbow);
	p = rotateAbout(p, S, a.shoulder);
	return p;
};

/** Arc-length table of one point path (one tuck spec). */
export type PointPath = {
	/** Length of the hand's path from rest to the point, in world units. */
	length: number;
	/** The poseAmount at which the hand has travelled fraction u (0..1) of its path. Monotonic and continuous. */
	poseAmountForPath: (u: number) => number;
	/** The path fraction (0..1) the hand has travelled at a given poseAmount (inverse of poseAmountForPath). */
	pathForPoseAmount: (poseAmount: number) => number;
	/** The pointTuck this path assumes at a given poseAmount (pass it to ZooRig). */
	tuckAt: (poseAmount: number) => number;
};

const SAMPLES = 600;
/** Build the arc-length table for a tuck spec (constant tucks are cached; keep function specs in a module constant). */
export const pointPath = (tuck: TuckSpec = 1): PointPath => {
	if (typeof tuck === 'number') {
		const k = Math.round(clamp01(tuck) * 100) / 100;
		const hit = CACHE.get(k);
		if (hit) return hit;
		const built = build(k);
		CACHE.set(k, built);
		return built;
	}
	return build(tuck);
};
const CACHE = new Map<number, PointPath>();
const build = (tuck: TuckSpec): PointPath => {
	const amount: number[] = [];
	const length: number[] = [];
	let prev = pointHandAt(0, tuck);
	let total = 0;
	for (let i = 0; i <= SAMPLES; i++) {
		const a = i / SAMPLES;
		const p = pointHandAt(a, tuck);
		total += Math.hypot(p.x - prev.x, p.y - prev.y);
		prev = p;
		amount.push(a);
		length.push(total);
	}
	const fraction = length.map((l) => l / total);
	return {
		length: total,
		poseAmountForPath: (u: number) => {
			const t = clamp01(u);
			let lo = 0;
			let hi = fraction.length - 1;
			while (hi - lo > 1) {
				const mid = (lo + hi) >> 1;
				if (fraction[mid] < t) lo = mid;
				else hi = mid;
			}
			const span = fraction[hi] - fraction[lo];
			const k = span > 0 ? (t - fraction[lo]) / span : 0;
			return amount[lo] + k * (amount[hi] - amount[lo]);
		},
		pathForPoseAmount: (poseAmount: number) => {
			const a = clamp01(poseAmount) * SAMPLES;
			const i = Math.min(SAMPLES - 1, Math.floor(a));
			const k = a - i;
			return fraction[i] + k * (fraction[i + 1] - fraction[i]);
		},
		tuckAt: (poseAmount: number) => tuckValue(tuck, poseAmount),
	};
};

/** Length of the hand's path from rest to the point, in world units (the rig's default tuck). */
export const POINT_PATH_LENGTH = pointPath(1).length;

/** The poseAmount at which the hand has travelled fraction u (0..1) of its path (constant tuck, default the rig's 1). */
export const poseAmountForPath = (u: number, tuck = 1): number => pointPath(tuck).poseAmountForPath(u);

/** The path fraction (0..1) the hand has travelled at a given poseAmount (inverse of poseAmountForPath). */
export const pathForPoseAmount = (poseAmount: number, tuck = 1): number => pointPath(tuck).pathForPoseAmount(poseAmount);
