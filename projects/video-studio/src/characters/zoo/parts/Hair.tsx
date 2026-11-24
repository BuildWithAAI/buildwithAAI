/**
 * ZOO hair, front view. Asymmetric by design (never mirrored). Re-traced in repair round 1 from
 * zoo_expr_neutral.png (contrast-enhanced, 0.699 u/px) and checked against zoo_turn_front.png (face offset
 * of decision ZOO-F1 removed); the two drawings agree within ~4 u.
 *
 * Structure, as on the sheet: a big TOP LOCK sweeps from the top-left tuft over the crown and rolls over a
 * near-black arch-shaped hollow right of centre; a MIDDLE LOCK sweeps from the left lobe across the brow line
 * and turns down into the FORELOCK, a curved horn whose tip hangs just left of centre; a lower-left WING and
 * a short side lock sit over the left ear; on the right a rounded tuft and lobe end in a small flick. The
 * sides are short: the hair ends at the ear tops and the ears are the outermost silhouette below.
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {clamp01, line, smooth, type Pt} from '../geometry';
import {ZOO_LINE} from '../lines';
import {Clipped, Shape, Stroke} from './Shape';

/** Visible silhouette, clockwise from the left ear top over the crown to the right ear top. Tips are corners. */
const TOP: Pt[] = [
	[-54.6, -806.6], [-58.6, -809.6], [-62.8, -812.6, 'c'], // side lock: starts on the ear outline, small tip over the left ear
	[-66.2, -816], [-67, -820.4], [-66.4, -824.6], [-64.4, -827.8, 'c'], // side lock, notch under the wing
	[-68.6, -829.8], [-73, -832.6], [-77.2, -835.8], [-80.4, -839.2], [-83, -843, 'c'], // lower-left wing, tip
	[-79.2, -844.8], [-74.8, -846.2], [-71.4, -848.4], [-69.6, -851.6, 'c'], // wing top, notch
	[-71, -855.8], [-71.8, -860.2], [-72.2, -864.6], [-72.4, -868.6, 'c'], // left lobe, tip
	[-69.4, -866.4], [-64.4, -865], [-59, -865.6], [-54.4, -868], [-50.8, -871.6, 'c'], // lobe top edge, notch
	[-50.9, -876.4], [-50.6, -881.4], [-49.2, -886.8, 'c'], // top-left tuft, tip
	[-45.8, -884.6], [-41, -883.4], [-35, -883.8], [-29, -886], [-22, -889.4], [-14, -893.4], [-6, -897.2], [2, -899.3],
	[10, -899.3], [17, -897.8], [23, -895.2], [27, -892], [29.6, -888.6], [30.6, -885.8, 'c'], // crown, notch
	[34.4, -884.4], [37.6, -882], [39.8, -878.6], [41.4, -875.2, 'c'], // right top tuft, notch
	[44.6, -872.8], [49, -871.6], [53.6, -870.4], [57.4, -867.6], [60.2, -863.4], [62, -858.4], [62.8, -853.4], [62.8, -848.6],
	[64.6, -844.2], [68, -840.8, 'c'], // right lobe, flick tip
	[64.4, -839.4], [62.2, -836.4], [60.2, -832.2], [57.8, -828.4], [56.6, -824.6], [57, -819.8], [57.2, -815.8], [55.6, -812.6],
];
/** Hidden lower edge of the back-hair fill: tucked inside the ears and the face, so no hair shows around or under the ears. */
const BOTTOM: Pt[] = [[50, -806], [45, -795], [38, -784], [20, -778], [-20, -778], [-38, -784], [-45, -795], [-50, -806]];
export const HAIR_SILHOUETTE: Pt[] = [...TOP, ...BOTTOM];

/** Hairline left of the forelock: from the left ear top up the temple and along the middle lock to the wedge apex. */
const HAIRLINE_LEFT: Pt[] = [
	[-54.2, -810.6], [-50.4, -812.6], [-45, -815.6], [-42.4, -821], [-41.8, -828], [-41.8, -836], [-41.4, -843.2],
	[-36, -844.6], [-30, -845.8], [-24.4, -847.2], [-19.6, -849.2], [-16.2, -852.2], [-14, -855.6], [-12.6, -859.6, 'c'],
];
/** The forelock: left edge from the wedge apex down to the tip, then the concave right edge up to the forehead. */
// Repair round 2 (grid-measured on zoo_expr_neutral.png): ~11.6 u wide at y -850 (sheet ~12, round 1 ~8): the concave
// right edge sits ~2.5 u further right (the sheet's hugs the forehead down to x ~-1.5 at -850) and the left edge ~1 u
// further left; the tip stays at (-17,-842) and the skin wedge above it stays open.
const FORELOCK: Pt[] = [
	[-12.2, -855.6], [-13, -851.4], [-14.4, -847.6], [-16, -844.6], [-17, -842, 'c'],
	[-12.6, -842.4], [-8.2, -843.8], [-4.2, -846.4], [-1.8, -850], [-0.6, -855], [-0.2, -860], [0.4, -865.4],
];
/** Forehead top and right temple down to the right ear top. */
const HAIRLINE_RIGHT: Pt[] = [
	[5, -866.4], [12, -866.6], [19, -866], [25, -864.6], [30, -862.2], [34, -859], [37, -854.6], [39.4, -848.8],
	[40.8, -842], [41.6, -834], [42.2, -826], [43, -819], [45.8, -814], [51, -812], [55.4, -811.6],
];

/** Forelock tip and the brow clearance it keeps (see forelockLiftFor). */
export const FORELOCK_TIP = {x: -17, y: -842, clearance: 1.6} as const;

/**
 * Raised brows never slide under the hair (blocker fix, repair round 1): when a brow top comes within
 * FORELOCK_TIP.clearance of the forelock tip, the forelock's lower part is lifted by `lift` (full at the
 * tip, fading to 0 at the wedge apex), so the lock reads shorter, as on the shocked panel.
 */
const liftForelock = (pts: Pt[], lift: number): Pt[] =>
	lift <= 0
		? pts
		: pts.map((p) => {
				const w = clamp01((p[1] + 860) / 18);
				const y = p[1] - lift * w * w * (3 - 2 * w);
				return p.length === 3 ? [p[0], y, 'c'] : [p[0], y];
			});

export const hairlinePts = (lift = 0): Pt[] => [...HAIRLINE_LEFT, ...liftForelock(FORELOCK, lift), ...HAIRLINE_RIGHT];

/** Brow-top height (y) of the highest brow point within the forelock's x range -> lift needed. */
export const forelockLiftFor = (browTopY: number) => Math.max(0, FORELOCK_TIP.y - browTopY + FORELOCK_TIP.clearance);

/** Interior strands (wave edges), drawn in the hair shadow tone at the fine width (never near-black). */
const STRANDS: Pt[][] = [
	[[-46.4, -877], [-40, -874.8], [-32, -874.6], [-24, -876.4], [-16, -878.6], [-8, -879.8]], // top lock's lower edge (left)
	[[-66, -861.4], [-57, -857.8], [-47, -855.4], [-36, -855.2], [-27, -857.4]], // middle lock ribbon
	[[-5.8, -881.6], [0, -886.2], [8, -888.4], [16, -887.4], [23, -883.4], [26.8, -877], [27.6, -870]], // rolling top lock around the hollow
	[[41.4, -875.2], [36.8, -869.6], [32, -864.8]], // right lock boundary
	[[38.6, -862], [46.6, -857.6], [54.6, -853.4], [61.6, -849.4]], // right lobe's lower edge
];

/** One flat shadow tone (hairShadow), clipped to the front fill. */
const shadowD = (lift: number) =>
	[
		// underside of the middle lock along the left hairline
		smooth([[-69, -852.6], [-60, -854.4], [-50, -850.6], [-40, -848.4], [-30, -848], [-22, -849.6], [-16, -852.8], [-12.4, -858], [-13, -846], [-24, -844], [-40, -841], [-58, -838]]),
		// left side under the wing, down to the ear
		smooth([[-41.4, -842.4], [-52, -843], [-60, -838.6], [-64.6, -830], [-66.4, -821], [-62.4, -812], [-54, -810], [-46, -815], [-42.4, -826]]),
		// forelock's shadow side along its right edge
		smooth(
			liftForelock(
				[[0.8, -867.6], [-0.4, -860.4], [-1.6, -855], [-3.8, -850.6], [-7, -846.8], [-11, -843.8], [-15.8, -842.2], [-10.4, -846.8], [-6.4, -851.2], [-4, -856.2], [-2.6, -862], [-2, -868]],
				lift,
			),
		),
		// right temple under the right lobe, down to the ear
		smooth([[36, -863.4], [46.6, -857.6], [54.6, -853.4], [61.6, -849.4], [63.4, -845.6], [61, -836], [58, -828], [57.2, -820], [56, -811.6], [44, -811.6], [42, -826], [40.6, -846]]),
	].join(' ');

/**
 * The near-black arch-shaped hollow under the rolling top lock (sheet median #2A201A, core #110C0B). Drawn as an
 * ink accent in the brow near-black brown (#221C18), not as a third hair tone (one shadow tone per colour).
 */
const HOLLOW = smooth([[0.4, -863], [0.5, -870.6], [2.4, -876], [6, -878.4], [10, -879], [14, -878.2], [17.4, -876], [19.6, -872.4], [20.6, -867.6], [20.8, -862.6]]);

const BACK = smooth(HAIR_SILHOUETTE);
const BACK_SHADOW = smooth([[70, -834], [64, -800], [50, -770], [-50, -770], [-64, -800], [-70, -834], [0, -842]]);

/** Behind the ears and face (its outline is drawn by HairFront along the visible top). */
export const HairBack: React.FC = () => <Shape name="hairBack" d={BACK} fill={ZOO_COLORS.hair} shadow={{d: BACK_SHADOW, fill: ZOO_COLORS.hairShadow}} stroke={0} />;

/** In front of the forehead: top lock, hollow, middle lock, forelock, wings. `forelockLift` shortens the forelock. */
export const HairFront: React.FC<{forelockLift?: number}> = ({forelockLift = 0}) => {
	const hairline = hairlinePts(forelockLift);
	const fill = smooth([...TOP, ...hairline.slice().reverse()]);
	return (
		<g data-part="hairFront">
			<Shape d={fill} fill={ZOO_COLORS.hair} shadow={{d: shadowD(forelockLift), fill: ZOO_COLORS.hairShadow}} stroke={0} />
			<Clipped clip={fill}>
				<path data-part="crownHollow" d={HOLLOW} fill={ZOO_COLORS.brow} />
			</Clipped>
			{STRANDS.map((s, i) => (
				<Stroke key={i} d={line(s)} width={ZOO_LINE.fine} color={ZOO_COLORS.hairShadow} />
			))}
			<Stroke name="hairline" d={line(hairline)} width={ZOO_LINE.outline} />
			<Stroke name="hairOutline" d={line(TOP)} width={ZOO_LINE.outline} />
		</g>
	);
};
