/**
 * Drawing helpers for the set, in the character style (ART_GUIDE SL4, LS3): a flat fill, at most one flat shadow
 * shape clipped to the same path, then the near-black outline drawn LAST as the same path with fill="none".
 * No gradients, filters, patterns or opacity tints.
 */
import React from 'react';
import {BRAND, LINE} from '../../characters/palette';

/** Rounded-rectangle path; r is clamped to half the shorter side. */
export const rr = (x: number, y: number, w: number, h: number, r: number): string => {
	const k = Math.max(0, Math.min(r, w / 2, h / 2));
	return `M ${x + k} ${y} H ${x + w - k} A ${k} ${k} 0 0 1 ${x + w} ${y + k} V ${y + h - k} A ${k} ${k} 0 0 1 ${x + w - k} ${y + h} H ${x + k} A ${k} ${k} 0 0 1 ${x} ${y + h - k} V ${y + k} A ${k} ${k} 0 0 1 ${x + k} ${y} Z`;
};

/** Rounded only at the top (a chair back, a panel whose bottom is hidden). */
export const rrTop = (x: number, y: number, w: number, h: number, r: number): string => {
	const k = Math.max(0, Math.min(r, w / 2, h));
	return `M ${x} ${y + h} V ${y + k} A ${k} ${k} 0 0 1 ${x + k} ${y} H ${x + w - k} A ${k} ${k} 0 0 1 ${x + w} ${y + k} V ${y + h} Z`;
};

/** A document-unique id for clip paths (React's useId, reduced to characters that are safe inside url(#...)). */
export const useUid = (prefix: string): string => `${prefix}${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

export type OutlinedProps = {
	d: string;
	fill: string;
	/** One flat shadow shape (any path), clipped to `d`. */
	shadow?: {d: string; fill: string};
	stroke?: number;
	color?: string;
	id: string;
};

/** Fill, clipped shadow, outline on top. Stroke widths are in stage units (the shot scales them). */
export const Outlined: React.FC<OutlinedProps> = ({d, fill, shadow, stroke = LINE.width, color = BRAND.nearBlack, id}) => (
	<g>
		<path d={d} fill={fill} />
		{shadow ? (
			<>
				<clipPath id={id}>
					<path d={d} />
				</clipPath>
				<path d={shadow.d} fill={shadow.fill} clipPath={`url(#${id})`} />
			</>
		) : null}
		{stroke > 0 ? <path d={d} fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" /> : null}
	</g>
);
