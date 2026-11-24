/**
 * Brows: thick, dark, nearly straight with a short tail at the outer end. ASYMMETRIC at rest and
 * drawn per side (never mirrored): the anatomical-left brow (screen right) sits higher with a soft
 * arch, giving the deadpan "subtly raised brow" from the sheet.
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {smooth, type Pt} from '../geometry';
import type {BrowPose} from '../rig';

/** Anatomical right brow (screen left): straight, lower. Inner end first, clockwise. */
export const BROW_R: Pt[] = [
	[-8.5, -836.4, 'c'], [-18, -837.8], [-29, -837], [-36.8, -833.2], [-41, -824.8, 'c'], [-35.5, -827.6], [-29, -828.8],
	[-18, -828.6], [-8.5, -828.7, 'c'],
];
/** Anatomical left brow (screen right): raised, gently arched. */
export const BROW_L: Pt[] = [
	[9, -838.4, 'c'], [17, -840.6], [27, -840.8], [35.8, -837.2], [40.8, -827.8, 'c'], [35, -830.8], [27, -832.8],
	[17, -832.4], [9, -831, 'c'],
];

export const posed = (pts: Pt[], pose: BrowPose, lift: number): Pt[] => {
	const xs = pts.map((p) => Math.abs(p[0]));
	const inner = Math.min(...xs);
	const outer = Math.max(...xs);
	return pts.map((p) => {
		const t = (Math.abs(p[0]) - inner) / (outer - inner); // 0 inner .. 1 outer
		const dy = pose.lift + lift + pose.inner * (1 - t) + pose.outer * t + pose.arch * Math.sin(Math.PI * Math.min(1, t * 1.15));
		return p.length === 3 ? [p[0], p[1] - dy, 'c'] : [p[0], p[1] - dy];
	});
};

export const Brows: React.FC<{left: BrowPose; right: BrowPose; lift: number; crease: number}> = ({left, right, lift, crease}) => (
	<g data-part="brows">
		<path data-part="browR" d={smooth(posed(BROW_R, right, lift))} fill={ZOO_COLORS.brow} />
		<path data-part="browL" d={smooth(posed(BROW_L, left, lift))} fill={ZOO_COLORS.brow} />
		{crease > 0 ? (
			<g data-part="worryCrease">
				<path d="M-4.5 -846 C-5.2 -843 -5 -840.5 -4 -838.5" fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={1.6 * crease} strokeLinecap="round" />
				<path d="M4.8 -846.5 C5.4 -843.5 5.2 -841 4.3 -839" fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={1.6 * crease} strokeLinecap="round" />
			</g>
		) : null}
	</g>
);
