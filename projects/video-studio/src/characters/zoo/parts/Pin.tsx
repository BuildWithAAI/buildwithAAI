/**
 * The tiny teal jellyfish pin: a small dome with three short tentacles. Worn on the ANATOMICAL LEFT
 * chest, which is SCREEN RIGHT in the front view, just above the chest pocket (as on the sheet).
 */
import React from 'react';
import {BRAND, LINE, ZOO_COLORS} from '../../palette';

export const PIN_CENTER = {x: 58, y: -662} as const;

export const JellyfishPin: React.FC<{x?: number; y?: number}> = ({x = PIN_CENTER.x, y = PIN_CENTER.y}) => {
	const dome = `M${x - 7.2} ${y - 1} C${x - 7.2} ${y - 7.4} ${x - 3.6} ${y - 10.4} ${x} ${y - 10.4} C${x + 3.6} ${y - 10.4} ${x + 7.2} ${y - 7.4} ${x + 7.2} ${y - 1} C${x + 4.4} ${y - 0.1} ${x - 4.4} ${y - 0.1} ${x - 7.2} ${y - 1} Z`;
	const tentacles = [-3.6, 0, 3.6].map(
		(dx) => `M${x + dx} ${y + 0.4} C${x + dx - 1.3} ${y + 3} ${x + dx + 1.3} ${y + 5.4} ${x + dx} ${y + 8.6}`,
	);
	return (
		<g data-part="pin">
			{tentacles.map((d, i) => (
				<path key={`u${i}`} d={d} fill="none" stroke={LINE.color} strokeWidth={4.2} strokeLinecap="round" />
			))}
			{tentacles.map((d, i) => (
				<path key={`t${i}`} d={d} fill="none" stroke={ZOO_COLORS.pin} strokeWidth={2} strokeLinecap="round" />
			))}
			<path d={dome} fill={ZOO_COLORS.pin} stroke={LINE.color} strokeWidth={1.3} strokeLinejoin="round" />
			<path d={`M${x - 3.6} ${y - 7.4} C${x - 2.4} ${y - 8.6} ${x - 1} ${y - 9} ${x + 0.4} ${y - 9}`} fill="none" stroke={BRAND.offWhite} strokeWidth={1.1} strokeLinecap="round" />
		</g>
	);
};
