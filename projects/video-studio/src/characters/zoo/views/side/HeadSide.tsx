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
import {clamp, clamp01, lerpPts, line, safeId, smooth, type Pt} from '../../geometry';
import {MOUTHS} from '../../mouth';
import {EXPRESSIONS, MOD0, type BrowPose, type EyePose, type MouthMod} from '../../rig';
import {BROW_R, posed} from '../../parts/Brows';
import {mouthDrops} from '../../parts/Mouth';
import {Clipped, Shape, Stroke} from '../../parts/Shape';

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
	[74, -867.4], [79.4, -862], [82, -855.4], [81.4, -849, 'c'], [77, -847.6], [71, -850.4], [65, -856.6], [61, -852.6],
];
/** Hairline: forelock underside, temple, sideburn down to the jaw in front of the ear. */
const HAIRLINE: Pt[] = [
	[61, -852.6], [63, -849.8], [62.4, -846.4], [59.6, -846.6], [57.6, -848.8], [53.6, -847], [47, -841.6], [43.6, -837.4], [36.4, -837.6],
	[31, -834.8], [25, -835.2], [19.4, -836.6], [16.4, -834], [17.4, -828], [15.6, -822], [14, -814], [12.6, -806], [14, -798],
	[13.6, -791], [10.6, -788.6], [6, -789],
];
/** Closes the front-hair fill above the hairline, staying right of the ear (ear max x = 1.6). */
const FRONT_CLOSE: Pt[] = [[8.6, -806], [8.6, -832], [2, -858], [28, -884], [64, -882]];
/** Hidden return path (behind the ear and the jaw). */
const HAIR_HIDDEN: Pt[] = [[0, -782], [-12, -778], [-17, -770], [-21, -761], [-25, -757]];
const STRANDS: Pt[][] = [
	[[-70, -856], [-54, -862], [-36, -868], [-16, -872], [4, -872.4], [22, -870], [40, -868], [56, -864]], // main sweep
	[[30, -884], [46, -884], [60, -878], [70, -868]], // top wave toward the forelock
	[[-60, -838], [-46, -846], [-30, -850], [-14, -850]], // lower back wing
	[[-62, -812], [-50, -824], [-36, -832]], // behind the ear
	[[66, -856], [72, -852.4], [76, -850.4]], // forelock curl
];
const HAIR_SHADOW = [
	smooth([[-70, -812], [-60, -826], [-44, -834], [-26, -838], [-8, -840], [8, -838], [16, -830], [12, -800], [0, -790], [-24, -760], [-50, -770], [-66, -790]]),
	smooth([[46, -862], [58, -866], [70, -862], [64, -852], [56, -846], [48, -846]]),
].join(' ');

const EAR: Pt[] = [
	[1.6, -797], [-2.4, -806.6], [-8.6, -812], [-16, -811.8], [-22, -806.4], [-25, -798], [-24, -789.6], [-20.4, -783.6], [-15, -779],
	[-10.6, -777.4], [-6, -779], [-2.6, -784], [0.4, -790],
];
const EAR_SHADOW: Pt[] = [[-4, -805], [-12, -808], [-19, -804], [-21, -795], [-17, -786], [-11, -782], [-12, -794], [-8, -801]];
const EAR_HELIX: Pt[] = [[-4.4, -804.4], [-10.4, -808], [-17, -806.4], [-20.6, -799], [-19, -790], [-14.6, -784]];
const EAR_CONCHA: Pt[] = [[-8.4, -800], [-13, -798.6], [-14, -792], [-10.6, -787.4]];

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
	const round = shape === 'oh' ? 2.2 : shape === 'ee' ? -0.8 : 0;
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
	[18, -858], [40, -859], [55.4, -853], [61, -847], [63.4, -838], [63.8, -830], [62.6, -824], [59.6, -819.4], [60.4, -813],
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
const NOSTRIL = line([[66.4, -785.8], [64.4, -788], [66, -790.4]]);

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
const MOUSTACHE_SHADOW: Pt[] = [[37, -768.4], [46, -771], [54, -771.6], [63, -770.4], [63, -766], [37, -764]];

// ---------------------------------------------------------------- eye and brow (anatomical right)
const EYE_C = {x: 48.4, y: -812.6};
const E_FRONT: Pt = [6.2, 0.4, 'c'];
const E_BACK: Pt = [-7.4, -0.6, 'c'];
const E_UPPER: Pt[] = [[3.6, -3.8], [-1.6, -4.4]]; // front -> back
const E_LOWER: Pt[] = [[-3.6, 2.8], [2.6, 3.4]]; // back -> front
const E_CLOSED: Pt[] = [[3.6, 2.2], [-1.6, 2.4]];

const EyeSide: React.FC<{pose: EyePose; blink: number; lookX: number; lookY: number}> = ({pose, blink, lookX, lookY}) => {
	const clipId = safeId(useId(), 'eyeS');
	const s = pose.scale;
	const W = (p: Pt): Pt => (p.length === 3 ? [EYE_C.x + p[0] * s, EYE_C.y + p[1] * s, 'c'] : [EYE_C.x + p[0] * s, EYE_C.y + p[1] * s]);
	const upper = E_UPPER.map((p) => [p[0], p[1] - pose.lidTop * 0.8] as Pt);
	const lower = E_LOWER.map((p) => [p[0], p[1] - pose.lidBottom * 0.8] as Pt);
	const shape = [E_FRONT, ...upper, E_BACK, ...lower].map(W);
	const b = clamp01(blink);
	const lid = lerpPts(upper, E_CLOSED.map((p, i) => [p[0], Math.min(p[1], lower[1 - i][1] - 0.8)] as Pt), b);
	const lidEdge = [E_FRONT, ...lid, E_BACK].map(W);
	const lidFill = [...lidEdge, W([-10, -12]), W([10, -12])];
	// the iris sits at the front of the eye; looking back (lookX < 0) moves it toward the back corner
	const ix = EYE_C.x + (2.6 + clamp(lookX, -1, 1) * 2.2) * s;
	const iy = EYE_C.y + (0.2 + clamp(lookY, -1, 1) * 1.4) * s;
	const r = 4.4 * s * pose.iris;
	return (
		<g data-part="eyeR">
			<clipPath id={clipId}>
				<path d={smooth(shape)} />
			</clipPath>
			<path d={smooth(shape)} fill={ZOO_COLORS.eyeWhite} />
			<g clipPath={`url(#${clipId})`}>
				<ellipse data-part="iris" cx={ix} cy={iy} rx={r * 0.55} ry={r} fill={ZOO_COLORS.eyeIris} />
				<ellipse data-part="pupil" cx={ix + 0.5} cy={iy} rx={r * 0.3} ry={r * 0.55} fill={ZOO_COLORS.pupil} />
				{b > 0.001 ? <path data-part="upperLid" d={smooth(lidFill)} fill={ZOO_COLORS.skin} /> : null}
			</g>
			<path d={line([W([-5, lower[0][1] + 0.2]), W([3, lower[1][1] + 0.4])])} fill="none" stroke={ZOO_COLORS.skinShadow} strokeWidth={1.3} strokeLinecap="round" />
			<path data-part="lidLine" d={line(lidEdge)} fill="none" stroke={LINE.color} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
			<path d={line([W([5.8, -0.6]), W([8.2, -2.2])])} fill="none" stroke={LINE.color} strokeWidth={1.8} strokeLinecap="round" />
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
const explicitMod = (m: MouthMod): MouthMod => ({...MOD0, cornerL: m.cornerL * 0.5, cornerR: m.cornerR * 0.5, wave: m.wave * 0.4, moustacheLiftR: m.moustacheLiftR * 0.6});

export const HeadSide: React.FC<HeadSideProps> = ({expression, mouth, blink, browLift, lookX, lookY, headTilt}) => {
	const spec = EXPRESSIONS[expression];
	const shape = mouth ?? spec.mouth;
	const mod = mouth ? explicitMod(spec.mod) : spec.mod;
	const {hole, jaw} = mouthDrops(shape, mod);
	const g = mouthGeo(shape, mod, jaw);
	const face = faceProfile(g, jaw);
	const faceD = smooth(face.fill);
	const interior = g.notch ? smooth([g.top, g.corner, g.bottom, [g.bottom[0] + 3, g.bottom[1] - 1], [g.top[0] + 3, g.top[1] + 1]]) : null;
	const lift = clamp01(browLift) * 3.5;
	return (
		<g data-part="head" data-view="side" transform={`rotate(${headTilt} ${HEAD_SIDE_PIVOT.x} ${HEAD_SIDE_PIVOT.y})`}>
			<g data-part="hairBack">
				<Shape d={smooth([...HAIR_TOP, ...HAIRLINE.slice(1), ...HAIR_HIDDEN])} fill={ZOO_COLORS.hair} shadow={{d: HAIR_SHADOW, fill: ZOO_COLORS.hairShadow}} stroke={0} />
			</g>
			<g data-part="earR">
				<Shape d={smooth(EAR)} fill={ZOO_COLORS.skin} shadow={{d: smooth(EAR_SHADOW), fill: ZOO_COLORS.skinShadow}} />
				<Stroke d={line(EAR_HELIX)} width={LINE.detailWidth} />
				<Stroke d={line(EAR_CONCHA)} width={LINE.detailWidth * 0.8} />
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
					<path d={smooth(MOUSTACHE)} fill={ZOO_COLORS.beard} />
					<Clipped clip={smooth(MOUSTACHE)}>
						<path d={smooth(MOUSTACHE_SHADOW)} fill={ZOO_COLORS.beardShadow} />
					</Clipped>
				</Clipped>
			</g>
			{!g.notch ? (
				<g data-part="mouth" data-shape={shape}>
					<Stroke d={line([[SIDE_MOUTH.x + 0.6 + g.protrude, SIDE_MOUTH.y], [SIDE_MOUTH.x - 4, SIDE_MOUTH.y + 0.3], g.lineEnd])} width={shape === 'mbp' ? 2.5 : 2.1} />
					{g.lowerLip ? <Stroke d={line([[SIDE_MOUTH.x - 1, SIDE_MOUTH.y + 4.4], [SIDE_MOUTH.x - 6, SIDE_MOUTH.y + 4]])} width={1.6} color={ZOO_COLORS.skinShadow} /> : null}
				</g>
			) : null}
			<path data-part="profileOutline" d={line(face.outline)} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinecap="round" strokeLinejoin="round" />
			<g data-part="nose">
				<path d={NOSE_UNDER} fill={ZOO_COLORS.skinShadow} />
				<Stroke d={NOSTRIL} width={LINE.detailWidth} />
			</g>
			<EyeSide pose={spec.eyes} blink={blink} lookX={lookX} lookY={lookY} />
			<path data-part="browR" d={browSide(spec.browR, lift)} fill={ZOO_COLORS.brow} />
			<g data-part="hairFront">
				<path d={smooth([...HAIRLINE, ...FRONT_CLOSE])} fill={ZOO_COLORS.hair} />
				<Clipped clip={smooth([...HAIRLINE, ...FRONT_CLOSE])}>
					<path d={HAIR_SHADOW} fill={ZOO_COLORS.hairShadow} />
				</Clipped>
				{STRANDS.map((s, i) => (
					<Stroke key={i} d={line(s)} width={LINE.detailWidth} />
				))}
				<Stroke d={line(HAIRLINE)} width={LINE.width} />
				<Stroke d={line(HAIR_TOP)} width={LINE.width} />
			</g>
		</g>
	);
};
