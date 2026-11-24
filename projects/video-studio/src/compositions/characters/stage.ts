/**
 * Shared staging for the character proof compositions (1920x1080, 30 fps, flat #E6E8EB).
 * The pair layout reproduces reference/crops/badger_size_comparison.png: ZOO on screen left, Badger on
 * screen right, one ground line, relative scale and spacing from SIZE_COMPARISON (both at one `scale`).
 */
import {Easing} from 'remotion';
import {SIZE_COMPARISON} from '../../characters/relativeScale';

export const FRAME = {width: 1920, height: 1080, fps: 30} as const;

/** Ground contact at 85% of the frame height. */
export const GROUND_Y = Math.round(FRAME.height * 0.85); // 918
/** One shared scale for both characters: ZOO = 900 * 0.88 = 792 px tall, top of hair at y=126. */
export const PAIR_SCALE = 0.88;
const pairCentre = (SIZE_COMPARISON.pairExtent.minX + SIZE_COMPARISON.pairExtent.maxX) / 2;
/** ZOO's ground point; the pair (ZOO hands .. Badger tail tip) is centred horizontally. */
export const ZOO_X = Math.round(FRAME.width / 2 - pairCentre * PAIR_SCALE);
/** Badger's footprint centre, SIZE_COMPARISON.spacingUnits to screen right of ZOO. */
export const BADGER_X = Math.round(ZOO_X + SIZE_COMPARISON.spacingUnits * PAIR_SCALE);

/** Easing curves (cubic bezier) used by the proof animation. */
export const EASE = {
	inOut: Easing.bezier(0.45, 0, 0.25, 1),
	out: Easing.bezier(0.2, 0.65, 0.3, 1),
	in: Easing.bezier(0.55, 0, 0.75, 0.35),
	/** Gesture: quick start, long soft settle. */
	gesture: Easing.bezier(0.35, 0, 0.15, 1),
} as const;
