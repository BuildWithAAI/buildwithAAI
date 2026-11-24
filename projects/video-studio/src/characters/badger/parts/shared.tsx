import React, {useId} from 'react';
import {BADGER_COLORS, LINE} from '../../palette';

/** A clip-path id that is unique per Badger instance and safe inside url(#...). */
export const useUid = (prefix: string): string => {
	const raw = useId();
	return `${prefix}-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
};

export const STROKE = {
	fill: 'none',
	stroke: LINE.color,
	strokeWidth: LINE.width,
	strokeLinecap: 'round',
	strokeLinejoin: 'round',
} as const;

export const DETAIL = {
	fill: 'none',
	stroke: LINE.color,
	strokeWidth: LINE.detailWidth,
	strokeLinecap: 'round',
	strokeLinejoin: 'round',
} as const;

export type ShapeGeom = {
	readonly fill: string;
	readonly strokes: readonly string[];
	readonly details: readonly string[];
};

export type Pt = {readonly x: number; readonly y: number};

/**
 * One rig part: solid fill, then everything that must stay inside the part (flat shadow shapes,
 * spots) clipped to the fill outline, then the open outline strokes and interior detail lines.
 */
export const PartShape: React.FC<{
	geom: ShapeGeom;
	clipId: string;
	color?: string;
	children?: React.ReactNode;
	strokeColor?: string;
}> = ({geom, clipId, color = BADGER_COLORS.coat, children, strokeColor}) => {
	const lineProps = strokeColor ? {...STROKE, stroke: strokeColor} : STROKE;
	const detailProps = strokeColor ? {...DETAIL, stroke: strokeColor} : DETAIL;
	return (
		<g>
			<clipPath id={clipId}>
				<path d={geom.fill} />
			</clipPath>
			<path d={geom.fill} fill={color} />
			{children ? <g clipPath={`url(#${clipId})`}>{children}</g> : null}
			{geom.strokes.map((d, i) => (
				<path key={`s${i}`} d={d} {...lineProps} />
			))}
			{geom.details.map((d, i) => (
				<path key={`d${i}`} d={d} {...detailProps} />
			))}
		</g>
	);
};

export const tr = (p: Pt, angle = 0): string => `translate(${p.x} ${p.y})${angle ? ` rotate(${angle})` : ''}`;

export const clamp01 = (v: number | undefined, fallback = 0): number => {
	const n = v ?? fallback;
	return Math.max(0, Math.min(1, Number.isFinite(n) ? n : fallback));
};
