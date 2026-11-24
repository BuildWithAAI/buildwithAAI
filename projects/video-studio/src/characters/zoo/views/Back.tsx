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
import {ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, smoothstep, tapered, type Pt} from '../geometry';
import {HandDrawing, type HandDrawingSpec} from '../parts/Hand';
import {ZOO_LINE} from '../lines';
import {Clipped, Outline, Shape, Stroke, useLineScale} from '../parts/Shape';
import {Button} from './threeQuarter/Body34';
import type {ViewBodyProps} from './types';

/**
 * Mirror axes for the unmarked pairs (measured centre lines of the sheet's back view). Repair round 3: the arms mirror
 * about x = 1 (the sheet's sleeves and cuffs are centred on ~0..1.5; at 2 the right sleeve sat ~2 u wide); the ears keep
 * the head's axis.
 */
const ARM_AXIS = 1;
const HEAD_AXIS = 2;
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
/**
 * One flat shadow tone (repair round 2, zoo_turn_back.png): the underside of the S-shaped crown lock (a thin crescent
 * under its sweep) and the nape below an edge that follows the lower ends of the locks. Round 1 used a straight band over
 * the whole lower half plus an isolated oval under the right wing, which read as a two-tone helmet. Repair round 3: the
 * nape edge is no longer one smooth U from ear to ear: four pointed lock tips hang into the shadow (at x ~-46 / -20 / 14 /
 * 44, the left locks, the S tail and the right wave) with the darker under-layer rising 8-15 u between them, so the
 * darkness follows the lock ends as on the sheet.
 */
const HAIR_SHADOW = [
	smooth([
		[-80, -829], [-62, -827], [-46, -812, 'c'], [-33, -823], [-20, -805, 'c'], [-4, -816], [14, -799, 'c'], [30, -813], [44, -805, 'c'],
		[56, -823], [68, -829], [82, -825], [82, -740], [-80, -740],
	]),
	smooth([[-12.6, -866.6], [-2, -856.6], [14, -850.4], [30, -845.2], [38.6, -837.4], [33.4, -835.6], [22, -839], [8, -844.2], [-3.6, -850.4], [-10.4, -858]]),
].join(' ');
/**
 * The lock edges that carry the hair's identity from behind (repair round 2): the S-shaped crown lock, the top lock's
 * lower edge on the right, and the two left lock edges, as tapered dark-brown ink lines (ZOO_COLORS.brow, the hair ink
 * already used for the front crown hollow, decision ZOO-H3), up to ZOO_LINE.detail wide. Round 1 drew them in the hair
 * shadow tone at the fine width, which was invisible.
 */
const LOCK_LINES: Pt[][] = [
	[[-15, -882], [-12.4, -868], [-2.4, -857.4], [13.4, -850.6], [29.6, -845.4], [38.6, -838.4], [40, -828.6], [34.4, -818.6], [25.4, -810.4], [16.6, -803]], // the S
	[[12, -876], [28, -869.4], [44, -866.4], [55, -869]], // top lock's lower edge, into the right wave tip
	[[-37, -868], [-42.4, -852], [-41.6, -836], [-35.6, -823], [-25, -813]], // left lock
	[[-19, -856], [-16.6, -843], [-10.6, -832], [0, -825], [12, -821], [20, -813]], // lower edge of the S ribbon
];
/** Peak width of each lock line as a multiple of ZOO_LINE.detail (repair round 3: the S lock swells to 1.3x at its middle, a
 * broad lock edge rather than a wire, as on the sheet). */
const LOCK_WIDTH = [1.3, 1, 1, 1];
const EAR_L: Pt[] = [[-42, -806], [-49, -808.6], [-55, -804], [-56.6, -794], [-54.6, -784.6], [-49.6, -778], [-43, -776]];
const EAR_SHADOW_L: Pt[] = [[-44, -804], [-50, -804], [-53, -794], [-51, -784], [-45, -780]];
const NECK: Pt[] = [[-27, -764], [-26.4, -746], [-27, -732], [-20, -726], [34, -726], [35, -732], [34.4, -746], [34, -764]];
const NECK_SHADOW = smooth([[-30, -760], [36, -760], [36, -744], [20, -742.6], [4, -745], [-12, -743], [-30, -745]]);

const BackHead: React.FC = () => {
	const ls = useLineScale();
	const hair = smooth(HAIR);
	return (
		<g data-part="head" data-view="back">
			{([1, -1] as const).map((s) => {
				const m = (p: Pt[]) => (s === 1 ? p : mirrorX(p, HEAD_AXIS));
				return <Shape key={s} name={s === 1 ? 'earL' : 'earR'} d={smooth(m(EAR_L))} fill={ZOO_COLORS.skin} shadow={{d: smooth(m(EAR_SHADOW_L)), fill: ZOO_COLORS.skinShadow}} />;
			})}
			<g data-part="hair">
				<Shape d={hair} fill={ZOO_COLORS.hair} shadow={{d: HAIR_SHADOW, fill: ZOO_COLORS.hairShadow}} stroke={0} />
				<Clipped clip={hair}>
					{LOCK_LINES.map((l, i) => (
						<path key={i} data-part="lockLine" d={tapered(l, (t) => LOCK_WIDTH[i] * ZOO_LINE.detail * ls * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * t), 0.7)))} fill={ZOO_COLORS.brow} />
					))}
				</Clipped>
				<Outline d={hair} />
			</g>
		</g>
	);
};

// ---------------------------------------------------------------- shirt
const COLLAR = smooth([
	[-38, -720], [-36, -729], [-31, -735.4], [-16, -738], [2, -738.6], [20, -738], [35, -735.4], [40, -729], [42, -720], [2, -716],
]);
/**
 * Back panel. Repair round 3 (row scans of zoo_turn_back.png): the shoulders slope from the collar and ROUND OFF into the
 * armhole seam (smooth shoulder points at (-105.4, -686.8) / (109.4, -686.8); round 2's 'c' corners at +-110.6/114.6 made
 * a square yoke ~10 u wider than the sheet at y -680..-640). The armhole seam then runs down and in, as on the sheet
 * ((-103,-695) -> (-90,-650) -> (-85,-620)).
 */
const SHIRT: Pt[] = [
	[-36, -723], [-46, -714.4], [-60, -707.6], [-78, -701], [-94, -695.4], [-102.6, -691.4], [-105.4, -686.8], [-102.4, -678.6],
	[-96.6, -667], [-90.4, -652], [-85.2, -637], [-81.4, -620], [-80.6, -560], [-80.4, -500], [-80.6, -450], [-81, -436, 'c'], [-60, -424],
	[-30, -416], [0, -413.4], [30, -416], [60, -424], [87.6, -436, 'c'], [88, -450], [88, -500], [88, -560], [88.6, -620], [91.4, -637],
	[96, -652], [101.6, -667], [107, -678.6], [109.4, -686.8], [106.6, -691.4], [98, -695.4], [82, -701], [64, -707.6], [50, -714.4],
	[40, -723],
];
const SHIRT_SHADOW = [
	smooth([[-86, -660], [-68, -656], [-68, -430], [-86, -430]]),
	smooth([[94, -660], [76, -656], [76, -430], [94, -430]]),
	smooth([[-90, -430], [-60, -436], [0, -428], [60, -436], [96, -430], [96, -400], [-90, -400]]),
].join(' ');
const YOKE = line([[-88, -662], [-80, -657.4], [-40, -656.4], [2, -656.6], [44, -656.4], [84, -657.4], [92, -662]]);
const COLLAR_SEAM = line([[-35, -725], [-20, -727.4], [2, -728], [24, -727.4], [39, -725]]);

// ---------------------------------------------------------------- sleeves and hands (left authored, right mirrored)
// Repair round 2 (row scans of zoo_turn_back.png): the forearms hang ~7 u further in than round 1 had them, against the
// hips: cuff 128.6..91.4 between path edges (sheet outline edges ~131..89), cuff bottom -411, cuff seam -443.
// Repair round 3: the sleeve cap rounds off under the sloping shoulder, ~3-5 u further in above y -600 (silhouette
// -112..115 at y -680, -120..122 at -640 against the sheet's -112..115 / -121..122; round 2: -116..120 / -124..127).
const SLEEVE_L: Pt[] = [
	[-102, -692], [-108, -687], [-112.4, -677], [-115.4, -663], [-117.8, -646], [-121.6, -625], [-126.4, -597], [-131.4, -565], [-135.2, -540],
	[-138.4, -515], [-139, -500], [-138, -484], [-136.2, -468], [-134, -456], [-131.4, -446], [-129.8, -436], [-129.2, -424],
	[-128.6, -412.6, 'c'], [-110, -410.4], [-91.4, -412, 'c'], [-91.6, -424], [-91.8, -436], [-90.6, -450], [-88.4, -465],
	[-86, -480], [-84, -500], [-80, -560], [-80, -620], [-84, -650], [-92, -670],
];
const SLEEVE_SHADOW_L: Pt[] = [[-108, -690], [-96, -660], [-90, -600], [-91, -540], [-94, -490], [-98, -462], [-99.6, -440], [-99.6, -405], [-70, -405], [-70, -690]];
const CUFF_SEAM_L: Pt[] = [[-129.8, -443.4], [-110.4, -444.8], [-91.4, -443.4]];
const SLEEVE_PLACKET_L: Pt[] = [[-122, -484], [-121.4, -468], [-121.6, -455]];
const CUFF_BUTTON_L = {x: -120.4, y: -424.6} as const;
/**
 * The back of the anatomical-LEFT hand seen from behind (repair round 2, skin edges row-scanned on zoo_turn_back.png;
 * round 1 mapped the front palm drawing here, so its thumb hook showed from behind). The back of the hand tapers out of
 * the cuff and the fingers curl toward the thigh: four tip lobes step up the inner edge (index highest, nearest the
 * thigh; little finger lowest), parted by short warm-brown separations. The thumb is tucked out of view. The screen-right
 * (anatomical right) hand is its mirror about the arm axis WITHIN this view (unmarked pair, ZOO-S1).
 */
const BACK_HAND_L: HandDrawingSpec = {
	outline: [
		[-121.4, -418], [-94, -418], [-92.4, -409], [-89.6, -402], [-88.2, -394], [-87.8, -385], [-87.8, -376], [-87.4, -368.6],
		[-85.2, -364.6], [-83.8, -360], [-84.6, -355.8], [-87.8, -353.8], [-90.6, -353, 'c'], [-87.4, -350.2], [-85.2, -346.4],
		[-84.2, -342.2], [-85.6, -339], [-89, -338, 'c'], [-87.2, -335.6], [-87.8, -332.6], [-91.2, -331], [-95.4, -331.6, 'c'],
		[-98.6, -332.4], [-102.4, -335.2], [-106.2, -338.8], [-110, -343], [-113.6, -348], [-116.8, -354], [-119.2, -361],
		[-120.6, -369], [-120.8, -380], [-120.6, -394], [-120.8, -408],
	],
	shadow: [[-70, -420], [-95.6, -418], [-93.4, -404], [-92.6, -392], [-92.6, -380], [-93.4, -370], [-70, -366]],
	lines: [
		// where the curled fingers fold under the back of the hand (sheet: a soft curve from the knuckles to the tips)
		[[-104.6, -378], [-102.8, -366], [-99, -354.6], [-94.6, -345.4], [-90.6, -339.6]],
		[[-90.6, -353], [-93.6, -359.4], [-96.6, -365.6]],
		[[-95.4, -331.6], [-99.4, -336.8], [-103.6, -341.6]],
	],
};
const Arm: React.FC<{side: 1 | -1}> = ({side}) => {
	const m = (p: Pt[]) => (side === 1 ? p : mirrorX(p, ARM_AXIS));
	const bx = side === 1 ? CUFF_BUTTON_L.x : 2 * ARM_AXIS - CUFF_BUTTON_L.x;
	const handMap = (p: Pt): Pt => (side === 1 ? p : mirrorX([p], ARM_AXIS)[0]);
	return (
		<g data-part={side === 1 ? 'armL' : 'armR'}>
			<HandDrawing hand={BACK_HAND_L} map={handMap} name={side === 1 ? 'handL' : 'handR'} />
			<Shape name={side === 1 ? 'sleeveL' : 'sleeveR'} d={smooth(m(SLEEVE_L))} fill={ZOO_COLORS.overshirt} shadow={{d: smooth(m(SLEEVE_SHADOW_L)), fill: ZOO_COLORS.overshirtShadow}} />
			<Stroke d={line(m(CUFF_SEAM_L))} width={ZOO_LINE.detail} />
			<Stroke d={line(m(SLEEVE_PLACKET_L))} width={ZOO_LINE.fine} />
			<Button x={bx} y={CUFF_BUTTON_L.y} r={3.2} />
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
	// a ~10 u curved terminator under the shirt hem (v1: a 40 u band that read as a belt)
	[[-84.5, -446], [7.5, -446], [7.5, -425], [-40, -423.4], [-84.5, -428]],
	[[2.1, -366], [-1.5, -340], [-9.5, -260], [-14.9, -180], [-19.5, -100], [-22.7, -40], [-32.5, -40], [-26.5, -140], [-18.5, -260], [-8.5, -360]],
];
/** An open, curved jeans back-pocket line (repair round 1; v1 drew a closed flap rectangle). */
const POCKET_L: Pt[] = [[-59.5, -409], [-56, -394], [-46, -383.4], [-33, -383.4], [-23, -394], [-19.5, -409]];
// Repair round 1: the heel flares out toward the sole (v1 was a box).
const SHOE_L: Pt[] = [
	[-80.5, -39], [-58.5, -41.6], [-30.5, -40], [-24.6, -32], [-22.8, -20], [-19.6, -9.4], [-21, -3], [-38.5, -1.75], [-70.5, -1.75], [-90.6, -2.4],
	[-95.6, -8.6], [-93, -20], [-88.6, -32],
];
const SHOE_SOLE_L: Pt[] = [[-99.5, -10.6], [-56.5, -10], [-15.5, -10.6], [-15.5, 2], [-99.5, 2]];
const SHOE_SHADOW_L: Pt[] = [[-90.5, -44], [-74.5, -44], [-78.5, -20], [-84.5, -10], [-90.5, -10]];
const SHOE_LINES_L: Pt[][] = [
	[[-95, -10.4], [-56.5, -9.8], [-19.8, -10.4]],
	[[-89.5, -23], [-56.5, -21.6], [-23.9, -23]],
	[[-55.5, -39], [-55.5, -28]],
];

/**
 * The anatomical-right leg (screen right from behind) is the left one mirrored about LEG_AXIS, then authored for this view
 * below the knee (repair round 3): the sheet's legs are not mirror images there. Its right shin leans ~5 u toward the
 * centre by the ankle (`leanR`, the shoe moves with it) and its outer edge is ~3.5 u slimmer from the knee down
 * (`slimR`): silhouette 78.7 at y -100 and heel ~89 at y -30, against the sheet's 77.9 / 89.3 (round 2: 85 / 97).
 */
const leanR = (y: number) => -5 * smoothstep((y + 300) / 260);
const slimR = (y: number) => -3.5 * smoothstep((y + 340) / 120);
/** Right-leg point: mirror, lean, and slim the trouser's outer edge (`slim` false for the shoe, which only leans). */
const rightLegPt = (p: Pt, slim = true): Pt => {
	const x = 2 * LEG_AXIS - p[0] + leanR(p[1]) + (slim && p[0] < -50 ? slimR(p[1]) : 0);
	return p.length === 3 ? [x, p[1], 'c'] : [x, p[1]];
};
const Leg: React.FC<{side: 1 | -1}> = ({side}) => {
	const m = (p: Pt[]) => (side === 1 ? p : p.map((q) => rightLegPt(q)));
	const ms = (p: Pt[]) => (side === 1 ? p : p.map((q) => rightLegPt(q, false)));
	const shoe = smooth(ms(SHOE_L));
	return (
		<g data-part={side === 1 ? 'legL' : 'legR'}>
			<g data-part={side === 1 ? 'shoeL' : 'shoeR'}>
				<path d={shoe} fill={ZOO_COLORS.sneaker} />
				<Clipped clip={shoe}>
					<path d={smooth(ms(SHOE_SHADOW_L))} fill={ZOO_COLORS.sneakerShadow} />
					<path d={smooth(ms(SHOE_SOLE_L))} fill={ZOO_COLORS.sneakerSole} />
				</Clipped>
				<Outline d={shoe} />
				{SHOE_LINES_L.map((l, i) => (
					<Stroke key={i} d={line(ms(l))} width={i === 0 ? ZOO_LINE.detail : ZOO_LINE.fine} />
				))}
			</g>
			<Shape d={smooth(m(LEG_L))} fill={ZOO_COLORS.trousers} shadow={{d: LEG_SHADOWS_L.map((p) => smooth(m(p))).join(' '), fill: ZOO_COLORS.trousersShadow}} />
			<Stroke name="backPocket" d={line(m(POCKET_L))} width={ZOO_LINE.fine} />
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
			<Stroke d={line([[3.2, -412], [3, -390], [3, -368]])} width={ZOO_LINE.fine} />
			<g transform={`translate(0 ${dy})`}>
				<Shape name="neck" d={smooth(NECK)} fill={ZOO_COLORS.skin} shadow={{d: NECK_SHADOW, fill: ZOO_COLORS.skinShadow}} />
			</g>
			<g data-part="arms" transform={`translate(0 ${dy})`}>
				<Arm side={1} />
				<Arm side={-1} />
			</g>
			<g data-part="torso" transform={torsoT}>
				<Shape name="overshirt" d={smooth(SHIRT)} fill={ZOO_COLORS.overshirt} shadow={{d: SHIRT_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
				<Stroke d={YOKE} width={ZOO_LINE.detail} />
				<Shape name="collar" d={COLLAR} fill={ZOO_COLORS.overshirt} />
				<Stroke d={COLLAR_SEAM} width={ZOO_LINE.fine} />
			</g>
			<g data-part="upperBody" transform={`translate(0 ${dy}) rotate(${tilt} ${BACK_BODY.headPivot.x} ${BACK_BODY.headPivot.y})`}>
				<BackHead />
			</g>
		</g>
	);
};
