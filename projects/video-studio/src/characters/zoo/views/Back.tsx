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
 * One flat shadow tone (repair round 2, zoo_turn_back.png). Repair round 4 (decision ZOO-H4; the sheet's back hair
 * classified into base / shadow / ink tones at 1 u): the locks read as FILLED shapes, base on top and hairShadow on the
 * underside, instead of ink lines over a flat cap.
 * - The nape (HAIR_SHADOW) starts under four ROUNDED lock ends of unequal length, at the sheet's positions: the far-left
 *   lock ends short and round (~-825 at x -48), the long left lock sweeps down-right to a tip at (-4, -809), the S lock's
 *   lower body ends at (23, -811), and the right lock ends short and round (~-825 at x 53). Between the left lock and the
 *   S body the shadow runs up a narrow channel to -855. Round 3 had four POINTED tips at -812 / -805 / -799 / -805.
 * - LOCK_SHADOWS: the S lock's dark band, i.e. the underside of its sweep (the curl between the core and the S body) and
 *   the channel above and right of the core (the top lock's and right lock's undersides), ~12 u deep as on the sheet
 *   (round 3: a 3-6 u crescent); and the top lock's underside wedge into the right wave tip (round 3 drew it as an ink line).
 */
const HAIR_SHADOW = smooth([
	[-82, -823.4, 'c'], [-58, -823.8], [-53.4, -826.2], [-49.8, -825.3], [-46.6, -825.4], [-44.2, -827.2], [-42.8, -829.8], [-39.6, -831.4],
	[-35.8, -831.6], [-32.6, -829.4], [-30.2, -824.8], [-26, -821], [-21, -818], [-15.4, -815], [-10.4, -812.2], [-6.8, -810], [-4.4, -808.8],
	[-2.4, -809.4], [-2.4, -811.8], [-5.2, -815.6], [-8.6, -818.8], [-12.2, -822.8], [-15, -827.2], [-17, -832.4], [-18.4, -838.4], [-19, -845],
	[-18.8, -851], [-17.2, -855], [-14.8, -853], [-13.6, -848], [-12.4, -842.6], [-10.8, -838], [-8.2, -834.4], [-3.6, -831.4], [2.4, -829.6],
	[9, -827.6], [14.4, -825], [18.2, -821.2], [20.6, -816.8], [21.8, -813], [22.6, -810.6], [24.2, -810.6], [26, -812.4], [29.6, -815.6],
	[33.4, -819.4], [35.8, -823.6], [37.2, -828], [41, -829.6], [45.4, -829.6], [48.6, -828], [50.8, -826], [53.4, -825.4], [56.4, -826],
	[60, -827.6], [64.6, -828.8], [70, -829.4], [84, -829, 'c'], [84, -740, 'c'], [-82, -740, 'c'],
]);
const LOCK_SHADOWS = [
	// the S curl: under the core, above the S lock's lower body, right of the strand that becomes the S body
	smooth([
		[-7.4, -854.4], [-4.4, -851.2], [0, -848.6], [5, -846.4], [12, -844.6], [21, -843.6], [29, -841.6], [33.6, -838.8], [35.4, -836.2],
		[32.4, -837.4], [27.6, -840.2], [21, -841.2], [15, -839.8], [10.4, -836.6], [5.4, -833.4], [0.6, -832], [-3.6, -833.4], [-6.8, -836.4],
		[-8.6, -840.2], [-9.4, -844.4], [-9.2, -849],
	]),
	// above and right of the core: the top lock's lower edge, then down between the S body and the right lock into the nape
	smooth([
		[-11.6, -868.4], [-10.6, -870.6], [-7, -866.4], [-3.6, -863], [-0.6, -860], [2.8, -857.2], [9.4, -854.2], [20, -853], [32, -852.4],
		[38.8, -851.2], [41.2, -848.4], [43.8, -845.2], [45.8, -842], [47.4, -839], [48.6, -835.4], [49.2, -831], [49.2, -827.4], [44, -826.6],
		[39.6, -826], [40.6, -830.4], [39.4, -835.4], [36.8, -839.4], [32.4, -842.2], [24, -844.2], [13, -845.4], [4.4, -847.4], [-0.6, -850],
		[-4, -853], [-6.6, -856.6], [-9.2, -860.4], [-11, -864],
	]),
	// the top lock's underside, widening into the right wave tip
	smooth([
		[20.6, -876.6], [25, -873.6], [29.6, -870.6], [34.4, -868.2], [41, -867.4], [48, -867.4], [55, -867], [60, -865], [59, -861.6], [52, -861.4],
		[44, -862], [37.4, -863.2], [32.6, -865.4], [28.4, -868.4], [24.8, -871.6], [22, -874.6],
	]),
];
/**
 * Ink lines in the hair ink (ZOO_COLORS.brow, decision ZOO-H3), tapered: the S lock's core (re-traced in round 4: it runs
 * from the crown down to (-1.5, -851), level at ~-845 to x 30, round the S body at x ~40 and curls under its tip to
 * (21, -802)), the far-left lock's edge (it ends at ~-823 where the nape starts; round 3 ran it on into the nape) and a
 * short stretch of the channel between the left lock and the S strand.
 */
const LOCK_LINES: Pt[][] = [
	[[-15, -882], [-12.4, -869], [-11.4, -863], [-8.6, -858], [-5.4, -854], [-1.4, -851], [4, -847.8], [12, -845.8], [21, -844.8], [29.6, -842.6],
		[34.6, -839.4], [37.6, -835.4], [39.4, -830.4], [39.8, -824], [37.6, -818], [34.2, -812.4], [29.6, -808.2], [24.4, -805], [20.6, -802.4]], // the S core
	[[-25, -873.4], [-29.6, -869.4], [-32.6, -866], [-35, -862.6], [-37.6, -858], [-39.6, -852.6], [-40.8, -846], [-40.6, -839.4], [-38.8, -833.6],
		[-36.4, -828], [-33.6, -823.6]], // far-left lock edge
	[[-18.4, -848], [-17, -842.4], [-15.4, -837.4], [-13.4, -833], [-10, -829.4]], // channel between the left lock and the S strand
];
/** Peak width of each lock line as a multiple of ZOO_LINE.detail (the S core swells to 1.4x: a broad lock edge, as on the sheet). */
const LOCK_WIDTH = [1.4, 1, 0.9];
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
					{LOCK_SHADOWS.map((d, i) => (
						<path key={i} data-part="lockShadow" d={d} fill={ZOO_COLORS.hairShadow} />
					))}
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
	// Repair round 4 (ZOO-V9): THREE separations, one from each notch between the four tip lobes up and back along the
	// curled fingers (~14-17 u, tapered), as on the sheet; round 3 had two short ticks and let the fold line run into the
	// middle notch, so only two partings read. The fold now stops above them.
	lines: [
		// where the curled fingers fold under the back of the hand (sheet: a soft curve down from the knuckles)
		[[-104.6, -378], [-103.4, -369], [-100.8, -359.6]],
		[[-90.6, -353], [-94, -359.6], [-97.6, -365.8]],
		[[-89, -338], [-93.2, -342.6], [-97.4, -347.8], [-101, -353.4]],
		[[-95.4, -331.6], [-99.6, -336], [-103.8, -340.6], [-107.2, -345.6]],
	],
	lineWidth: ZOO_LINE.detail,
	taper: 0.4,
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
/**
 * Repair round 4 (decision ZOO-S3; zoo_turn_back.png row-scanned): the trouser legs taper ~4-5 u per leg from the knee
 * down (leg ~52-55 u wide at y -60..-100 against round 3's 56-61) with a small calf swell, and the hem DRAPES: it sits at
 * ~-43 at the outer side and falls to ~-37 across the heel and the inner side, so a rounded heel counter shows under it.
 */
const LEG_L: Pt[] = [
	[-80.5, -440], [3.5, -440], [3.5, -380], [2.1, -366, 'c'], [-2.6, -340], [-7.6, -300], [-12.2, -260], [-16.4, -222], [-16.8, -190],
	[-18, -160], [-19.9, -140], [-23, -100], [-25.2, -80], [-24, -62], [-25.4, -48], [-25.6, -37, 'c'],
	// the hem, draping from the inner side over the heel to the outer corner
	[-29, -36.6], [-40, -36.6], [-55, -37.4], [-64, -38.2], [-70.4, -40], [-73.8, -42.6], [-75, -47],
	[-74.8, -54], [-76.4, -62], [-74.6, -80], [-76.2, -100], [-77, -120], [-78.6, -140], [-79.4, -178], [-76.6, -202], [-74.4, -222],
	[-75.2, -260], [-76.6, -300], [-77, -340], [-77.6, -400],
];
/** One flat shadow tone: a ~10 u curved terminator under the shirt hem (v1: a 40 u band that read as a belt). Round 4 drops
 * the inseam band (the sheet's trousers are flat). */
const LEG_SHADOWS_L: Pt[][] = [[[-84.5, -446], [7.5, -446], [7.5, -425], [-40, -423.4], [-84.5, -428]]];
/** An open, curved jeans back-pocket line (repair round 1; v1 drew a closed flap rectangle). */
const POCKET_L: Pt[] = [[-59.5, -409], [-56, -394], [-46, -383.4], [-33, -383.4], [-23, -394], [-19.5, -409]];
/**
 * Back of the sneaker (repair round 4, outline centres of zoo_turn_back.png): a rounded heel counter that is narrow under
 * the hem (~-77 at y -40) and swells out to ~-96 near the sole, with a straight inner side at ~-24 (rounds 1-3: a
 * flat-topped box with vertical sides). Lines in the soft sneakerLine grey, as on the sheet: the midsole line and the
 * heel-counter seam that curves from under the hem down and out to the midsole (round 3's horizontal band and heel-tab line
 * are not on the sheet). No shadow band (the sheet's heels are flat off-white).
 */
// Repair round 5 (ZOO-S4): the inner side's bottom corner rounds like the outer heel (~5-6 u radius, as on the sheet's two
// heels); round 4 ran the inner wall straight down to a square corner at (-23.6, -5) -> (-26, -1.75).
const SHOE_L: Pt[] = [
	[-73.6, -48], [-50, -47], [-27.6, -45], [-25.6, -36], [-25, -28], [-24.4, -20], [-23.9, -13.4], [-24.2, -8], [-25.6, -4.4], [-29, -1.9],
	[-34, -1.75], [-60, -1.75],
	// round 6: the outer heel rounds into the flat bottom through extra points (round 4-5's tangent at (-93, -1.9) overshot
	// ~2.4 u past the heel as a small hook)
	[-82, -1.75], [-90.4, -1.85], [-94.6, -3.4], [-96.4, -6.4], [-96.6, -11], [-96, -17], [-94.4, -22], [-91.8, -25.8], [-88, -28.6], [-83.4, -31.4], [-79.2, -34.8], [-76.4, -39.4], [-75.2, -43.6],
];
const SHOE_SOLE_L: Pt[] = [[-100, -11], [-56.5, -10.8], [-15, -11], [-15, 2], [-100, 2]];
const SHOE_LINES_L: Pt[][] = [
	[[-99, -11.2], [-60, -10.8], [-20, -11.2]], // midsole
	[[-70.6, -36], [-72.6, -27.6], [-76.4, -20], [-80.8, -12.4]], // heel-counter seam
];
const SHOE_LINE_W = [ZOO_LINE.detail * 1.15, ZOO_LINE.detail * 0.9];

/**
 * The anatomical-right leg (screen right from behind) is the left one mirrored about LEG_AXIS, then authored for this view
 * below the knee (repair round 3): the sheet's legs are not mirror images there. Its right shin leans ~5 u toward the
 * centre by the ankle (`leanR`, the shoe moves with it) and its outer edge is ~3.5 u slimmer from the knee down
 * (`slimR`): silhouette 78.7 at y -100 and heel ~89 at y -30, against the sheet's 77.9 / 89.3 (round 2: 85 / 97).
 */
const leanR = (y: number) => -5 * smoothstep((y + 300) / 260);
// Repair round 4: the slimming eases off over the hem (to 40% at the hem's outer corner), where the sheet's right trouser
// meets the heel at ~75 (silhouette), so the heel counter flows out of the trouser edge instead of from a notch.
const slimR = (y: number) => -3.5 * smoothstep((y + 340) / 120) * (1 - 0.6 * smoothstep((y + 70) / 26));
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
					<path d={smooth(ms(SHOE_SOLE_L))} fill={ZOO_COLORS.sneakerSole} />
					{SHOE_LINES_L.map((l, i) => (
						<Stroke key={i} d={line(ms(l))} width={SHOE_LINE_W[i]} color={ZOO_COLORS.sneakerLine} />
					))}
				</Clipped>
				<Outline d={shoe} />
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
