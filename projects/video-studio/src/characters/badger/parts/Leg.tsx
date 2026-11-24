import React from 'react';
import {BADGER_COLORS, LINE} from '../../palette';
import {Pt, ShapeGeom, tr, useStrokes} from './shared';
import {SpotShapes} from './SpotShapes';
import type {BadgerSpot} from '../spots';

/**
 * A leg segment. `creases` are contour lines that run inside the segment (elbow / brisket), drawn on top at full width.
 * `underlay` are exterior edges that lie inside the torso at rest (the top of the thigh): a far leg strokes them with its
 * other edges (the torso is drawn over it), a near leg strokes them in a separate pass drawn UNDER the torso (pass
 * 'underlay', see SideBody), so they show only where a rotating leg pushes them outside the body.
 */
export type LegSeg = ShapeGeom & {readonly creases?: readonly string[]; readonly underlay?: readonly string[]};

export type LegGeom = {
	readonly upper: LegSeg;
	readonly lowerPivot: Pt;
	readonly lower: LegSeg;
	readonly pawPivot: Pt;
	readonly paw: LegSeg;
	/** Radius of the round joint disk at the lower pivot (wrist / hock) and at the paw pivot. */
	readonly lowerJointR?: number;
	readonly pawJointR?: number;
	/**
	 * How far the traced fills and strokes were inset (dev/trace/erode.py), normally LINE.width / 2. The visible outline
	 * lies outside the fill edge by up to LINE.width, so it covers the traced edge +- inset, as a centred stroke would.
	 */
	readonly inset?: number;
};

export type LegAngles = {upper: number; lower: number; paw: number};

const circle = (r: number) => `M ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 Z`;

type SegKey = 'upper' | 'lower' | 'paw';
const SEGS: readonly SegKey[] = ['paw', 'lower', 'upper'];

/** End of an edge at a joint: the point and the unit tangent pointing AWAY from the joint along the edge. */
type EdgeEnd = {p: Pt; t: Pt};
const NUM = /-?\d*\.?\d+(?:e-?\d+)?/g;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Pt, b: Pt): Pt => {
	const l = dist(a, b) || 1;
	return {x: (b.x - a.x) / l, y: (b.y - a.y) / l};
};
/** Both ends of an absolute M/C/L path with the tangent pointing into the path from each end. */
const pathEnds = (d: string): {start: EdgeEnd; end: EdgeEnd} => {
	const n = (d.match(NUM) ?? []).map(Number);
	const pts: Pt[] = [];
	for (let i = 0; i + 1 < n.length; i += 2) pts.push({x: n[i], y: n[i + 1]});
	const next = (i0: number, step: number): Pt => {
		let i = i0 + step;
		while (i > 0 && i < pts.length - 1 && dist(pts[i], pts[i0]) < 1e-6) i += step;
		return pts[Math.max(0, Math.min(pts.length - 1, i))];
	};
	const a = pts[0];
	const z = pts[pts.length - 1];
	return {start: {p: a, t: unit(a, next(0, 1))}, end: {p: z, t: unit(z, next(pts.length - 1, -1))}};
};
type JointPair = {upper: EdgeEnd; lower: EdgeEnd};
const JOINT_CACHE = new WeakMap<LegGeom, JointPair[]>();
/** The outline edges meeting at the wrist / hock, paired by side (upper-local and lower-local coordinates). */
const jointPairs = (geom: LegGeom): JointPair[] => {
	let out = JOINT_CACHE.get(geom);
	if (out) return out;
	const P = geom.lowerPivot;
	const O = {x: 0, y: 0};
	const near = (d: string, q: Pt): EdgeEnd => {
		const e = pathEnds(d);
		return dist(e.start.p, q) <= dist(e.end.p, q) ? e.start : e.end;
	};
	const ups = geom.upper.strokes.map((d) => near(d, P)).filter((e) => dist(e.p, P) < 30);
	const lows = geom.lower.strokes.map((d) => near(d, O)).filter((e) => dist(e.p, O) < 30);
	out = [];
	for (const u of ups) {
		const l = lows.find((q) => Math.sign(q.p.x) === Math.sign(u.p.x - P.x));
		if (l) out.push({upper: u, lower: l});
	}
	JOINT_CACHE.set(geom, out);
	return out;
};
const FILLET_R = 7;
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
/**
 * Round-2 repair (decision BADGER-D35): a strongly bent wrist / hock left a sharp V where the upper and lower outlines
 * cross on the inside of the bend. This fills the V with a small fillet (radius FILLET_R units, upper-local space): `fill`
 * goes with the segment fills, `arc` is its outline for the under-stroke pass, so the inside of the joint reads as one
 * soft curve. The outside of the bend is closed by the round joint disk as before.
 */
const jointFillets = (geom: LegGeom, lowerDeg: number): {fill: string; arc: string}[] => {
	if (Math.abs(lowerDeg) < 8) return [];
	const P = geom.lowerPivot;
	const th = (lowerDeg * Math.PI) / 180;
	const c = Math.cos(th);
	const s = Math.sin(th);
	const rotV = (v: Pt): Pt => ({x: v.x * c - v.y * s, y: v.x * s + v.y * c});
	const axis = rotV({x: 0, y: 1}); // the lower segment's long axis (downward) in upper-local space
	const out: {fill: string; arc: string}[] = [];
	for (const pair of jointPairs(geom)) {
		const side = Math.sign(pair.upper.p.x - P.x);
		if (side * axis.x <= 0) continue; // the lower swings AWAY from this side: outside of the bend (joint disk)
		const u = pair.upper.t;
		const A0 = pair.upper.p;
		const lp0 = rotV(pair.lower.p);
		const lp = {x: P.x + lp0.x, y: P.y + lp0.y};
		const lt = rotV(pair.lower.t);
		const den = u.x * lt.y - u.y * lt.x;
		if (Math.abs(den) < 1e-4) continue;
		const D = {x: lp.x - A0.x, y: lp.y - A0.y};
		const a = (D.x * lt.y - D.y * lt.x) / den;
		const b = (u.y * D.x - u.x * D.y) / den;
		if (a < -1 || b < -1 || a > 40 || b > 40) continue;
		const V = {x: A0.x + a * u.x, y: A0.y + a * u.y};
		const alpha = Math.acos(Math.max(-1, Math.min(1, u.x * lt.x + u.y * lt.y)));
		if (alpha > (170 * Math.PI) / 180) continue;
		let r = FILLET_R;
		let dd = r / Math.tan(alpha / 2);
		if (dd > 12) {
			dd = 12;
			r = dd * Math.tan(alpha / 2);
		}
		const A = {x: V.x + u.x * dd, y: V.y + u.y * dd};
		const B = {x: V.x + lt.x * dd, y: V.y + lt.y * dd};
		const sweep = den > 0 ? 0 : 1; // the arc bulges toward V (its centre lies on the open side of the V)
		const pt = (q: Pt) => `${f2(q.x)} ${f2(q.y)}`;
		out.push({
			fill: `M ${pt(V)} L ${pt(A)} A ${f2(r)} ${f2(r)} 0 0 ${sweep} ${pt(B)} Z`,
			arc: `M ${pt(A)} A ${f2(r)} ${f2(r)} 0 0 ${sweep} ${pt(B)}`,
		});
	}
	return out;
};

/**
 * A three-segment leg (upper / lower / paw). Each segment rotates about its own pivot; the chain is composed
 * explicitly. Far legs pass `far` and are filled with the coat's single shadow tone; they carry no visible spots
 * (their markings face away from the camera).
 *
 * Construction (decision BADGER-D26, revised): stroke-under-fill. (1) Every segment's exterior strokes, and the ring
 * of any joint that is bent, are drawn at TWICE the outline width. (2) The joint disks and the segment fills (with
 * their spots, clipped) go on top and hide the inner half of every stroke and every interior seam. (3) Interior
 * creases (full width, traced coordinates) and detail lines (toes) go last. The result is one continuous silhouette whose outline is exactly LINE.width wide at
 * any joint angle: no masks, no seams, no crumbs. The geometry is inset by LINE.width / 2 in the tracer, so the
 * visible outline sits where a centred stroke on the traced edge would.
 */
export const Leg: React.FC<{
	geom: LegGeom;
	mount: Pt;
	angles: LegAngles;
	uid: string;
	far?: boolean;
	spots?: readonly BadgerSpot[];
	/** 'underlay': only the under-torso outline of the segments' `underlay` edges (twice LINE.width), for a near leg. */
	pass?: 'normal' | 'underlay';
}> = ({geom, mount, angles, uid, far, spots = [], pass = 'normal'}) => {
	const upperT = tr(mount, angles.upper);
	const lowerT = `${upperT} ${tr(geom.lowerPivot, angles.lower)}`;
	const pawT = `${lowerT} ${tr(geom.pawPivot, angles.paw)}`;
	const T: Record<SegKey, string> = {upper: upperT, lower: lowerT, paw: pawT};
	const L0 = useStrokes();
	if (pass === 'underlay') {
		const u = {...L0.stroke, strokeWidth: LINE.width * 2 * L0.k};
		return (
			<g>
				{SEGS.map((s) =>
					geom[s].underlay?.length ? (
						<g key={`ul${s}`} transform={T[s]}>
							{geom[s].underlay!.map((d, i) => (
								<path key={i} d={d} {...u} />
							))}
						</g>
					) : null,
				)}
			</g>
		);
	}
	const color = far ? BADGER_COLORS.coatShadow : BADGER_COLORS.coat;
	const bySeg = (s: SegKey) => spots.filter((p) => (p.segment ?? 'upper') === s);
	const rl = geom.lowerJointR;
	const rp = geom.pawJointR;
	const L = L0;
	const under = {...L.stroke, strokeWidth: LINE.width * 2 * L.k};
	const lowerBent = Math.abs(angles.lower) > 0.25;
	const pawBent = Math.abs(angles.paw) > 0.25;
	const fillets = jointFillets(geom, angles.lower);
	return (
		<g>
			{SEGS.map((s) => (
				<g key={`u${s}`} transform={T[s]}>
					{geom[s].strokes.map((d, i) => (
						<path key={i} d={d} {...under} />
					))}
					{far
						? (geom[s].underlay ?? []).map((d, i) => (
								<path key={`ul${i}`} d={d} {...under} />
							))
						: null}
				</g>
			))}
			{fillets.map((f, i) => (
				<path key={`fa${i}`} d={f.arc} transform={upperT} {...under} />
			))}
			{rl && lowerBent ? <path d={circle(rl)} transform={lowerT} {...under} /> : null}
			{rp && pawBent ? <path d={circle(rp)} transform={pawT} {...under} /> : null}
			{rl ? <path d={circle(rl)} transform={lowerT} fill={color} /> : null}
			{rp ? <path d={circle(rp)} transform={pawT} fill={color} /> : null}
			{fillets.map((f, i) => (
				<path key={`ff${i}`} d={f.fill} transform={upperT} fill={color} />
			))}
			{SEGS.map((s) => (
				<g key={s} transform={T[s]}>
					<path d={geom[s].fill} fill={color} />
					{bySeg(s).length ? (
						<>
							<clipPath id={`${uid}-c${s}`}>
								<path d={geom[s].fill} />
							</clipPath>
							<g clipPath={`url(#${uid}-c${s})`}>
								<SpotShapes spots={bySeg(s)} />
							</g>
						</>
					) : null}
				</g>
			))}
			{SEGS.map((s) => {
				const creases = geom[s].creases ?? [];
				return geom[s].details.length || creases.length ? (
					<g key={`d${s}`} transform={T[s]}>
						{creases.map((d, i) => (
							<path key={`c${i}`} d={d} {...L.stroke} />
						))}
						{geom[s].details.map((d, i) => (
							<path key={i} d={d} {...L.detail} />
						))}
					</g>
				) : null;
			})}
		</g>
	);
};
