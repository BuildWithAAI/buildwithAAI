/**
 * The tiny teal jellyfish pin: a small dome with three short tentacles. Worn on the ANATOMICAL LEFT chest, which is
 * SCREEN RIGHT in the front view, just above the chest pocket (as on the sheet).
 *
 * Repair round 2 (teal rows measured on zoo_expr_neutral.png at 0.699 u/px and on zoo_turn_front.png): a compact badge.
 * The dome is ~18 x 12 u; the three tentacles are ~9.5 u long, ~5 u apart, splay only slightly and end inside the dome's
 * width; each is cased in near-black like the sheet's (the casing is an outline, so it follows lineScale). Round 1's
 * tentacles were 15 u long, splayed wider than the dome and had no casing, so the pin read as a long-legged squid.
 * Default size 1.15; centre on the sheet's (58, -660). No highlight tone (ART_GUIDE CV3).
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {ZOO_LINE} from '../lines';
import {useLineScale} from './Shape';

export const PIN_CENTER = {x: 58, y: -660} as const;
/** Pin geometry in pin-local units (before `size`): dome half-width/top, tentacle length and teal width. */
export const PIN_SHAPE = {domeHalfWidth: 7.8, domeTop: -10.6, tentacleEnd: 8.2, tentacleWidth: 2.4} as const;

export const JellyfishPin: React.FC<{x?: number; y?: number; size?: number}> = ({x = PIN_CENTER.x, y = PIN_CENTER.y, size = 1.15}) => (
	<g transform={`translate(${x} ${y}) scale(${size}) translate(${-x} ${-y})`}>
		<PinShape x={x} y={y} size={size} />
	</g>
);

/** Tentacle centrelines: dx where they leave the dome, end dx (inside the dome's width), slight S-curve sign. */
const TENTACLES = [
	{x0: -4.4, x1: -5, s: 1},
	{x0: 0, x1: 0.2, s: -1},
	{x0: 4.4, x1: 5.2, s: 1},
] as const;

const PinShape: React.FC<{x: number; y: number; size: number}> = ({x, y, size}) => {
	const ls = useLineScale();
	const {domeHalfWidth: w, domeTop: t, tentacleEnd: e, tentacleWidth: tw} = PIN_SHAPE;
	const dome = `M${x - w} ${y - 0.8} C${x - w} ${y + t * 0.62} ${x - w * 0.52} ${y + t} ${x} ${y + t} C${x + w * 0.52} ${y + t} ${x + w} ${y + t * 0.62} ${x + w} ${y - 0.8} C${x + w * 0.6} ${y + 0.2} ${x - w * 0.6} ${y + 0.2} ${x - w} ${y - 0.8} Z`;
	const tentacles = TENTACLES.map(({x0, x1, s}) => {
		const a = x + x0;
		const b = x + x1;
		const m = (a + b) / 2;
		return `M${a} ${y - 1.2} C${m - 0.7 * s} ${y + e * 0.3} ${m + 0.7 * s} ${y + e * 0.62} ${b} ${y + e}`;
	});
	// The casing is an outline: ZOO_LINE.fine at the current lineScale on each side, in pin-local units (divide by size).
	const casing = tw + (2 * ZOO_LINE.fine * ls) / size;
	return (
		<g data-part="pin">
			{tentacles.map((d, i) => (
				<path key={`c${i}`} d={d} fill="none" stroke={LINE.color} strokeWidth={casing} strokeLinecap="round" />
			))}
			{tentacles.map((d, i) => (
				<path key={`t${i}`} d={d} fill="none" stroke={ZOO_COLORS.pin} strokeWidth={tw} strokeLinecap="round" />
			))}
			<path d={dome} fill={ZOO_COLORS.pin} stroke={LINE.color} strokeWidth={(ZOO_LINE.fine * ls) / size} strokeLinejoin="round" />
		</g>
	);
};
