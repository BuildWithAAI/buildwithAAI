/**
 * Brows: dark, nearly straight with a short tail at the outer end. ASYMMETRIC at rest and drawn per side
 * (never mirrored): the anatomical-left brow (screen right) sits higher with a soft arch, giving the deadpan
 * "subtly raised brow" from the sheet. Repair round 1: ~7 u thick as on zoo_expr_neutral.png / zoo_turn_front.png
 * (v1 was ~9 u), near-black brown (palette ZOO-C5), and drawn AFTER the front hair so a raised brow never
 * slides under the forelock (the forelock lifts instead, see Hair.tsx).
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {smooth, type Pt} from '../geometry';
import {ZOO_LINE} from '../lines';
import type {BrowPose} from '../rig';
import {useLineScale} from './Shape';

/** Anatomical right brow (screen left): straight, lower. Inner end first, clockwise (top edge, tail, bottom edge). */
export const BROW_R: Pt[] = [
	[-9.4, -835.8, 'c'], [-18, -836.8], [-28.6, -836.2], [-35.6, -833.4], [-40.4, -826.4, 'c'], [-35, -828.6], [-28.6, -829.8],
	[-18, -829.4], [-9.4, -829.2, 'c'],
];
/** Anatomical left brow (screen right): raised, gently arched. */
export const BROW_L: Pt[] = [
	[9.4, -837.8, 'c'], [17, -839.4], [26.6, -839.6], [34.8, -836.6], [39.8, -828.6, 'c'], [34.4, -831.4], [26.6, -833],
	[17, -832.4], [9.4, -831.2, 'c'],
];

/**
 * Pose a brow. dy (up) = lift + inner*(1-t) + outer*t + arch*sin(pi*min(1, 1.15 t)) + curl*(1-t)^6, with t = 0 at the
 * inner end and 1 at the tail. `curl` (optional) is the sharp upturn of the inner end seen on the worried panel.
 */
export const posed = (pts: Pt[], pose: BrowPose, lift: number): Pt[] => {
	const xs = pts.map((p) => Math.abs(p[0]));
	const inner = Math.min(...xs);
	const outer = Math.max(...xs);
	const curl = pose.curl ?? 0;
	return pts.map((p) => {
		const t = (Math.abs(p[0]) - inner) / (outer - inner); // 0 inner .. 1 outer
		const dy = pose.lift + lift + pose.inner * (1 - t) + pose.outer * t + pose.arch * Math.sin(Math.PI * Math.min(1, t * 1.15)) + curl * Math.pow(1 - t, 6);
		return p.length === 3 ? [p[0], p[1] - dy, 'c'] : [p[0], p[1] - dy];
	});
};

/** Highest point (min y) of a posed brow's TOP edge within [x0, x1] (linear between key points). */
export const browTopIn = (pts: Pt[], x0: number, x1: number): number => {
	const top = pts.slice(0, 5); // inner end -> tail along the top edge
	let best = Infinity;
	for (let i = 0; i < top.length - 1; i++) {
		const [ax, ay] = top[i];
		const [bx, by] = top[i + 1];
		const lo = Math.max(Math.min(ax, bx), x0);
		const hi = Math.min(Math.max(ax, bx), x1);
		if (lo > hi) continue;
		for (const x of [lo, hi]) {
			const u = bx === ax ? 0 : (x - ax) / (bx - ax);
			best = Math.min(best, ay + (by - ay) * u);
		}
	}
	return best;
};

export const Brows: React.FC<{left: BrowPose; right: BrowPose; liftL: number; liftR: number; crease: number}> = ({left, right, liftL, liftR, crease}) => {
	const ls = useLineScale();
	return (
		<g data-part="brows">
			<path data-part="browR" d={smooth(posed(BROW_R, right, liftR))} fill={ZOO_COLORS.brow} />
			<path data-part="browL" d={smooth(posed(BROW_L, left, liftL))} fill={ZOO_COLORS.brow} />
			{crease > 0 ? (
				<g data-part="worryCrease">
					<path d="M-4.2 -846.6 C-4.9 -843.6 -4.7 -841 -3.8 -838.8" fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={ZOO_LINE.fine * 1.1 * crease * ls} strokeLinecap="round" />
					<path d="M4.4 -847 C5 -844 4.8 -841.4 3.9 -839.2" fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={ZOO_LINE.fine * 1.1 * crease * ls} strokeLinecap="round" />
				</g>
			) : null}
		</g>
	);
};
