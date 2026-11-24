import React, {createContext, useContext, useId} from 'react';
import {LINE} from '../../palette';
import {safeId} from '../geometry';
import {ZOO_LINE} from '../lines';

/**
 * Multiplier applied to every ZOO stroke width (ZooRig `lineScale`, default 1). Parts read it through
 * useLineScale(); Shape and Stroke apply it automatically.
 */
export const LineScaleContext = createContext(1);
export const useLineScale = () => useContext(LineScaleContext);

type ShapeProps = {
	d: string;
	fill: string;
	/** One flat shadow tone, clipped to `d` (never a gradient or filter). */
	shadow?: {d: string; fill: string};
	/** Outline width in world units at lineScale 1; 0 = no outline. Defaults to LINE.width. */
	stroke?: number;
	strokeColor?: string;
	name?: string;
};

/** A filled part with an optional clipped flat shadow and an even near-black outline on top. */
export const Shape: React.FC<ShapeProps> = ({d, fill, shadow, stroke = ZOO_LINE.outline, strokeColor = LINE.color, name}) => {
	const id = safeId(useId(), 'clip');
	const ls = useLineScale();
	return (
		<g data-part={name}>
			<path d={d} fill={fill} />
			{shadow ? (
				<>
					<clipPath id={id}>
						<path d={d} />
					</clipPath>
					<path d={shadow.d} fill={shadow.fill} clipPath={`url(#${id})`} />
				</>
			) : null}
			{stroke > 0 ? <path d={d} fill="none" stroke={strokeColor} strokeWidth={stroke * ls} strokeLinejoin="round" strokeLinecap="round" /> : null}
		</g>
	);
};

/** An open detail stroke (seams, creases, finger separations). Width in world units at lineScale 1. */
export const Stroke: React.FC<{d: string; width?: number; color?: string; name?: string}> = ({d, width = ZOO_LINE.detail, color = LINE.color, name}) => {
	const ls = useLineScale();
	return <path data-part={name} d={d} fill="none" stroke={color} strokeWidth={width * ls} strokeLinejoin="round" strokeLinecap="round" />;
};

/** Outline only (closed or open path), drawn last over fills. Width in world units at lineScale 1. */
export const Outline: React.FC<{d: string; width?: number; color?: string; name?: string}> = ({d, width = ZOO_LINE.outline, color = LINE.color, name}) => {
	const ls = useLineScale();
	return <path data-part={name} d={d} fill="none" stroke={color} strokeWidth={width * ls} strokeLinejoin="round" strokeLinecap="round" />;
};

/** Region clipped to a path (used to keep beards, lids and irises inside their parent shape). */
export const Clipped: React.FC<{clip: string; children: React.ReactNode}> = ({clip, children}) => {
	const id = safeId(useId(), 'clip');
	return (
		<>
			<clipPath id={id}>
				<path d={clip} />
			</clipPath>
			<g clipPath={`url(#${id})`}>{children}</g>
		</>
	);
};
