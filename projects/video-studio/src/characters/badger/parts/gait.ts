import type {LegAngles, LegGeom} from './Leg';
import {samplePath} from './pathSample';
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

/** BADGER's walk: a 4-beat lateral-sequence gait (LH, LF, RH, RF), lateral pairs close together as drawn on the sheet. */
export const WALK = {
	/** Body travel per gait cycle at scale 1 (world units). Move the root by exactly this much per cycle. */
	stride: 225 / 0.6,
	/** Fraction of the cycle each paw is on the ground. */
	duty: 0.6,
	/**
	 * Stance sweep of each paw pivot, relative to its own shoulder / hip (units, + = forward): it lands at `land`
	 * and lifts at `lift`. Both sweeps are 225 units (= stride * duty), so planted paws never slide. Measured on
	 * badger_pose_walking.png (normalised by body length): the far fore paw lands well ahead of the chest and the
	 * near hind paw leaves the ground behind the hip.
	 */
	// Round-2 repair (decision BADGER-D25, revised): the fore lands 3% further ahead and the hind lifts 5% further back (and
	// each stays planted a little longer), so the phase-0 paw spread is closer to badger_pose_walking.png at equal height (it
	// was about 10% short); the shoulder glide cap rose 22 -> 26 so the far fore still reaches. Sweeps 225 = stride * duty;
	// dev/walkCheck.ts: no paw below the ground, no stance drift, both facings.
	front: {land: 128, lift: -97},
	hind: {land: 96, lift: -129},
	/** Shoulder glide (scapula) of the front legs, fraction of the paw offset, capped (hidden inside the chest). */
	glide: 0.3,
	glideMax: 26,
	/**
	 * Stance legs keep their reach (pivot-to-paw distance / full leg length) inside these bands; the shoulder or
	 * hip slides up/down inside the body to do so (scapula / pelvis movement, hidden by the torso). Front legs stay
	 * almost straight, as a dog's do; hind legs keep some hock flex.
	 */
	reachFront: [0.965, 0.99],
	reachHind: [0.84, 0.99],
	/** Reach band of a swinging fore leg (the carpus folds, so the leg may shorten a little more). */
	swingReachFront: [0.93, 0.985],
	maxSlide: 36,
	/** Heel-up roll onto the toes at the end of stance (deg, toes-down), about the paw's real ground contact point. */
	roll: 20,
	/** Most the swinging paw may pitch toes-down (deg): the carpus folds, but the paw never points straight down. */
	maxPawPitch: 28,
	/** Paw lift at mid-swing (units). */
	lift: 30,
	/** Body carried lower than the stand (legs slightly flexed), plus a small bob. */
	drop: 6,
	bob: 2,
	/**
	 * Phase offsets per ANATOMICAL leg. walkPhase 0 is the frame of badger_pose_walking.png seen from the right:
	 * far (left) fore paw landing, far hind just planted under the belly, near (right) hind at toe-off, near fore
	 * in late stance.
	 */
	offsets: {leftHind: -0.08, leftFront: 0.0, rightHind: 0.4, rightFront: 0.52},
	/** Neck carriage while walking (deg, + = raised): the sheet carries the head up and forward, close to the stand. */
	neck: 2,
	/** Tail carriage while walking (deg, + = raised): the sheet's walking tail is carried up in a sabre curve. */
	tail: 34,
} as const;

const frac = (v: number) => v - Math.floor(v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Sampled outlines (paw-local / pastern-local SVG units) of the parts that can touch the ground. */
type GroundShape = {paw: readonly Pt[]; lower: readonly Pt[]};
const GROUND_CACHE = new WeakMap<LegGeom, GroundShape>();
const groundShape = (geom: LegGeom): GroundShape => {
	let g = GROUND_CACHE.get(geom);
	if (!g) {
		g = {paw: samplePath(geom.paw.fill, 10), lower: samplePath(geom.lower.fill, 6)};
		GROUND_CACHE.set(geom, g);
	}
	return g;
};

/**
 * Roll pivot of a paw (paw-pivot space, facing-normalised), measured ON THE DRAWN OUTLINE (sampled curve, not control
 * points): the point of the toe arc that is the lowest point of the paw once it has rolled WALK.roll degrees heel-up.
 * Rolling about it never pushes the toes into the ground; while the paw is flat its height is taken up by the ground
 * clamp in walkPose, so a planted paw keeps a fixed x and a fixed ground contact.
 */
const TOE_CACHE = new WeakMap<LegGeom, Pt>();
export const toeOf = (geom: LegGeom, dir: 1 | -1): Pt => {
	let t = TOE_CACHE.get(geom);
	if (!t) {
		const pts = groundShape(geom).paw;
		const maxY = Math.max(...pts.map((p) => p.y));
		const facing = (p: Pt) => (dir * p.x); // forward coordinate (cache is per geom; both rigs use one dir each)
		const sole = pts.filter((p) => p.y > maxY - 0.75).reduce((a, b) => (facing(b) > facing(a) ? b : a));
		const a = (WALK.roll * Math.PI) / 180;
		// heel-up roll = toes-down: rotate (forward, down) by +roll in the facing-normalised frame
		const dropOf = (p: Pt) => facing(p) * Math.sin(a) + p.y * Math.cos(a);
		let best = sole;
		let bestDrop = -Infinity;
		for (const p of pts) {
			if (facing(p) < facing(sole) - 0.5 || p.y < maxY - 20) continue;
			const d = dropOf(p);
			if (d > bestDrop) {
				bestDrop = d;
				best = p;
			}
		}
		t = {x: best.x, y: best.y};
		TOE_CACHE.set(geom, t);
	}
	return {x: dir * t.x, y: t.y};
};

const rotSvg = (v: Pt, deg: number): Pt => {
	const a = (deg * Math.PI) / 180;
	return {x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a)};
};
const addP = (a: Pt, b: Pt): Pt => ({x: a.x + b.x, y: a.y + b.y});

/**
 * Lowest point (largest world y; ground = 0, y down) of a posed paw and pastern FILL, sampled on the drawn curves.
 * Replicates SideBody's transform chain exactly. The fills are inset by `geom.inset`, so the traced sole is this value
 * plus the inset; walkPose keeps that traced sole on the ground line (the outline then reaches LINE.width / 2 below it,
 * exactly as in the standing pose).
 */
export const pawLowestY = (R: SideRig, dir: 1 | -1, body: SidePose['body'], svgMount: Pt, a: LegAngles, geom: LegGeom): number => {
	const T = R.torso.pivot;
	const root = {x: T.x + dir * body.forward, y: T.y - body.up};
	const pitchSvg = -dir * body.pitch;
	const su = -dir * a.upper;
	const sl = -dir * a.lower;
	const sp = -dir * a.paw;
	const g = groundShape(geom);
	let m = -Infinity;
	const world = (q: Pt) => addP(root, rotSvg(addP(svgMount, rotSvg(q, su)), pitchSvg)).y;
	for (const p of g.paw) m = Math.max(m, world(addP(geom.lowerPivot, rotSvg(addP(geom.pawPivot, rotSvg(p, sp)), sl))));
	for (const p of g.lower) m = Math.max(m, world(addP(geom.lowerPivot, rotSvg(p, sl))));
	return m;
};

/** Walk pose at gait phase t (cycles; fractional part used). Planted toes move back at exactly `stride` per cycle. */
export const walkPose = (R: SideRig, dir: 1 | -1, t: number, nearSide: 'left' | 'right'): SidePose => {
	const W = WALK;
	const ph = frac(t);
	const body = {forward: 0, up: -W.drop + W.bob * Math.cos(ph * Math.PI * 4), pitch: 0};
	const far = nearSide === 'left' ? 'right' : 'left';
	const offOf = (key: LegKey): number => {
		const side = key.endsWith('Near') ? nearSide : far;
		const front = key.startsWith('front');
		return W.offsets[`${side}${front ? 'Front' : 'Hind'}` as keyof typeof W.offsets];
	};
	/** Ground in the gait's root frame (torso-local at rest): world y = 0. */
	const groundY = -R.torso.pivot.y;
	const legs = {} as Record<LegKey, LegAngles>;
	const mountShift = {} as Record<LegKey, Pt>;
	for (const s of legSpecs(R)) {
		const u = frac(ph - offOf(s.key));
		const m = {x: dir * s.mount.x, y: s.mount.y};
		const rng = s.front ? W.front : W.hind;
		const toe = toeOf(s.geom, dir);
		const sole = groundShape(s.geom).paw.map((q) => ({x: dir * q.x - toe.x, y: q.y - toe.y}));
		/** Depth of the paw's lowest drawn point below the roll pivot when the paw has world pitch `pw`. */
		const depthAt = (pw: number): number => {
			let d = 0;
			for (const q of sole) d = Math.max(d, rot(q, (-pw * Math.PI) / 180).y);
			return d;
		};
		// the fills are inset by `inset` (stroke-under-fill legs): the traced sole = lowest fill point + inset
		const inset = s.geom.inset ?? 0;
		// paw pivot when the paw has world pitch `pw` (+ = toes up), its roll pivot at x = toeX and its traced sole
		// exactly on the ground line, as in the standing pose
		const pivotAt = (toeX: number, pw: number): Pt => {
			const r = rot({x: -toe.x, y: -toe.y}, (-pw * Math.PI) / 180);
			return {x: toeX + r.x, y: groundY - inset - depthAt(pw) + r.y};
		};
		const toeLand = m.x + rng.land + toe.x;
		const toeLift = m.x + rng.lift + toe.x;
		const Lmax = Math.hypot(s.geom.lowerPivot.x, s.geom.lowerPivot.y) + Math.hypot(s.geom.pawPivot.x, s.geom.pawPivot.y);
		const band = s.front ? W.reachFront : W.reachHind;
		const glideAt = (tx: number) => (s.front ? Math.max(-W.glideMax, Math.min(W.glideMax, W.glide * (tx - m.x))) : 0);
		/** Mount slide (dx forward, dy down) that keeps a paw pivot within the reach band (scapula / pelvis). */
		const slideFor = (tgtRoot: Pt, bnd: readonly number[] = band): Pt => {
			const tb = rootToBody(tgtRoot, body);
			const gx = glideAt(tgtRoot.x);
			const dx = tb.x - (m.x + gx);
			const dy0 = tb.y - m.y;
			const d0 = Math.hypot(dx, dy0);
			const want = Math.max(bnd[0] * Lmax, Math.min(bnd[1] * Lmax, d0));
			const dy = Math.sqrt(Math.max(0, want * want - dx * dx));
			const slide = Math.max(-W.maxSlide, Math.min(W.maxSlide, dy0 - dy));
			return {x: gx, y: slide};
		};
		let target: Pt;
		let slide: Pt;
		let pawWorld: number;
		let swingBand: readonly number[] = band;
		let prefer = s.front ? 0 : 10;
		const rollStart = W.duty * 0.6;
		const stance = u < W.duty;
		if (stance) {
			const toeX = toeLand - (u / W.duty) * (toeLand - toeLift); // planted toe; the body advances over it
			const phi = u > rollStart ? W.roll * Math.pow((u - rollStart) / (W.duty - rollStart), 1.6) : 0;
			pawWorld = -phi; // heel up, onto the toes
			target = pivotAt(toeX, pawWorld);
			slide = slideFor(target);
		} else {
			const sp = (u - W.duty) / (1 - W.duty);
			const e = 0.5 - 0.5 * Math.cos(sp * Math.PI);
			const a = pivotAt(toeLift, -W.roll);
			const b = pivotAt(toeLand, 0);
			target = {x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - W.lift * Math.sin(sp * Math.PI)};
			// a swinging fore leg has no elbow joint in the rig: the scapula rises with the paw (slide from the lifted
			// target itself), the carpus fold does the rest. The reach band eases from the stance band so the leg top
			// never jumps at toe-off or landing.
			const k = Math.sin(sp * Math.PI);
			swingBand = s.front ? [lerp(band[0], W.swingReachFront[0], k), lerp(band[1], W.swingReachFront[1], k)] : band;
			slide = slideFor(target, swingBand);
			// the carpus / hock folds the paw toes-down after toe-off (eased in, so the toe lifts clean) and opens it
			// again before landing; capped so the paw never hangs straight down
			const ease = Math.min(1, sp / 0.3);
			const fold = (s.front ? 1 : 0.55) * W.maxPawPitch * Math.sin(Math.min(1, sp * 1.15) * Math.PI) * ease * ease * (3 - 2 * ease);
			pawWorld = -Math.min(W.maxPawPitch, Math.max(W.roll * Math.pow(1 - sp, 2), fold));
			if (s.front) prefer = -70;
		}
		const mountOf = (sl: Pt): Pt => ({x: s.mount.x + dir * sl.x, y: s.mount.y + sl.y});
		// ground clamp on the drawn outline: a planted paw sits exactly on the ground, a swinging paw never dips below it
		let ang = solveLeg(s.geom, dir, mountOf(slide), rootToBody(target, body), prefer, body.pitch, pawWorld);
		for (let it = 0; it < 6; it++) {
			const low = pawLowestY(R, dir, body, mountOf(slide), ang, s.geom) + inset;
			const err = stance ? low : Math.max(0, low);
			if (Math.abs(err) < 0.02) break;
			target = {x: target.x, y: target.y - err};
			if (!stance) slide = slideFor(target, swingBand);
			ang = solveLeg(s.geom, dir, mountOf(slide), rootToBody(target, body), prefer, body.pitch, pawWorld);
		}
		mountShift[s.key] = slide;
		legs[s.key] = ang;
	}
	return {body, neck: W.neck, legs, tail: W.tail, mountShift};
};

/** Root x offset (world units at scale 1, along the facing) for a walk that has run `cycles` gait cycles. */
export const badgerWalkDistance = (cycles: number): number => cycles * WALK.stride;

export {bodyToRoot};
