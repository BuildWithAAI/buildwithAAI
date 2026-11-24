import React, {useId} from 'react';
import {LINE} from '../../palette';
import {safeId} from '../geometry';

type ShapeProps = {
	d: string;
	fill: string;
	/** One flat shadow tone, clipped to `d` (never a gradient or filter). */
	shadow?: {d: string; fill: string};
	/** Outline width; 0 = no outline. Defaults to LINE.width. */
	stroke?: number;
	strokeColor?: string;
	name?: string;
};

/** A filled part with an optional clipped flat shadow and an even near-black outline on top. */
export const Shape: React.FC<ShapeProps> = ({d, fill, shadow, stroke = LINE.width, strokeColor = LINE.color, name}) => {
	const id = safeId(useId(), 'clip');
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
			{stroke > 0 ? <path d={d} fill="none" stroke={strokeColor} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" /> : null}
		</g>
	);
};

/** An open detail stroke (seams, creases, finger separations). */
export const Stroke: React.FC<{d: string; width?: number; color?: string; name?: string}> = ({d, width = LINE.detailWidth, color = LINE.color, name}) => (
	<path data-part={name} d={d} fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" />
);

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
