/**
 * Flat contact shadows for the character compositions (decision INT-C1; ART_GUIDE LS4 and CV4a): one ellipse in
 * BRAND.backgroundShadow under each figure's feet or paws, centred on its ground line. No blur, no opacity, no
 * gradient. Badger's off-white coat and Zoo's sneakers are only a few L* from the background, so the shadow is what
 * plants them on the floor.
 *
 * Footprints are world units relative to the character's ground point (x = centre offset, rx/ry = radii), measured on
 * the round-2 rigs: the outermost sole, paw, wheel or leg pixels in the 8 px above the ground line of ZooSheet,
 * BadgerSheet and Preview10s, plus a 10-unit margin at each end. They agree with the episode engine's ellipses
 * (src/episode/scenes/parts.tsx) to within about 10 units.
 */
import React from 'react';
import {BRAND} from '../../characters/palette';

export type Footprint = {cx: number; rx: number; ry: number};

export const FOOTPRINTS = {
	/** Front view, standing or pointing: sneakers at -111..+110. */
	zooFront: {cx: -1, rx: 121, ry: 16},
	zooThreeQuarter: {cx: -3, rx: 118, ry: 16},
	zooSide: {cx: 4, rx: 90, ry: 16},
	zooBack: {cx: 2, rx: 112, ry: 16},
	/** Seated typing pose with its props: one floor shadow under the chair base, the feet and the desk legs. */
	zooTyping: {cx: 8, rx: 365, ry: 16},
	/** 'left' view, standing and looking up (same stance): paws at -189..+187. */
	badgerLeft: {cx: -1, rx: 198, ry: 15},
	badgerFront: {cx: 1, rx: 79, ry: 15},
	badgerThreeQuarter: {cx: -3, rx: 124, ry: 15},
	badgerRight: {cx: -14, rx: 187, ry: 15},
	badgerBack: {cx: 2, rx: 91, ry: 15},
	badgerSitRight: {cx: -49, rx: 161, ry: 15},
	badgerSitLeft: {cx: 47, rx: 161, ry: 15},
	badgerLieRight: {cx: -28, rx: 282, ry: 15},
	badgerLieLeft: {cx: 26, rx: 282, ry: 15},
	/** Walk phase 0, right-facing (the sheet's walk still). */
	badgerWalkRight: {cx: 19, rx: 287, ry: 15},
	badgerLookUpRight: {cx: -14, rx: 190, ry: 15},
} as const satisfies Record<string, Footprint>;

/** One flat contact shadow for a figure whose ground point is (x, y) at `scale`. Draw it before the figure. */
export const ContactShadow: React.FC<{x: number; y: number; scale: number; print: Footprint}> = ({x, y, scale, print}) => (
	<ellipse cx={x + print.cx * scale} cy={y + scale} rx={print.rx * scale} ry={print.ry * scale} fill={BRAND.backgroundShadow} />
);
