/**
 * Small segment glyphs drawn in the house style (fill, then the near-black outline on top).
 *  - Flag (Badger's Red Flag): drawn near-black, NOT red. ART_GUIDE CV5 reserves red and green for price direction
 *    only, so "red flag" is said in words; the owner can switch the fill to the chart red in one place if he wants it.
 *  - ShieldCheck (Zoo's One Fix), Pushpin (pinned Correction), Stamp (Scam of the Week).
 */
import React from 'react';
import {G} from './theme';

export const FlagGlyph: React.FC<{x: number; y: number; size: number}> = ({x, y, size}) => {
	const s = size / 100;
	return (
		<svg width={size} height={size} viewBox="0 0 100 100" style={{position: 'absolute', left: x, top: y, overflow: 'visible'}}>
			<path d="M 22 10 V 94" stroke={G.ink} strokeWidth={8} strokeLinecap="round" />
			<path d="M 26 14 C 46 4 58 24 84 14 V 56 C 58 66 46 46 26 56 Z" fill={G.ink} stroke={G.ink} strokeWidth={4 / s} strokeLinejoin="round" />
		</svg>
	);
};

export const ShieldCheck: React.FC<{x: number; y: number; size: number}> = ({x, y, size}) => (
	<svg width={size} height={size} viewBox="0 0 100 100" style={{position: 'absolute', left: x, top: y}}>
		<path d="M 50 6 L 88 20 V 48 C 88 72 70 88 50 96 C 30 88 12 72 12 48 V 20 Z" fill={G.slate} />
		<path d="M 50 6 L 88 20 V 48 C 88 72 70 88 50 96 C 30 88 12 72 12 48 V 20 Z" fill="none" stroke={G.ink} strokeWidth={4.5} strokeLinejoin="round" />
		<path d="M 32 52 L 45 65 L 69 38" fill="none" stroke={G.card} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

export const Pushpin: React.FC<{x: number; y: number; size: number}> = ({x, y, size}) => (
	<svg width={size} height={size} viewBox="0 0 100 100" style={{position: 'absolute', left: x, top: y, overflow: 'visible'}}>
		<path d="M 50 62 L 46 96" stroke={G.ink} strokeWidth={6} strokeLinecap="round" />
		<path d="M 30 14 H 70 L 64 40 L 78 56 H 22 L 36 40 Z" fill={G.slate} />
		<path d="M 30 14 H 70 L 64 40 L 78 56 H 22 L 36 40 Z" fill="none" stroke={G.ink} strokeWidth={4.5} strokeLinejoin="round" />
		<path d="M 28 8 H 72" stroke={G.ink} strokeWidth={8} strokeLinecap="round" />
	</svg>
);

/** A rubber-stamp frame (Scam of the Week): an off-white plate, double border. Text goes on top as HTML. */
export const StampFrame: React.FC<{x: number; y: number; w: number; h: number}> = ({x, y, w, h}) => (
	<div style={{position: 'absolute', left: x, top: y, width: w, height: h, boxSizing: 'border-box', border: `5px solid ${G.ink}`, borderRadius: 10, backgroundColor: G.card}}>
		<div style={{position: 'absolute', inset: 6, border: `2.5px solid ${G.ink}`, borderRadius: 6}} />
	</div>
);
