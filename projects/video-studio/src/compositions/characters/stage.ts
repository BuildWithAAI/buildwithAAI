/**
 * Shared staging for the character proof compositions (1920x1080, 30 fps, flat #E6E8EB).
 * The pair layout reproduces reference/crops/badger_size_comparison.png: Zoo on screen left, Badger on
 * screen right, one ground line, relative scale and spacing from SIZE_COMPARISON (both at one `scale`).
 */
import {Easing} from 'remotion';
import {LINE} from '../../characters/palette';
import {SIZE_COMPARISON} from '../../characters/relativeScale';
import {lineScaleFor} from '../../characters/zoo/lines';

export const FRAME = {width: 1920, height: 1080, fps: 30} as const;

/** Ground contact at 85% of the frame height. */
export const GROUND_Y = Math.round(FRAME.height * 0.85); // 918
/** One shared scale for both characters: Zoo = 900 * 0.88 = 792 px tall, top of hair at y=126. */
export const PAIR_SCALE = 0.88;
/**
 * Ground-point spacing for scenes where Zoo points to screen right over Badger (decision INT-P2). Re-measured in
 * integration round 1 on the repaired point path (ZOO-P2): at the panel's 482.9 units the swinging hand overlaps
 * Badger's pale ear at poseAmount ~0.2 (front and 3/4 heads alike), so the pair keeps standing 560 units apart (77 units
 * wider than the panel), where the closest approach is ~24 px at this scale. Scale and ground line are the panel's; use
 * SIZE_COMPARISON.spacingUnits for shots without that gesture.
 */
export const PAIR_SPACING = 560;
const pairMaxX = PAIR_SPACING + (SIZE_COMPARISON.pairExtent.maxX - SIZE_COMPARISON.spacingUnits);
const pairCentre = (SIZE_COMPARISON.pairExtent.minX + pairMaxX) / 2;
/** Zoo's ground point; the pair (Zoo hands .. Badger tail tip) is centred horizontally. */
export const ZOO_X = Math.round(FRAME.width / 2 - pairCentre * PAIR_SCALE);
/** Badger's footprint centre, PAIR_SPACING units to screen right of Zoo. */
export const BADGER_X = Math.round(ZOO_X + PAIR_SPACING * PAIR_SCALE);

/**
 * Line weights (decision INT-L1). Both rigs take `lineScale`, a multiplier on every stroke width.
 * - Full-body framings use ART_GUIDE SL5: outline = clamp(3.5 x k, 3, 6) px at output, where k = output px per world unit.
 * - Close-ups (head-and-shoulders and closer) keep the sheet's close-up weight, about half of LINE.width in world units
 *   (zoo_expr_* and badger_expr_* measure 1.4-2.1 units at 0.699 units/px), floored at SL5's 3 px and capped at 6 px.
 * Give both characters the same value in a two-shot.
 */
export const fullLineScale = (pxPerUnit: number): number => lineScaleFor(pxPerUnit);
export const closeLineScale = (pxPerUnit: number): number => {
	const k = Math.max(1e-6, pxPerUnit);
	const px = Math.min(6, Math.max(3, 0.5 * LINE.width * k));
	return px / (LINE.width * k);
};
/** The proof's pair framing: 0.88 px per unit gives a 3.08 px outline, inside SL5, so 1. */
export const PAIR_LINE_SCALE = fullLineScale(PAIR_SCALE);

/** Easing curves (cubic bezier) used by the proof animation. */
export const EASE = {
	inOut: Easing.bezier(0.45, 0, 0.25, 1),
	out: Easing.bezier(0.2, 0.65, 0.3, 1),
	in: Easing.bezier(0.55, 0, 0.75, 0.35),
	/** v1 gesture curve (quick start, long soft settle); kept for scenes that ease poseAmount directly. */
	gesture: Easing.bezier(0.35, 0, 0.15, 1),
	/**
	 * Point swing along the hand's arc (gesture.ts): close to a minimum-jerk reach, slightly quicker in than out.
	 * Over 16 frames at the proof scale the hand peaks at ~49 px/frame (v1: 123 px in one frame).
	 */
	swing: Easing.bezier(0.38, 0, 0.4, 1),
} as const;
