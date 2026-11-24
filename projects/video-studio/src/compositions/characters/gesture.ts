/**
 * Arc-length timing for Zoo's point gesture (decision INT-T1).
 *
 * `poseAmount` is not uniform in screen space: the rig's quadratic joint path (armAnglesFor with ARM_POINT_MID) moves
 * the hand 71% of its 454-unit path in the first half of poseAmount and only 29% in the second half. Easing poseAmount
 * directly therefore front-loads the swing (v1: 123 px in one frame). This module maps a path fraction u (0..1, the
 * fraction of the hand's travel along the arc) to the poseAmount that puts the hand there, so a composition can ease
 * u with any symmetric curve and the hand's on-screen speed follows that curve exactly.
 *
 * The hand point is the centre of the hand (48 units below the wrist pivot in the hand's rest frame), driven through the
 * rig's own pivots and angle function, so the table follows any later change to the rig.
 */
import {ARM_POINT, armAnglesFor, PIVOTS} from '../../characters/zoo/rig';

type Pt = {x: number; y: number};

const rotateAbout = (p: Pt, c: Pt, deg: number): Pt => {
	const r = (deg * Math.PI) / 180;
	const x = p.x - c.x;
	const y = p.y - c.y;
	return {x: c.x + x * Math.cos(r) - y * Math.sin(r), y: c.y + x * Math.sin(r) + y * Math.cos(r)};
};

/** Hand centre in Zoo's world units for a given poseAmount of the point gesture (front view, no wind-up). */
export const pointHandAt = (poseAmount: number): Pt => {
	const a = armAnglesFor(ARM_POINT, poseAmount);
	const S = PIVOTS.shoulderL;
	const E = PIVOTS.elbowL;
	const W = PIVOTS.wristL;
	let p: Pt = {x: W.x, y: W.y + 48};
	p = rotateAbout(p, W, a.wrist);
	p = rotateAbout(p, E, a.elbow);
	p = rotateAbout(p, S, a.shoulder);
	return p;
};

const SAMPLES = 600;
const TABLE = (() => {
	const amount: number[] = [];
	const length: number[] = [];
	let prev = pointHandAt(0);
	let total = 0;
	for (let i = 0; i <= SAMPLES; i++) {
		const a = i / SAMPLES;
		const p = pointHandAt(a);
		total += Math.hypot(p.x - prev.x, p.y - prev.y);
		prev = p;
		amount.push(a);
		length.push(total);
	}
	return {amount, fraction: length.map((l) => l / total), total};
})();

/** Length of the hand's path from rest to the point, in world units. */
export const POINT_PATH_LENGTH = TABLE.total;

/** The poseAmount at which the hand has travelled fraction u (0..1) of its path. Monotonic and continuous. */
export const poseAmountForPath = (u: number): number => {
	const t = Math.max(0, Math.min(1, u));
	const f = TABLE.fraction;
	let lo = 0;
	let hi = f.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (f[mid] < t) lo = mid;
		else hi = mid;
	}
	const span = f[hi] - f[lo];
	const k = span > 0 ? (t - f[lo]) / span : 0;
	return TABLE.amount[lo] + k * (TABLE.amount[hi] - TABLE.amount[lo]);
};

/** The path fraction (0..1) the hand has travelled at a given poseAmount (inverse of poseAmountForPath). */
export const pathForPoseAmount = (poseAmount: number): number => {
	const a = Math.max(0, Math.min(1, poseAmount)) * SAMPLES;
	const i = Math.min(SAMPLES - 1, Math.floor(a));
	const k = a - i;
	return TABLE.fraction[i] + k * (TABLE.fraction[i + 1] - TABLE.fraction[i]);
};
