import React from 'react';
import {BADGER_COLORS, LINE} from '../../palette';
import {Pt, ShapeGeom, tr, useStrokes} from './shared';
import {SpotShapes} from './SpotShapes';
import {samplePath} from './pathSample';
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

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const pt2 = (q: Pt) => `${f2(q.x)} ${f2(q.y)}`;

/** An outline edge leaving a joint: sampled points ordered from the joint outward (segment-local space). */
type EdgeRun = {pts: Pt[]; side: number};
/** Both joints of a leg: the parent segment's edges ending at the child pivot, the child's edges starting at its origin. */
type JointEdges = {parent: EdgeRun[]; child: EdgeRun[]};
const RUN = 48; // units of each edge kept near the joint
const runFrom = (pts: Pt[]): Pt[] => {
	const out = [pts[0]];
	let s = 0;
	for (let i = 1; i < pts.length && s < RUN; i++) {
		s += dist(pts[i - 1], pts[i]);
		out.push(pts[i]);
	}
	return out;
};
/** Edges of `strokes` with an end within 30 units of `q`, as runs leaving q (both ends of a stroke may qualify). */
const edgesAt = (strokes: readonly string[], q: Pt, axisX: number): EdgeRun[] => {
	const out: EdgeRun[] = [];
	for (const d of strokes) {
		const pts = samplePath(d, 16);
		if (pts.length < 2) continue;
		for (const run of [pts, [...pts].reverse()]) {
			if (dist(run[0], q) < 30) out.push({pts: runFrom(run), side: Math.sign(run[0].x - axisX)});
		}
	}
	return out;
};
const EDGE_CACHE = new WeakMap<LegGeom, {lower: JointEdges; paw: JointEdges}>();
const jointEdges = (geom: LegGeom) => {
	let e = EDGE_CACHE.get(geom);
	if (!e) {
		const O = {x: 0, y: 0};
		e = {
			lower: {parent: edgesAt(geom.upper.strokes, geom.lowerPivot, geom.lowerPivot.x), child: edgesAt(geom.lower.strokes, O, 0)},
			paw: {parent: edgesAt(geom.lower.strokes, geom.pawPivot, geom.pawPivot.x), child: edgesAt(geom.paw.strokes, O, 0)},
		};
		EDGE_CACHE.set(geom, e);
	}
	return e;
};
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const sub = (a: Pt, b: Pt): Pt => ({x: a.x - b.x, y: a.y - b.y});
/** First crossing of two polylines (smallest summed arc length from their starts). */
const firstCrossing = (A: Pt[], B: Pt[]): {p: Pt; ia: number; ta: number; ib: number; tb: number} | null => {
	let best: {p: Pt; ia: number; ta: number; ib: number; tb: number} | null = null;
	let bestS = Infinity;
	let sa = 0;
	for (let i = 0; i + 1 < A.length; i++) {
		const r = sub(A[i + 1], A[i]);
		const la = Math.hypot(r.x, r.y);
		let sb = 0;
		for (let j = 0; j + 1 < B.length; j++) {
			const q = sub(B[j + 1], B[j]);
			const lb = Math.hypot(q.x, q.y);
			const den = cross(r, q);
			if (Math.abs(den) > 1e-9) {
				const w = sub(B[j], A[i]);
				const t = cross(w, q) / den;
				const u = cross(w, r) / den;
				if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && sa + t * la + sb + u * lb < bestS) {
					bestS = sa + t * la + sb + u * lb;
					best = {p: {x: A[i].x + r.x * t, y: A[i].y + r.y * t}, ia: i, ta: t, ib: j, tb: u};
				}
			}
			sb += lb;
		}
		sa += la;
	}
	return best;
};
/** The polyline from a crossing (segment i, fraction t) outward for `len` units: its points, end point and end tangent. */
const walkOut = (P: Pt[], i: number, t: number, len: number): {pts: Pt[]; end: Pt; tan: Pt} | null => {
	let cur = {x: P[i].x + (P[i + 1].x - P[i].x) * t, y: P[i].y + (P[i + 1].y - P[i].y) * t};
	const pts = [cur];
	let left = len;
	for (let k = i + 1; k < P.length; k++) {
		const d = dist(cur, P[k]);
		if (d >= left) {
			const f = left / d;
			const end = {x: cur.x + (P[k].x - cur.x) * f, y: cur.y + (P[k].y - cur.y) * f};
			pts.push(end);
			return {pts, end, tan: {x: (P[k].x - cur.x) / d, y: (P[k].y - cur.y) / d}};
		}
		left -= d;
		cur = P[k];
		pts.push(cur);
	}
	return null;
};
const FILLET_R = 9;
const FILLET_MAX = 15;
/**
 * Round-2 repair (decision BADGER-D35): a strongly bent wrist / hock / pastern left a sharp V where the parent and child
 * outlines cross on the inside of the bend. For each pair of edges that actually cross (sampled on the drawn curves, child
 * edge moved into parent space), the V is filled with a fillet tangent to both edges (radius FILLET_R units, cut back at
 * most FILLET_MAX units along each edge): `fill` goes with the segment fills, `arc` is its outline for the under-stroke
 * pass, so the inside of the joint reads as one soft curve. The outside of the bend is closed by the round joint disk.
 * Paths are in the PARENT segment's space (upper for the wrist / hock, lower for the pastern).
 */
const jointFillets = (edges: JointEdges, pivot: Pt, deg: number): {fill: string; arc: string}[] => {
	if (Math.abs(deg) < 8) return [];
	const th = (deg * Math.PI) / 180;
	const c = Math.cos(th);
	const s = Math.sin(th);
	const toParent = (v: Pt): Pt => ({x: pivot.x + v.x * c - v.y * s, y: pivot.y + v.x * s + v.y * c});
	const out: {fill: string; arc: string}[] = [];
	for (const pe of edges.parent) {
		for (const ce of edges.child) {
			if (ce.side !== pe.side) continue;
			const B = ce.pts.map(toParent);
			const X = firstCrossing(pe.pts, B);
			if (!X) continue;
			// outward tangents at the crossing
			const ta = walkOut(pe.pts, X.ia, X.ta, 1);
			const tb = walkOut(B, X.ib, X.tb, 1);
			if (!ta || !tb) continue;
			const cosA = Math.max(-1, Math.min(1, ta.tan.x * tb.tan.x + ta.tan.y * tb.tan.y));
			const alpha = Math.acos(cosA); // opening of the V between the two visible edges
			if (alpha > (165 * Math.PI) / 180 || alpha < (10 * Math.PI) / 180) continue;
			const dd = Math.min(FILLET_MAX, FILLET_R / Math.tan(alpha / 2));
			const ra = walkOut(pe.pts, X.ia, X.ta, dd);
			const rb = walkOut(B, X.ib, X.tb, dd);
			if (!ra || !rb) continue;
			const phi = Math.PI - alpha;
			const h = ((4 / 3) * Math.tan(phi / 4) * dd) / Math.tan(phi / 2);
			const c1 = {x: ra.end.x - ra.tan.x * h, y: ra.end.y - ra.tan.y * h};
			const c2 = {x: rb.end.x - rb.tan.x * h, y: rb.end.y - rb.tan.y * h};
			const arc = `M ${pt2(ra.end)} C ${pt2(c1)} ${pt2(c2)} ${pt2(rb.end)}`;
			const back = [...rb.pts].reverse();
			const fill = `M ${ra.pts.map(pt2).join(' L ')} C ${pt2(c1)} ${pt2(c2)} ${pt2(rb.end)} L ${back.map(pt2).join(' L ')} Z`;
			out.push({fill, arc});
		}
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
	// Fill-colour halo (stroke width, world units) on every leg fill: it closes the anti-aliasing seam where two fills of the
	// same leg abut over the dark under-stroke (wrist / hock / pastern), which showed as hairline ticks. The under-strokes are
	// widened by the same amount, so the visible outline stays LINE.width.
	const halo = LINE.width * 0.3 * L0.k;
	if (pass === 'underlay') {
		const u = {...L0.stroke, strokeWidth: LINE.width * 2 * L0.k + halo};
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
	const under = {...L.stroke, strokeWidth: LINE.width * 2 * L.k + halo};
	const fillP = {fill: color, stroke: color, strokeWidth: halo, strokeLinejoin: 'round' as const};
	const lowerBent = Math.abs(angles.lower) > 0.25;
	const pawBent = Math.abs(angles.paw) > 0.25;
	const E = jointEdges(geom);
	const fillets = jointFillets(E.lower, geom.lowerPivot, angles.lower);
	const pawFillets = jointFillets(E.paw, geom.pawPivot, angles.paw);
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
			{pawFillets.map((f, i) => (
				<path key={`pa${i}`} d={f.arc} transform={lowerT} {...under} />
			))}
			{rl && lowerBent ? <path d={circle(rl)} transform={lowerT} {...under} /> : null}
			{rp && pawBent ? <path d={circle(rp)} transform={pawT} {...under} /> : null}
			{rl ? <path d={circle(rl)} transform={lowerT} {...fillP} /> : null}
			{rp ? <path d={circle(rp)} transform={pawT} {...fillP} /> : null}
			{fillets.map((f, i) => (
				<path key={`ff${i}`} d={f.fill} transform={upperT} {...fillP} />
			))}
			{pawFillets.map((f, i) => (
				<path key={`pf${i}`} d={f.fill} transform={lowerT} {...fillP} />
			))}
			{SEGS.map((s) => (
				<g key={s} transform={T[s]}>
					<path d={geom[s].fill} {...fillP} />
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
