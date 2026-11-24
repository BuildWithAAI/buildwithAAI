/**
 * ZOO head in PROFILE facing SCREEN RIGHT (reference/crops/zoo_turn_side.png). World units in the
 * side view's root space: origin = centre of the footprint (crop x=150), 1 crop px = 900/630 u.
 *
 * Facing screen right, the viewer sees the anatomical RIGHT side: the right ear, right eye and right
 * brow. The forelock projects in front of the forehead, as on the sheet. Drawn for this view, never
 * flipped from another.
 *
 * Mouth: every library shape is supported. The face contour gets a notch between the upper and lower
 * lip fronts whose height comes from MOUTHS[shape] (top/bottom of the opening) and whose depth comes
 * from its half width; the dark interior fills the notch, and the chin and lip patch drop by the same
 * `jaw` / `hole` amounts the front head uses, so the beard stays coherent.
 */
import React, {useId} from 'react';
import {LINE, ZOO_COLORS} from '../../../palette';
import type {Expression, MouthShape} from '../../../types';
import {clamp, clamp01, lerpPts, line, safeId, smooth, tapered, type Pt} from '../../geometry';
import {ZOO_LINE} from '../../lines';
import {MOUTHS} from '../../mouth';
import {EXPRESSIONS, type BrowPose, type EyePose, type MouthMod} from '../../rig';
import {BROW_R, posed} from '../../parts/Brows';
import {HIGHLIGHT, lidProfile} from '../../parts/Eyes';
import {browLifts, explicitMod} from '../../parts/Head';
import {mouthDrops} from '../../parts/Mouth';
import {nostrilWidth} from '../../parts/Nose';
import {Clipped, Shape, Stroke, useLineScale} from '../../parts/Shape';

export const HEAD_SIDE_PIVOT = {x: -6, y: -748} as const;
/** Lip contact point (front of the closed lips) and mouth line in the side view. */
export const SIDE_MOUTH = {x: 60.2, y: -767} as const;

// ---------------------------------------------------------------- hair, ear, neck
const HAIR_TOP: Pt[] = [
	[-29, -752.6], [-33.6, -753], [-38.8, -760.4], [-42.8, -763.4], [-44.6, -767.6], [-50.4, -769.8], [-51, -773.4], [-55.4, -778],
	[-59, -784], [-62.4, -787.4], [-69.6, -791.2], [-73, -794.4], [-73.2, -800], [-70.6, -809, 'c'], [-80, -818], [-86.4, -826],
	[-87.6, -831, 'c'], [-84, -834], [-78, -834], [-73, -836.6], [-66.4, -843.6], [-71.6, -852], [-71.4, -861.6], [-68.6, -864.2, 'c'], [-64, -863.2],
	[-59.6, -861.8], [-54, -862.4], [-48, -866.4], [-46, -870.4], [-39, -878.4], [-34.6, -881.2], [-29.6, -882], [-25.4, -884.4],
	[-14.4, -884.8], [-12.4, -889], [-8.6, -891.6], [-4.4, -891.8], [1.8, -889], [11.4, -887], [18.2, -884.8], [22.9, -887.2],
	[28.6, -888], [37.1, -893.4], [43.2, -895.4], [53.6, -895.4], [63.2, -891.2], [69, -884], [70.4, -878.6], [70.6, -872.4],
	// Repair round 1 (zoo_turn_side.png): the forelock rolls over and HANGS as a C-curl in front of the forehead, tip at
	// (71.8,-838.8) pointing down and back, with a gap inside the curl (v1 was a forward visor tipped at (80.6,-848.6)).
	[75, -867.6], [79.2, -862.6], [80.6, -856.4], [80, -850], [78, -844.4], [74.8, -840.4], [71.8, -838.8, 'c'], [71.4, -842.6],
	[70, -847.4], [66.6, -851.2], [63, -853],
];
/** Hairline: forelock underside, temple, sideburn down to the jaw in front of the ear. */
const HAIRLINE: Pt[] = [
	[63, -853], [61.6, -850.4], [59.6, -848.6], [57.6, -848.8], [53.6, -847], [47, -841.6], [43.6, -837.4], [36.4, -837.6],
	[31, -834.8], [25, -835.2], [19.4, -836.6], [16.4, -834], [17.4, -828], [15.6, -822], [14, -814], [12.6, -806], [14, -798],
	[13.6, -791], [10.6, -788.6], [6, -789],
];
/** Closes the front-hair fill above the hairline, staying right of the ear (ear max x = 1.6). */
const FRONT_CLOSE: Pt[] = [[8.6, -806], [8.6, -832], [2, -858], [28, -884], [64, -882]];
/** Hidden return path (behind the ear and the jaw). */
const HAIR_HIDDEN: Pt[] = [[0, -782], [-12, -778], [-17, -770], [-21, -761], [-25, -757]];
/** Strands in the hair shadow tone (repair round 1): short curved wave edges instead of one long crown seam. */
const STRANDS: Pt[][] = [
	[[-30, -873.6], [-14, -878.6], [4, -880.6], [20, -879]], // crown lock's lower edge
	[[30, -884], [46, -884], [60, -878], [70, -868]], // top wave toward the forelock
	[[-60, -838], [-46, -846], [-30, -850], [-14, -850]], // lower back wing
	[[-62, -812], [-50, -824], [-36, -832]], // behind the ear
	[[68.4, -860.6], [74, -855.6], [76.4, -848.6]], // inside the forelock curl
];
/** One flat shadow tone: a band under the crown waves and a small patch above the ear (v1 shaded the whole lower back). */
const HAIR_SHADOW = [
	smooth([[-70, -836], [-52, -846.6], [-30, -852.4], [-10, -854.4], [8, -850.6], [15, -840], [-4, -843.6], [-26, -842.4], [-50, -836.6], [-66, -826]]),
	smooth([[-22, -812], [-8, -817.6], [8, -813.6], [10, -800], [-2, -794], [-16, -801]]),
	smooth([[46, -862], [58, -866], [70, -862], [64, -852], [56, -846], [48, -846]]),
].join(' ');

const EAR: Pt[] = [
	[1.6, -797], [-2.4, -806.6], [-8.6, -812], [-16, -811.8], [-22, -806.4], [-25, -798], [-24, -789.6], [-20.4, -783.6], [-15, -779],
	[-10.6, -777.4], [-6, -779], [-2.6, -784], [0.4, -790],
];
const EAR_SHADOW: Pt[] = [[-4, -805], [-12, -808], [-19, -804], [-21, -795], [-17, -786], [-11, -782], [-12, -794], [-8, -801]];
/** One soft fold line in the nose-line brown (v1: two near-black strokes). */
const EAR_FOLD: Pt[] = [[-5.6, -804.2], [-11.6, -806.8], [-17.2, -803.6], [-18.8, -795.6], [-16, -787.6]];

const NECK: Pt[] = [
	[-14, -782], [-17, -770], [-22, -760], [-30, -752], [-33, -746], [-35, -736], [-36.4, -726], [-10, -718], [10, -714], [21, -717.6],
	[22.6, -730], [24.8, -742], [20, -750], [8, -762], [2, -778],
];
const NECK_SHADOW = smooth([[-40, -760], [-18, -756], [4, -752], [20, -748], [28, -744], [28, -730], [0, -736], [-40, -742]]);

export const NeckSide: React.FC = () => <Shape name="neck" d={smooth(NECK)} fill={ZOO_COLORS.skin} shadow={{d: NECK_SHADOW, fill: ZOO_COLORS.skinShadow}} />;

// ---------------------------------------------------------------- face profile with the mouth notch
type MouthGeo = {notch: boolean; top: Pt; corner: Pt; bottom: Pt; lineEnd: Pt; protrude: number; teeth: boolean; tongue: boolean; lowerLip: boolean};

/** Profile mouth geometry from the front library shape (same opening heights, scaled by the expression). */
const mouthGeo = (shape: MouthShape, mod: MouthMod, jawDrop: number): MouthGeo => {
	const spec = MOUTHS[shape];
	const m = SIDE_MOUTH;
	const lift = -mod.cornerL + mod.wave * 0.6; // the visible corner is the anatomical right one (front's screen-left)
	if (spec.kind === 'line') {
		const hw = Math.max(...spec.line.map((p) => Math.abs(p[0])));
		const depth = hw * 0.62;
		const pressed = shape === 'mbp';
		return {
			notch: false,
			top: [m.x, m.y],
			corner: [m.x - depth, m.y + 0.6 + lift],
			bottom: [m.x, m.y],
			lineEnd: [m.x - depth, m.y + 0.6 + lift],
			protrude: pressed ? 0.8 : 0,
			teeth: false,
			tongue: false,
			lowerLip: pressed,
		};
	}
	const pts = [...spec.top, ...spec.bottom];
	const hw = Math.max(...pts.map((p) => Math.abs(p[0])));
	const t = -Math.min(...spec.top.map((p) => p[1])) * mod.openScale;
	const b = Math.max(...spec.bottom.map((p) => p[1])) * mod.openScale;
	const round = shape === 'oh' ? 1.2 : shape === 'ee' ? -0.8 : 0;
	const depth = Math.min(15, hw * 0.62 * mod.widthScale + (shape === 'oh' ? 1.5 : 0));
	return {
		notch: true,
		top: [m.x + 0.6 + round, m.y - t * 0.9],
		corner: [m.x - depth, m.y + (b - t) * 0.18 + lift],
		bottom: [m.x + round * 0.8, m.y + b * 0.85 + jawDrop * 0.3],
		lineEnd: [m.x - depth, m.y],
		protrude: round,
		teeth: Boolean(spec.teeth),
		tongue: Boolean(spec.tongue),
		lowerLip: false,
	};
};

/** Front profile down to the upper lip (fixed), then lower lip, chin and jaw (follow jawDrop). */
const UPPER_PROFILE: Pt[] = [
	[18, -858], [40, -859], [55.4, -853], [61, -847], [63.4, -838], [63.8, -830], [63, -824], [61.8, -819.6], [62.8, -813],
	[63.4, -806], [67.6, -799], [72.4, -793], [75.6, -789.4], [74.8, -785.8], [70.6, -784.2], [66, -783.4], [63.6, -781],
	[63, -775], [61.8, -770.4],
];
const LOWER_PROFILE: Pt[] = [
	[59.4, -761], [59.2, -757], [60.6, -751], [61.6, -745.4], [60, -740.4], [54, -738.2], [44, -738.4], [34, -740.6], [25, -744.6],
	[17, -750.6], [9.6, -757.6], [5.6, -766], [4.6, -776], [5.4, -786], [8, -796], [11, -810], [13, -824], [15, -840],
];
/** Index range of the outlined contour within the assembled point list (forehead -> jaw under the ear). */
const dropLower = (pts: Pt[], jawDrop: number): Pt[] =>
	pts.map((p) => {
		const w = clamp01((p[1] + 790) / 30) * clamp01((p[0] - 2) / 14);
		return p.length === 3 ? [p[0], p[1] + jawDrop * w, 'c'] : [p[0], p[1] + jawDrop * w];
	});

const faceProfile = (g: MouthGeo, jawDrop: number): {fill: Pt[]; outline: Pt[]} => {
	const lower = dropLower(LOWER_PROFILE, jawDrop);
	const lips: Pt[] = g.notch
		? [[g.top[0], g.top[1], 'c'], [g.corner[0], g.corner[1], 'c'], [g.bottom[0], g.bottom[1], 'c']]
		: [[SIDE_MOUTH.x + 0.4 + g.protrude, SIDE_MOUTH.y - 1.4], [SIDE_MOUTH.x + 0.2 + g.protrude, SIDE_MOUTH.y + 1.6]];
	const fill = [...UPPER_PROFILE, ...lips, ...lower];
	const start = 3; // forehead below the hairline
	const end = UPPER_PROFILE.length + lips.length + 12; // up the jaw to below the ear
	return {fill, outline: fill.slice(start, end + 1)};
};

const FACE_SHADOW = smooth([[14, -838], [30, -838], [32, -832], [24, -826], [18, -812], [14, -800], [10, -820]]);
const NOSE_UNDER = smooth([[64.4, -784.4], [70.6, -784.6], [74.4, -786.4], [69, -787.4]]);
const NOSTRIL: Pt[] = [[66.8, -785.6], [64.8, -787.6], [66, -790.2]];

// ---------------------------------------------------------------- beard and moustache (profile)
const beardSide = (hole: number, jawDrop: number, corner: Pt): Pt[] => {
	const lip = (p: Pt): Pt => [p[0], p[1] + hole * 0.9];
	const pts: Pt[] = [
		[5, -795], [13.4, -791.6], [15.4, -786], [17.6, -777.2], [23.6, -769.4], [31, -765], [corner[0] - 2, corner[1] + 1.6],
		lip([46, -756.4]), lip([51.8, -753]), lip([54.4, -754.6, 'c']), lip([58.4, -754.4]), [64, -752], [64, -730], [0, -730],
	];
	return dropLower(pts, jawDrop);
};
const BEARD_SHADOW = (jawDrop: number) => smooth([[2, -790], [8, -776], [12, -762], [24, -752 + jawDrop * 0.6], [40, -745.6 + jawDrop], [58, -744 + jawDrop], [64, -730], [0, -730]]);
const MOUSTACHE: Pt[] = [
	[63.8, -781], [58, -782.4], [49, -781.6], [42.4, -778.6], [38.6, -773.4], [37.4, -767.4, 'c'], [41, -769.8], [46, -771.6], [53, -772],
	[59, -771.4], [62.6, -770, 'c'],
];

// ---------------------------------------------------------------- eye and brow (anatomical right)
// Repair round 1: the eye sits ~3 u further back so ~7 u of nasal bridge shows in front of it, as on zoo_turn_side.png.
export const EYE_C = {x: 45.5, y: -812.6};
const E_FRONT: Pt = [5, 0.4, 'c'];
const E_BACK: Pt = [-7.4, -0.6, 'c'];
const E_UPPER: Pt[] = [[3.6, -3.8], [-1.6, -4.4]]; // front -> back
const E_LOWER: Pt[] = [[-3.6, 2.8], [2.6, 3.4]]; // back -> front
const E_CLOSED: Pt[] = [[3.6, 2.2], [-1.6, 2.4]];

const EyeSide: React.FC<{pose: EyePose; blink: number; lookX: number; lookY: number}> = ({pose, blink, lookX, lookY}) => {
	const clipId = safeId(useId(), 'eyeS');
	const ls = useLineScale();
	const s = pose.scale * 1.14;
	const W = (p: Pt): Pt => (p.length === 3 ? [EYE_C.x + p[0] * s, EYE_C.y + p[1] * s, 'c'] : [EYE_C.x + p[0] * s, EYE_C.y + p[1] * s]);
	const upper = E_UPPER.map((p) => [p[0], p[1] - pose.lidTop * 0.8] as Pt);
	const lower = E_LOWER.map((p) => [p[0], p[1] - pose.lidBottom * 0.8] as Pt);
	const shape = [E_FRONT, ...upper, E_BACK, ...lower].map(W);
	const b = clamp01(blink);
	const lid = lerpPts(upper, E_CLOSED.map((p, i) => [p[0], Math.min(p[1], lower[1 - i][1] - 0.8)] as Pt), b);
	const lidEdge = [E_FRONT, ...lid, E_BACK].map(W);
	const lidFill = [W([E_FRONT[0] + 1.2, E_FRONT[1]]), ...lid.map(W), W([E_BACK[0] - 1.2, E_BACK[1]]), ...upper.slice().reverse().map((p) => W([p[0], p[1] - 1.8]))];
	// the iris sits at the front of the eye; looking back (lookX < 0) moves it toward the back corner
	const ix = EYE_C.x + (2.6 + clamp(lookX, -1, 1) * 2.2) * s;
	const iy = EYE_C.y + (0.2 + clamp(lookY, -1, 1) * 1.4) * s;
	const r = 4.4 * s * pose.iris;
	return (
		<g data-part="eyeR">
			{b < 0.97 ? (
				<>
					<clipPath id={clipId}>
						<path d={smooth(shape)} />
					</clipPath>
					<path d={smooth(shape)} fill={ZOO_COLORS.eyeWhite} />
					<g clipPath={`url(#${clipId})`}>
						<ellipse data-part="iris" cx={ix} cy={iy} rx={r * 0.55} ry={r} fill={ZOO_COLORS.eyeIris} />
						<ellipse data-part="pupil" cx={ix + 0.5} cy={iy} rx={r * 0.24} ry={r * 0.42} fill={ZOO_COLORS.pupil} />
						<circle data-part="highlight" cx={ix + HIGHLIGHT.dx * 0.45 * s} cy={iy + HIGHLIGHT.dy * s} r={HIGHLIGHT.r * 0.9 * s} fill={ZOO_COLORS.eyeWhite} />
					</g>
				</>
			) : null}
			{b > 0.001 ? <path data-part="upperLid" d={smooth(lidFill)} fill={ZOO_COLORS.skin} /> : null}
			<path d={line([W([-5, lower[0][1] + 0.2]), W([3, lower[1][1] + 0.4])])} fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={ZOO_LINE.fine * ls} strokeLinecap="round" />
			<path data-part="lidLine" d={tapered(lidEdge, (t) => ZOO_LINE.lid * 1.05 * ls * lidProfile(1 - t))} fill={LINE.color} />
		</g>
	);
};

/** The anatomical right brow (BROW_R) in profile: inner end at the front, x scaled 0.83, thinner. */
const browSide = (pose: BrowPose, lift: number) => {
	const pts = posed(BROW_R, pose, lift);
	const n = pts.length;
	return smooth(
		pts.map((p, i) => {
			const j = Math.max(0, Math.min(n - 1, n - 1 - i));
			const mid = (p[1] + pts[j][1]) / 2;
			const x = 61 + (p[0] + 8.5) * 0.83;
			const y = mid + (p[1] - mid) * 0.8 + 3.6;
			return p.length === 3 ? [x, y, 'c'] : [x, y];
		}),
	);
};

// ---------------------------------------------------------------- head
export type HeadSideProps = {expression: Expression; mouth?: MouthShape; blink: number; browLift: number; lookX: number; lookY: number; headTilt: number};

export const HeadSide: React.FC<HeadSideProps> = ({expression, mouth, blink, browLift, lookX, lookY, headTilt}) => {
	const spec = EXPRESSIONS[expression];
	const shape = mouth ?? spec.mouth;
	const mod = mouth ? explicitMod(spec.mod) : spec.mod;
	const {hole, jaw} = mouthDrops(shape, mod);
	const g = mouthGeo(shape, mod, jaw);
	const face = faceProfile(g, jaw);
	const faceD = smooth(face.fill);
	// The opening ends at the lip fronts (repair round 1): nothing of the dark interior pokes out beyond the face line,
	// and a thin lip line closes the opening front (v1's interior ran 3 u past the lips and read as a beak).
	const interior = g.notch ? smooth([g.top, g.corner, g.bottom, [(g.top[0] + g.bottom[0]) / 2 - 0.6, (g.top[1] + g.bottom[1]) / 2, 'c']]) : null;
	const {liftR} = browLifts(browLift);
	const ls = useLineScale();
	return (
		<g data-part="head" data-view="side" transform={`rotate(${headTilt} ${HEAD_SIDE_PIVOT.x} ${HEAD_SIDE_PIVOT.y})`}>
			<g data-part="hairBack">
				<Shape d={smooth([...HAIR_TOP, ...HAIRLINE.slice(1), ...HAIR_HIDDEN])} fill={ZOO_COLORS.hair} shadow={{d: HAIR_SHADOW, fill: ZOO_COLORS.hairShadow}} stroke={0} />
			</g>
			<g data-part="earR">
				<Shape d={smooth(EAR)} fill={ZOO_COLORS.skin} shadow={{d: smooth(EAR_SHADOW), fill: ZOO_COLORS.skinShadow}} />
				<Stroke d={line(EAR_FOLD)} width={ZOO_LINE.fine} color={ZOO_COLORS.noseLine} />
			</g>
			{interior ? (
				<g data-part="mouth" data-shape={shape}>
					<path d={interior} fill={ZOO_COLORS.mouthInterior} />
					<Clipped clip={interior}>
						{g.tongue ? <path d={smooth([[g.corner[0] + 2, g.bottom[1] - 2], [g.bottom[0] - 4, g.bottom[1] - 4.6], [g.bottom[0] + 4, g.bottom[1] + 2], [g.corner[0], g.bottom[1] + 4]])} fill={ZOO_COLORS.tongue} /> : null}
						{g.teeth ? <path d={smooth([[g.corner[0] + 3, g.top[1] - 1], [g.top[0] + 4, g.top[1] - 1], [g.top[0] + 4, g.top[1] + 3.4], [g.corner[0] + 4, g.top[1] + 3]])} fill={ZOO_COLORS.teeth} /> : null}
					</Clipped>
				</g>
			) : null}
			<Shape name="face" d={faceD} fill={ZOO_COLORS.skin} shadow={{d: FACE_SHADOW, fill: ZOO_COLORS.skinShadow}} stroke={0} />
			<g data-part="beard">
				<Clipped clip={faceD}>
					<path d={smooth(beardSide(hole, jaw, g.corner))} fill={ZOO_COLORS.beard} />
					<Clipped clip={smooth(beardSide(hole, jaw, g.corner))}>
						<path d={BEARD_SHADOW(jaw)} fill={ZOO_COLORS.beardShadow} />
					</Clipped>
				</Clipped>
			</g>
			<g data-part="moustache">
				<Clipped clip={faceD}>
					<path d={smooth(MOUSTACHE)} fill={ZOO_COLORS.moustache} />
				</Clipped>
			</g>
			{!g.notch ? (
				<g data-part="mouth" data-shape={shape}>
					<Stroke d={line([[SIDE_MOUTH.x + 0.6 + g.protrude, SIDE_MOUTH.y], [SIDE_MOUTH.x - 4, SIDE_MOUTH.y + 0.3], g.lineEnd])} width={shape === 'mbp' ? 1.9 : 1.6} color={ZOO_COLORS.beardShadow} />
					{g.lowerLip ? <Stroke d={line([[SIDE_MOUTH.x - 1, SIDE_MOUTH.y + 4.4], [SIDE_MOUTH.x - 6, SIDE_MOUTH.y + 4]])} width={ZOO_LINE.fine} color={ZOO_COLORS.skinShadow} /> : null}
				</g>
			) : null}
			<path data-part="profileOutline" d={line(face.outline)} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.outline * ls} strokeLinecap="round" strokeLinejoin="round" />
			{g.notch ? <Stroke name="lipFront" d={line([g.top, g.bottom])} width={ZOO_LINE.fine} /> : null}
			<g data-part="nose">
				<path d={NOSE_UNDER} fill={ZOO_COLORS.skinShadow} />
				<path data-part="nostril" d={tapered(NOSTRIL, nostrilWidth(ZOO_LINE.feature * ls))} fill={LINE.color} />
			</g>
			<EyeSide pose={spec.eyes} blink={blink} lookX={lookX} lookY={lookY} />
			<g data-part="hairFront">
				<path d={smooth([...HAIRLINE, ...FRONT_CLOSE])} fill={ZOO_COLORS.hair} />
				<Clipped clip={smooth([...HAIRLINE, ...FRONT_CLOSE])}>
					<path d={HAIR_SHADOW} fill={ZOO_COLORS.hairShadow} />
				</Clipped>
				{STRANDS.map((s, i) => (
					<Stroke key={i} d={line(s)} width={ZOO_LINE.fine} color={ZOO_COLORS.hairShadow} />
				))}
				<Stroke d={line(HAIRLINE)} width={ZOO_LINE.outline} />
				<Stroke d={line(HAIR_TOP)} width={ZOO_LINE.outline} />
			</g>
			{/* Brows over the hair (repair round 1): a raised brow is never hidden by the hanging forelock. */}
			<path data-part="browR" d={browSide(spec.browR, liftR)} fill={ZOO_COLORS.brow} />
		</g>
	);
};
