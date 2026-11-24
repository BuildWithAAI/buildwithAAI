/**
 * ZOO seen from BEHIND (reference/crops/zoo_turn_back.png). World units in the back view's root
 * space: origin = centre of the footprint (crop x=154.5), 1 crop px = 900/630 u.
 *
 * From behind, anatomical LEFT is SCREEN LEFT. The hair is drawn for this view (never flipped from
 * the front): its big wing tips sit on screen right here, which is the anatomical right, the same
 * side as the front view's wings. The pin, pocket and buttons are on the front of the overshirt and
 * are hidden. Sleeves, cuffs, hands, ears, trouser legs, back pockets and shoes are unmarked
 * bilateral pairs: each is authored once for this view and mirrored to the other side within it
 * (decision ZOO-S1), never copied from another view.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, type Pt} from '../geometry';
import {Clipped, Shape, Stroke} from '../parts/Shape';
import type {ViewBodyProps} from './types';

/** Mirror axes for the unmarked pairs (measured centre lines of the sheet's back view). */
const ARM_AXIS = 2;
const LEG_AXIS = 3;
export const BACK_BODY = {hem: -436, shoulder: -690, headPivot: {x: 2, y: -748}} as const;

// ---------------------------------------------------------------- head (hair, ears, neck)
const HAIR: Pt[] = [
	[0, -899], [13.6, -898.8], [22, -896.4], [30, -891], [35.6, -885.4], [40, -880.4], [47, -878], [55.8, -877.6], [58.4, -877.2, 'c'],
	[56.4, -871], [56.6, -865.6], [60, -860.4], [67, -853.4], [74, -849.4], [79.4, -846.8, 'c'], [78.6, -840], [75.4, -836], [69, -830.6],
	[68.6, -827], [72.4, -822.2, 'c'], [70.4, -816.6], [65.2, -810.6], [60, -806], [58.6, -800], [54, -798.6], [49.4, -793.4], [45, -786],
	[47.6, -779.4], [46.4, -775.4], [40.8, -771], [40.4, -764.6], [36.6, -760.6], [32.2, -754.6, 'c'], [28.8, -754], [26.6, -756.2, 'c'],
	[24, -754], [19, -753], [14.4, -755.2, 'c'], [10, -753], [4, -752.6], [-2, -754.8, 'c'], [-8, -753], [-14, -752.6], [-19, -754.6, 'c'],
	[-23, -752.4], [-28.6, -757.6, 'c'], [-34, -768], [-36.4, -776], [-41, -783.4], [-45.4, -790], [-46.6, -798.6], [-52.4, -802.6],
	[-58, -810.6], [-62.4, -818.4, 'c'], [-61, -824], [-57.4, -829.4], [-58, -832.6], [-61.6, -838.4], [-65.2, -842.6], [-66.6, -849.6, 'c'],
	[-63.6, -856.4], [-60, -861.6], [-53, -868.6], [-46.6, -875], [-41, -877.6], [-34, -878], [-28, -878], [-24.4, -881.4], [-22, -887.2],
	[-17.6, -892.4], [-12.4, -895.6], [-7, -898.6],
];
/** One flat shadow tone: the lower half of the hair down to the nape, and the crown swirl's underside. */
const HAIR_SHADOW = [
	// lower half, its upper boundary following the swirl
	smooth([[-70, -830], [-56, -836], [-40, -838], [-24, -834], [-10, -826], [2, -822], [14, -826], [28, -832], [44, -834], [60, -828], [78, -820], [78, -740], [-70, -740]]),
	// crescent under the top lock of the swirl
	smooth([[-34, -848], [-26, -862], [-12, -872], [6, -876], [20, -872], [28, -860], [26, -848], [18, -842], [22, -852], [18, -862], [6, -866], [-10, -862], [-22, -854]]),
	// groove under the right wing
	smooth([[40, -862], [54, -858], [66, -850], [56, -846], [44, -850]]),
].join(' ');
const HAIR_STRANDS: Pt[][] = [
	[[-40, -846], [-32, -864], [-16, -878], [4, -883], [20, -878], [30, -866], [30, -852], [20, -842], [8, -836], [4, -826], [12, -816]], // crown swirl
	[[-24, -880], [-8, -888], [10, -890], [26, -884]], // top lock
	[[36, -880], [50, -872], [62, -860], [72, -851]], // right wing
	[[-58, -856], [-46, -864], [-34, -870]], // left lock
	[[-54, -830], [-40, -836], [-26, -832]], // left lower lock
	[[40, -834], [54, -830], [66, -822]], // right lower lock
];
const EAR_L: Pt[] = [[-42, -806], [-49, -808.6], [-55, -804], [-56.6, -794], [-54.6, -784.6], [-49.6, -778], [-43, -776]];
const EAR_SHADOW_L: Pt[] = [[-44, -804], [-50, -804], [-53, -794], [-51, -784], [-45, -780]];
const NECK: Pt[] = [[-27, -764], [-26.4, -746], [-27, -732], [-20, -726], [34, -726], [35, -732], [34.4, -746], [34, -764]];
const NECK_SHADOW = smooth([[-30, -760], [36, -760], [36, -744], [20, -742.6], [4, -745], [-12, -743], [-30, -745]]);

const BackHead: React.FC = () => (
	<g data-part="head" data-view="back">
		{([1, -1] as const).map((s) => {
			const m = (p: Pt[]) => (s === 1 ? p : mirrorX(p, ARM_AXIS));
			return <Shape key={s} name={s === 1 ? 'earL' : 'earR'} d={smooth(m(EAR_L))} fill={ZOO_COLORS.skin} shadow={{d: smooth(m(EAR_SHADOW_L)), fill: ZOO_COLORS.skinShadow}} />;
		})}
		<g data-part="hair">
			<Shape d={smooth(HAIR)} fill={ZOO_COLORS.hair} shadow={{d: HAIR_SHADOW, fill: ZOO_COLORS.hairShadow}} />
			{HAIR_STRANDS.map((s, i) => (
				<Stroke key={i} d={line(s)} width={LINE.detailWidth} />
			))}
		</g>
	</g>
);

// ---------------------------------------------------------------- shirt
const COLLAR = smooth([
	[-38, -720], [-36, -729], [-31, -735.4], [-16, -738], [2, -738.6], [20, -738], [35, -735.4], [40, -729], [42, -720], [2, -716],
]);
const SHIRT: Pt[] = [
	[-36, -723], [-46, -714.4], [-60, -707.6], [-78, -701], [-94, -695], [-106, -689], [-110.6, -683, 'c'], [-102, -674], [-92, -662], [-84, -645],
	[-81, -620], [-80.6, -560], [-80.4, -500], [-80.6, -450], [-81, -436, 'c'], [-60, -424], [-30, -416], [0, -413.4], [30, -416], [60, -424],
	[87.6, -436, 'c'], [88, -450], [88, -500], [88, -560], [88.6, -620], [91.6, -645], [98, -662], [106, -674], [114.6, -683, 'c'], [110, -689],
	[98, -695], [82, -701], [64, -707.6], [50, -714.4], [40, -723],
];
const SHIRT_SHADOW = [
	smooth([[-86, -660], [-68, -656], [-68, -430], [-86, -430]]),
	smooth([[94, -660], [76, -656], [76, -430], [94, -430]]),
	smooth([[-90, -430], [-60, -436], [0, -428], [60, -436], [96, -430], [96, -400], [-90, -400]]),
].join(' ');
const YOKE = line([[-88, -662], [-80, -657.4], [-40, -656.4], [2, -656.6], [44, -656.4], [84, -657.4], [92, -662]]);
const COLLAR_SEAM = line([[-35, -725], [-20, -727.4], [2, -728], [24, -727.4], [39, -725]]);

// ---------------------------------------------------------------- sleeves and hands (left authored, right mirrored)
const SLEEVE_L: Pt[] = [
	[-104, -690], [-112, -683], [-118, -670], [-120.6, -652], [-123.4, -625], [-127.4, -595], [-131.4, -565], [-135.2, -540],
	[-138.6, -515], [-139.2, -500], [-137.8, -480], [-136.2, -462], [-135.4, -452], [-136, -440], [-135.6, -420, 'c'], [-118, -417],
	[-100.4, -419, 'c'], [-99.8, -440], [-99.8, -452], [-90, -470], [-84, -500], [-80, -560], [-80, -620], [-84, -650], [-92, -670],
];
const SLEEVE_SHADOW_L: Pt[] = [[-100, -690], [-82, -680], [-78, -560], [-80, -470], [-96, -450], [-98, -416], [-92, -416], [-70, -470], [-70, -690]];
const CUFF_SEAM_L: Pt[] = [[-136, -453.4], [-118, -455.6], [-100.2, -453.4]];
const SLEEVE_PLACKET_L: Pt[] = [[-129, -486], [-128.4, -470], [-128.6, -456]];
const CUFF_BUTTON_L = {x: -126.6, y: -427} as const;
/** Anatomical LEFT hand from behind: back of the hand outward, fingers curling toward the thigh. */
const HAND_L: Pt[] = [
	[-129, -418], [-129.8, -396], [-128.4, -376], [-125.4, -360], [-120, -349], [-112, -341.6], [-102, -336.8], [-92, -336.4],
	[-86.6, -339.6, 'c'], [-90.4, -344], [-87.4, -348.6], [-85.4, -356], [-86.4, -366, 'c'], [-89.4, -374], [-90.6, -392], [-92.6, -418],
];
const HAND_SHADOW_L: Pt[] = [[-106, -380], [-90, -384], [-82, -334], [-110, -334], [-110, -356]];
const HAND_LINES_L: Pt[][] = [
	[[-116, -354], [-105, -347], [-93, -345]],
	[[-110, -366], [-100, -358.6], [-89.6, -356.6]],
	[[-87, -366], [-96, -366.4], [-103, -371]], // thumb tip tucked in front
];

const Arm: React.FC<{side: 1 | -1}> = ({side}) => {
	const m = (p: Pt[]) => (side === 1 ? p : mirrorX(p, ARM_AXIS));
	const bx = side === 1 ? CUFF_BUTTON_L.x : 2 * ARM_AXIS - CUFF_BUTTON_L.x;
	const hand = smooth(m(HAND_L));
	return (
		<g data-part={side === 1 ? 'armL' : 'armR'}>
			<g data-part={side === 1 ? 'handL' : 'handR'}>
				<path d={hand} fill={ZOO_COLORS.skin} />
				<Clipped clip={hand}>
					<path d={smooth(m(HAND_SHADOW_L))} fill={ZOO_COLORS.skinShadow} />
				</Clipped>
				<path d={hand} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinejoin="round" />
				{HAND_LINES_L.map((l, i) => (
					<Stroke key={i} d={line(m(l))} width={LINE.detailWidth} />
				))}
			</g>
			<Shape name={side === 1 ? 'sleeveL' : 'sleeveR'} d={smooth(m(SLEEVE_L))} fill={ZOO_COLORS.overshirt} shadow={{d: smooth(m(SLEEVE_SHADOW_L)), fill: ZOO_COLORS.overshirtShadow}} />
			<Stroke d={line(m(CUFF_SEAM_L))} width={LINE.detailWidth} />
			<Stroke d={line(m(SLEEVE_PLACKET_L))} width={LINE.detailWidth * 0.8} />
			<circle data-part="cuffButton" cx={bx} cy={CUFF_BUTTON_L.y} r={3.2} fill={ZOO_COLORS.buttons} stroke={LINE.color} strokeWidth={1} />
		</g>
	);
};

// ---------------------------------------------------------------- legs, back pockets, heels (left authored, right mirrored)
const LEG_L: Pt[] = [
	[-80.5, -440], [3.5, -440], [3.5, -380], [2.1, -366, 'c'], [-1.5, -340], [-5.5, -300], [-9.5, -260], [-13.5, -220], [-14.9, -180], [-16.5, -140],
	[-19.5, -100], [-22.1, -70], [-22.7, -40.4, 'c'], [-49.5, -38], [-78.5, -39, 'c'], [-79.1, -60], [-77.7, -90], [-79.1, -120], [-81.5, -150],
	[-80.9, -200], [-78.1, -240], [-78.1, -290], [-78.7, -330], [-80.5, -400],
];
const LEG_SHADOWS_L: Pt[][] = [
	[[-84.5, -446], [7.5, -446], [7.5, -400], [-84.5, -404]],
	[[2.1, -366], [-1.5, -340], [-9.5, -260], [-14.9, -180], [-19.5, -100], [-22.7, -40], [-32.5, -40], [-26.5, -140], [-18.5, -260], [-8.5, -360]],
];
const POCKET_L: Pt[] = [[-60.5, -406, 'c'], [-18.5, -406, 'c'], [-20.9, -384], [-38.9, -377.4, 'c'], [-56.5, -384.6]];
const SHOE_L: Pt[] = [
	[-80.5, -39], [-58.5, -41.6], [-30.5, -40], [-24.1, -32], [-21.5, -16], [-22.9, -4], [-38.5, -1.75], [-70.5, -1.75], [-88.5, -2.4], [-93.1, -10],
	[-92.1, -24], [-87.1, -34],
];
const SHOE_SOLE_L: Pt[] = [[-96.5, -10.6], [-56.5, -10], [-18.5, -10.6], [-18.5, 2], [-96.5, 2]];
const SHOE_SHADOW_L: Pt[] = [[-90.5, -44], [-74.5, -44], [-78.5, -20], [-84.5, -10], [-90.5, -10]];
const SHOE_LINES_L: Pt[][] = [
	[[-92.3, -10.4], [-56.5, -9.8], [-21.9, -10.4]],
	[[-89.5, -23], [-56.5, -21.6], [-23.9, -23]],
	[[-55.5, -39], [-55.5, -28]],
];

const Leg: React.FC<{side: 1 | -1}> = ({side}) => {
	const m = (p: Pt[]) => (side === 1 ? p : mirrorX(p, LEG_AXIS));
	const shoe = smooth(m(SHOE_L));
	return (
		<g data-part={side === 1 ? 'legL' : 'legR'}>
			<g data-part={side === 1 ? 'shoeL' : 'shoeR'}>
				<path d={shoe} fill={ZOO_COLORS.sneaker} />
				<Clipped clip={shoe}>
					<path d={smooth(m(SHOE_SHADOW_L))} fill={ZOO_COLORS.sneakerShadow} />
					<path d={smooth(m(SHOE_SOLE_L))} fill={ZOO_COLORS.sneakerSole} />
				</Clipped>
				<path d={shoe} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinejoin="round" />
				{SHOE_LINES_L.map((l, i) => (
					<Stroke key={i} d={line(m(l))} width={i === 0 ? LINE.detailWidth : LINE.detailWidth * 0.8} />
				))}
			</g>
			<Shape d={smooth(m(LEG_L))} fill={ZOO_COLORS.trousers} shadow={{d: LEG_SHADOWS_L.map((p) => smooth(m(p))).join(' '), fill: ZOO_COLORS.trousersShadow}} />
			<path data-part="backPocket" d={smooth(m(POCKET_L))} fill="none" stroke={LINE.color} strokeWidth={LINE.detailWidth * 0.8} strokeLinejoin="round" />
		</g>
	);
};

// ---------------------------------------------------------------- assembly
export const ZooBack: React.FC<ViewBodyProps> = (p) => {
	const dy = p.breath;
	const sy = 1 + -dy / (BACK_BODY.hem - BACK_BODY.shoulder);
	const torsoT = `translate(0 ${BACK_BODY.hem}) scale(1 ${sy}) translate(0 ${-BACK_BODY.hem})`;
	const tilt = p.head.headTilt;
	return (
		<g data-view="back">
			<Leg side={1} />
			<Leg side={-1} />
			<Stroke d={line([[3.2, -412], [3, -390], [3, -368]])} width={LINE.detailWidth * 0.8} />
			<g transform={`translate(0 ${dy})`}>
				<Shape name="neck" d={smooth(NECK)} fill={ZOO_COLORS.skin} shadow={{d: NECK_SHADOW, fill: ZOO_COLORS.skinShadow}} />
			</g>
			<g data-part="arms" transform={`translate(0 ${dy})`}>
				<Arm side={1} />
				<Arm side={-1} />
			</g>
			<g data-part="torso" transform={torsoT}>
				<Shape name="overshirt" d={smooth(SHIRT)} fill={ZOO_COLORS.overshirt} shadow={{d: SHIRT_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
				<Stroke d={YOKE} width={LINE.detailWidth} />
				<Shape name="collar" d={COLLAR} fill={ZOO_COLORS.overshirt} />
				<Stroke d={COLLAR_SEAM} width={LINE.detailWidth * 0.8} />
			</g>
			<g data-part="upperBody" transform={`translate(0 ${dy}) rotate(${tilt} ${BACK_BODY.headPivot.x} ${BACK_BODY.headPivot.y})`}>
				<BackHead />
			</g>
		</g>
	);
};
