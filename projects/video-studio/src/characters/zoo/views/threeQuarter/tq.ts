/**
 * 3/4 view (body turned to SCREEN RIGHT) mapping constants. All coordinates are world units in the
 * 3/4 view's root space: origin = ground contact point (centre of the footprint, crop x=154 of
 * reference/crops/zoo_turn_34.png), 1 crop px = 900/630 u, y = (cropY - 640) * 900/630.
 *
 * In this view the anatomical RIGHT side is the NEAR side (screen left) and the anatomical LEFT side
 * is the FAR side (screen right). Front-view facial features are re-used through per-feature maps
 * that compress the far side more than the near side. No map ever mirrors: a front-view point with
 * x > 0 (anatomical left) always lands right of the facial midline.
 *
 * The mouth-region map was fitted on the sheet: it places the beard's inner edge, the lip patch
 * and the moustache tips of the front design within ~2 u of the 3/4 drawing (5 control points).
 */
import type {Pt} from '../../geometry';
import {PIVOTS} from '../../rig';

/** Facial midline of the lower face (mouth, moustache, chin) in the 3/4 view. */
export const TQ_MID_X = 29;
/** Moustache-tip half width in front units: inside it the map is linear (mouth and moustache keep their shape). */
const TIP = 27.5;

/**
 * Lower-face map (front x -> 3/4 x), fitted on the sheet: linear x0.86 across the mouth and moustache,
 * then the near cheek (x < -27.5, anatomical right) stretches x2.0 and the far cheek (x > 27.5,
 * anatomical left) wraps around the face contour at x0.25.
 */
export const tqX = (x: number) => {
	if (x < -TIP) return TQ_MID_X - 0.86 * TIP + 2.0 * (x + TIP);
	if (x > TIP) return TQ_MID_X + 0.86 * TIP + 0.25 * (x - TIP);
	return TQ_MID_X + 0.86 * x;
};
export const tqPt = (p: Pt): Pt => (p.length === 3 ? [tqX(p[0]), p[1], 'c'] : [tqX(p[0]), p[1]]);
/** Mouth-local (front units, origin = jaw anchor) -> 3/4 head space. */
export const tqMouth = (x: number, y: number) => [tqX(x), PIVOTS.jaw.y + y] as const;

/** Eyes: centres measured on the sheet; sx = horizontal foreshortening of the front eye drawing. */
export const TQ_EYES = {
	near: {x: 7, y: -816, sx: 0.96, s: 0.96, irisSx: 0.86, dir: -1 as const}, // anatomical RIGHT eye
	far: {x: 46.4, y: -815.5, sx: 0.55, s: 0.96, irisSx: 0.7, dir: 1 as const}, // anatomical LEFT eye
	/** The eyes look along the face's own forward direction (slightly screen right) at rest. */
	restLook: 1.2,
} as const;

/** Brows: linear maps of the front brows (inner end -> outer end), no mirroring. */
export const TQ_BROWS = {
	near: {frontInner: -8.5, inner: 24.5, scale: 1.12, dy: 1.5}, // anatomical right brow (BROW_R)
	far: {frontInner: 9, inner: 38, scale: 0.53, dy: 1.5}, // anatomical left brow (BROW_L)
	/** The 3/4 sheet draws the brows thinner than the front: thickness x0.7 about each brow's mid-line. */
	thickness: 0.7,
} as const;
export const tqBrowX = (which: 'near' | 'far', x: number) => {
	const b = TQ_BROWS[which];
	return b.inner + (x - b.frontInner) * b.scale;
};
