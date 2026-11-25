/**
 * Legs: near-black straight trousers and off-white low-top sneakers. The legs and shoes are a
 * symmetric garment pair (no markings), authored for the anatomical LEFT side (screen right) and
 * mirrored for the right (decision ZOO-S1). The two legs of zoo_turn_front.png differ by drawing jitter (the screen-left
 * leg and shoe sit ~4 u further out), so every number below is the AVERAGE of the two sheet legs, measured on the same
 * world grid (repair round 4, decision ZOO-S3).
 */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, smoothRange, tapered, type Pt} from '../geometry';
import {ZOO_LINE} from '../lines';
import {Clipped, Outline, Shape, Stroke, useLineScale} from './Shape';

/**
 * Trouser leg (path = outline centre). Repair round 4 (zoo_turn_front.png, both legs row-scanned and averaged): lean
 * straight legs that taper from ~73 u at the thigh to ~50 u at the ankle (outer edge ~75 at the knee and 76-77 at the
 * calf, inner edge 26-28 at the ankle), a soft break where the hem bunches (~-70), and a hem that DRAPES over the shoe:
 * highest over the instep (~-56.6 at x 60) and sloping down to the inner ankle (~-41.6 at x 30), so ~32 u of white upper
 * shows on the inner side. Round 3's legs were 61-64 u wide at the calf with a flat hem at -52..-56 across the whole shoe,
 * which showed a tall white shaft with a vertical inner edge (a high-top). The crotch rises to -394 and the leg gap opens
 * at ~-382 (round 3: -368). The top runs to -460 so the trousers show between the open overshirt panels under the tee's
 * hem (-451, Torso.tsx).
 */
const LEG: Pt[] = [
	[0, -460], [77.4, -460, 'c'], [77.2, -420], [76, -370], [74.6, -310], [73, -262], [74.4, -232], [76.2, -195], [77.2, -150],
	[76.6, -110], [75.8, -92], [77.6, -81], [80.2, -71], [79.6, -61], [78.6, -51.6, 'c'],
	// the hem: a break over the instep, draping down to the inner ankle
	[75.6, -52.4], [71.6, -54.4], [66, -56.2], [60, -56.6], [54.6, -55.8], [50, -54], [46, -51], [42, -48], [37.6, -45], [33.4, -43],
	[30.2, -41.6, 'c'],
	// the inseam, up to the crotch
	[29.6, -50], [28.8, -60], [26.6, -70], [28, -81], [27.4, -92], [26.4, -102], [22.2, -140], [19.6, -180], [17.8, -220], [14.8, -260],
	[10.4, -300], [6.2, -340], [3.6, -365], [1.9, -382], [0, -394],
];
/** Key point indices of LEG: the outline runs from the top-outer corner round to the crotch (not up the centre line). */
const LEG_OUTLINE = {from: 1, to: LEG.length - 1} as const;
/** The fly: one soft seam from the tee hem to the crotch, between the open overshirt panels (zoo_turn_front.png). */
const FLY: Pt[] = [[1, -451], [1, -425], [0.7, -405], [0, -395.6]];
/**
 * The break crease (repair round 5, ZOO-S4; zoo_turn_front.png with the near-black trousers brightened): one soft fold just
 * above each hem where the leg bunches on the shoe, rising from the inner side (~40, -71) to a peak toward the outer side
 * (~60, -79) and turning down; a tapered line in trousersShadow, the trousers' one shadow tone (round 4's legs were flat at
 * the break).
 */
const BREAK_CREASE: Pt[] = [[40.4, -70.6], [47, -73.6], [54.6, -77], [60.4, -78.8], [64.6, -77.6], [67.4, -74.8]];

/**
 * Sneaker (path bottom at y = -1.75, so the outline's outer edge touches the ground). Repair round 4 (outline centres of
 * both sheet shoes, averaged): the upper is a convex dome under the hem; the outer edge falls almost straight from the hem
 * (~79 at -50) and flares into a round toe from ~-38 (~90 at -30, ~103 at -20, ~109 at -8); the inner edge is a near-vertical
 * ~28-30 from the inner ankle to the sole. The top of the shoe is hidden under the trouser hem.
 */
const SHOE: Pt[] = [
	[30.6, -46], [31.4, -60], [44, -66], [60, -67], [73, -64.6], [77.8, -58], [79.2, -50], [80.6, -46], [82.6, -42], [84.8, -38],
	[87.2, -34], [90, -30], [94.2, -26], [100, -22], [104.6, -18], [107.4, -14], [108.8, -10], [109.4, -5.6], [108.2, -2.4],
	// round 6: extra points along the flat bottom keep the spline from overshooting at the toe and the inner corner (round 4-5
	// tangents ran 2-3 u past both bottom corners and back, as small hooks in the outline)
	[105.2, -1.8], [100, -1.75], [88, -1.75], [60, -1.75], [36, -1.75], [31.4, -1.9], [28.6, -3.4], [27.8, -8], [28.2, -16], [28.6, -26],
	[29.2, -34], [30, -40],
];
/**
 * The sole below the midsole line (sneakerSole: the off-white, as light as the upper on the sheet; ZOO-C8 as corrected in round
 * 6). Repair round 6 (R5 review): the band is ~7 u between the midsole stroke and the outline (the sheet's ~7 u at world x
 * 70-90; round 5: 4.5 u), so the midsole line sits 2.6 u higher.
 */
const SOLE: Pt[] = [[112, -12], [60, -11.8], [22, -12], [22, 2], [112, 2]];
/**
 * Line art in ZOO_COLORS.sneakerLine (soft mid-grey, as on the sheet; round 3 drew them near-black, which read as a
 * canvas high-top): the midsole line, the vamp/toe-cap seam that arches from the inner sole over the toe box and back
 * down near the toe, and the lace panel on the instep: its inner edge and three lace bars, each lower bar set further
 * toward the outward-turned toe.
 */
const MIDSOLE: Pt[] = [[26, -11.8], [60, -11.7], [111, -12.2]];
const VAMP: Pt[] = [[27.6, -13.8], [34, -16.6], [41.4, -20.6], [49.6, -24.4], [59.6, -26.6], [70.6, -26.8], [80.4, -25.4], [89.4, -22.4], [96.4, -18.2], [101.4, -12.8]];
const LACE_EDGE: Pt[] = [[47.2, -48.6], [49.6, -38.4], [53.2, -28.6]];
const LACES: Pt[][] = [
	[[47.8, -46.4], [61, -47], [74.6, -45.4]],
	[[50.4, -40.2], [64.4, -40.6], [78.2, -39.2]],
	[[52.6, -33.6], [67, -33.8], [80.8, -32.4]],
];
/** Line widths: the sheet's midsole line is the heaviest of the shoe lines. */
const SHOE_LINE_W = {midsole: ZOO_LINE.detail * 1.15, seam: ZOO_LINE.detail * 0.9} as const;

const mirrorIf = (side: 1 | -1) => (p: Pt[]) => (side === 1 ? p : mirrorX(p));

const Leg: React.FC<{side: 1 | -1}> = ({side}) => {
	const pts = mirrorIf(side)(LEG);
	const ls = useLineScale();
	return (
		<g data-part={side === 1 ? 'legL' : 'legR'}>
			{/* Flat trousers, as on the sheet (round 3's under-hem band read as a belt and its inseam band as a thick inner
			    line). The outline skips the centre line above the crotch, where the two legs overlap (the fly is drawn once). */}
			<Shape d={smooth(pts)} fill={ZOO_COLORS.trousers} stroke={0} />
			<path data-part="breakCrease" d={tapered(mirrorIf(side)(BREAK_CREASE), (t) => ZOO_LINE.detail * 0.9 * ls * Math.pow(Math.sin(Math.PI * t), 0.6))} fill={ZOO_COLORS.trousersShadow} />
			<Outline d={smoothRange(pts, LEG_OUTLINE.from, LEG_OUTLINE.to)} />
		</g>
	);
};

const Shoe: React.FC<{side: 1 | -1}> = ({side}) => {
	const m = mirrorIf(side);
	const shoe = smooth(m(SHOE));
	return (
		<g data-part={side === 1 ? 'shoeL' : 'shoeR'}>
			<path d={shoe} fill={ZOO_COLORS.sneaker} />
			<Clipped clip={shoe}>
				<path d={smooth(m(SOLE))} fill={ZOO_COLORS.sneakerSole} />
				<Stroke name="midsole" d={line(m(MIDSOLE))} width={SHOE_LINE_W.midsole} color={ZOO_COLORS.sneakerLine} />
				<Stroke name="vamp" d={line(m(VAMP))} width={SHOE_LINE_W.seam} color={ZOO_COLORS.sneakerLine} />
				<Stroke name="laceEdge" d={line(m(LACE_EDGE))} width={SHOE_LINE_W.seam} color={ZOO_COLORS.sneakerLine} />
				{LACES.map((l, i) => (
					<Stroke key={i} name="lace" d={line(m(l))} width={SHOE_LINE_W.seam} color={ZOO_COLORS.sneakerLine} />
				))}
			</Clipped>
			<Outline d={shoe} />
		</g>
	);
};

export const Legs: React.FC = () => (
	<g data-part="legs">
		<Shoe side={1} />
		<Shoe side={-1} />
		<Leg side={1} />
		<Leg side={-1} />
		<Stroke name="fly" d={line(FLY)} width={ZOO_LINE.fine} color={ZOO_COLORS.trousersShadow} />
	</g>
);
