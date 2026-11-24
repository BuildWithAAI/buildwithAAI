/**
 * Desktop monitor in the character style, seen FROM BEHIND as in the typing panel of zoo_model_sheet_v1.png (ZOO faces
 * the screen, we see its back). Local origin = centre of the stand's base where it rests on the desk; world units.
 *
 * Repair round 1 (measured on zoo_pose_typing.png at 1.555 u/px): a plain dark back panel (x 72..332, y -615..-416 in
 * the typing layout) with its lit left-side thickness, a slanted neck drawn IN FRONT of the panel's lower middle down
 * to a flat rectangular foot. v1 drew a screen-out bezel with a puck base. Repair round 2: panel and foot are straight-
 * edged polygons with small fillets (no spline overshoot at the corners).
 */
import React from 'react';
import {PROP_COLORS} from '../../palette';
import type {Placement} from '../../types';
import {smooth, type Pt} from '../geometry';
import {Shape} from '../parts/Shape';

const c = (pts: Pt[]): Pt[] => pts.map((p) => [p[0], p[1], 'c'] as Pt);
const f = (n: number) => (Math.round(n * 100) / 100).toString();
/**
 * Closed polygon with straight edges and a small circular-looking fillet (quadratic, inside the corner's hull) at every
 * vertex. Repair round 2: the back panel was a Catmull-Rom spline whose smooth points next to corners overshot ~11 u past
 * every corner (four 'horns'); with straight edges the panel's extent is exactly its vertices' extent.
 */
const roundedPoly = (v: readonly (readonly [number, number])[], r: number): string => {
	const n = v.length;
	const at = (i: number) => v[(i + n) % n];
	const toward = (a: readonly [number, number], b: readonly [number, number], d: number): [number, number] => {
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		const k = Math.min(d, len / 2) / len;
		return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
	};
	let d = '';
	for (let i = 0; i < n; i++) {
		const p = at(i);
		const a = toward(p, at(i - 1), r);
		const b = toward(p, at(i + 1), r);
		d += `${i === 0 ? 'M' : 'L'}${f(a[0])} ${f(a[1])} Q${f(p[0])} ${f(p[1])} ${f(b[0])} ${f(b[1])} `;
	}
	return d + 'Z';
};
/** Back panel corners: top-left, top-right, bottom-right, bottom-left (top at y -275.4, bottom-left at -71.6). */
export const MONITOR_BACK: readonly (readonly [number, number])[] = [[-143.6, -275.4], [97.2, -275.4], [87.2, -73.6], [-162.4, -71.6]];
const BACK = roundedPoly(MONITOR_BACK, 4.5);
/** The panel's left-side thickness (lit edge). */
const SIDE: Pt[] = c([[-150, -268], [-144, -271], [-162, -76], [-169, -73]]);
/** Slanted neck in front of the panel, foot to the panel's lower middle. */
const NECK: Pt[] = c([[-30, -132], [27, -132], [55, -16], [-9, -16]]);
const NECK_SHADOW: Pt[] = c([[12, -136], [32, -136], [60, -12], [40, -12]]);
const BASE = roundedPoly([[-80, -19], [90, -19], [90, -1.75], [-80, -1.75]], 2.6);

export const Monitor: React.FC<Placement> = ({x = 0, y = 0, scale = 1}) => (
	<g data-prop="monitor" transform={`translate(${x} ${y}) scale(${scale})`}>
		<Shape name="side" d={smooth(SIDE)} fill={PROP_COLORS.monitor} />
		<Shape name="back" d={BACK} fill={PROP_COLORS.monitorShadow} />
		<Shape name="base" d={BASE} fill={PROP_COLORS.monitorShadow} />
		<Shape name="neck" d={smooth(NECK)} fill={PROP_COLORS.monitor} shadow={{d: smooth(NECK_SHADOW), fill: PROP_COLORS.monitorShadow}} />
	</g>
);
