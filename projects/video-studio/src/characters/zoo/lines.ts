/**
 * ZOO stroke widths (world units at lineScale 1). Every width is derived from palette.ts LINE so the line
 * system stays one system (repair round 1, decision ZOO-L1): silhouettes use LINE.width, seams and finger
 * separations LINE.detailWidth, and the soft facial interior lines (nose, ear fold, lips, hair strands,
 * lower lids, pocket hem) one `fine` width instead of the scattered literals of v1.
 *
 * `lineScale` (ZooRig prop, default 1) multiplies every width. The approved sheet keeps a roughly constant
 * SCREEN line weight: at full-body framing its outline is ~3 u (= LINE.width), at bust framing ~1.6 u. Use
 * lineScaleFor(pxPerUnit) to get the ART_GUIDE SL5 weights for any framing (outline 3..6 px at output).
 */
import {LINE} from '../palette';

export const ZOO_LINE = {
	/** Silhouettes and part outlines. */
	outline: LINE.width,
	/** Seams, folds, finger separations, pocket outline. */
	detail: LINE.detailWidth,
	/** Soft interior lines of the face and small costume details (~0.62 x detail). */
	fine: Math.round(LINE.detailWidth * 0.62 * 100) / 100,
	/** The upper-lid line of the eyes (the heaviest facial line on the sheet). */
	lid: Math.round(LINE.width * 0.7 * 100) / 100,
	/** Nostril commas and the closed-mouth lip line. */
	feature: Math.round(LINE.detailWidth * 0.72 * 100) / 100,
} as const;

/**
 * Scale for facial FEATURE shapes (nose bridge, nostrils, upper-lid line) under a given lineScale (repair round 2,
 * decision ZOO-L2). They are part of the face's design, not outlines, so a close-up lineScale below `min` does not thin
 * them: the sheet's close-up nostrils are ~1.7 u dark commas, which ls 0.5 had shrunk to ~0.9 u hairlines. Above it
 * (small framings) they thicken with the outlines so they stay legible.
 */
export const featureScale = (ls: number, min = 1) => Math.max(ls, min);
/** The upper-lid line may thin a little at close-ups (the sheet's bust lids are ~0.85 x the full-body weight). */
export const LID_MIN_SCALE = 0.85;

/**
 * ART_GUIDE SL5: outline = clamp(3.5 x k, 3, 6) px at output, where k = output px per world unit (placement
 * scale times any parent viewBox magnification). Returns the lineScale that produces it.
 * Examples: k = 0.88 (pair shots) -> 1.00; k = 0.54 (asset sheet) -> 1.59; k = 3.21 (MouthDemo bust) -> 0.53.
 */
export const lineScaleFor = (pxPerUnit: number) => {
	const k = Math.max(1e-6, pxPerUnit);
	const px = LINE.width * k;
	return Math.min(6, Math.max(3, px)) / px;
};
