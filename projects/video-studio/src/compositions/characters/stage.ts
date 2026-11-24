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
/**
 * Ground-point spacing for scenes where ZOO points to screen right over Badger (decision INT-P2): the panel's 482.9
 * units put Badger's head inside the arc of any sideways arm lift; with the point path of INT-Z3 the arm clears his
 * head from 554 units, so the pair stands 560 units apart (77 units wider than the panel). Scale and ground line are
 * the panel's; use SIZE_COMPARISON.spacingUnits for shots without that gesture.
 */
export const PAIR_SPACING = 560;
const pairMaxX = PAIR_SPACING + (SIZE_COMPARISON.pairExtent.maxX - SIZE_COMPARISON.spacingUnits);
const pairCentre = (SIZE_COMPARISON.pairExtent.minX + pairMaxX) / 2;
/** ZOO's ground point; the pair (ZOO hands .. Badger tail tip) is centred horizontally. */
export const ZOO_X = Math.round(FRAME.width / 2 - pairCentre * PAIR_SCALE);
/** Badger's footprint centre, PAIR_SPACING units to screen right of ZOO. */
export const BADGER_X = Math.round(ZOO_X + PAIR_SPACING * PAIR_SCALE);

/** Easing curves (cubic bezier) used by the proof animation. */
export const EASE = {
	inOut: Easing.bezier(0.45, 0, 0.25, 1),
	out: Easing.bezier(0.2, 0.65, 0.3, 1),
	in: Easing.bezier(0.55, 0, 0.75, 0.35),
	/** Gesture: quick start, long soft settle. */
	gesture: Easing.bezier(0.35, 0, 0.15, 1),
} as const;
