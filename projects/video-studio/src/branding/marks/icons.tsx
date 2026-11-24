/**
 * Series icons for the thumbnail badges: simple line icons on a 24-unit grid, round caps and joins, one stroke
 * colour (flat, no fills except small solid dots). Drawn to stay readable at 40-60 px.
 */
import React from 'react';
import {JellyfishMark} from './JellyfishMark';

export type IconName = 'jellyfish' | 'gauge' | 'flag' | 'wrench' | 'hook' | 'info' | 'pulse' | 'calendar';

const P: Record<Exclude<IconName, 'jellyfish'>, (c: string) => React.ReactNode> = {
	// Rekt Meter: a gauge arc with a needle swung far right
	gauge: (c) => (
		<>
			<path d="M3.5 16.5 A8.5 8.5 0 0 1 20.5 16.5" fill="none" stroke={c} />
			<path d="M12 16.5 L17.6 10.4" fill="none" stroke={c} />
			<circle cx="12" cy="16.5" r="1.9" fill={c} stroke="none" />
			<path d="M3.5 20 H20.5" fill="none" stroke={c} />
		</>
	),
	// Badger's Red Flag: a pennant on a pole (drawn, not coloured red: red means price direction only, CV5)
	flag: (c) => (
		<>
			<path d="M6 21.5 V3" fill="none" stroke={c} />
			<path d="M6 4 H18 L15 8.5 L18 13 H6" fill="none" stroke={c} />
		</>
	),
	// Zoo's One Fix: a wrench
	wrench: (c) => (
		<path
			d="M14.7 6.3 a4 4 0 0 0 4.9 4.9 l1.1 -1.1 a5.5 5.5 0 0 1 -7 7 L7.4 21.4 a2 2 0 0 1 -2.8 -2.8 l4.3 -4.3 a5.5 5.5 0 0 1 7 -7 Z"
			fill="none"
			stroke={c}
		/>
	),
	// Scam of the Week: a fish hook (phishing): eye, shank, bend and barb
	hook: (c) => (
		<>
			<circle cx="14.5" cy="3.6" r="1.9" fill="none" stroke={c} />
			<path d="M14.5 5.5 V14.5 A5 5 0 0 1 4.5 14.5 V11" fill="none" stroke={c} />
			<path d="M4.5 11 L7.8 14.2" fill="none" stroke={c} />
		</>
	),
	// What We Know: an info mark in a circle
	info: (c) => (
		<>
			<circle cx="12" cy="12" r="9.5" fill="none" stroke={c} />
			<path d="M12 11 V17" fill="none" stroke={c} />
			<circle cx="12" cy="7.3" r="1.5" fill={c} stroke="none" />
		</>
	),
	// Developing: a dot inside an open ring (an ongoing story)
	pulse: (c) => (
		<>
			<circle cx="12" cy="12" r="3.2" fill={c} stroke="none" />
			<path d="M12 3 a9 9 0 1 1 -8.5 6" fill="none" stroke={c} />
		</>
	),
	// Weekly Roundup: a calendar page
	calendar: (c) => (
		<>
			<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke={c} />
			<path d="M3.5 10 H20.5 M8 3 V7 M16 3 V7" fill="none" stroke={c} />
			<circle cx="8.5" cy="14.5" r="1.4" fill={c} stroke="none" />
			<circle cx="12" cy="14.5" r="1.4" fill={c} stroke="none" />
		</>
	),
};

/** An icon at (x, y) top-left with the given size (px), as an SVG <g>. */
export const Icon: React.FC<{name: IconName; x: number; y: number; size: number; color: string; accent?: string | null}> = ({name, x, y, size, color, accent = null}) => {
	if (name === 'jellyfish') {
		return <JellyfishMark cx={x + size / 2} cy={y + size / 2} height={size} color={color} accent={accent} strokeBoostPx={size * 0.02} />;
	}
	const k = size / 24;
	return (
		<g transform={`translate(${x} ${y}) scale(${k})`} stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
			{P[name](color)}
		</g>
	);
};
