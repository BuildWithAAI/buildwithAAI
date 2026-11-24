import type {LegAngles, LegGeom} from './Leg';
import type {Pt} from './shared';
import type {LegKey, SidePose, SideRig} from './SideBody';

/**
 * Leg IK and the 4-beat walk for the side rigs. Everything here works in a FACING-NORMALISED frame
 * (x forward toward the head, y down, torso-local units) so one gait drives both traced rigs; the
 * drawings themselves are never mirrored.
 */

const deg = (r: number) => (r * 180) / Math.PI;
const ang = (v: Pt) => Math.atan2(v.y, v.x);
/** SVG rotation (y down): positive = clockwise on screen. */
const rot = (v: Pt, a: number): Pt => ({x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a)});

/**
 * Two-bone IK: angles (facing-normalised degrees, + = forward swing) that put the paw pivot of a leg mounted
 * at `mount` on `target`, both in torso-local normalised coordinates. Of the two joint solutions the one whose
 * lower-segment angle is closest to `prefer` (deg) is used: ~0 keeps the standing carpus/hock, a negative value
 * folds the front pastern back (swing), a positive one flexes the hock forward. The paw is then rotated so it
 * keeps `pawWorld` degrees of world rotation (0 = flat on the ground) under a body pitch of `pitch`.
 */
export const solveLeg = (geom: LegGeom, dir: 1 | -1, mount: Pt, target: Pt, prefer: number, pitch: number, pawWorld = 0): LegAngles => {
	const L1 = {x: dir * geom.lowerPivot.x, y: geom.lowerPivot.y};
	const L2 = {x: dir * geom.pawPivot.x, y: geom.pawPivot.y};
	const l1 = Math.hypot(L1.x, L1.y);
	const l2 = Math.hypot(L2.x, L2.y);
	const m = {x: dir * mount.x, y: mount.y};
	const D = {x: target.x - m.x, y: target.y - m.y};
	const d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-3, Math.hypot(D.x, D.y)));
	const cb = Math.max(-1, Math.min(1, (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2)));
	const beta = Math.acos(cb);
	// relative direction of the rotated lower segment against L1: ang(L2) + a2svg - ang(L1) = +-beta
	const cand = [beta, -beta].map((b) => {
		const a2svg = b - (ang(L2) - ang(L1)); // SVG rotation applied to the lower segment
		const v = {x: L1.x + rot(L2, a2svg).x, y: L1.y + rot(L2, a2svg).y};
		const a1svg = ang(D) - ang(v);
		return {a1: -a1svg, a2: -a2svg};
	});
	const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
	const pref = (prefer * Math.PI) / 180;
	const pick = cand.sort((p, q) => Math.abs(wrap(p.a2 - pref)) - Math.abs(wrap(q.a2 - pref)))[0];
	const a1 = deg(wrap(pick.a1));
	const a2 = deg(wrap(pick.a2));
	// paw: total SVG rotation = -(pitch + a1 + a2 + a3) must equal -pawWorld
	const a3 = pawWorld - pitch - a1 - a2;
	return {upper: a1, lower: a2, paw: a3};
};

/** Rest paw-pivot position of a leg in torso-local normalised coordinates. */
export const restPaw = (geom: LegGeom, dir: 1 | -1, mount: Pt): Pt => ({
	x: dir * (mount.x + geom.lowerPivot.x + geom.pawPivot.x),
	y: mount.y + geom.lowerPivot.y + geom.pawPivot.y,
});

/** Forward/up displacement of the torso pivot and its pitch -> where a torso-local point lands (normalised). */
const bodyToRoot = (p: Pt, pose: SidePose['body']): Pt => {
	const r = rot(p, (-pose.pitch * Math.PI) / 180);
	return {x: r.x + pose.forward, y: r.y - pose.up};
};
const rootToBody = (p: Pt, pose: SidePose['body']): Pt => rot({x: p.x - pose.forward, y: p.y + pose.up}, (pose.pitch * Math.PI) / 180);

export type LegSpec = {key: LegKey; front: boolean; mount: Pt; geom: LegGeom};

export const legSpecs = (R: SideRig): LegSpec[] => [
	{key: 'frontNear', front: true, mount: R.mounts.legFrontNear, geom: R.legFront},
	{key: 'frontFar', front: true, mount: R.mounts.legFrontFar, geom: R.legFront},
	{key: 'hindNear', front: false, mount: R.mounts.legHindNear, geom: R.legHind},
	{key: 'hindFar', front: false, mount: R.mounts.legHindFar, geom: R.legHind},
];

/**
 * Plant every paw at its standing spot shifted by `offsets` (normalised units, + = forward), under a body
 * pose. Used by the right stand (its far front leg is placed by rotating it from the shoulder, so it never
 * pokes out in front of the chest) and by the walk.
 */
export const plantLegs = (R: SideRig, dir: 1 | -1, body: SidePose['body'], offsets: Partial<Record<LegKey, Pt>>): Record<LegKey, LegAngles> => {
	const out = {} as Record<LegKey, LegAngles>;
	for (const s of legSpecs(R)) {
		const o = offsets[s.key] ?? {x: 0, y: 0};
		const rest = restPaw(s.geom, dir, s.mount); // torso-local == root-local at rest (torso pivot is the root)
		const targetRoot = {x: rest.x + o.x, y: rest.y + o.y};
		const t = rootToBody(targetRoot, body);
		out[s.key] = solveLeg(s.geom, dir, s.mount, t, s.front ? 0 : 10, body.pitch);
	}
	return out;
};

/** BADGER's walk: a lateral-sequence 4-beat gait (LH, LF, RH, RF a quarter cycle apart). */
export const WALK = {
	/** Body travel per gait cycle at scale 1 (world units). Move the root by exactly this much per cycle. */
	stride: 250,
	/** Fraction of the cycle each paw is on the ground. */
	duty: 0.6,
	/** Stance sweep of each paw relative to its standing spot (units): lands `reach` ahead, lifts `trail` behind. */
	reach: 58,
	trail: 92,
	/** Heel roll about the planted toe at the end of stance (deg), so the trailing leg can stay on the ground. */
	roll: 26,
	/** Paw lift at mid-swing (units). */
	lift: 28,
	/** Body carried lower than the stand (legs slightly flexed), plus a small bob. */
	drop: 12,
	bob: 2,
	/** Phase offsets per ANATOMICAL leg; walkPhase 0 is close to badger_pose_walking.png. */
	offsets: {leftHind: -0.15, leftFront: 0.1, rightHind: 0.35, rightFront: 0.6},
	neck: -13,
	tail: 20,
} as const;

const frac = (v: number) => v - Math.floor(v);

const NUM = /-?\d*\.?\d+/g;
/** Toe contact point of a paw (paw-pivot space): the most forward of its lowest points. */
const toeOf = (geom: LegGeom, dir: 1 | -1): Pt => {
	const n = (geom.paw.fill.match(NUM) ?? []).map(Number);
	const pts: Pt[] = [];
	for (let i = 0; i + 1 < n.length; i += 2) pts.push({x: dir * n[i], y: n[i + 1]});
	const maxY = Math.max(...pts.map((p) => p.y));
	const low = pts.filter((p) => p.y > maxY - 5);
	return low.reduce((a, b) => (b.x > a.x ? b : a));
};

/** Walk pose at gait phase t (0..1). Planted toes move back at exactly `stride` per cycle in the body frame. */
export const walkPose = (R: SideRig, dir: 1 | -1, t: number, nearSide: 'left' | 'right'): SidePose => {
	const W = WALK;
	const ph = frac(t);
	const body = {forward: 0, up: -W.drop + W.bob * Math.cos(ph * Math.PI * 4), pitch: 0};
	const exc = W.reach + W.trail;
	// keep exactly stride*duty of stance sweep so planted paws never slide
	const k = (W.stride * W.duty) / exc;
	const xf = W.reach * k;
	const xb = -W.trail * k;
	const far = nearSide === 'left' ? 'right' : 'left';
	const offOf = (key: LegKey): number => {
		const side = key.endsWith('Near') ? nearSide : far;
		const front = key.startsWith('front');
		return W.offsets[`${side}${front ? 'Front' : 'Hind'}` as keyof typeof W.offsets];
	};
	const legs = {} as Record<LegKey, LegAngles>;
	for (const s of legSpecs(R)) {
		const u = frac(ph - offOf(s.key));
		const rest = restPaw(s.geom, dir, s.mount);
		const toe = toeOf(s.geom, dir); // paw-pivot space, normalised
		// pivot when the paw is rolled by phi about its toe (toe fixed): pivot = toeWorld + R(-phi)(-toe)
		const rolledPivot = (toeX: number, phi: number): Pt => {
			const r = rot({x: -toe.x, y: -toe.y}, (-phi * Math.PI) / 180);
			return {x: rest.x + toeX + toe.x + r.x, y: rest.y + toe.y + r.y};
		};
		let target: Pt;
		let pawWorld = 0;
		let prefer = s.front ? 0 : 10;
		const rollStart = W.duty * 0.62;
		if (u < W.duty) {
			const toeX = xf - (u / W.duty) * (xf - xb); // the toe contact moves back linearly while the body advances
			const phi = u > rollStart ? W.roll * Math.pow((u - rollStart) / (W.duty - rollStart), 1.6) : 0;
			target = rolledPivot(toeX, phi);
			pawWorld = phi;
		} else {
			const sp = (u - W.duty) / (1 - W.duty);
			const e = 0.5 - 0.5 * Math.cos(sp * Math.PI);
			const a = rolledPivot(xb, W.roll);
			const b = rolledPivot(xf, 0);
			target = {x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - W.lift * Math.sin(sp * Math.PI)};
			const fold = (s.front ? -46 : -20) * Math.sin(Math.min(1, sp * 1.12) * Math.PI);
			pawWorld = W.roll * Math.pow(1 - sp, 2) + fold;
			if (s.front) prefer = -70;
		}
		legs[s.key] = solveLeg(s.geom, dir, s.mount, rootToBody(target, body), prefer, body.pitch, pawWorld);
	}
	return {body, neck: W.neck, legs, tail: W.tail};
};

/** Root x offset (world units at scale 1, along the facing) for a walk that has run `cycles` gait cycles. */
export const badgerWalkDistance = (cycles: number): number => cycles * WALK.stride;

export {bodyToRoot};
