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

/**
 * Line weight (BadgerExtraProps.lineScale), provided by <Badger/>: every outline and detail width is multiplied by it.
 * 1 (default) = the palette's LINE widths in world units. Use lineScaleFor(pxPerUnit) for the ART_GUIDE SL5 weights at a
 * framing, and pass the same value to ZooRig's lineScale so the pair keeps one line weight.
 */
export const LineScaleContext = React.createContext(1);

/** STROKE / DETAIL at the current line scale, plus the scale itself (k) for widths derived from LINE. */
export const useStrokes = () => {
	const k = React.useContext(LineScaleContext);
	return React.useMemo(
		() => ({
			k,
			stroke: k === 1 ? STROKE : {...STROKE, strokeWidth: LINE.width * k},
			detail: k === 1 ? DETAIL : {...DETAIL, strokeWidth: LINE.detailWidth * k},
		}),
		[k],
	);
};

/**
 * ART_GUIDE SL5: outline = clamp(LINE.width x k, 3, 6) px at output, where k = output px per world unit (placement scale
 * times any parent viewBox magnification). Returns the lineScale that produces it (the same formula as zoo/lines.ts).
 */
export const lineScaleFor = (pxPerUnit: number): number => {
	const k = Math.max(1e-6, pxPerUnit);
	const px = LINE.width * k;
	return Math.min(6, Math.max(3, px)) / px;
};

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
	const L = useStrokes();
	const lineProps = strokeColor ? {...L.stroke, stroke: strokeColor} : L.stroke;
	const detailProps = strokeColor ? {...L.detail, stroke: strokeColor} : L.detail;
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
