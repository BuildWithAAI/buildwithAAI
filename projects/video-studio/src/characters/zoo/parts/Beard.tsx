/**
 * Short beard and moustache. The beard is one band (cheeks + chin) clipped to the face shape, so
 * its outer edge IS the jaw outline. Its inner edge rises from below each ear to the moustache
 * tips and frames the lower-lip skin patch with the small soul patch. `hole` lowers that patch
 * (and the soul patch) when the mouth opens; `jawDrop` lowers the chin outline with it.
 * The moustache is a two-lobed chevron with pointed drooping tips that sits over the top of the mouth.
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {smooth, type Pt} from '../geometry';
import {Clipped} from './Shape';
import {facePath} from './Face';

export const BEARD_BASE: Pt[] = [
	[-62, -793], [-40, -789.5], [-37, -783], [-32, -773.7], [-27.5, -767.8], [-24.4, -764.4], [-21.8, -761.8],
	[-17.2, -757.4], [-12, -754.6], [-7.6, -755.2], [-5.3, -757.8, 'c'], [-4.3, -761.4, 'c'], [4.3, -761.4, 'c'],
	[5.3, -757.8, 'c'], [7.6, -755.2], [12, -754.6], [17.2, -757.4], [21.8, -761.8], [24.4, -764.4], [27.5, -767.8],
	[32, -773.7], [37, -783], [40, -789.5], [62, -793], [62, -720], [-62, -720],
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
 * Moustache, clockwise from the top-centre philtrum notch (repair round 1, zoo_expr_neutral.png and the six mouth
 * panels at front-view heights): two lobes with a central dip on top, a small upward peak at the bottom centre and
 * pointed drooping tips. Flat fill in ZOO_COLORS.moustache (darker than the chin beard, decision ZOO-C3).
 */
export const MOUSTACHE: Pt[] = [
	// Repair round 2: the philtrum notch is a shallow 0.6 u dip with its top at -784 (round 1: a 2 u notch at -781.2 split the
	// moustache into two handlebar lobes; the sheet measures 9.5 u thick at x=0 with the top at -784.5).
	[0, -784, 'c'], [3.4, -784.6], [8, -784.2], [13.6, -782.4], [19, -779.4], [23.4, -775.4], [26.4, -771.2], [27.6, -767.4, 'c'],
	[25.2, -768.4], [21.6, -771], [16, -772.8], [9, -773.6], [3.2, -774.4], [0, -775.6, 'c'], [-3.2, -774.4], [-9, -773.6],
	[-16, -772.8], [-21.6, -771], [-25.2, -768.4], [-27.6, -767.4, 'c'], [-26.4, -771.2], [-23.4, -775.4], [-19, -779.4],
	[-13.6, -782.4], [-8, -784.2], [-3.4, -784.6],
];
/** v1 moustache shadow band (kept for reference; the moustache is now drawn flat). */
export const MOUSTACHE_SHADOW: Pt[] = [[-27, -769], [-18, -772.4], [-6, -774.2], [0, -775.4], [6, -774.2], [18, -772.4], [27, -769], [26, -763], [-26, -763]];

/**
 * liftR > 0 raises the screen-right half (smirk): the end rises most, so the droop flattens; liftL (optional, repair round 4)
 * raises the screen-left half the same way. Each half moves only on its own side of the philtrum.
 */
export const moustachePts = (pts: Pt[], liftR: number, liftL = 0): Pt[] =>
	pts.map((p) => {
		const tR = Math.max(0, p[0]) / 27;
		const tL = Math.max(0, -p[0]) / 27;
		const dy = -liftR * Math.pow(tR, 1.2) - liftL * Math.pow(tL, 1.2);
		const dx = liftR * 0.25 * tR - liftL * 0.25 * tL;
		return p.length === 3 ? [p[0] + dx, p[1] + dy, 'c'] : [p[0] + dx, p[1] + dy];
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

export const Moustache: React.FC<{liftR: number; liftL?: number}> = ({liftR, liftL = 0}) => (
	<g data-part="moustache">
		<path d={smooth(moustachePts(MOUSTACHE, liftR, liftL))} fill={ZOO_COLORS.moustache} />
	</g>
);
