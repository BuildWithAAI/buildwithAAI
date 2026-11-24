/**
 * Torso, front view: near-black crewneck tee under an OPEN slate overshirt. Asymmetric details are
 * placed per side, never mirrored: the small silver buttons run down the screen-left panel
 * (wearer's right placket), the chest pocket is on the screen-right panel, and the jellyfish pin
 * sits above that pocket on the anatomical-left chest. The collar leaves are a symmetric pair.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, type Pt} from '../geometry';
import {PIVOTS, SHOULDER_FOLLOW} from '../rig';
import {JellyfishPin} from './Pin';
import {ZOO_LINE} from '../lines';
import {Shape, Stroke, useLineScale} from './Shape';

// The hem points are corners (integration fix INT-Z2): as smooth points the closed spline overshot ~30 units below
// the overshirt hem and hung a rounded tee tail over the trousers that zoo_turn_front.png does not show.
// Repair round 1 (zoo_turn_front.png): the crewneck sits at -703.6 (v1 -715.8), so the neck shows ~30 u as on the
// sheet, and the shoulder line runs at -714 / -707 / -699 at |x| = 60 / 80 / 100 (v1 was 4-9 u higher).
// Repair round 4 (decision ZOO-K4; zoo_turn_front.png row/column scans): the tee ENDS at -451 with its hem line, and the
// trousers (with the fly seam, Legs.tsx) show between the open overshirt panels down to the overshirt hem, as on the sheet
// (INT-Z2 had run the tee down to the overshirt hem at -419).
const TEE = smooth([
	[-37, -727], [-28, -716], [-15, -706.6], [0, -703.6], [15, -706.6], [28, -716], [37, -727], [39, -700], [36, -451, 'c'], [-36, -451, 'c'],
	[-39, -690],
]);
const TEE_RIB = line([[-25.6, -709.6], [-13, -701.4], [0, -699.2], [13, -701.4], [25.6, -709.6]]);

/**
 * Outer contour of the screen-right panel (anatomical left), from the collar over the shoulder to the hem corner. Repair
 * round 2 (line centres row-scanned on zoo_turn_front.png): the shoulder line runs at -704.6 / -695.6 / -686.4 at
 * x = 76 / 96 / 110.4 (round 1 sat ~4 u high); at the shoulder point the edge turns down the ARMHOLE SEAM (x ~104 at
 * -672, ~98 at -648) into the armpit and continues as the body side at x ~86-89, so the sleeve cap and the full sleeve
 * width show outside it; below y ~-490 the side steps in to ~85 and the sleeve hangs free of it (background between
 * them, as on the sheet). Round 1 kept the panel at +-101..118, which hid ~13 u of each sleeve and made the torso boxy.
 * The screen-left panel uses the garment mirror of this contour (no markings on it); the plackets differ.
 * Repair round 3: the hem corner is a rounder, tighter arc (from y ~-434), so at y -424 the silhouette has come in to ~81
 * as on the sheet (round 2's squarer corner still reached ~85 there; with Legs.tsx's hip corner fixed).
 */
const OUTER_SR: Pt[] = [
	[28, -735], [46, -725], [60, -714.4], [76, -704.6], [96, -695.6], [106, -690.4], [110.4, -686.4, 'c'], [106.4, -680.6],
	[104, -672], [101.8, -663], [99.6, -655], [97.4, -647.6], [94.4, -640.6], [91, -633.4], [89.4, -622], [88, -600], [87, -575],
	[86.6, -550], [87, -528], [87.6, -510], [87.2, -497], [86.2, -485], [85.7, -470], [85.8, -456], [85.6, -444], [85, -434.4],
	[82.6, -427.6], [77.2, -422.6], [68, -420.2], [50, -418.6],
];
/** Screen-left panel (wearer's right front, carries the buttons). */
const PANEL_SL: Pt[] = [
	...mirrorX(OUTER_SR), [-26, -418.6], [-21.6, -421.8], [-21, -432], [-21, -600], [-21.6, -690], [-24, -705], [-26.4, -722],
];
/** Screen-right panel (wearer's left front, carries the pocket and pin). */
const PANEL_SR: Pt[] = [...OUTER_SR, [29, -418.6], [24.6, -421.8], [24, -432], [24, -600], [24.6, -690], [27, -705], [29.4, -722]];
// One shadow tone, kept to a narrow band (~5 u) inside each side edge, under the arm (v1's full-length 30 u bands read
// as a two-tone vest). Round 2: follows the new armhole seam and body side.
const PANEL_SHADOW_PTS: Pt[] = [[128, -700], [108, -688], [100.6, -672], [96.2, -656], [90, -640], [84.6, -626], [83, -600], [82, -560], [82, -520], [82.2, -500], [80.6, -470], [80.4, -440], [78, -416], [128, -416]];
const PANEL_SHADOW_SR = smooth(PANEL_SHADOW_PTS);
const PANEL_SHADOW_SL = smooth(mirrorX(PANEL_SHADOW_PTS));

const COLLAR_BACK = smooth([[-31, -722], [-29, -737], [-15, -741.5], [0, -742.5], [15, -741.5], [29, -737], [31, -722]]);
/**
 * Screen-left collar leaf; the screen-right leaf is its garment mirror. Repair round 1: a flat, spread collar as on the
 * sheet (top edge along the shoulder line, crisp point at (-55,-693)); v1's leaf stood ~35 u tall up to the chin.
 */
const COLLAR_SL: Pt[] = [[-27, -737.6], [-38, -731.2], [-49, -724.4], [-60.4, -716.2, 'c'], [-58.8, -706.6], [-55.4, -693.4, 'c'], [-47.4, -698.4], [-38.8, -704.4], [-31.4, -712], [-26.4, -724]];
/** Thin crescent of shadow just under the leaf's lower edge. */
const COLLAR_SHADOW: Pt[] = [[-57.6, -700], [-55.4, -693.4], [-47.4, -698.4], [-38.8, -704.4], [-31.4, -712], [-28.6, -706], [-38, -699], [-48, -692.6], [-55, -688.6]];

const POCKET = smooth([[39, -637, 'c'], [81, -637, 'c'], [81, -601, 'c'], [60, -592.4, 'c'], [39, -601, 'c']]);
const POCKET_HEM = line([[39.5, -630.4], [80.5, -630.4]]);
const BUTTON_X = -28.4;
/** Repair round 1: measured on zoo_turn_front.png (-672/-622/-565/-508/-452); v1 put the top button at -686 (ZOO-V3 revised). */
export const BUTTON_Y = [-672, -622, -565, -508, -452];

/**
 * The overshirt's screen-right shoulder (anatomical left) follows the left arm's shoulder angle by SHOULDER_FOLLOW, so a
 * raised sleeve continues out of a lifted shoulder line instead of appearing from under a fixed corner (ZOO-P2).
 * Weights fade from the shoulder tip toward the collar and down the side seam; at rest nothing moves.
 */
const SHOULDER_WEIGHTS: Record<string, number> = {'76,-704.6': 0.05, '96,-695.6': 0.25, '106,-690.4': 0.45, '110.4,-686.4': 0.6, '106.4,-680.6': 0.5, '104,-672': 0.35, '101.8,-663': 0.2, '99.6,-655': 0.1};
const followShoulder = (pts: Pt[], deg: number): Pt[] => {
	if (Math.abs(deg) < 1e-3) return pts;
	const c = PIVOTS.shoulderL;
	return pts.map((p) => {
		const w = SHOULDER_WEIGHTS[`${p[0]},${p[1]}`] ?? 0;
		if (!w) return p;
		const a = (deg * SHOULDER_FOLLOW * w * Math.PI) / 180;
		const x = p[0] - c.x;
		const y = p[1] - c.y;
		const q: [number, number] = [c.x + x * Math.cos(a) - y * Math.sin(a), c.y + x * Math.sin(a) + y * Math.cos(a)];
		return p.length === 3 ? [q[0], q[1], 'c'] : q;
	});
};

export const Torso: React.FC<{shoulderL?: number}> = ({shoulderL = 0}) => {
	const ls = useLineScale();
	return (
	<g data-part="torso">
		<Shape name="tee" d={TEE} fill={ZOO_COLORS.tee} />
		<Stroke d={TEE_RIB} width={ZOO_LINE.detail * 0.8} color={ZOO_COLORS.overshirt} />
		<Shape name="overshirtRightPanel" d={smooth(PANEL_SL)} fill={ZOO_COLORS.overshirt} shadow={{d: PANEL_SHADOW_SL, fill: ZOO_COLORS.overshirtShadow}} />
		<Shape name="overshirtLeftPanel" d={smooth(followShoulder(PANEL_SR, shoulderL))} fill={ZOO_COLORS.overshirt} shadow={{d: PANEL_SHADOW_SR, fill: ZOO_COLORS.overshirtShadow}} />
		<g data-part="collarShadow">
			<path d={smooth(COLLAR_SHADOW)} fill={ZOO_COLORS.overshirtShadow} />
			<path d={smooth(mirrorX(COLLAR_SHADOW))} fill={ZOO_COLORS.overshirtShadow} />
		</g>
		<Shape name="collarR" d={smooth(COLLAR_SL)} fill={ZOO_COLORS.overshirt} />
		<Shape name="collarL" d={smooth(mirrorX(COLLAR_SL))} fill={ZOO_COLORS.overshirt} />
		<g data-part="pocket">
			<path d={POCKET} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.detail * ls} strokeLinejoin="round" />
			<Stroke d={POCKET_HEM} width={ZOO_LINE.fine} />
		</g>
		<g data-part="buttons">
			{BUTTON_Y.map((y) => (
				<circle key={y} cx={BUTTON_X} cy={y} r={3.7} fill={ZOO_COLORS.buttons} stroke={LINE.color} strokeWidth={ZOO_LINE.fine * 0.85 * ls} />
			))}
		</g>
		<JellyfishPin />
	</g>
	);
};

/** Collar stand behind the neck (drawn before the neck). */
export const CollarBack: React.FC = () => <Shape name="collarBack" d={COLLAR_BACK} fill={ZOO_COLORS.overshirtShadow} />;
