/**
 * Camera shots of the set (pure data). A shot maps stage units to screen px with ONE scale S for everything in it
 * (characters, desk, chairs, mics), so outlines scale with the camera as ART_GUIDE SL5 asks: 3.5 x S px, kept within
 * 3-6 px (S 0.86-1.71, push-in included). Each shot anchors a subject's eyes at a screen point.
 *
 *   landscape  wide     both at the desk (ColdOpen, desk talk)
 *              zooR     Zoo on the right third, graphics on the left (Headline, Correction)
 *              zooL     Zoo on the left third, graphics on the right; he points right at them (HowItWorked, One Fix)
 *              badgerR  Badger on the right third, the red-flag card on the left
 *              badgerC  Badger close-up, centred: the reaction insert of a beat
 *              wideL    both on the left half, end-screen zones on the right (Outro)
 *   vertical   two      both at the desk, graphics on top
 *              zoo      Zoo single, graphics on top
 *              badger   Badger single (beats, red flag)
 *   none       a full-frame graphic (Scam of the Week, Sources), no set
 *
 * `cast` lists who the camera sees. A single's camera is a separate angle, not a crop: the other character and his
 * chair and mic are not drawn (a sliver of a body at the frame edge would read as a mistake).
 */
import type {Format} from '../types.ts';
import {BADGER_EYES, STAGE, ZOO_EYES} from './stage.ts';

export type ShotName = 'wide' | 'zooR' | 'zooL' | 'badgerR' | 'badgerC' | 'wideL' | 'two' | 'zoo' | 'badger' | 'none';
export type Cast = 'zoo' | 'badger';

/** Set dressing a shot shows: the desk logo plate and the ON AIR sign appear only in two-shots (a single would crop them). */
export type Dressing = {logo: boolean; onAir: boolean};
export type ShotDef = {S: number; anchor: 'zoo' | 'badger' | 'pair'; at: {x: number; y: number}; cast: Cast[]; push: number; dressing: Dressing};
export type Shot = {name: ShotName; S: number; tx: number; ty: number; cast: Cast[]; push: number; pushAnchor: {x: number; y: number}; dressing: Dressing};

export const FRAME: Record<Format, {width: number; height: number}> = {
	landscape: {width: 1920, height: 1080},
	vertical: {width: 1080, height: 1920},
};

/** Safe areas (px): landscape MO18 margins; vertical keeps faces and text out of the Shorts UI (top 10%, bottom 20%). */
export const SAFE: Record<Format, {left: number; right: number; top: number; bottom: number}> = {
	landscape: {left: 96, right: 1824, top: 54, bottom: 1026},
	vertical: {left: 54, right: 1026, top: 192, bottom: 1536},
};

/** Vertical: the Shorts action buttons cover the right edge of the lower half (x > 950). */
export const SHORTS_BUTTONS = {x: 950, y: 960} as const;

export const SHOT_DEFS: Record<Format, Partial<Record<ShotName, ShotDef>>> = {
	landscape: {
		wide: {S: 1.15, anchor: 'pair', at: {x: 960, y: 440}, cast: ['zoo', 'badger'], push: 1.03, dressing: {logo: true, onAir: true}},
		zooR: {S: 1.5, anchor: 'zoo', at: {x: 1385, y: 300}, cast: ['zoo'], push: 1.03, dressing: {logo: false, onAir: false}},
		zooL: {S: 1.5, anchor: 'zoo', at: {x: 430, y: 300}, cast: ['zoo'], push: 1.03, dressing: {logo: false, onAir: false}},
		badgerR: {S: 1.7, anchor: 'badger', at: {x: 1395, y: 470}, cast: ['badger'], push: 1, dressing: {logo: false, onAir: false}},
		badgerC: {S: 1.7, anchor: 'badger', at: {x: 960, y: 470}, cast: ['badger'], push: 1, dressing: {logo: false, onAir: false}},
		wideL: {S: 1.0, anchor: 'pair', at: {x: 470, y: 560}, cast: ['zoo', 'badger'], push: 1, dressing: {logo: false, onAir: false}},
	},
	vertical: {
		two: {S: 1.25, anchor: 'pair', at: {x: 548, y: 1125}, cast: ['zoo', 'badger'], push: 1.025, dressing: {logo: true, onAir: true}},
		zoo: {S: 1.6, anchor: 'zoo', at: {x: 540, y: 1080}, cast: ['zoo'], push: 1.03, dressing: {logo: false, onAir: false}},
		badger: {S: 1.7, anchor: 'badger', at: {x: 540, y: 1130}, cast: ['badger'], push: 1, dressing: {logo: false, onAir: false}},
	},
};

/** The shots each format offers (`none` is always available). */
export const shotNames = (format: Format): ShotName[] => [...(Object.keys(SHOT_DEFS[format]) as ShotName[]), 'none'];

const anchorPoint = (format: Format, a: ShotDef['anchor']): {x: number; y: number} => {
	const b = STAGE[format].badger;
	const zoo = ZOO_EYES;
	const badger = {x: b.x + BADGER_EYES.x, y: b.y + BADGER_EYES.y};
	if (a === 'zoo') return zoo;
	if (a === 'badger') return badger;
	return {x: (zoo.x + badger.x) / 2, y: (zoo.y + badger.y) / 2};
};

export const shotFor = (format: Format, name: ShotName): Shot => {
	if (name === 'none') return {name, S: 1, tx: 0, ty: 0, cast: [], push: 1, pushAnchor: {x: 0, y: 0}, dressing: {logo: false, onAir: false}};
	const def = SHOT_DEFS[format][name];
	if (!def) throw new Error(`no ${format} shot "${name}" (have: ${shotNames(format).join(', ')})`);
	const p = anchorPoint(format, def.anchor);
	return {name, S: def.S, tx: def.at.x - p.x * def.S, ty: def.at.y - p.y * def.S, cast: def.cast, push: def.push, pushAnchor: def.at, dressing: def.dressing};
};

/** Stage point -> screen px (no push-in). */
export const toScreen = (shot: Shot, p: {x: number; y: number}): {x: number; y: number} => ({x: shot.tx + p.x * shot.S, y: shot.ty + p.y * shot.S});

/** Stage rect -> screen rect (no push-in). */
export const rectToScreen = (shot: Shot, r: {x: number; y: number; w: number; h: number}) => {
	const a = toScreen(shot, r);
	return {x: a.x, y: a.y, w: r.w * shot.S, h: r.h * shot.S};
};

/** Rect after a push-in of factor k about the shot's anchor. */
export const pushRect = (shot: Shot, r: {x: number; y: number; w: number; h: number}, k: number) => ({
	x: shot.pushAnchor.x + (r.x - shot.pushAnchor.x) * k,
	y: shot.pushAnchor.y + (r.y - shot.pushAnchor.y) * k,
	w: r.w * k,
	h: r.h * k,
});

/** Outline width (px) of the characters and props in a shot, before and after its push-in (ART_GUIDE SL5: 3-6 px). */
export const outlinePx = (shot: Shot): {min: number; max: number} => ({min: 3.5 * shot.S, max: 3.5 * shot.S * shot.push});
