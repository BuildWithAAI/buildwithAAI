/**
 * Measured character boxes for framing branding shots (pure data). World units at scale 1, relative to each
 * character's ground contact point, front views, neutral pose, breathing off. Measured from a transparent render of
 * the real rigs (src/branding/dev/Probe.tsx) and re-checked by the QA run (qa/run.ts), so drift in
 * src/characters is caught instead of silently mis-framing a banner.
 */
import type {Rect} from './spec.ts';

/** Zoo, front view: hair top to beard chin, forelock wing to right tuft. */
export const ZOO_HEAD: Rect = {x: -88, y: -901, w: 158, h: 162};
/** Zoo, front view, whole figure (hands hang at the sides). */
export const ZOO_BODY: Rect = {x: -147, y: -901, w: 293, h: 902};
/** Badger, front view: ear tips to the bottom of the chin (the collar starts just below, at about -318). */
export const BADGER_HEAD: Rect = {x: -98, y: -447, w: 188, h: 127};
/** Badger, front view: head, collar and the teal tag (bottom of the tag at about -266). */
export const BADGER_BUST: Rect = {x: -98, y: -447, w: 188, h: 182};
/** Badger, front view, whole figure. */
export const BADGER_BODY: Rect = {x: -98, y: -447, w: 188, h: 454};

/** A box placed at ground point (x, y) and scale s, in output px. */
export const placeBox = (box: Rect, x: number, y: number, s: number): Rect => ({x: x + box.x * s, y: y + box.y * s, w: box.w * s, h: box.h * s});

/** Centre of a box (output px). */
export const boxCentre = (r: Rect): {x: number; y: number} => ({x: r.x + r.w / 2, y: r.y + r.h / 2});
