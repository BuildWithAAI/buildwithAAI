/**
 * ZOO body in PROFILE facing SCREEN RIGHT (reference/crops/zoo_turn_side.png). The viewer sees the
 * anatomical RIGHT side. The overshirt's front edge (the anatomical-right panel's placket) carries
 * the five silver buttons; the jellyfish pin is on the anatomical LEFT chest, on the far side, so it
 * is hidden in this view (the sheet hides it too). The far arm and far leg are hidden behind the body
 * and the near leg, as on the sheet.
 *
 * Layers, back to front: leg + shoe, collar stand, neck, shirt body, collar leaf, near arm + hand.
 */
import React from 'react';
import {ZOO_COLORS} from '../../../palette';
import {line, smooth, type Pt} from '../../geometry';
import {ZOO_LINE} from '../../lines';
import {Button} from '../threeQuarter/Body34';
import {HandDrawing, type HandDrawingSpec} from '../../parts/Hand';
import {Clipped, Outline, Shape, Stroke} from '../../parts/Shape';

// ---------------------------------------------------------------- shirt
const SHIRT: Pt[] = [
	[-40, -737.6], [-46.6, -730], [-49, -720], [-53, -710], [-57, -701], [-61.6, -692], [-66.6, -682], [-71, -670], [-74, -658],
	[-76.2, -645], [-77, -630], [-77, -600], [-77, -560], [-77.4, -520], [-78, -480], [-78.4, -450], [-77.6, -430.6, 'c'],
	[-40, -427.8], [0, -425.8], [40, -424], [59.6, -423.2, 'c'], [59.4, -440], [58.8, -470], [57.8, -500], [56.2, -540],
	[54.4, -570], [52.4, -600], [49.6, -625], [45.6, -645], [40.4, -662], [35.6, -675], [32.6, -692], [30.4, -704], [24, -711],
];
const SHIRT_SHADOW = smooth([[-80, -700], [-60, -700], [-66, -640], [-68, -560], [-66, -430], [-80, -420]]);
/** The near panel's placket line, ~7 u inside the front edge, and the buttons along it (front-view heights). */
const PLACKET = line([[24, -700], [30, -680], [38.6, -655], [45, -630], [49.6, -600], [52.4, -560], [53.4, -520], [53.4, -470], [53, -432]]);
/** Front-view button heights (repair round 1: top button -672, ZOO-V3 revised), placed along the placket. */
const BUTTONS: Pt[] = [[35.4, -672], [43.8, -622], [50.8, -565], [52.8, -508], [53.2, -452]];

/** The collar band seen from the side: top edge from the back of the neck down to the front, point at the front. */
const COLLAR: Pt[] = [
	[-45.6, -737.4, 'c'], [-30, -733], [-15, -727.4], [0, -721.4], [12, -715.4], [22, -710], [28.6, -705], [30.4, -697],
	[28.8, -688.4, 'c'], [22, -692.6], [12, -697.6], [0, -704.4], [-15, -711], [-30, -715.6], [-44, -718.6], [-48.4, -726],
];
const COLLAR_SHADOW = smooth([[-48, -718], [-30, -714], [-15, -709], [0, -702], [12, -695], [24, -690], [30, -686], [26, -680], [0, -690], [-30, -702], [-52, -706]]);
/** Inside of the collar behind the neck (only its top sliver shows above the band at the back). */
const COLLAR_INSIDE = smooth([[-46, -733], [-40, -741], [-24, -738], [-8, -731], [6, -724], [16, -718], [10, -712], [-20, -724], [-40, -728]]);

export const CollarStandSide: React.FC = () => <Shape name="collarBack" d={COLLAR_INSIDE} fill={ZOO_COLORS.overshirtShadow} />;

export const TorsoSide: React.FC = () => (
	<g data-part="torso" data-view="side">
		<Shape name="overshirt" d={smooth(SHIRT)} fill={ZOO_COLORS.overshirt} shadow={{d: SHIRT_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
		<Stroke d={PLACKET} width={ZOO_LINE.fine} />
		<g data-part="buttons">
			{BUTTONS.map(([x, y]) => (
				<Button key={y} x={x} y={y} r={3.7} rx={2.8} />
			))}
		</g>
		<path data-part="collarShadow" d={COLLAR_SHADOW} fill={ZOO_COLORS.overshirtShadow} />
		<Shape name="collarR" d={smooth(COLLAR)} fill={ZOO_COLORS.overshirt} />
	</g>
);

// ---------------------------------------------------------------- near arm (anatomical right)
const SLEEVE: Pt[] = [
	[-52, -688], [-42, -696], [-26, -697.6], [-10, -694.6], [2, -690], [11, -683], [17.4, -671], [23, -655], [26.6, -630], [27.4, -600],
	[26, -570], [23.6, -540], [21, -510], [18.6, -485], [17, -465], [17.4, -453], [24, -449], [26.6, -440], [26, -428], [22, -423.6, 'c'],
	[-8, -421.4], [-33, -423.6, 'c'], [-37, -434], [-37.6, -447], [-34.4, -453], [-40.6, -470], [-48.4, -490], [-55, -520], [-59, -560],
	[-61, -600], [-61, -640], [-58, -670],
];
const SLEEVE_SHADOW = smooth([[-64, -686], [-50, -690], [-50, -640], [-48, -560], [-38, -480], [-26, -456], [-40, -420], [-66, -420]]);
const CUFF_SEAM = line([[-35.6, -452], [-10, -454.4], [18.4, -451.6]]);
const ARMHOLE = line([[-46, -694], [-52, -678], [-55, -660]]);
const ELBOW = line([[-46, -528], [-38, -520], [-30, -516]]);
export const WRIST_SIDE = {x: -6, y: -422} as const;
export const SHOULDER_SIDE = {x: -18, y: -690} as const;

/**
 * Anatomical RIGHT hand seen from its outer side (back of the hand). Repair round 3, row-mapped on zoo_turn_side.png at
 * 1 u: the back of the hand widens from the cuff to ~47 u and the four fingers TOUCH all the way down. They are parted by
 * three warm-brown creases from the knuckle line (y ~-364) to the tips (HAND_LINES), and the silhouette shows only small
 * rounded tip lobes: the notches between them reach just 3-6 u above the tips (~-337..-343). The fingers lean slightly
 * back toward their tips, which step: back finger ~-340, second ~-335, third lowest ~-331, front ~-336. Round 2 parted the
 * fingers with silhouette V-notches up to -366; the 3.5 u outline filled each 1-2 u notch, so the hand read as a
 * four-tine rake with near-black slits (6-7 u black wedges at the asset sheet's lineScale). No thumb lobe here (ZOO-V5).
 */
const HAND: Pt[] = [
	[-21, -424], [17, -424], [18.4, -412], [21.6, -404], [24.8, -397], [27.6, -390], [28.2, -380], [28, -366], [27.6, -356],
	[26.8, -348], [25.4, -342], [23, -338.6], [19.8, -337], [16.8, -337.8], [14.4, -340.4, 'c'],
	// third finger (lowest tip)
	[12.6, -336.4], [9.8, -333.4], [6.4, -332.4], [3.4, -333.4], [1.6, -335.6], [0.8, -338.6, 'c'],
	// second finger
	[-0.8, -336.8], [-3.6, -335.8], [-6.6, -336.6], [-8.4, -339.2], [-9.8, -343.4, 'c'],
	// back finger, then the back edge up to the cuff
	[-12.4, -341.8], [-14.8, -341.4], [-17.6, -342.6], [-19.2, -345.8], [-19.2, -350.4], [-17.8, -358], [-17.6, -366],
	[-18.8, -376], [-20.6, -388], [-21.6, -402], [-21.4, -414],
];
/** One flat terminator along the front edge (no full-height band). */
const HAND_SHADOW = [[21, -412], [30, -400], [30.4, -362], [27.4, -344], [24, -338], [24.4, -360], [24.8, -392]] as Pt[];
/**
 * The finger separations as interior creases (repair round 3), placed on the sheet's crease lines (x ~-5 / 7 / 19.5 at
 * y -360, leaning back toward the tips), each drawn from its tip notch up to the knuckle line: tapered, warm brown, at
 * ZOO_LINE.detail (HandDrawing taper). The sheet's are 2-3 u mid-tone creases with no dark slits.
 */
const HAND_LINES: Pt[][] = [
	[[14.4, -340.4], [16.6, -344.6], [18.6, -351], [19.4, -358], [19.4, -364]],
	[[0.8, -338.6], [4, -343], [6.2, -350], [7, -357.4], [7, -364]],
	[[-9.8, -343.4], [-7.4, -349.2], [-6, -356], [-5.4, -364]],
];
const SIDE_HAND: HandDrawingSpec = {outline: HAND, shadow: HAND_SHADOW, lines: HAND_LINES, lineWidth: ZOO_LINE.detail, taper: 0.4};

export const ArmSide: React.FC = () => (
	<g data-part="armR">
		<HandDrawing hand={SIDE_HAND} name="handR" />
		<Shape name="sleeveR" d={smooth(SLEEVE)} fill={ZOO_COLORS.overshirt} shadow={{d: SLEEVE_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
		<Stroke d={CUFF_SEAM} width={ZOO_LINE.detail} />
		<Stroke d={ARMHOLE} width={ZOO_LINE.fine} />
		<Stroke d={ELBOW} width={ZOO_LINE.fine} />
		<Button x={-26} y={-433} r={3} />
	</g>
);

// ---------------------------------------------------------------- leg and shoe
const LEG: Pt[] = [
	[-74, -440], [46, -440], [45.6, -420], [42.4, -395], [38.6, -365], [35, -335], [30.6, -300], [26.4, -272], [22.4, -250], [19, -225],
	[15, -205], [11, -185], [7.6, -160], [5, -130], [2, -108], [0.4, -95], [4.2, -82], [4.4, -66], [2.6, -52.6, 'c'], [-20, -46],
	[-45, -42.6], [-66.6, -43.6, 'c'], [-67.4, -60], [-66.4, -80], [-65, -100], [-67.6, -130], [-67.6, -175], [-64.6, -195],
	[-60.6, -210], [-58, -230], [-54.6, -250], [-56.4, -275], [-56.6, -310], [-57.4, -345], [-57, -375], [-60, -388], [-66, -405],
	[-69, -425],
];
const LEG_SHADOW = [
	smooth([[-80, -446], [50, -446], [50, -410], [-80, -404]]),
	smooth([[-56, -300], [-56, -250], [-60, -215], [-66, -190], [-68, -130], [-66, -80], [-67, -40], [-50, -40], [-50, -100], [-46, -200], [-44, -300]]),
].join(' ');
const LEG_CREASE = line([[-6, -404], [-12, -320], [-18, -240], [-24, -160], [-28, -100], [-30, -64]]);

// Repair round 1 (zoo_turn_side.png): toe extended ~12 u to x ~78 and rounded, toe box ~30 u tall (v1 was 142 u long with a
// low pointed toe; the sheet's shoe is ~156 u).
// Repair round 3 (column and row scans of zoo_turn_side.png, outline centres): the instep falls more steeply from the
// collar to a flat toe cap (top at -37 / -32 / -30.6 / -27.7 at x 30 / 40 / 46 / 62) and the toe ends in a tall, round
// front face at x ~73-74 from y -22 down to the sole (front edge 59 / 72 / 75 at y -30 / -22 / -15 against the sheet's
// 59-61 / 72-73 / 75-76). Round 2's long low toe ran ~6 u further forward at every height (73 / 79 / 81) and its top
// sat 3-6 u above the sheet's, so the sneaker read as a slipper.
const SHOE: Pt[] = [
	[-71, -42], [-60, -40], [-45, -39], [-30, -41.4], [-16, -46.4], [-4, -53], [4, -55.4], [12, -49.8], [20, -43.4], [30, -37.4],
	[40, -32.6], [48, -30.8], [56, -29.4], [62, -27.8], [66.4, -25.6], [70, -22], [72.6, -16.8], [73.8, -10.8], [73.4, -5.4],
	[70.4, -1.75], [0, -1.75], [-66, -1.75], [-71.4, -6], [-72.4, -22], [-71.6, -34],
];
const SHOE_SOLE: Pt[] = [[-76, -11], [0, -10.4], [76, -11.2], [76, 2], [-76, 2]];
const SHOE_SHADOW: Pt[] = [[-76, -44], [-58, -44], [-56, -26], [-60, -11], [-76, -11]];
const SHOE_LINES: Pt[][] = [
	[[-71.4, -10.8], [0, -10.2], [72, -11]],
	[[8, -49], [14, -45.4]],
	[[14, -43.6], [21, -40]],
	[[21, -39], [28, -35.4]],
	[[44, -24], [58, -22.6], [67.6, -22.2]],
	[[-70, -34], [-58, -31], [-52, -22]],
];

export const LegSide: React.FC = () => {
	const shoe = smooth(SHOE);
	return (
		<g data-part="legs" data-view="side">
			<g data-part="shoeR">
				<path d={shoe} fill={ZOO_COLORS.sneaker} />
				<Clipped clip={shoe}>
					<path d={smooth(SHOE_SHADOW)} fill={ZOO_COLORS.sneakerShadow} />
					<path d={smooth(SHOE_SOLE)} fill={ZOO_COLORS.sneakerSole} />
				</Clipped>
				<Outline d={shoe} />
				{SHOE_LINES.map((l, i) => (
					<Stroke key={i} d={line(l)} width={i === 0 ? ZOO_LINE.detail : ZOO_LINE.fine} />
				))}
			</g>
			<Shape name="legR" d={smooth(LEG)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
			<Stroke d={LEG_CREASE} width={ZOO_LINE.fine} color={ZOO_COLORS.trousersShadow} />
		</g>
	);
};
