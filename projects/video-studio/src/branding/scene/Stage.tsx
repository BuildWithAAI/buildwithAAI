/**
 * Set pieces for branding shots, drawn in the character style: flat fills, near-black outline drawn last as the
 * same path with fill="none" (ART_GUIDE SL4, LS3), one radius scale, no gradients or filters (P1).
 */
import React from 'react';
import {BRAND} from '../../characters/palette';
import {BACKGROUND_SHADOW} from '../tokens';

/** Flat contact shadow under feet or paws (ART_GUIDE LS4): one ellipse in backgroundShadow, no blur, no opacity. */
export const ContactShadow: React.FC<{cx: number; cy: number; rx: number; ry: number}> = ({cx, cy, rx, ry}) => (
	<ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={BACKGROUND_SHADOW} />
);

const rr = (x: number, y: number, w: number, h: number, r: number) =>
	`M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;

/** A rounded-rectangle path (SVG units). */
export const roundedRect = rr;

/** A filled shape with its outline drawn on top (SL4). */
export const Outlined: React.FC<{d: string; fill: string; outline?: number; color?: string}> = ({d, fill, outline = 4, color = BRAND.nearBlack}) => (
	<>
		<path d={d} fill={fill} />
		{outline > 0 ? <path d={d} fill="none" stroke={color} strokeWidth={outline} strokeLinejoin="round" /> : null}
	</>
);

/**
 * The show's front-view desk: a slate top slab over an off-white front panel with one flat shadow band at the
 * bottom (the key light is upper-left, LS1). Geometry in px; `topY` is the top face of the slab.
 */
export const ShowDesk: React.FC<{x: number; topY: number; w: number; h: number; outline: number; slab?: number; radius?: number}> = ({
	x,
	topY,
	w,
	h,
	outline,
	slab = 34,
	radius = 16,
}) => {
	const panel = rr(x + 18, topY + slab - 2, w - 36, h - slab + 2, Math.min(radius, 8));
	const top = rr(x, topY, w, slab, Math.min(radius, slab / 2));
	const shadowH = Math.round(h * 0.16);
	return (
		<g data-part="desk">
			<path d={panel} fill={BRAND.offWhite} />
			<clipPath id={`deskPanel${Math.round(x)}`}>
				<path d={panel} />
			</clipPath>
			<rect x={x} y={topY + h - shadowH} width={w} height={shadowH} fill={BRAND.silver} clipPath={`url(#deskPanel${Math.round(x)})`} />
			<path d={panel} fill="none" stroke={BRAND.nearBlack} strokeWidth={outline} strokeLinejoin="round" />
			<Outlined d={top} fill={BRAND.slate} outline={outline} />
		</g>
	);
};
