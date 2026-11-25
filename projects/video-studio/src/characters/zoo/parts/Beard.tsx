/**
 * Short beard and moustache. The beard is one band (cheeks + chin) clipped to the face shape, so
 * its outer edge IS the jaw outline. Its inner edge rises from below each ear to the moustache
 * tips and frames the lower-lip skin patch with the small soul patch. `hole` lowers that patch
 * (and the soul patch) when the mouth opens; `jawDrop` lowers the chin outline with it.
 * The moustache is a flat two-lobed band with a philtrum notch at top and bottom and blunt drooping ends that stop about
 * level with the mouth line (repair round 6, ZOO-F6); the cheek beard rises to meet each end.
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {smooth, type Pt} from '../geometry';
import {Clipped} from './Shape';
import {facePath} from './Face';

/**
 * Beard band. Its inner edge runs from the cheek down to each moustache end and on round the lip patch (repair round 6,
 * ZOO-F6: the cheek edge now meets the shorter moustache's blunt end at ~(+-25.4, -772.4), as on zoo_expr_neutral.png,
 * where the cheek beard rises beside the moustache end; rounds 1-5 ran it to the old pointed tip at (+-27.5, -767.8)).
 * The first two points of each side are the cheek top (the 3/4 head replaces them with its sideburn edge).
 */
export const BEARD_BASE: Pt[] = [
	[-62, -793], [-40, -789.5], [-34.8, -786.6], [-30.6, -781.8], [-27.6, -776.8], [-25.6, -772.4], [-24.6, -768.6], [-23.4, -765.4],
	[-21.6, -762.4], [-17.2, -757.4], [-12, -754.6], [-7.6, -755.2], [-5.3, -757.8, 'c'], [-4.3, -761.4, 'c'], [4.3, -761.4, 'c'],
	[5.3, -757.8, 'c'], [7.6, -755.2], [12, -754.6], [17.2, -757.4], [21.6, -762.4], [23.4, -765.4], [24.6, -768.6], [25.6, -772.4],
	[27.6, -776.8], [30.6, -781.8], [34.8, -786.6], [40, -789.5], [62, -793], [62, -720], [-62, -720],
];

/**
 * Smile shift of the beard's inner edge (repair round 4, ZOO-E4): in a smile the cheeks bunch, so the lip-patch edge beside
 * each mouth corner rises and opens a little (a tent around |x| ~22, up to `smileR` u on the screen-right side and `smileL`
 * on the screen-left). Points of the outer jaw (|x| > 60) and of the soul patch (|x| < 9) do not move.
 */
export const smileShift = (p: Pt, smileR: number, smileL: number): [number, number] => {
	const ax = Math.abs(p[0]);
	if (ax > 60 || ax < 9 || p[1] < -790) return [0, 0];
	const w = Math.max(0, 1 - Math.abs(ax - 22) / 12) * Math.max(0, Math.min(1, (p[1] + 792) / 14));
	const s = p[0] > 0 ? smileR : smileL;
	return [Math.sign(p[0]) * s * 0.3 * w, -s * w];
};

export const beardPoints = (hole: number, jawDrop: number, smileR = 0, smileL = 0): Pt[] =>
	BEARD_BASE.map((p) => {
		if (Math.abs(p[0]) > 60) return p.length === 3 ? p : [p[0], p[1] + (p[1] > -760 ? jawDrop : 0)];
		const w = Math.max(0, Math.min(1, (p[1] + 769) / 7)); // 0 near the moustache tips -> 1 at the lip patch
		const [sx, sy] = smileShift(p, smileR, smileL);
		const y = p[1] + hole * w + sy;
		return p.length === 3 ? [p[0] + sx, y, 'c'] : [p[0] + sx, y];
	});

const beardShadow = (jawDrop: number) =>
	smooth([
		[-46, -790], [-37, -786.5], [-33.4, -772], [-29.6, -762], [-22, -752.6 + jawDrop * 0.8], [-10, -746.4 + jawDrop],
		[4, -745.6 + jawDrop], [14, -747.2 + jawDrop], [22, -751 + jawDrop * 0.8], [22, -730], [-46, -730],
	]);

/**
 * Moustache, clockwise from the top philtrum notch. Repair round 6 (decision ZOO-F6; re-traced on zoo_expr_neutral.png at
 * 0.699 u/px, checked on zoo_turn_front.png and the six mouth panels): a flat two-lobed band ~49 u wide, 9.8 u thick at the
 * lobes (top -785, bottom -775.2) and ~6 u at the centre, where the philtrum notches the top (2.2 u, to -782.8) and the
 * bottom (1.8 u, up to -777); the top edge falls only ~5.6 u by 5% of the width from each end, and each end is a blunt,
 * slightly drooping cap whose lowest point (+-24.3, -771.3) stops about level with the mouth line (-769.6). Rounds 1-5 drew
 * a 55 u horseshoe crescent whose top fell 9.8 u by the same point and whose thin pointed tails hung to (+-27.6, -767.4),
 * below the mouth line (R5 review: 53.8 x 15.7 u against the sheet's 48.2-49.3 x 10.7-14 u).
 */
export const MOUSTACHE: Pt[] = [
	[0, -782.8, 'c'], [2.4, -784.4], [5.6, -785], [9.2, -784.7], [12.8, -783.9], [16.2, -782.6], [19.3, -781], [21.8, -779.2],
	[23.6, -777], [24.6, -774.3], [24.3, -771.3], [22.4, -771.2], [19.6, -772.2], [15.8, -773.4], [11.6, -774.3], [7.4, -774.9],
	[3.6, -775.4], [1.6, -776], [0, -777, 'c'], [-1.6, -776], [-3.6, -775.4], [-7.4, -774.9], [-11.6, -774.3], [-15.8, -773.4],
	[-19.6, -772.2], [-22.4, -771.2], [-24.3, -771.3], [-24.6, -774.3], [-23.6, -777], [-21.8, -779.2], [-19.3, -781],
	[-16.2, -782.6], [-12.8, -783.9], [-9.2, -784.7], [-5.6, -785], [-2.4, -784.4],
];
/** Half width of MOUSTACHE (its outermost end points). */
export const MOUSTACHE_HALF = 24.6;
/**
 * Half width of the philtrum hinge: the lift profile is 0 inside |x| < this and linear from it to the ends, so the notch and
 * the inner lobes stay clear of the nose while each half swings up straight (an end lift of L u raises a point at |x| by
 * L x (|x| - hinge) / (MOUSTACHE_HALF - hinge)).
 */
export const MOUSTACHE_HINGE = 0;
/**
 * 1 for MOUSTACHE's lower-edge points (both tips, the lower edge and the bottom notch), 0 for its upper edge: `thin` in
 * moustachePts lifts only the lower edge, so the band thins as the smile pulls the upper lip up from below.
 */
export const MOUSTACHE_LOWER: readonly number[] = MOUSTACHE.map((p, i) => (i >= 10 && i <= 26 ? 1 : 0));
/** v1 moustache shadow band (kept for reference; the moustache is now drawn flat). */
export const MOUSTACHE_SHADOW: Pt[] = [[-27, -769], [-18, -772.4], [-6, -774.2], [0, -775.4], [6, -774.2], [18, -772.4], [27, -769], [26, -763], [-26, -763]];

/**
 * The smile's moustache pose (repair round 6, ZOO-E6): each half is LEVELLED by a linear lift profile about the philtrum
 * hinge (|x| < MOUSTACHE_HINGE stays put), so `liftR` (screen-right half) and `liftL` (screen-left half) are the rises of
 * the ends and each half stays straight, with no tip weighting and no outward shift (round
 * 4-5's t^1.2 tip profile plus an outward dx read as a curl and could not level the crescent). `raise` lifts the whole
 * moustache with the upper lip. Each half moves only on its own side of the philtrum.
 */
export const moustachePts = (pts: Pt[], liftR: number, liftL = 0, raise = 0, thin = 0, lower: readonly number[] = MOUSTACHE_LOWER): Pt[] =>
	pts.map((p, i) => {
		const t = Math.max(0, Math.abs(p[0]) - MOUSTACHE_HINGE) / (MOUSTACHE_HALF - MOUSTACHE_HINGE);
		const dy = -raise - (p[0] > 0 ? liftR : liftL) * t - thin * (lower[i] ?? 0);
		return p.length === 3 ? [p[0], p[1] + dy, 'c'] : [p[0], p[1] + dy];
	});

export const Beard: React.FC<{hole: number; jawDrop: number; smileR?: number; smileL?: number}> = ({hole, jawDrop, smileR = 0, smileL = 0}) => (
	<g data-part="beard">
		<Clipped clip={facePath(jawDrop)}>
			<path d={smooth(beardPoints(hole, jawDrop, smileR, smileL))} fill={ZOO_COLORS.beard} />
			<Clipped clip={smooth(beardPoints(hole, jawDrop, smileR, smileL))}>
				<path d={beardShadow(jawDrop)} fill={ZOO_COLORS.beardShadow} />
			</Clipped>
		</Clipped>
	</g>
);

export const Moustache: React.FC<{liftR: number; liftL?: number; raise?: number; thin?: number}> = ({liftR, liftL = 0, raise = 0, thin = 0}) => (
	<g data-part="moustache">
		<path d={smooth(moustachePts(MOUSTACHE, liftR, liftL, raise, thin))} fill={ZOO_COLORS.moustache} />
	</g>
);
