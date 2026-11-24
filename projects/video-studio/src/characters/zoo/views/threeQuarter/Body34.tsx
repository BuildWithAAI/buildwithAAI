/**
 * ZOO body, 3/4 view turned to SCREEN RIGHT (reference/crops/zoo_turn_34.png). Drawn for this view,
 * never flipped from the front. NEAR side = anatomical RIGHT (screen left); FAR side = anatomical
 * LEFT (screen right). The open overshirt shows the near panel (anatomical right, carrying the five
 * silver buttons along its front edge), a strip of the black tee, and the narrower far panel
 * (anatomical left) with the chest pocket and the teal jellyfish pin above it.
 *
 * Layers, back to front: far arm + far hand, far leg + shoe, near leg + shoe, collar stand, neck,
 * tee, far panel (pocket, pin), near panel (buttons), collar leaves, near arm + near hand.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../../palette';
import {line, smooth, type Pt} from '../../geometry';
import {HandDrawing, type HandDrawingSpec} from '../../parts/Hand';
import {JellyfishPin} from '../../parts/Pin';
import {ZOO_LINE} from '../../lines';
import {Clipped, Outline, Shape, Stroke, useLineScale} from '../../parts/Shape';

// ---------------------------------------------------------------- neck and collar
// Repair round 1: every point above the collar line moved down ~7 u (full at y <= -705, none below -685) so the tee
// neckline, collar and shoulder line sit where zoo_turn_34.png has them (as in the front view).
// Repair round 2: the throat's top edge tucks UNDER the jaw (0.5-1.5 u above Head34's jaw line, so the face covers it);
// round 1 stopped it ~6 u below the jaw, which left a sliver of background and a second outline under the chin.
const NECK: Pt[] = [
	[-28, -773], [-31.6, -761], [-33.8, -747], [-34.8, -733], [-35.6, -721], [-30, -712], [-12, -704.6], [6, -703.4],
	[22, -707], [26, -724], [24, -734], [18, -739], [6, -743], [-8, -750],
];
/**
 * Jaw shadow (repair round 2): a crescent ~5 u deep under Head34's jaw line plus a thin strip under the hair at the nape;
 * round 1's 12-20 u diagonal band read as a strap across the neck.
 */
const NECK_SHADOW = smooth([
	[50, -790], [50, -735], [35.6, -731.6], [27, -731], [18.4, -732.4], [10, -735.4], [1.4, -739.8], [-7.6, -745.4], [-15.2, -751.6],
	[-22, -758.6], [-30, -760], [-40, -758], [-40, -790],
]);
const COLLAR_BACK = smooth([[-48, -713], [-46.6, -724], [-40, -730], [-26, -732.6], [-6, -731.6], [12, -728], [26, -722], [32, -714], [20, -706], [-30, -709]]);

export const Neck34: React.FC = () => <Shape name="neck" d={smooth(NECK)} fill={ZOO_COLORS.skin} shadow={{d: NECK_SHADOW, fill: ZOO_COLORS.skinShadow}} />;
export const CollarBack34: React.FC = () => <Shape name="collarBack" d={COLLAR_BACK} fill={ZOO_COLORS.overshirtShadow} />;

// ---------------------------------------------------------------- torso
const TEE = smooth([
	[-12, -709], [0, -704], [15, -702.6], [28, -705.6], [37, -711], [38, -688.2], [37, -600], [36, -446], [18, -446.6], [0, -447.6],
	[-8, -449], [-8, -600], [-9, -694.8],
]);
const TEE_RIB = line([[-6, -704.4], [6, -699.8], [18, -699.6], [29, -703.6]]);

/** Near panel (anatomical right front, buttons on its front edge). Its back half hides under the near sleeve. */
const PANEL_NEAR: Pt[] = [
	[-48, -720], [-60, -709.6], [-76, -701.4], [-92, -695.4], [-104, -690.9], [-110, -686.3], [-111, -640], [-105, -560], [-99, -480],
	[-93, -440], [-85, -432.6], [-60, -429], [-32, -425], [-10, -420.8], [-2.6, -420.6], [0.6, -425], [0.8, -460], [0.8, -600],
	[0.4, -688.2], [-1.8, -696.7], [-6, -704], [-18, -710.6], [-33, -716.6],
];
const PANEL_NEAR_SHADOW = smooth([[-90, -694.8], [-60, -705], [-40, -694.8], [-50, -684], [-70, -676], [-90, -672]]);
/** Far panel (anatomical left front: pocket + pin). */
const PANEL_FAR: Pt[] = [
	[29, -717], [40, -709], [52, -699.4], [64, -694.4], [75, -690.6], [83.6, -686], [87.4, -676], [86.6, -650], [84.4, -600],
	[82.6, -540], [81.6, -480], [81, -440], [78.6, -426], [70, -423], [50, -421], [36, -421.4], [31.2, -424.4], [30.4, -440],
	[30.2, -600], [29.8, -688.2], [28.4, -705],
];
const PANEL_FAR_SHADOW = smooth([[70, -694.8], [92, -688.2], [92, -420], [68, -420], [71, -520], [73, -620]]);
// Repair round 1 (zoo_turn_34.png): pocket and pin ~9 u nearer the far edge (pocket x 54..77, pin centre x 61).
const POCKET = smooth([[54.4, -640.4, 'c'], [77, -640.4, 'c'], [77, -600, 'c'], [66, -589.4, 'c'], [54.4, -599.6, 'c']]);
const POCKET_HEM = line([[54.8, -632.6], [76.6, -632.6]]);
const BUTTON_X = -6.4;
/** Same heights as the front view (decision ZOO-V3, revised in repair round 1: top button -672). */
const BUTTON_Y = [-672, -622, -565, -508, -452];
export const PIN34 = {x: 61, y: -660, sx: 0.86} as const;

const COLLAR_NEAR: Pt[] = [
	[-43.6, -727.6], [-48.8, -717], [-46, -701], [-38.6, -688.6, 'c'], [-28, -691.5], [-16, -695.4], [-5, -700.6], [1.4, -705.4, 'c'],
	[-12, -709.6], [-27, -716], [-39, -724],
];
const COLLAR_NEAR_SHADOW: Pt[] = [[-48, -699], [-38.6, -687], [-26, -689.9], [-10, -694.1], [-2, -697.4], [-6, -688.2], [-24, -682], [-42, -680]];
const COLLAR_FAR: Pt[] = [[26.6, -722], [33.6, -713], [40, -698], [45.4, -688.9, 'c'], [39.6, -691.8], [33.4, -696.7], [29, -704], [25.6, -713]];

/** A small silver button with a fine outline (line width follows lineScale). */
export const Button: React.FC<{x: number; y: number; r: number; rx?: number}> = ({x, y, r, rx}) => {
	const ls = useLineScale();
	return rx ? (
		<ellipse cx={x} cy={y} rx={rx} ry={r} fill={ZOO_COLORS.buttons} stroke={LINE.color} strokeWidth={ZOO_LINE.fine * 0.8 * ls} />
	) : (
		<circle cx={x} cy={y} r={r} fill={ZOO_COLORS.buttons} stroke={LINE.color} strokeWidth={ZOO_LINE.fine * 0.8 * ls} />
	);
};

export const Torso34: React.FC = () => (
	<g data-part="torso" data-view="threeQuarter">
		<Shape name="tee" d={TEE} fill={ZOO_COLORS.tee} />
		<Stroke d={TEE_RIB} width={LINE.detailWidth * 0.8} color={ZOO_COLORS.overshirt} />
		<Shape name="overshirtLeftPanel" d={smooth(PANEL_FAR)} fill={ZOO_COLORS.overshirt} shadow={{d: PANEL_FAR_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
		<g data-part="pocket">
			<Outline d={POCKET} width={ZOO_LINE.detail} />
			<Stroke d={POCKET_HEM} width={ZOO_LINE.fine} />
		</g>
		<g transform={`translate(${PIN34.x} 0) scale(${PIN34.sx} 1) translate(${-PIN34.x} 0)`}>
			<JellyfishPin x={PIN34.x} y={PIN34.y} />
		</g>
		<Shape name="overshirtRightPanel" d={smooth(PANEL_NEAR)} fill={ZOO_COLORS.overshirt} shadow={{d: PANEL_NEAR_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
		<g data-part="buttons">
			{BUTTON_Y.map((y) => (
				<Button key={y} x={BUTTON_X} y={y} r={3.7} />
			))}
		</g>
		<path data-part="collarShadow" d={smooth(COLLAR_NEAR_SHADOW)} fill={ZOO_COLORS.overshirtShadow} />
		<Shape name="collarR" d={smooth(COLLAR_NEAR)} fill={ZOO_COLORS.overshirt} />
		<Shape name="collarL" d={smooth(COLLAR_FAR)} fill={ZOO_COLORS.overshirt} />
	</g>
);

// ---------------------------------------------------------------- arms
/** Near sleeve (anatomical right), hanging in front of the near side of the body. */
const SLEEVE_NEAR: Pt[] = [
	[-92, -695.4], [-104, -690.9], [-112, -686], [-118.4, -677], [-123.4, -664], [-127.4, -650], [-130.4, -628], [-133.4, -604], [-136.2, -576],
	[-138.6, -548], [-140, -520], [-139.2, -500], [-136.4, -480], [-132.6, -463], [-130.6, -455], [-129.8, -440], [-128.8, -419.4, 'c'],
	[-105, -416.8], [-82.4, -418.4, 'c'], [-82.8, -440], [-84, -455.4], [-86, -480], [-87.8, -520], [-88.4, -560], [-87, -600],
	[-84.6, -630], [-83.8, -650], [-85.6, -668], [-88.6, -685.6],
];
const SLEEVE_NEAR_SHADOW = smooth([[-96, -684], [-86, -692], [-80, -640], [-80, -420], [-98, -420], [-100, -520], [-98, -620]]);
const CUFF_NEAR = line([[-131, -455.4], [-108, -457.4], [-84, -455.8]]);
const ELBOW_NEAR = line([[-123.4, -616], [-120.4, -590], [-121.2, -566]]);
/** Far sleeve (anatomical left): only its outer half shows, behind the far panel. */
const SLEEVE_FAR: Pt[] = [
	[66, -692.8], [79, -689.5], [86.6, -682], [89.8, -664], [91.8, -640], [94, -612], [96.8, -582], [99.4, -555], [101.6, -525],
	[103.2, -500], [104.6, -478], [104.8, -462], [103.8, -455], [103.6, -440], [103, -419.4, 'c'], [89, -417], [75.6, -418.6, 'c'],
	[75.6, -440], [75.8, -455], [74, -500], [72, -600], [64, -680],
];
const SLEEVE_FAR_SHADOW = smooth([[60, -700], [80, -700], [86, -640], [84, -420], [60, -420]]);
const CUFF_FAR = line([[75.8, -455.4], [90, -456.6], [104, -455.2]]);

/** Wrist pivots (cuff bottom centre) used to hang the hands. */
export const WRIST34 = {near: {x: -98.4, y: -418}, far: {x: 87.6, y: -418}} as const;

const Sleeve: React.FC<{d: string; shadow: string; cuff: string; extra?: string; name: string}> = ({d, shadow, cuff, extra, name}) => (
	<g data-part={name}>
		<Shape d={d} fill={ZOO_COLORS.overshirt} shadow={{d: shadow, fill: ZOO_COLORS.overshirtShadow}} />
		<Stroke d={cuff} width={LINE.detailWidth} />
		{extra ? <Stroke d={extra} width={LINE.detailWidth} /> : null}
	</g>
);

/**
 * 3/4 hands (repair round 2), drawn for this view from zoo_turn_34.png (skin edges row-scanned); round 1 mapped the front
 * palm drawing here, so the front thumb notch showed. Near = anatomical RIGHT hand: the BACK of the hand, ~48 u wide, four
 * fingers pointing down with their tips stepping (little finger shortest, index longest) and the thumb as a shorter lobe
 * on the inner side; thin warm-brown separations run up from the tip notches. Far = anatomical LEFT hand: seen from its
 * little-finger side, the back of the hand with the fingers curled toward the body (tip lobes at the lower left) and one
 * soft crease where they fold. Neither is a mirror of the other or of another view's hand.
 */
const NEAR_HAND: HandDrawingSpec = {
	outline: [
		[-112.6, -422], [-84, -422], [-80.4, -414], [-76.6, -408], [-71.8, -400.4], [-67.6, -393], [-65, -385], [-63, -376], [-62.4, -366],
		[-62.8, -358], [-64.4, -352.8], [-67.2, -351.2], [-69.8, -353.4, 'c'], [-70.2, -347.6], [-70.8, -340.4], [-72.4, -334.8],
		[-75.6, -331.2], [-79.4, -330.8], [-81.8, -333, 'c'], [-84, -331.2], [-87.2, -330.8], [-90.4, -332.2], [-92.4, -334.6],
		[-93.8, -337.4, 'c'], [-95.8, -336], [-98.8, -336.4], [-101, -339.4], [-102.4, -344, 'c'], [-104, -346], [-106.6, -346.6],
		[-108.8, -349.6], [-110.8, -356], [-112.4, -364], [-113, -376], [-113, -392], [-112.8, -406],
	],
	shadow: [[-56, -424], [-78, -422], [-73.6, -406], [-69.4, -396], [-67.4, -384], [-66.8, -370], [-56, -360]],
	// The sheet's separations run from the knuckle line (y ~-363) to the tip notches.
	lines: [
		[[-102.4, -344], [-103.4, -353], [-104, -362]],
		[[-93.8, -337.4], [-94.8, -350], [-95.4, -362.6]],
		[[-81.8, -333], [-82.6, -347], [-83, -362]],
		[[-69.8, -353.4], [-70.4, -365], [-71, -376]],
	],
};
/**
 * Far hand, repair round 4 (decision ZOO-V9; zoo_turn_34.png skin runs scanned row by row): the curled fingers now end in
 * separate rounded tips at the lower left, as on the sheet: the middle finger runs diagonally down to a tip at (64, -339),
 * the index tip sits above it at (64, -350), and the THUMB's tip shows between them and the fold (its lower edge is the
 * crease that continues up the fold to the knuckles). The little-finger side ends lowest (~-332). The creases are tapered
 * warm-brown lines (round 3: one untapered fold line and two short ticks, with a 33 u wide back of the hand; now ~31 u,
 * the sheet's 30).
 */
const FAR_HAND: HandDrawingSpec = {
	outline: [
		[73.4, -424], [97.6, -424], [98.2, -412], [99.6, -402], [100.6, -394], [101.4, -386], [102.6, -379], [103.1, -373], [102.6, -368],
		[100.8, -364], [99.4, -360], [98, -356], [96.2, -351.6], [94.2, -347.6], [91.6, -343.8], [88.6, -340.4], [85.2, -337], [81.4, -334],
		[77.6, -332], [74.6, -331.8], [72.4, -333.4], [71.6, -336.4],
		// the middle finger's tip
		[69.6, -336], [66.6, -336.2], [64.2, -337.8], [63.6, -340.6], [64.6, -343.4], [66.8, -345.4],
		// the index tip
		[64.6, -347], [63.8, -349.6], [64.4, -352.4], [66.4, -354.4], [69.2, -354.8],
		// up the thumb's outer edge and the side of the hand
		[70.4, -357.4], [69.6, -361], [69.4, -366], [69.6, -372], [70.2, -380], [70.6, -390], [71.2, -400], [72.2, -408], [73, -416],
	],
	shadow: [[110, -426], [97.4, -424], [98, -404], [97.8, -384], [96, -368], [110, -362]],
	lines: [
		// the thumb tip's lower edge, continuing up the fold toward the knuckles
		[[69.8, -355.4], [72.6, -352.8], [75.8, -352.6], [78, -354.6], [79.6, -358.4], [81.2, -364.4], [83.2, -372.4], [85.4, -381]],
		// between the middle finger and the little-finger side
		[[71.6, -336.4], [73.8, -340], [77.2, -344], [80.8, -348], [83.6, -352.6], [85.6, -357.6]],
		// under the index tip
		[[66.8, -345.4], [69.6, -346.2], [72.8, -348.4]],
	],
	lineWidth: ZOO_LINE.detail * 1.15,
	taper: 0.45,
};

export const FarArm34: React.FC = () => (
	<g data-part="armL">
		<HandDrawing hand={FAR_HAND} name="handL" />
		<Sleeve d={smooth(SLEEVE_FAR)} shadow={SLEEVE_FAR_SHADOW} cuff={CUFF_FAR} name="sleeveL" />
	</g>
);

export const NearArm34: React.FC = () => (
	<g data-part="armR">
		<HandDrawing hand={NEAR_HAND} name="handR" />
		<Sleeve d={smooth(SLEEVE_NEAR)} shadow={SLEEVE_NEAR_SHADOW} cuff={CUFF_NEAR} extra={ELBOW_NEAR} name="sleeveR" />
		<Button x={-125.4} y={-436} r={2.8} />
	</g>
);

// ---------------------------------------------------------------- legs and shoes
const LEG_NEAR: Pt[] = [
	[-92, -440], [-10, -440], [-12, -330], [-14.6, -272], [-18.6, -250], [-24.6, -229], [-27, -207], [-35.6, -172], [-38, -146],
	[-41.6, -120], [-45.4, -90], [-45.6, -66], [-47.4, -54], [-49.4, -48.6, 'c'],
	// repair round 4: the hem drapes (zoo_turn_34.png): high over the instep (~-53.5), down to ~-41 at the outer heel side
	[-54, -50.4], [-60, -53], [-67, -54], [-74, -52.2], [-80, -48.4], [-86, -44.2], [-93, -41.6], [-101.6, -41.2, 'c'], [-102.6, -56], [-102, -70], [-100, -86],
	[-99.6, -160], [-97.6, -188], [-94.2, -210], [-86.6, -236], [-86.6, -270], [-86, -330], [-89, -400],
];
const LEG_NEAR_SHADOW = [
	smooth([[-100, -446], [0, -446], [0, -410], [-40, -405], [-100, -408]]),
	smooth([[-12, -330], [-14.6, -272], [-24.6, -229], [-35.6, -172], [-41.6, -120], [-46, -56], [-56, -56], [-50, -150], [-36, -240], [-24, -330]]),
].join(' ');
const LEG_FAR: Pt[] = [
	[-12, -440], [66, -440], [64.4, -380], [61.6, -326], [59, -306], [57.6, -294], [54.6, -282], [53.4, -265], [50, -244],
	[49.2, -222], [45, -198], [41.4, -176], [39.6, -138], [38.2, -110], [37.4, -96], [39.6, -81], [38.4, -64], [39, -57.4, 'c'],
	// repair round 4: the hem slopes down from the instep (~-57) to the heel (~-46), as on zoo_turn_34.png
	[30.4, -53.4], [20, -48], [8, -44], [-4, -42.4], [-15.2, -43.2, 'c'], [-15.8, -60], [-15.6, -80], [-17, -108], [-17, -180], [-14.6, -196], [-14, -230], [-12, -300],
];
const LEG_FAR_SHADOW = smooth([[66, -446], [-14, -446], [-14, -410], [30, -404], [66, -408]]) + ' ' + smooth([[-17, -300], [-17, -56], [0, -56], [-4, -200], [-6, -300]]);

/**
 * Near sneaker, a 3/4 front view (toe turned toward the viewer and screen right). Repair round 2 (zoo_turn_34.png): the toe
 * box runs on to a round nose at x ~-22, over the far shoe's heel, as on the sheet (round 1 stopped at ~-36: a short clog).
 */
const SHOE_NEAR: Pt[] = [
	[-106, -38.6], [-100, -46.4], [-88, -53.4], [-73, -56.6], [-58, -55], [-50, -50], [-44.6, -43], [-40.8, -36.4], [-36.8, -30.4],
	[-30.6, -26], [-22.8, -21.6], [-17.6, -17.2], [-14.6, -11.8], [-13.6, -6.6], [-15.2, -2.6], [-22, -1.75], [-72, -1.75], [-104, -1.9], [-107.4, -8], [-107.6, -24],
];
const SHOE_NEAR_SOLE: Pt[] = [[-110, -12.4], [-72, -11.6], [-10, -12.2], [-10, 2], [-110, 2]];
/**
 * Near sneaker line art (repair round 4, decision ZOO-S3; zoo_turn_34.png): in the soft sneakerLine grey, the midsole line,
 * the lace panel on the instep (its inner edge and three bars, each lower one set toward the toe) and the vamp seam that
 * rises from the midsole at the heel side, runs under the lace panel and follows the toe cap round to the front (round 3:
 * two near-black dashes and one toe line on a plain slipper, with a grey shadow band down the heel side).
 */
const SHOE_NEAR_LINES: Pt[][] = [
	[[-110, -11.8], [-72, -11.2], [-8, -11.8]], // midsole
	[[-85.6, -48.6], [-81, -38.8], [-75.4, -29.6]], // lace panel edge
	[[-84, -46.6], [-72, -47.8], [-60.6, -47]], // laces
	[[-81.4, -41], [-69.6, -41.8], [-58.2, -41.2]],
	[[-78.6, -35.4], [-67.4, -36], [-56.6, -35.6]],
	[[-94, -11.6], [-88.4, -16], [-82.4, -22], [-76.6, -27.4], [-66, -30.2], [-53.6, -28.8], [-40, -25.4], [-29, -21.6], [-21, -16.4], [-16.6, -12.2]], // vamp / toe cap
];
/** Far sneaker in profile pointing screen right; its heel tucks behind the near shoe. */
// Repair round 2: a rounder, slightly shorter toe (round 1 tapered to a low point at x ~107: a pointed slipper).
// Repair round 4 (zoo_turn_34.png outline centres): the heel's back edge is flush with the far trouser leg (~-16 at y -42,
// slanting to ~-20 at -24, then hidden behind the near toe); round 3's heel reached x -40 and its top showed as a bump
// between the legs.
const SHOE_FAR: Pt[] = [
	[-15.6, -50], [-4, -55], [16, -57.6], [32, -57], [44, -52], [60, -44.4], [76, -38.4], [88, -33.4], [96.4, -29],
	[101.6, -22.6], [103.4, -14], [101.8, -6], [97, -1.75], [60, -1.75], [-14, -1.75], [-19.6, -3.4], [-21, -12], [-20.2, -20], [-18.8, -28], [-17.4, -36], [-16.4, -43],
];
const SHOE_FAR_SOLE: Pt[] = [[-26, -12.6], [30, -12], [108, -12.6], [108, 2], [-26, 2]];
/** Far sneaker line art (repair round 4, zoo_turn_34.png): the midsole line, the laces as four short dashes down the instep
 * (the sheet's row of lace marks along the eyestay) and the toe-cap seam curving down to the midsole (round 3: near-black
 * dashes on a plain upper). */
const SHOE_FAR_LINES: Pt[][] = [
	[[-24, -12.8], [30, -12.2], [106, -12.8]], // midsole
	[[39.4, -50.8], [43.4, -48.8]], // laces
	[[46.4, -47.4], [50.4, -45.4]],
	[[53.4, -44], [57.4, -42.2]],
	[[60.4, -40.6], [64.4, -38.8]],
	[[74, -33.4], [69.8, -26.4], [66.2, -19.6], [64.4, -12.8]], // toe-cap seam
];

/** A 3/4 sneaker: off-white upper, lighter sole, soft grey line art clipped to the shoe (the first line is the midsole,
 * drawn a little heavier), near-black silhouette on top. No shadow band (repair round 4: the sheet's uppers are flat). */
export const Sneaker: React.FC<{outline: Pt[]; sole: Pt[]; lines: Pt[][]; name: string}> = ({outline, sole, lines, name}) => {
	const d = smooth(outline);
	return (
		<g data-part={name}>
			<path d={d} fill={ZOO_COLORS.sneaker} />
			<Clipped clip={d}>
				<path d={smooth(sole)} fill={ZOO_COLORS.sneakerSole} />
				{lines.map((l, i) => (
					<Stroke key={i} d={line(l)} width={i === 0 ? ZOO_LINE.detail * 1.15 : ZOO_LINE.detail * 0.9} color={ZOO_COLORS.sneakerLine} />
				))}
			</Clipped>
			<Outline d={d} />
		</g>
	);
};

/** The 3/4 sneakers on their own (the seated typing pose puts the feet in the same place). */
export const FarShoe34: React.FC = () => <Sneaker outline={SHOE_FAR} sole={SHOE_FAR_SOLE} lines={SHOE_FAR_LINES} name="shoeL" />;
export const NearShoe34: React.FC = () => <Sneaker outline={SHOE_NEAR} sole={SHOE_NEAR_SOLE} lines={SHOE_NEAR_LINES} name="shoeR" />;

export const Legs34: React.FC = () => (
	<g data-part="legs" data-view="threeQuarter">
		<Sneaker outline={SHOE_FAR} sole={SHOE_FAR_SOLE} lines={SHOE_FAR_LINES} name="shoeL" />
		<Shape name="legL" d={smooth(LEG_FAR)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_FAR_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
		<Sneaker outline={SHOE_NEAR} sole={SHOE_NEAR_SOLE} lines={SHOE_NEAR_LINES} name="shoeR" />
		<Shape name="legR" d={smooth(LEG_NEAR)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_NEAR_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
	</g>
);
