/**
 * Short beard and moustache. The beard is one band (cheeks + chin) clipped to the face shape, so
 * its outer edge IS the jaw outline. Its inner edge rises from below each ear to the moustache
 * tips and frames the lower-lip skin patch with the small soul patch. `hole` lowers that patch
 * (and the soul patch) when the mouth opens; `jawDrop` lowers the chin outline with it.
 * The moustache is a broad chevron that sits over the top of the mouth.
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {smooth, type Pt} from '../geometry';
import {Clipped} from './Shape';
import {facePath} from './Face';

const BEARD_BASE: Pt[] = [
	[-62, -793], [-40, -789.5], [-37, -783], [-32, -773.7], [-27.5, -767.8], [-24.4, -764.4], [-21.8, -761.8],
	[-17.2, -757.4], [-12, -754.6], [-7.6, -755.2], [-5.3, -757.8, 'c'], [-4.3, -761.4, 'c'], [4.3, -761.4, 'c'],
	[5.3, -757.8, 'c'], [7.6, -755.2], [12, -754.6], [17.2, -757.4], [21.8, -761.8], [24.4, -764.4], [27.5, -767.8],
	[32, -773.7], [37, -783], [40, -789.5], [62, -793], [62, -720], [-62, -720],
];

const beardPoints = (hole: number, jawDrop: number): Pt[] =>
	BEARD_BASE.map((p) => {
		if (Math.abs(p[0]) > 60) return p.length === 3 ? p : [p[0], p[1] + (p[1] > -760 ? jawDrop : 0)];
		const w = Math.max(0, Math.min(1, (p[1] + 769) / 7)); // 0 near the moustache tips -> 1 at the lip patch
		const y = p[1] + hole * w;
		return p.length === 3 ? [p[0], y, 'c'] : [p[0], y];
	});

const beardShadow = (jawDrop: number) =>
	smooth([
		[-46, -790], [-37, -786.5], [-33.4, -772], [-29.6, -762], [-22, -752.6 + jawDrop * 0.8], [-10, -746.4 + jawDrop],
		[4, -745.6 + jawDrop], [14, -747.2 + jawDrop], [22, -751 + jawDrop * 0.8], [22, -730], [-46, -730],
	]);

/** Moustache, clockwise from the top centre. */
const MOUSTACHE: Pt[] = [
	[0, -782.6], [8, -782.6], [16, -780.6], [22, -776.6], [25.6, -771.4], [27.2, -765.6, 'c'], [24.4, -766.9],
	[19.6, -769.7], [12, -771.6], [4.6, -772.3], [0, -773.8, 'c'], [-4.6, -772.3], [-12, -771.6], [-19.6, -769.7],
	[-24.4, -766.9], [-27.2, -765.6, 'c'], [-25.6, -771.4], [-22, -776.6], [-16, -780.6], [-8, -782.6],
];
const MOUSTACHE_SHADOW: Pt[] = [[-27, -769], [-18, -772.4], [-6, -774.2], [0, -775.4], [6, -774.2], [18, -772.4], [27, -769], [26, -763], [-26, -763]];

/** liftR > 0 raises the screen-right half (smirk); the left half barely moves. */
const moustachePts = (pts: Pt[], liftR: number): Pt[] =>
	pts.map((p) => {
		const t = Math.max(0, p[0]) / 27;
		const dy = -liftR * Math.pow(t, 1.2);
		const dx = liftR * 0.25 * t;
		return p.length === 3 ? [p[0] + dx, p[1] + dy, 'c'] : [p[0] + dx, p[1] + dy];
	});

export const Beard: React.FC<{hole: number; jawDrop: number}> = ({hole, jawDrop}) => (
	<g data-part="beard">
		<Clipped clip={facePath(jawDrop)}>
			<path d={smooth(beardPoints(hole, jawDrop))} fill={ZOO_COLORS.beard} />
			<Clipped clip={smooth(beardPoints(hole, jawDrop))}>
				<path d={beardShadow(jawDrop)} fill={ZOO_COLORS.beardShadow} />
			</Clipped>
		</Clipped>
	</g>
);

export const Moustache: React.FC<{liftR: number}> = ({liftR}) => {
	const d = smooth(moustachePts(MOUSTACHE, liftR));
	return (
		<g data-part="moustache">
			<path d={d} fill={ZOO_COLORS.beard} />
			<Clipped clip={d}>
				<path d={smooth(moustachePts(MOUSTACHE_SHADOW, liftR))} fill={ZOO_COLORS.beardShadow} />
			</Clipped>
		</g>
	);
};
