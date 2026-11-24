/**
 * ZOO seated at a desk, typing (reference/crops/zoo_pose_typing.png). 3/4 view facing SCREEN RIGHT,
 * like the panel: the pin is on the far (anatomical LEFT) chest, the buttons on the near panel.
 *
 * Construction (all in the typing pose's root space; origin = centre of the footprint, the same
 * place as the standing 3/4 view's origin, so the sneakers are the 3/4 sneakers unchanged):
 * - upper body = the 3/4 head, neck, collar and torso translated by TYPING_LAYOUT.upper; the torso
 *   is shortened about the shoulder line by `seatedTorso` because the overshirt bunches on the lap
 *   (decision ZOO-T2);
 * - seated legs, both arms and the typing hands are drawn for this pose;
 * - the hands are split into a FRONT layer so a desk and keyboard can sit between the body and the
 *   hands (`layer` and `between` props on <Zoo>).
 * Finger taps are driven by the frame when `typing` is true (deterministic per-finger rhythm).
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {ZOO_COLORS} from '../../palette';
import {line, smooth, type Pt} from '../geometry';
import {ZOO_LINE} from '../lines';
import {Clipped, Shape, Stroke} from '../parts/Shape';
import {HandDrawing} from '../parts/Hand';
import {Head34} from './threeQuarter/Head34';
import {CollarBack34, FarShoe34, Neck34, NearShoe34, Torso34} from './threeQuarter/Body34';
import type {ViewHeadProps} from './types';

/** Where everything sits in the typing pose (world units, ZOO's root space). */
export const TYPING_LAYOUT = {
	/**
	 * 3/4 upper body offset from the standing 3/4 view. Repair round 1: +6/+10 toward the screen and down (v1 -150/170 sat
	 * bolt upright; world overlay on zoo_pose_typing.png puts the eyes within ~4 u); the near sleeve's shoulder follows.
	 */
	upper: {dx: -144, dy: 180},
	/** Vertical scale of the 3/4 torso about the 3/4 shoulder line (y = -690) when seated. */
	seatedTorso: 0.88,
	shoulderY34: -690,
	/** Props, placed in ZOO's root space (origin of each prop component). */
	chair: {x: -195, y: 0},
	desk: {x: 70, y: 0},
	keyboard: {x: 20, y: -344},
	monitor: {x: 235, y: -344},
	/**
	 * Wrist pivots of the typing hands (repair round 1: hands side by side over the keys, the near hand over the far cuff).
	 * Repair round 4: the far wrist 2 u lower (-387 -> -385) so the re-traced far hand's knuckles (-401.5) and fingertips
	 * (~-360) sit where the sheet has them.
	 */
	wristR: {x: -101, y: -384},
	wristL: {x: -19, y: -385},
	/** Typing-hand scale: the standing-hand size (v1 drew them ~0.72 x as large). */
	handScale: {near: 1.36, far: 1.3},
} as const;

// ---------------------------------------------------------------- seated legs
/**
 * Far leg (anatomical LEFT): thigh forward to the knee, shin down to the 3/4 far sneaker. Repair round 4 (ZOO-T8): the lap
 * rises to the desk's front face (y ~-322 from x -236 to -80, hidden by the desk) and slopes down to the round-3 thigh line
 * from x ~-50, so with the overshirt cut at the desk edge the lap fills the space under the desk as on the sheet.
 */
const LEG_FAR: Pt[] = [
	[-236, -318], [-150, -323], [-80, -322], [-50, -315], [-20, -301], [26, -295], [50, -287], [59, -273], [57.6, -255], [50, -236], [44, -210],
	[42, -170], [41, -130], [40, -95], [39.6, -64], [39, -57.4, 'c'], [30.4, -53.4], [20, -48], [8, -44], [-4, -42.4], [-15.2, -43.2, 'c'], [-15.6, -60], [-15.4, -80], [-14, -120],
	[-12, -160], [-10, -200], [-14, -230], [-60, -236], [-120, -238], [-190, -240], [-236, -252],
];
const LEG_FAR_SHADOW = smooth([[-240, -248], [-100, -244], [-14, -236], [-16, -54], [-4, -54], [0, -200], [-6, -238], [-240, -238]]);
/** Near leg (anatomical RIGHT), in front: its shin slants back to the 3/4 near sneaker. */
const LEG_NEAR: Pt[] = [
	[-268, -288], [-200, -294], [-120, -293], [-50, -289], [0, -281], [24, -270], [33, -253], [29.6, -233], [18, -216], [6, -192],
	[-6, -152], [-20, -112], [-30, -84], [-38, -64], [-44.4, -52], [-49.4, -48.6, 'c'], [-54, -50.4], [-60, -53], [-67, -54], [-74, -52.2], [-80, -48.4], [-86, -44.2], [-93, -41.6],
	[-101.6, -41.2, 'c'], [-101.8, -56], [-98, -72], [-88, -110],
	[-76, -150], [-64, -190], [-58, -212], [-100, -214], [-160, -216], [-222, -220], [-262, -234], [-274, -260],
];
const LEG_NEAR_SHADOW = smooth([[-280, -236], [-160, -222], [-58, -214], [-64, -190], [-90, -100], [-101, -56], [-86, -56], [-74, -110], [-56, -190], [-44, -206], [-160, -206], [-280, -206]]);
const KNEE_CREASE = line([[-6, -230], [-18, -222], [-32, -218]]);

// ---------------------------------------------------------------- arms (typing)
/** Shift of the shoulder end so the sleeve follows the leaning torso (full above y -500, none below -420). */
const leanFollow = (pts: Pt[]): Pt[] =>
	pts.map((p) => {
		const w = Math.max(0, Math.min(1, (-420 - p[1]) / 80));
		return [p[0] + 6 * w, p[1] + 10 * w];
	});
const SLEEVE_NEAR: Pt[] = leanFollow([
	[-240, -532], [-254, -525], [-263, -516], [-269, -506], [-274, -492], [-276.4, -470], [-276.4, -440], [-274.6, -412], [-270.6, -392],
	[-264, -374], [-254, -363], [-240, -357.4], [-214, -356], [-186, -356.8], [-162, -358], [-136, -358.8, 'c'], [-136, -398.4, 'c'],
	[-158, -399.4], [-186, -400.8], [-210, -403], [-223, -409], [-229.4, -422], [-232, -445], [-234, -475], [-234.6, -500], [-236, -520],
]);
const SLEEVE_NEAR_SHADOW = smooth([[-280, -500], [-262, -500], [-258, -420], [-246, -384], [-200, -372], [-140, -372], [-140, -350], [-280, -350]]);
const CUFF_NEAR: Pt[] = [[-136.6, -398.8, 'c'], [-102, -397.2, 'c'], [-100.6, -378.4], [-102, -360.6, 'c'], [-136.6, -359.2, 'c']];
const ELBOW_NEAR = line([[-225, -410], [-236, -398], [-249, -391]]);
const FOREARM_FOLD = line([[-206, -366], [-190, -372.6]]);
/** Far forearm (anatomical LEFT): emerges from behind the torso's front edge (x ~ -68). */
const FOREARM_FAR: Pt[] = [[-84, -406], [-68, -406.6], [-52, -407.4, 'c'], [-52, -371, 'c'], [-68, -370.6], [-84, -370]];
const CUFF_FAR: Pt[] = [[-52.6, -407.8, 'c'], [-21, -406, 'c'], [-19.6, -388.4], [-21, -371, 'c'], [-52.6, -370.6, 'c']];

// ---------------------------------------------------------------- typing hand (wrist-local: +x forward, +y down)
/**
 * One typing hand as ONE silhouette (repair round 2, zoo_pose_typing.png): the back of the hand, the fingertips on the keys
 * and warm-brown creases along the fingers. Round 1 drew four separately outlined hooked fingers whose tips folded back
 * under their knuckles; the stacked outlines read as black knuckle-dusters.
 * Repair round 4 (decision ZOO-T8): re-traced from the sheet. Both sheet hands were scanned column by column (skin extents
 * in world units) and share one shape: a low heel pad resting on the keys, a back that rises from the wrist (~-382) to
 * the knuckles (~-404), a hollow under the palm, and three visible fingertips on the keys parted by narrow slots ~11-14 u
 * deep, each slot continuing up and back as a short crease. The near hand's trace (heel x -82 .. front tip x 29) is mapped
 * into the hand's wrist-local frame at 0.955 x horizontally so the heel sits in the cuff, which puts the front tips at world
 * x ~2 (near) and ~80 (far; sheet ~79) and the knuckle peak of the far hand at x ~38 (sheet 36-44). Round 3's hand was ~16 u
 * shorter (tips at -16 / 62), ~8 u taller with a high wrist (-399; sheet ~-382) and had four lobes with shallow corner
 * notches. Unscaled units (TYPING_LAYOUT.handScale applies); finger f3 (the pinky) is hidden in this view.
 */
type TPt = {p: Pt; f?: number; w?: number};
/** Silhouette clockwise from the heel; `f` = finger index whose tap lifts the point (0 = front finger), w = weight. */
const T_HAND: TPt[] = [
	{p: [-2.9, 16.2]}, {p: [-2.5, 10.3]}, {p: [-1.2, 5.4]}, {p: [0.9, 2.5]}, {p: [4.8, 1]}, {p: [10.4, -1.2]}, {p: [16, -4.4]},
	{p: [21.7, -7.4]}, {p: [27.3, -10.3]}, {p: [32.9, -12.5]}, {p: [38.5, -13.7]}, {p: [44.1, -14.3]}, {p: [49.7, -13.7]},
	{p: [55.4, -12.9]}, {p: [59.6, -10.9]}, {p: [63.8, -8.1], f: 0, w: 0.2}, {p: [66.9, -4.7], f: 0, w: 0.4}, {p: [69.7, -1], f: 0, w: 0.6},
	{p: [71.9, 3.2], f: 0, w: 0.8}, {p: [74, 7.8], f: 0}, {p: [75.5, 12.8], f: 0}, {p: [75.7, 17.4], f: 0}, {p: [74.7, 20.3], f: 0},
	{p: [72.6, 21.5], f: 0}, {p: [69.8, 21.2], f: 0}, {p: [68.3, 19.1], f: 0, w: 0.7}, {p: [67.6, 15.4], f: 0, w: 0.4},
	{p: [67, 10], f: 0, w: 0.15}, // slot between the front finger and the next
	{p: [66.2, 15.4], f: 1, w: 0.4}, {p: [65.5, 19.6], f: 1, w: 0.7}, {p: [63.5, 21.8], f: 1}, {p: [60.7, 21.3], f: 1},
	{p: [59.2, 18.7], f: 1, w: 0.7}, {p: [58.2, 14.4], f: 1, w: 0.4},
	{p: [57.3, 8.1], f: 1, w: 0.15}, // slot
	{p: [56.5, 14.3], f: 2, w: 0.4}, {p: [55.6, 19.7], f: 2, w: 0.7}, {p: [53.5, 22.4], f: 2}, {p: [50.9, 22.4], f: 2},
	{p: [48.8, 20.4], f: 2, w: 0.8}, {p: [47.2, 17.1], f: 2, w: 0.6}, {p: [45.8, 13.5], f: 2, w: 0.4}, {p: [43.9, 10.7], f: 2, w: 0.2},
	// the hollow under the palm, then the heel pad on the keys
	{p: [41.3, 8.8]}, {p: [38.1, 7.4]}, {p: [35, 8.1]}, {p: [33.2, 10.4]}, {p: [31.5, 13.1]}, {p: [28.7, 15]}, {p: [25.9, 16.5]},
	{p: [23.1, 17.9]}, {p: [20.3, 19.1]}, {p: [17.4, 20.1]}, {p: [13.2, 20.9]}, {p: [7.6, 21]}, {p: [2, 20.9]}, {p: [-0.8, 20]},
	{p: [-2.5, 18.4]},
];
/** Creases: each slot continues up and back toward the knuckles (sheet: ~12 u long). */
const T_SEPARATIONS: {pts: Pt[]; f: number}[] = [
	{pts: [[67, 10.4], [64.6, 6.4], [61.6, 2.4], [58.2, -1.8]], f: 0},
	{pts: [[57.3, 8.6], [54.4, 5.6], [51.2, 3.2], [48, 1.4]], f: 1},
];
/** The palm's underside: a thin band along the heel pad and the hollow (clipped to the hand). */
const T_SHADOW: Pt[] = [
	[-2, 17.6], [2, 18.3], [7.6, 18.4], [13.2, 18.3], [17.4, 17.5], [20.3, 16.5], [23.1, 15.3], [25.9, 13.9], [28.7, 12.4], [31.5, 10.5],
	[33.4, 7.8], [35.4, 5.4], [38.2, 4.8], [41.6, 6.2], [44.6, 8.4], [44.6, 30], [-2, 30],
];
/** Thumb, under the palm toward the space bar (skin, outlined): the heel pad covers it at rest, as on the sheet. */
const THUMB: Pt[] = [[6, 10], [14, 12], [20, 14.6], [22, 17], [20, 18.6], [13, 17.4], [8, 14]];

/** Lift angle (deg) of one finger at a frame: short taps on a per-finger rhythm (deterministic). */
export const fingerLift = (frame: number, hand: 0 | 1, finger: number): number => {
	const period = 9 + ((finger * 5 + hand * 3) % 5); // 9..13 frames
	const phase = (finger * 7 + hand * 11) % period;
	const t = (frame + phase) % period;
	return t < 4 ? Math.sin((Math.PI * t) / 4) * 16 : 0;
};
/** A tap raises a finger's tip lobe: 0.3 u up and 0.08 u back per degree of fingerLift (unscaled units). */
const TAP = {up: 0.3, back: 0.08} as const;

const TypingHand: React.FC<{x: number; y: number; s?: number; lifts: number[]; name: string}> = ({x, y, s = 1, lifts, name}) => {
	const lift = (q: Pt, f?: number, w = 1): Pt => {
		const l = f === undefined ? 0 : (lifts[f] ?? 0) * w;
		const px = x + (q[0] - l * TAP.back) * s;
		const py = y + (q[1] - l * TAP.up) * s;
		return q.length === 3 ? [px, py, 'c'] : [px, py];
	};
	const place = (q: Pt): Pt => lift(q);
	const outline = T_HAND.map(({p, f, w}) => lift(p, f, w));
	const seps = T_SEPARATIONS.map(({pts, f}) => pts.map((q, i) => lift(q, f, i === 0 ? 0.5 : Math.max(0, 0.5 - i * 0.2))));
	return (
		<g data-part={name}>
			<Shape d={smooth(THUMB.map(place))} fill={ZOO_COLORS.skin} />
			<HandDrawing hand={{outline, shadow: T_SHADOW.map(place), lines: seps, lineWidth: ZOO_LINE.detail, taper: 0.45}} name={`${name}Shape`} />
		</g>
	);
};

// ---------------------------------------------------------------- layers
export type TypingLayer = 'all' | 'back' | 'front';

const upperT = (dy: number) => `translate(${TYPING_LAYOUT.upper.dx} ${TYPING_LAYOUT.upper.dy + dy})`;
const torsoT = (sy: number) => {
	const y0 = TYPING_LAYOUT.shoulderY34;
	return `translate(${TYPING_LAYOUT.upper.dx} ${TYPING_LAYOUT.upper.dy}) translate(0 ${y0}) scale(1 ${TYPING_LAYOUT.seatedTorso * sy}) translate(0 ${-y0})`;
};

/**
 * Seated overshirt hem (repair round 4, decision ZOO-T8). On zoo_pose_typing.png the overshirt ends at the desk's front edge:
 * above the desk it is slate, right under it the lap shows (no slate below y ~-316). The seated torso is cut at torso-local
 * y SEATED_HEM_Y, which lands at world y -326, inside the desk's front face (DESK y -338..-320), and closed with its own hem
 * line, so it also reads as a hem resting on the lap when no desk is drawn. Round 3 hung the standing hem ~45 u below the desk.
 */
const SEATED_HEM_WORLD_Y = -326;
const SEATED_HEM_Y = TYPING_LAYOUT.shoulderY34 + (SEATED_HEM_WORLD_Y - TYPING_LAYOUT.upper.dy - TYPING_LAYOUT.shoulderY34) / TYPING_LAYOUT.seatedTorso;
const SEATED_CLIP = `M -400 -1200 H 400 V ${SEATED_HEM_Y} H -400 Z`;
/** The hem line spans the seated torso at that height: the near panel's side (x -99) to the far panel's side (x 81.6). */
const SEATED_HEM_LINE = line([[-99, SEATED_HEM_Y], [81.4, SEATED_HEM_Y]]);

/** Body behind the desk: legs, torso, head. */
const TypingBack: React.FC<{head: ViewHeadProps; breath: number}> = ({head, breath}) => (
	<g data-part="typingBack">
		<FarShoe34 />
		<Shape name="legL" d={smooth(LEG_FAR)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_FAR_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
		<NearShoe34 />
		<Shape name="legR" d={smooth(LEG_NEAR)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_NEAR_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
		<Stroke d={KNEE_CREASE} width={ZOO_LINE.fine} color={ZOO_COLORS.trousersShadow} />
		<g transform={torsoT(1)}>
			<CollarBack34 />
		</g>
		<g transform={upperT(breath)}>
			<Neck34 />
		</g>
		<g transform={`translate(0 ${breath * 0.6}) ${torsoT(1)}`}>
			<Clipped clip={SEATED_CLIP}>
				<Torso34 />
			</Clipped>
			<Stroke name="seatedHem" d={SEATED_HEM_LINE} width={ZOO_LINE.outline} />
		</g>
		<g transform={upperT(breath)}>
			<Head34 {...head} />
		</g>
	</g>
);

/** Arms and hands in front of the desk and keyboard. */
const TypingFront: React.FC<{typing: boolean; breath: number}> = ({typing, breath}) => {
	const frame = useCurrentFrame();
	const lifts = (hand: 0 | 1) => [0, 1, 2, 3].map((i) => (typing ? fingerLift(frame, hand, i) : 0));
	return (
		<g data-part="typingFront">
			<g data-part="armL">
				<Shape d={smooth(FOREARM_FAR)} fill={ZOO_COLORS.overshirt} shadow={{d: smooth([[-90, -380], [-40, -380], [-40, -360], [-90, -360]]), fill: ZOO_COLORS.overshirtShadow}} stroke={0} />
				<Stroke d={line(FOREARM_FAR.slice(0, 3))} width={ZOO_LINE.outline} />
				<Stroke d={line(FOREARM_FAR.slice(3))} width={ZOO_LINE.outline} />
				<TypingHand x={TYPING_LAYOUT.wristL.x} y={TYPING_LAYOUT.wristL.y} s={TYPING_LAYOUT.handScale.far} lifts={lifts(1)} name="handL" />
				<Shape name="cuffL" d={smooth(CUFF_FAR)} fill={ZOO_COLORS.overshirt} />
			</g>
			<g data-part="armR" transform={`translate(0 ${breath * 0.5})`}>
				<TypingHand x={TYPING_LAYOUT.wristR.x} y={TYPING_LAYOUT.wristR.y} s={TYPING_LAYOUT.handScale.near} lifts={lifts(0)} name="handR" />
				<Shape name="sleeveR" d={smooth(SLEEVE_NEAR)} fill={ZOO_COLORS.overshirt} shadow={{d: SLEEVE_NEAR_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
				<Stroke d={ELBOW_NEAR} width={ZOO_LINE.detail} />
				<Stroke d={FOREARM_FOLD} width={ZOO_LINE.fine} />
				<Shape name="cuffR" d={smooth(CUFF_NEAR)} fill={ZOO_COLORS.overshirt} />
			</g>
		</g>
	);
};

export const ZooTyping: React.FC<{head: ViewHeadProps; breath: number; typing: boolean; layer: TypingLayer; between?: React.ReactNode}> = ({head, breath, typing, layer, between}) => (
	<g data-pose="typing">
		{layer !== 'front' ? <TypingBack head={head} breath={breath} /> : null}
		{layer === 'all' ? between : null}
		{layer !== 'back' ? <TypingFront typing={typing} breath={breath} /> : null}
	</g>
);
