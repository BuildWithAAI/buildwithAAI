/**
 * Flat contact shadows for the character compositions (decision INT-C1; ART_GUIDE LS4 and CV4a): one ellipse in
 * BRAND.backgroundShadow under each figure's feet or paws, centred on its ground line. No blur, no opacity, no
 * gradient. Badger's off-white coat and Zoo's sneakers are only a few L* from the background, so the shadow is what
 * plants them on the floor.
 *
 * Footprints are world units relative to the character's ground point (x = centre offset, rx/ry = radii): the outermost
 * sole, paw, wheel or leg pixels in the 8 units above the ground line, plus a 10-unit margin at each end. Measured on the
 * round-2 rigs and re-measured on the round-4 rigs (each figure alone at scale 1; integration round 4 updated the Zoo
 * side and back views and Badger's 3/4, sit, lie, walk and look-up entries, which had drifted 2-5 units; integration round 5
 * re-checked every entry on the round-5 rigs: all within 1.5 units, unchanged). They agree with
 * the episode engine's ellipses (src/episode/scenes/parts.tsx) to within about 10 units.
 */
import React from 'react';
import {BRAND} from '../../characters/palette';

export type Footprint = {cx: number; rx: number; ry: number};

export const FOOTPRINTS = {
	/** Front view, standing or pointing: sneakers at -111..+110. */
	zooFront: {cx: -1, rx: 121, ry: 16},
	zooThreeQuarter: {cx: -3, rx: 118, ry: 16},
	zooSide: {cx: 2, rx: 87, ry: 16},
	zooBack: {cx: 0, rx: 109, ry: 16},
	/** Seated typing pose with its props: one floor shadow under the chair base, the feet and the desk legs. */
	zooTyping: {cx: 10, rx: 363, ry: 16},
	/** 'left' view, standing and looking up (same stance): paws at -189..+187. */
	badgerLeft: {cx: -1, rx: 198, ry: 15},
	badgerFront: {cx: 1, rx: 79, ry: 15},
	badgerThreeQuarter: {cx: -4, rx: 119, ry: 15},
	badgerRight: {cx: -14, rx: 187, ry: 15},
	badgerBack: {cx: 2, rx: 91, ry: 15},
	badgerSitRight: {cx: -46, rx: 157, ry: 15},
	badgerSitLeft: {cx: 45, rx: 157, ry: 15},
	badgerLieRight: {cx: -26, rx: 279, ry: 15},
	badgerLieLeft: {cx: 25, rx: 279, ry: 15},
	/** Walk phase 0, right-facing (the sheet's walk still). */
	badgerWalkRight: {cx: 21, rx: 282, ry: 15},
	badgerLookUpRight: {cx: -14, rx: 186, ry: 15},
} as const satisfies Record<string, Footprint>;

/** One flat contact shadow for a figure whose ground point is (x, y) at `scale`. Draw it before the figure. */
export const ContactShadow: React.FC<{x: number; y: number; scale: number; print: Footprint}> = ({x, y, scale, print}) => (
	<ellipse cx={x + print.cx * scale} cy={y + scale} rx={print.rx * scale} ry={print.ry * scale} fill={BRAND.backgroundShadow} />
);
