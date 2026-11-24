/**
 * ZOO head, 3/4 view turned to SCREEN RIGHT (reference/crops/zoo_turn_34.png). Same design and
 * expression controls as the front head: the beard, moustache, mouth library, eyes and brows are the
 * front-view drawings passed through the 3/4 maps in tq.ts (never mirrored), while the skull, hair,
 * near ear, nose and face contour are drawn for this view from the sheet.
 *
 * Layer order (back to front): neck is drawn by the body; back hair (with the nape), near ear, face
 * skin, mouth, beard, moustache, jaw outline, nose, eyes, brows, front hair.
 * Anatomical RIGHT = near side (screen left); anatomical LEFT = far side (screen right).
 */
import React, {useId} from 'react';
import {LINE, ZOO_COLORS} from '../../../palette';
import type {Expression, MouthShape} from '../../../types';
import {clamp, clamp01, lerp, lerpPts, line, safeId, smooth, type Pt} from '../../geometry';
import {EXPRESSIONS, MOD0, type BrowPose, type EyePose, type MouthMod} from '../../rig';
import {BEARD_BASE, MOUSTACHE, MOUSTACHE_SHADOW, moustachePts} from '../../parts/Beard';
import {BROW_L, BROW_R, posed} from '../../parts/Brows';
import {CLOSED, INNER, IRIS, LOWER, OUTER, UPPER} from '../../parts/Eyes';
import {Mouth, mouthDrops} from '../../parts/Mouth';
import {Clipped, Shape, Stroke} from '../../parts/Shape';
import {TQ_BROWS, TQ_EYES, tqBrowX, tqMouth, tqPt} from './tq';

/** Head pivot for headTilt in the 3/4 view (top of the neck, under the jaw). */
export const HEAD34_PIVOT = {x: -6, y: -748} as const;

// ---------------------------------------------------------------- face, ear, hair (drawn for 3/4)
/** Face skin, clockwise from the forehead (hidden under the hair) down the far contour to the chin. */
const FACE: Pt[] = [
	[18, -874], [40, -868], [50, -860], [55.5, -848], [57.4, -835], [56.2, -824], [53.8, -815.5], [53.2, -806], [54.4, -797],
	[54.2, -789.5], [52.4, -782.5], [51, -775.5], [49.2, -768], [48.2, -760], [46.8, -752.5], [44.6, -745.6], [41.2, -740],
	[35.6, -736.8], [27, -736.2], [18.4, -737.4], [10, -740.4], [1.4, -744.8], [-7.6, -750.4], [-15.2, -756.6],
	[-21.2, -763.6], [-25, -771], [-28.6, -778], [-30.6, -786.5], [-30.8, -795], [-28.4, -802], [-24.8, -808],
	[-23.2, -818], [-23, -830], [-22, -842], [-14, -860], [0, -870],
];
/** Indices of FACE that form the visible contour (far temple -> chin -> near jaw under the ear). */
const JAW_FROM = 4;
const JAW_TO = 28;

const dropPts = (pts: Pt[], jawDrop: number): Pt[] =>
	pts.map((p) => {
		const w = clamp01((p[1] + 790) / 45);
		return p.length === 3 ? [p[0], p[1] + jawDrop * w, 'c'] : [p[0], p[1] + jawDrop * w];
	});
export const face34Path = (jawDrop = 0) => smooth(dropPts(FACE, jawDrop));
const jaw34Outline = (jawDrop = 0) => line(dropPts(FACE, jawDrop).slice(JAW_FROM, JAW_TO + 1));

/** Skin shadow: near cheek under the cheekbone, and the far side of the forehead under the hair. */
const FACE_SHADOW = [
	smooth([[40, -862], [52, -852], [57, -838], [54, -826], [48, -832], [44, -848]]),
].join(' ');

/** Near ear (anatomical RIGHT), seen from the side. Its front edge tucks under the cheek. */
const EAR: Pt[] = [
	[-27, -800], [-31.5, -806.6], [-38, -810.4], [-45, -810], [-50.4, -805.4], [-52.8, -797.6], [-52, -789], [-48.6, -781.4],
	[-43, -776.4], [-36.4, -775], [-30.4, -777.6], [-27, -784],
];
const EAR_SHADOW: Pt[] = [[-33, -804], [-42, -806], [-48, -800], [-48, -790], [-43, -782.5], [-37.5, -790], [-36, -798]];
const EAR_HELIX: Pt[] = [[-34, -803.6], [-41, -806], [-46.8, -801.4], [-48.2, -793], [-45.6, -785.2], [-41, -781.4]];
const EAR_CONCHA: Pt[] = [[-38.6, -798.6], [-43, -796], [-43.4, -790], [-40.2, -786]];

/** Hair silhouette from the nape (behind the jaw) over the top to the far temple. Tuft tips are corners. */
const HAIR_TOP: Pt[] = [
	[-31.6, -776.4], [-31.8, -768.4], [-33.6, -760], [-37, -756], [-42, -760.4], [-46.6, -765.4], [-50.4, -768.6], [-49, -773.6],
	[-52, -780], [-57, -788.4], [-62.6, -792.6], [-66.6, -795.4], [-69.6, -802], [-70, -814.6], [-72.6, -819.4], [-79, -822.2],
	[-83, -826.6], [-86.4, -832.2, 'c'], [-80, -834.2], [-74.4, -834.8], [-67.2, -843.6], [-67.6, -848.2], [-70.6, -852.8],
	[-71.6, -858.4], [-70.4, -865.4], [-68.8, -869.4, 'c'], [-65.4, -864.2], [-60, -863.2], [-55.4, -864.4], [-50, -870],
	[-43, -874.2], [-37.8, -878.2], [-37.2, -885.6], [-33.6, -890.4, 'c'], [-27, -886.8], [-20, -885.2], [-11, -885.6],
	[-4, -887.6], [1, -890.6], [7, -892.6], [13, -895.6], [20, -897.6], [28, -898.2], [36, -896.6], [44, -893.2], [49.6, -889],
	[52.6, -882], [52.6, -875], [51.2, -869.4], [55, -865.2], [60, -864], [63.2, -861.6], [67, -860], [68.2, -853.2],
	[69.6, -847.2], [71.2, -842.4, 'c'], [67, -837.4], [62.6, -834], [61.2, -826], [57.6, -821.4], [54.2, -817.2],
];
/** Hidden return path behind the face, ear and jaw (closes the back-hair fill). */
const HAIR_HIDDEN: Pt[] = [[44, -812], [10, -814], [-20, -810], [-27, -796], [-28, -784]];

/** Hairline from the near sideburn, across the forehead (forelock at x~31), to the far temple. */
const HAIRLINE: Pt[] = [
	[-28.4, -803.4], [-23.8, -806.2], [-22.6, -815], [-21.2, -824], [-22.2, -832], [-19.6, -837.6], [-12, -839.6], [-2, -840],
	[7, -841.4], [13.6, -845], [18.6, -850], [22.6, -852.6], [25.8, -849.4], [28.4, -845], [31, -841, 'c'],
	[33.2, -846.4], [34.6, -853], [37.6, -859.6], [44, -862], [50.6, -857], [54.4, -848.4], [56.8, -838.6], [57.4, -829.4],
	[56.4, -822.6], [54.4, -818],
];
/** Close the front-hair fill over the top and down behind the ear (never over the ear itself). */
const FRONT_CLOSE: Pt[] = [[-60, -836], [-52, -826], [-42, -816], [-33, -812]];

const STRANDS: Pt[][] = [
	[[-63, -856], [-48, -864.6], [-30, -872.6], [-10, -878.4], [10, -880.4], [24, -878]], // main sweep edge (back -> crown)
	[[22.6, -852.6], [24.6, -862], [28.4, -872.6], [34.6, -878.6]], // forelock's near edge, up into the crown
	[[34, -862], [37, -873], [44.6, -881.4], [52, -880]], // crown curl over the hollow
	[[-74, -834.8], [-62, -838.4], [-50, -841]], // lower back wing
	[[-58, -811], [-50, -820], [-38, -826]], // above the ear
	[[55.2, -864], [60, -856], [61.6, -846]], // far wave
];
const HAIR_SHADOW = [
	// under the main sweep: back of the head between the tufts and the near temple
	smooth([[-64, -855], [-48, -863.4], [-30, -871.4], [-18, -874.6], [-14, -864], [-20, -850], [-24, -838], [-40, -836.6], [-58, -836], [-68, -846]]),
	// lower back of the head, behind the ear and down the nape
	smooth([[-71, -812], [-62, -828], [-46, -836], [-30, -836], [-23, -826], [-24, -806], [-34, -810], [-48, -804], [-56, -790], [-50, -770], [-37, -756], [-62, -790]]),
	// crown hollow above the forehead
	smooth([[31, -864], [35, -877], [45, -882.6], [51.6, -874], [48, -862], [39, -860]]),
	// under the far wave
	smooth([[56, -852], [63, -855], [70, -844], [62.6, -835], [57.4, -836]]),
].join(' ');

// ---------------------------------------------------------------- nose (drawn for 3/4)
const NOSE_PLANE = smooth([[23.6, -820], [24.8, -809], [26, -800], [27, -793.4], [24.2, -790.4], [21.6, -792], [22.2, -801], [22.4, -811]]);
const UNDER_TIP = smooth([[21, -787.2], [27, -785.2], [34.4, -786.8], [30, -788.6], [25, -788.8]]);
const BRIDGE = line([[28.4, -813], [30, -805], [32.2, -798], [34.6, -792.4]]);
const TIP = line([[34.6, -792.4], [35.6, -789.6], [33.8, -786.8], [29.8, -786.2]]);
const WING = line([[24.6, -786], [21.4, -786.4], [19.8, -789.2]]);

// ---------------------------------------------------------------- eyes and brows (front drawings, mapped)
type EyeProps = {which: 'near' | 'far'; pose: EyePose; blink: number; lookX: number; lookY: number};

const Eye34: React.FC<EyeProps> = ({which, pose, blink, lookX, lookY}) => {
	const clipId = safeId(useId(), 'eye34');
	const e = TQ_EYES[which];
	const s = pose.scale * e.s;
	const W = (p: Pt): Pt => {
		const x = e.x + e.dir * p[0] * s * e.sx;
		const y = e.y + p[1] * s;
		return p.length === 3 ? [x, y, 'c'] : [x, y];
	};
	const upper = UPPER.map((p, i) => [p[0], p[1] - pose.lidTop * (i === 1 ? 1 : 0.75)] as Pt);
	const lower = LOWER.map((p, i) => [p[0], p[1] - pose.lidBottom * (i === 1 ? 1 : 0.8)] as Pt);
	const shape = [OUTER, ...upper, INNER, ...lower].map(W);
	const b = clamp01(blink);
	const lid = lerpPts(upper, CLOSED.map((p, i) => [p[0], Math.min(p[1], lower[2 - i][1] - 1.1)] as Pt), b);
	const lidEdge = [OUTER, ...lid, INNER].map(W);
	const lidFill = [...lidEdge, W([-14, -16]), W([14, -16])];
	const ix = e.x + e.dir * IRIS.x * s * e.sx + (TQ_EYES.restLook + clamp(lookX, -1, 1) * 4.2) * e.sx;
	const iy = e.y + IRIS.y * s + clamp(lookY, -1, 1) * 1.8;
	const r = IRIS.r * s * pose.iris;
	const pr = IRIS.pupil * s * lerp(1, pose.iris, 0.6);
	const crease: Pt[] = [W([-5, -7.4 - pose.lidTop * 0.6]), W([1.5, -8.2 - pose.lidTop * 0.6]), W([7, -6.6 - pose.lidTop * 0.6])];
	return (
		<g data-part={which === 'near' ? 'eyeR' : 'eyeL'}>
			<clipPath id={clipId}>
				<path d={smooth(shape)} />
			</clipPath>
			<path d={smooth(shape)} fill={ZOO_COLORS.eyeWhite} />
			<g clipPath={`url(#${clipId})`}>
				<ellipse data-part="iris" cx={ix} cy={iy} rx={r * e.irisSx} ry={r} fill={ZOO_COLORS.eyeIris} />
				<ellipse data-part="pupil" cx={ix} cy={iy} rx={pr * e.irisSx} ry={pr} fill={ZOO_COLORS.pupil} />
				<circle data-part="highlight" cx={ix + 1.6 * e.irisSx} cy={iy - 2} r={1.1} fill={ZOO_COLORS.eyeWhite} />
				{b > 0.001 ? <path data-part="upperLid" d={smooth(lidFill)} fill={ZOO_COLORS.skin} /> : null}
			</g>
			<path d={line([W([-5.5, lower[1][1] - 0.3]), W([0.5, lower[1][1] + 0.4]), W([6, lower[2][1] + 0.1])])} fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={1.3} strokeLinecap="round" />
			{which === 'near' ? <path d={line(crease)} fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={1.2} strokeLinecap="round" /> : null}
			<path data-part="lidLine" d={line(lidEdge)} fill="none" stroke={LINE.color} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
			<path d={line([W([10.4, 1.2]), W([12.6, -0.6])])} fill="none" stroke={LINE.color} strokeWidth={1.8} strokeLinecap="round" />
		</g>
	);
};

const browPath = (which: 'near' | 'far', pose: BrowPose, lift: number) => {
	const base = which === 'near' ? BROW_R : BROW_L;
	const pts = posed(base, pose, lift);
	// thin the brow about its mid-line (top edge = first half of the points, bottom edge = second half)
	const n = pts.length;
	const mid = (i: number) => {
		const j = n - 1 - i; // matching point on the other edge (the outer tip pairs with itself)
		return (pts[i][1] + pts[Math.max(0, Math.min(n - 1, j))][1]) / 2;
	};
	const dy = TQ_BROWS[which].dy;
	return smooth(
		pts.map((p, i) => {
			const m = mid(i);
			const x = tqBrowX(which, p[0]);
			const y = m + (p[1] - m) * TQ_BROWS.thickness + dy;
			return p.length === 3 ? [x, y, 'c'] : [x, y];
		}),
	);
};

// ---------------------------------------------------------------- beard, moustache (front drawings, mapped)
/**
 * The front beard mapped into 3/4. Its first two points (the near cheek top) are replaced by the
 * sideburn edge measured on the 3/4 sheet, so the beard meets the hair in front of the near ear.
 */
const SIDEBURN_EDGE: Pt[] = [[-40, -812.4], [-25, -810.4], [-22.6, -801], [-19.4, -791.4]];
const beard34 = (hole: number, jawDrop: number): Pt[] => [
	...SIDEBURN_EDGE,
	...BEARD_BASE.slice(2).map((p) => {
		let y = p[1];
		if (Math.abs(p[0]) > 60) y = p[1] + (p[1] > -760 ? jawDrop : 0);
		else y = p[1] + hole * clamp01((p[1] + 769) / 7);
		return tqPt(p.length === 3 ? [p[0], y, 'c'] : [p[0], y]);
	}),
];
/** One flat beard shadow: a band along the jaw and under the chin. */
const BEARD_SHADOW = (jawDrop: number) =>
	smooth([[-33, -782], [-27, -780], [-20, -768], [-9, -756 + jawDrop * 0.7], [6, -747.6 + jawDrop], [24, -743.4 + jawDrop], [40, -744.6 + jawDrop], [50, -752 + jawDrop], [50, -728], [-33, -728]]);

const Beard34: React.FC<{hole: number; jawDrop: number}> = ({hole, jawDrop}) => {
	const d = smooth(beard34(hole, jawDrop));
	return (
		<g data-part="beard">
			<Clipped clip={face34Path(jawDrop)}>
				<path d={d} fill={ZOO_COLORS.beard} />
				<Clipped clip={d}>
					<path d={BEARD_SHADOW(jawDrop)} fill={ZOO_COLORS.beardShadow} />
				</Clipped>
			</Clipped>
		</g>
	);
};

const Moustache34: React.FC<{liftR: number}> = ({liftR}) => {
	const d = smooth(moustachePts(MOUSTACHE, liftR).map(tqPt));
	return (
		<g data-part="moustache">
			<Clipped clip={face34Path(0)}>
				<path d={d} fill={ZOO_COLORS.beard} />
				<Clipped clip={d}>
					<path d={smooth(moustachePts(MOUSTACHE_SHADOW, liftR).map(tqPt))} fill={ZOO_COLORS.beardShadow} />
				</Clipped>
			</Clipped>
		</g>
	);
};

// ---------------------------------------------------------------- head
export type Head34Props = {
	expression: Expression;
	mouth?: MouthShape;
	blink: number;
	browLift: number;
	lookX: number;
	lookY: number;
	headTilt: number;
};

const explicitMod = (m: MouthMod): MouthMod => ({...MOD0, cornerL: m.cornerL * 0.5, cornerR: m.cornerR * 0.5, wave: m.wave * 0.4, moustacheLiftR: m.moustacheLiftR * 0.6});

/** Back hair: drawn before the face. */
export const HairBack34: React.FC = () => (
	<g data-part="hairBack">
		<Shape d={smooth([...HAIR_TOP, ...HAIR_HIDDEN])} fill={ZOO_COLORS.hair} shadow={{d: HAIR_SHADOW, fill: ZOO_COLORS.hairShadow}} stroke={0} />
		<Stroke d={line(HAIR_TOP)} width={LINE.width} />
	</g>
);

export const Ear34: React.FC = () => (
	<g data-part="earR">
		<Shape d={smooth(EAR)} fill={ZOO_COLORS.skin} shadow={{d: smooth(EAR_SHADOW), fill: ZOO_COLORS.skinShadow}} />
		<Stroke d={line(EAR_HELIX)} width={LINE.detailWidth} />
		<Stroke d={line(EAR_CONCHA)} width={LINE.detailWidth * 0.8} />
	</g>
);

export const HairFront34: React.FC = () => {
	const top = HAIR_TOP.slice(HAIR_TOP.findIndex((p) => p[0] === -67.2), HAIR_TOP.length);
	return (
		<g data-part="hairFront">
			<path d={smooth([...HAIRLINE, ...top.slice().reverse(), ...FRONT_CLOSE])} fill={ZOO_COLORS.hair} />
			<Clipped clip={smooth([...HAIRLINE, ...top.slice().reverse(), ...FRONT_CLOSE])}>
				<path d={HAIR_SHADOW} fill={ZOO_COLORS.hairShadow} />
			</Clipped>
			{STRANDS.map((s, i) => (
				<Stroke key={i} d={line(s)} width={LINE.detailWidth} />
			))}
			<Stroke d={line(HAIRLINE)} width={LINE.width} />
			<Stroke d={line(top)} width={LINE.width} />
		</g>
	);
};

export const Head34: React.FC<Head34Props> = ({expression, mouth, blink, browLift, lookX, lookY, headTilt}) => {
	const spec = EXPRESSIONS[expression];
	const shape = mouth ?? spec.mouth;
	const mod = mouth ? explicitMod(spec.mod) : spec.mod;
	const {hole, jaw} = mouthDrops(shape, mod);
	const lift = clamp01(browLift) * 3.5;
	return (
		<g data-part="head" data-view="threeQuarter" transform={`rotate(${headTilt} ${HEAD34_PIVOT.x} ${HEAD34_PIVOT.y})`}>
			<HairBack34 />
			<Ear34 />
			<Shape name="face" d={face34Path(jaw)} fill={ZOO_COLORS.skin} shadow={{d: FACE_SHADOW, fill: ZOO_COLORS.skinShadow}} stroke={0} />
			<Mouth shape={shape} mod={mod} project={tqMouth} />
			<Beard34 hole={hole} jawDrop={jaw} />
			<Moustache34 liftR={mod.moustacheLiftR} />
			<path data-part="jawOutline" d={jaw34Outline(jaw)} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinecap="round" strokeLinejoin="round" />
			<g data-part="nose">
				<path d={NOSE_PLANE} fill={ZOO_COLORS.skinShadow} />
				<path d={UNDER_TIP} fill={ZOO_COLORS.skinShadow} />
				<Stroke d={BRIDGE} width={1.4} />
				<Stroke d={TIP} width={LINE.detailWidth} />
				<Stroke d={WING} width={LINE.detailWidth} />
			</g>
			<g data-part="eyes">
				<Eye34 which="far" pose={spec.eyes} blink={blink} lookX={lookX} lookY={lookY} />
				<Eye34 which="near" pose={spec.eyes} blink={blink} lookX={lookX} lookY={lookY} />
			</g>
			<g data-part="brows">
				<path data-part="browL" d={browPath('far', spec.browL, lift)} fill={ZOO_COLORS.brow} />
				<path data-part="browR" d={browPath('near', spec.browR, lift)} fill={ZOO_COLORS.brow} />
				{spec.crease > 0 ? (
					<path d="M27 -846 C26.6 -843 26.8 -840.5 27.8 -838.5" fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={1.6 * spec.crease} strokeLinecap="round" />
				) : null}
			</g>
			<HairFront34 />
		</g>
	);
};
