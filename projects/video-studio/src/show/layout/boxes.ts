/**
 * Where each segment's graphics sit, per format (pure data, px). Every box keeps the format's safe area (shots.ts SAFE)
 * and clears the on-camera faces by at least one head width (ART_GUIDE CV4c); tests/layout.test.ts checks both.
 *
 * Landscape: cards sit opposite the on-camera character (zooR -> left card, zooL -> right card, Zoo's point gesture
 *   reaches to x ~ 966, so a right card starts at 1000), or fill the frame when the shot is `none`.
 * Vertical: graphics take the band between the Shorts header (top 10%) and the characters' heads; full-frame graphics
 *   stop above the caption band (y 1312).
 */
import type {Format, ShowSegment} from '../types.ts';
import type {Box} from '../diagram/layout.ts';
import type {ShotName} from './shots.ts';

export type From = 'left' | 'right' | 'top' | 'bottom';
export type SegmentBoxes = {card: Box | null; source: Box | null; from: From};

/**
 * The header row: the segment tag and the persistent DEVELOPING badge. In a single the row moves to the side of the
 * graphics, away from the on-camera face (CV4c clear zone); in two-shots and full graphics it spans the frame.
 */
export type HeaderSlots = {tag: {x: number; y: number; maxW: number}; badge: {right: number; y: number}};
export const headerSlots = (format: Format, shot: ShotName): HeaderSlots => {
	if (format === 'vertical') return {tag: {x: 54, y: 204, maxW: 560}, badge: {right: 1026, y: 204}};
	if (shot === 'zooR' || shot === 'badgerR') return {tag: {x: 96, y: 54, maxW: 500}, badge: {right: 996, y: 54}};
	if (shot === 'zooL') return {tag: {x: 1000, y: 54, maxW: 420}, badge: {right: 1824, y: 54}};
	return {tag: {x: 96, y: 54, maxW: 800}, badge: {right: 1824, y: 54}};
};
/** Review badges (silent preview, dev fixture, machine translation): bottom right, never published. */
export const REVIEW_POS: Record<Format, {right: number; bottom: number}> = {landscape: {right: 1824, bottom: 1026}, vertical: {right: 1026, bottom: 1880}};

/** Burned-in captions: a plate in this band, centred (vertical: clear of the Shorts buttons, x <= 950). */
export const CAPTION_BAND: Record<Format, Box> = {
	landscape: {x: 460, y: 930, w: 1000, h: 96},
	vertical: {x: 130, y: 1312, w: 820, h: 188},
};

const L_LEFT: Box = {x: 96, y: 138, w: 900, h: 812};
const L_RIGHT: Box = {x: 1000, y: 138, w: 824, h: 812};
const L_FULL: Box = {x: 96, y: 138, w: 1728, h: 812};
const L_SRC_LEFT: Box = {x: 96, y: 966, w: 900, h: 44};
const L_SRC_RIGHT: Box = {x: 1000, y: 966, w: 824, h: 44};
const L_SRC_FULL: Box = {x: 96, y: 966, w: 1728, h: 44};

const V_TWO: Box = {x: 54, y: 300, w: 972, h: 392};
const V_ZOO: Box = {x: 54, y: 300, w: 972, h: 320};
const V_BADGER: Box = {x: 54, y: 300, w: 972, h: 460};
const V_FULL: Box = {x: 54, y: 300, w: 972, h: 940};
const vsrc = (b: Box): Box => ({x: 54, y: b.y + b.h + 12, w: 972, h: 44});

export const SEGMENT_BOXES: Record<Format, Record<ShowSegment, SegmentBoxes>> = {
	landscape: {
		coldOpen: {card: {x: 96, y: 930, w: 560, h: 72}, source: null, from: 'left'},
		headline: {card: L_LEFT, source: L_SRC_LEFT, from: 'left'},
		howItWorked: {card: L_RIGHT, source: L_SRC_RIGHT, from: 'right'},
		badgerRedFlag: {card: {x: 96, y: 138, w: 860, h: 760}, source: {x: 96, y: 914, w: 860, h: 44}, from: 'left'},
		zooOneFix: {card: {x: 1000, y: 180, w: 824, h: 660}, source: {x: 1000, y: 856, w: 824, h: 44}, from: 'right'},
		scamOfTheWeek: {card: L_FULL, source: L_SRC_FULL, from: 'bottom'},
		correction: {card: L_LEFT, source: L_SRC_LEFT, from: 'left'},
		sources: {card: L_FULL, source: null, from: 'bottom'},
		outroEndScreen: {card: {x: 1032, y: 160, w: 792, h: 866}, source: null, from: 'right'},
		beat: {card: null, source: null, from: 'left'},
		desk: {card: L_LEFT, source: L_SRC_LEFT, from: 'left'},
	},
	vertical: {
		// the kicker slate: 80 px tall so the ON AIR sign (stage.ts) clears it below, push-in included (checks.ts)
		coldOpen: {card: {x: 54, y: 300, w: 972, h: 80}, source: null, from: 'top'},
		headline: {card: V_TWO, source: vsrc(V_TWO), from: 'top'},
		howItWorked: {card: V_FULL, source: {x: 54, y: 1252, w: 972, h: 44}, from: 'top'},
		badgerRedFlag: {card: V_BADGER, source: vsrc(V_BADGER), from: 'top'},
		zooOneFix: {card: V_ZOO, source: vsrc(V_ZOO), from: 'top'},
		scamOfTheWeek: {card: V_TWO, source: vsrc(V_TWO), from: 'top'},
		correction: {card: V_ZOO, source: vsrc(V_ZOO), from: 'top'},
		sources: {card: V_TWO, source: null, from: 'top'},
		outroEndScreen: {card: V_TWO, source: null, from: 'top'},
		beat: {card: null, source: null, from: 'top'},
		desk: {card: V_TWO, source: vsrc(V_TWO), from: 'top'},
	},
};

/**
 * Landscape end screen (ShowEpisode outro): YouTube places its elements in the last 5-20 s; these are the empty guide
 * zones, inside the outro card: two 16:9 video slots and one subscribe circle.
 */
export const END_ZONES = {
	slots: [
		{x: 1064, y: 246, w: 728, h: 410},
		{x: 1064, y: 716, w: 480, h: 270},
	],
	subscribe: {cx: 1690, cy: 840, r: 88},
} as const;
