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
import {LINE, ZOO_COLORS} from '../../palette';
import {line, smooth, type Pt} from '../geometry';
import {Clipped, Shape, Stroke} from '../parts/Shape';
import {Head34} from './threeQuarter/Head34';
import {CollarBack34, FarShoe34, Neck34, NearShoe34, Torso34} from './threeQuarter/Body34';
import type {ViewHeadProps} from './types';

/** Where everything sits in the typing pose (world units, ZOO's root space). */
export const TYPING_LAYOUT = {
	/** 3/4 upper body offset from the standing 3/4 view. */
	upper: {dx: -150, dy: 170},
	/** Vertical scale of the 3/4 torso about the 3/4 shoulder line (y = -690) when seated. */
	seatedTorso: 0.88,
	shoulderY34: -690,
	/** Props, placed in ZOO's root space (origin of each prop component). */
	chair: {x: -195, y: 0},
	desk: {x: 70, y: 0},
	keyboard: {x: -16, y: -344},
	monitor: {x: 235, y: -344},
	/** Wrist pivots of the typing hands. */
	wristR: {x: -110, y: -378},
	wristL: {x: -2, y: -383},
} as const;

// ---------------------------------------------------------------- seated legs
/** Far leg (anatomical LEFT): thigh forward to the knee, shin down to the 3/4 far sneaker. */
const LEG_FAR: Pt[] = [
	[-236, -300], [-150, -305], [-80, -305], [-20, -301], [26, -295], [50, -287], [59, -273], [57.6, -255], [50, -236], [44, -210],
	[42, -170], [41, -130], [40, -95], [39.6, -64], [39.4, -50.4, 'c'], [12, -49.6], [-14.6, -51.6, 'c'], [-15.4, -80], [-14, -120],
	[-12, -160], [-10, -200], [-14, -230], [-60, -236], [-120, -238], [-190, -240], [-236, -252],
];
const LEG_FAR_SHADOW = smooth([[-240, -248], [-100, -244], [-14, -236], [-16, -54], [-4, -54], [0, -200], [-6, -238], [-240, -238]]);
/** Near leg (anatomical RIGHT), in front: its shin slants back to the 3/4 near sneaker. */
const LEG_NEAR: Pt[] = [
	[-268, -288], [-200, -294], [-120, -293], [-50, -289], [0, -281], [24, -270], [33, -253], [29.6, -233], [18, -216], [6, -192],
	[-6, -152], [-20, -112], [-30, -84], [-38, -64], [-44.6, -44, 'c'], [-74, -46.6], [-101, -50, 'c'], [-98, -72], [-88, -110],
	[-76, -150], [-64, -190], [-58, -212], [-100, -214], [-160, -216], [-222, -220], [-262, -234], [-274, -260],
];
const LEG_NEAR_SHADOW = smooth([[-280, -236], [-160, -222], [-58, -214], [-64, -190], [-90, -100], [-101, -50], [-86, -50], [-74, -110], [-56, -190], [-44, -206], [-160, -206], [-280, -206]]);
const KNEE_CREASE = line([[-6, -230], [-18, -222], [-32, -218]]);

// ---------------------------------------------------------------- arms (typing)
const SLEEVE_NEAR: Pt[] = [
	[-240, -532], [-254, -525], [-263, -516], [-269, -506], [-274, -492], [-276.4, -470], [-276.4, -440], [-274.6, -412], [-270.6, -392],
	[-264, -374], [-254, -363], [-240, -357.4], [-214, -356], [-186, -356.8], [-162, -358], [-145, -358.8, 'c'], [-145, -398.4, 'c'],
	[-162, -399.4], [-188, -400.8], [-210, -403], [-223, -409], [-229.4, -422], [-232, -445], [-234, -475], [-234.6, -500], [-236, -520],
];
const SLEEVE_NEAR_SHADOW = smooth([[-280, -500], [-262, -500], [-258, -420], [-246, -384], [-200, -372], [-140, -372], [-140, -350], [-280, -350]]);
const CUFF_NEAR: Pt[] = [[-145.6, -398.8, 'c'], [-111, -397.2, 'c'], [-109.6, -378.4], [-111, -360.6, 'c'], [-145.6, -359.2, 'c']];
const ELBOW_NEAR = line([[-225, -410], [-236, -398], [-249, -391]]);
const FOREARM_FOLD = line([[-206, -366], [-190, -372.6]]);
/** Far forearm (anatomical LEFT): emerges from behind the torso's front edge (x ~ -68). */
const FOREARM_FAR: Pt[] = [[-84, -403], [-58, -404], [-34, -405, 'c'], [-34, -368.6, 'c'], [-58, -368.2], [-84, -367.6]];
const CUFF_FAR: Pt[] = [[-34.6, -405.4, 'c'], [-3, -403.6, 'c'], [-1.6, -386], [-3, -368.6, 'c'], [-34.6, -368.2, 'c']];

// ---------------------------------------------------------------- typing hand (wrist-local: +x forward, +y down)
/** Back of the hand from the wrist to the knuckles. */
const PALM: Pt[] = [
	[-3, -10], [10, -14.6], [24, -16.4], [35, -15.4], [43, -12], [47.4, -6], [48.4, 1], [46, 7.6], [37, 10.6], [24, 11.4], [12, 10.6],
	[2, 9.4], [-3, 4],
];
const PALM_SHADOW = smooth([[-6, 5], [20, 7], [40, 5], [52, 4], [52, 14], [-6, 14]]);
/**
 * One finger in its knuckle frame (knuckle at 0,0): it leaves the hand forward and curls down so the
 * tip rests ~19 units lower on a key.
 */
const FINGER: Pt[] = [
	[-3, -6], [8, -7.2], [16, -4.4], [21, 1.6], [22.6, 8.6], [21.4, 15.2], [18, 19.6], [13, 20.4], [9.8, 17], [9.6, 11], [7, 6], [0, 5.4],
	[-3, 0],
];
/** Knuckles of the four fingers, index (farthest, drawn first) -> little (nearest, on top). */
const KNUCKLES: {x: number; y: number; s: number}[] = [
	{x: 38, y: -9, s: 0.88},
	{x: 41, y: -5, s: 0.95},
	{x: 42.6, y: -0.6, s: 1},
	{x: 41.6, y: 3.6, s: 0.9},
];
/** Thumb, tucked under the palm toward the space bar. */
const THUMB: Pt[] = [[8, 6], [18, 8.6], [27, 12], [31, 16.6], [28.6, 19.6], [20, 18], [11, 14.4]];

/** Lift angle (deg) of one finger at a frame: short taps on a per-finger rhythm (deterministic). */
export const fingerLift = (frame: number, hand: 0 | 1, finger: number): number => {
	const period = 9 + ((finger * 5 + hand * 3) % 5); // 9..13 frames
	const phase = (finger * 7 + hand * 11) % period;
	const t = (frame + phase) % period;
	return t < 4 ? Math.sin((Math.PI * t) / 4) * 16 : 0;
};

const TypingHand: React.FC<{x: number; y: number; s?: number; lifts: number[]; name: string}> = ({x, y, s = 1, lifts, name}) => {
	const palm = smooth(PALM);
	return (
		<g data-part={name} transform={`translate(${x} ${y}) scale(${s})`}>
			<Shape d={smooth(THUMB)} fill={ZOO_COLORS.skinShadow} />
			<path d={palm} fill={ZOO_COLORS.skin} />
			<Clipped clip={palm}>
				<path d={PALM_SHADOW} fill={ZOO_COLORS.skinShadow} />
			</Clipped>
			<path d={palm} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinejoin="round" />
			{KNUCKLES.map((k, i) => (
				<g key={i} data-part={`finger${i}`} transform={`translate(${k.x} ${k.y}) rotate(${-lifts[i]}) scale(${k.s})`}>
					<Shape d={smooth(FINGER)} fill={ZOO_COLORS.skin} shadow={{d: smooth([[6, 12], [24, 10], [24, 24], [6, 24]]), fill: ZOO_COLORS.skinShadow}} />
				</g>
			))}
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

/** Body behind the desk: legs, torso, head. */
const TypingBack: React.FC<{head: ViewHeadProps; breath: number}> = ({head, breath}) => (
	<g data-part="typingBack">
		<FarShoe34 />
		<Shape name="legL" d={smooth(LEG_FAR)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_FAR_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
		<NearShoe34 />
		<Shape name="legR" d={smooth(LEG_NEAR)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_NEAR_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
		<Stroke d={KNEE_CREASE} width={LINE.detailWidth * 0.8} color={ZOO_COLORS.trousersShadow} />
		<g transform={torsoT(1)}>
			<CollarBack34 />
		</g>
		<g transform={upperT(breath)}>
			<Neck34 />
		</g>
		<g transform={`translate(0 ${breath * 0.6}) ${torsoT(1)}`}>
			<Torso34 />
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
				<Stroke d={line(FOREARM_FAR.slice(0, 3))} width={LINE.width} />
				<Stroke d={line(FOREARM_FAR.slice(3))} width={LINE.width} />
				<TypingHand x={TYPING_LAYOUT.wristL.x} y={TYPING_LAYOUT.wristL.y} s={0.94} lifts={lifts(1)} name="handL" />
				<Shape name="cuffL" d={smooth(CUFF_FAR)} fill={ZOO_COLORS.overshirt} />
			</g>
			<g data-part="armR" transform={`translate(0 ${breath * 0.5})`}>
				<TypingHand x={TYPING_LAYOUT.wristR.x} y={TYPING_LAYOUT.wristR.y} lifts={lifts(0)} name="handR" />
				<Shape name="sleeveR" d={smooth(SLEEVE_NEAR)} fill={ZOO_COLORS.overshirt} shadow={{d: SLEEVE_NEAR_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
				<Stroke d={ELBOW_NEAR} width={LINE.detailWidth} />
				<Stroke d={FOREARM_FOLD} width={LINE.detailWidth * 0.8} />
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
