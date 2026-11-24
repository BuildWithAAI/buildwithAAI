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
import {JellyfishPin} from '../../parts/Pin';
import {Clipped, Shape, Stroke} from '../../parts/Shape';

// ---------------------------------------------------------------- neck and collar
const NECK: Pt[] = [
	[-28, -780], [-31.6, -768], [-33.8, -754], [-34.8, -740], [-35.6, -728], [-30, -719], [-12, -711.6], [6, -710.4],
	[22, -714], [24, -724], [21.2, -733], [17, -738], [6, -742], [-8, -750],
];
const NECK_SHADOW = smooth([[-36, -762], [-16, -755], [2, -746], [18, -739], [26, -738], [26, -726], [4, -728], [-20, -734], [-37, -738]]);
const COLLAR_BACK = smooth([[-48, -720], [-46.6, -731], [-40, -737], [-26, -739.6], [-6, -738.6], [12, -735], [26, -729], [32, -721], [20, -713], [-30, -716]]);

export const Neck34: React.FC = () => <Shape name="neck" d={smooth(NECK)} fill={ZOO_COLORS.skin} shadow={{d: NECK_SHADOW, fill: ZOO_COLORS.skinShadow}} />;
export const CollarBack34: React.FC = () => <Shape name="collarBack" d={COLLAR_BACK} fill={ZOO_COLORS.overshirtShadow} />;

// ---------------------------------------------------------------- torso
const TEE = smooth([
	[-12, -716], [0, -711], [15, -709.6], [28, -712.6], [37, -718], [38, -690], [37, -600], [36, -446], [18, -446.6], [0, -447.6],
	[-8, -449], [-8, -600], [-9, -700],
]);
const TEE_RIB = line([[-6, -711.4], [6, -706.8], [18, -706.6], [29, -710.6]]);

/** Near panel (anatomical right front, buttons on its front edge). Its back half hides under the near sleeve. */
const PANEL_NEAR: Pt[] = [
	[-48, -727], [-60, -716.6], [-76, -708.4], [-92, -701], [-104, -694], [-110, -687], [-111, -640], [-105, -560], [-99, -480],
	[-93, -440], [-85, -432.6], [-60, -429], [-32, -425], [-10, -420.8], [-2.6, -420.6], [0.6, -425], [0.8, -460], [0.8, -600],
	[0.4, -690], [-1.8, -703], [-6, -711], [-18, -717.6], [-33, -723.6],
];
const PANEL_NEAR_SHADOW = smooth([[-90, -700], [-60, -712], [-40, -700], [-50, -684], [-70, -676], [-90, -672]]);
/** Far panel (anatomical left front: pocket + pin). */
const PANEL_FAR: Pt[] = [
	[29, -724], [40, -716], [52, -706.4], [64, -699.4], [75, -693.6], [83.6, -686.6], [87.4, -676], [86.6, -650], [84.4, -600],
	[82.6, -540], [81.6, -480], [81, -440], [78.6, -426], [70, -423], [50, -421], [36, -421.4], [31.2, -424.4], [30.4, -440],
	[30.2, -600], [29.8, -690], [28.4, -712],
];
const PANEL_FAR_SHADOW = smooth([[70, -700], [92, -690], [92, -420], [68, -420], [71, -520], [73, -620]]);
const POCKET = smooth([[45.4, -640.4, 'c'], [68.2, -640.4, 'c'], [68.2, -600, 'c'], [57.2, -589.4, 'c'], [45.4, -599.6, 'c']]);
const POCKET_HEM = line([[45.8, -632.6], [67.8, -632.6]]);
const BUTTON_X = -6.4;
/** Same heights as the front view (decision ZOO-V3). */
const BUTTON_Y = [-686, -625, -567, -509, -452];
export const PIN34 = {x: 53, y: -659, sx: 0.86} as const;

const COLLAR_NEAR: Pt[] = [
	[-43.6, -734.6], [-48.8, -724], [-46, -708], [-38.6, -690.6, 'c'], [-28, -695], [-16, -701], [-5, -707.6], [1.4, -712.4, 'c'],
	[-12, -716.6], [-27, -723], [-39, -731],
];
const COLLAR_NEAR_SHADOW: Pt[] = [[-48, -706], [-38.6, -688], [-26, -692.6], [-10, -699], [-2, -704], [-6, -690], [-24, -682], [-42, -680]];
const COLLAR_FAR: Pt[] = [[26.6, -729], [33.6, -720], [40, -705], [45.4, -691, 'c'], [39.6, -695.4], [33.4, -703], [29, -711], [25.6, -720]];

export const Torso34: React.FC = () => (
	<g data-part="torso" data-view="threeQuarter">
		<Shape name="tee" d={TEE} fill={ZOO_COLORS.tee} />
		<Stroke d={TEE_RIB} width={LINE.detailWidth * 0.8} color={ZOO_COLORS.overshirt} />
		<Shape name="overshirtLeftPanel" d={smooth(PANEL_FAR)} fill={ZOO_COLORS.overshirt} shadow={{d: PANEL_FAR_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
		<g data-part="pocket">
			<path d={POCKET} fill="none" stroke={LINE.color} strokeWidth={LINE.detailWidth} strokeLinejoin="round" />
			<Stroke d={POCKET_HEM} width={LINE.detailWidth * 0.7} />
		</g>
		<g transform={`translate(${PIN34.x} 0) scale(${PIN34.sx} 1) translate(${-PIN34.x} 0)`}>
			<JellyfishPin x={PIN34.x} y={PIN34.y} />
		</g>
		<Shape name="overshirtRightPanel" d={smooth(PANEL_NEAR)} fill={ZOO_COLORS.overshirt} shadow={{d: PANEL_NEAR_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
		<g data-part="buttons">
			{BUTTON_Y.map((y) => (
				<circle key={y} cx={BUTTON_X} cy={y} r={3.7} fill={ZOO_COLORS.buttons} stroke={LINE.color} strokeWidth={1.1} />
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
	[-92, -701], [-104, -694], [-112, -686.6], [-118.4, -677], [-123.4, -664], [-127.4, -650], [-130.4, -628], [-133.4, -604], [-136.2, -576],
	[-138.6, -548], [-140, -520], [-139.2, -500], [-136.4, -480], [-132.6, -463], [-130.6, -455], [-129.8, -440], [-128.8, -419.4, 'c'],
	[-105, -416.8], [-82.4, -418.4, 'c'], [-82.8, -440], [-84, -455.4], [-86, -480], [-87.8, -520], [-88.4, -560], [-87, -600],
	[-84.6, -630], [-83.8, -650], [-85.6, -668], [-88.6, -686],
];
const SLEEVE_NEAR_SHADOW = smooth([[-96, -684], [-86, -692], [-80, -640], [-80, -420], [-98, -420], [-100, -520], [-98, -620]]);
const CUFF_NEAR = line([[-131, -455.4], [-108, -457.4], [-84, -455.8]]);
const ELBOW_NEAR = line([[-123.4, -616], [-120.4, -590], [-121.2, -566]]);
/** Far sleeve (anatomical left): only its outer half shows, behind the far panel. */
const SLEEVE_FAR: Pt[] = [
	[66, -697], [79, -692], [86.6, -682], [89.8, -664], [91.8, -640], [94, -612], [96.8, -582], [99.4, -555], [101.6, -525],
	[103.2, -500], [104.6, -478], [104.8, -462], [103.8, -455], [103.6, -440], [103, -419.4, 'c'], [89, -417], [75.6, -418.6, 'c'],
	[75.6, -440], [75.8, -455], [74, -500], [72, -600], [64, -680],
];
const SLEEVE_FAR_SHADOW = smooth([[60, -700], [80, -700], [86, -640], [84, -420], [60, -420]]);
const CUFF_FAR = line([[75.8, -455.4], [90, -456.6], [104, -455.2]]);

/** Wrist pivots (cuff bottom centre) used to hang the hands. */
export const WRIST34 = {near: {x: -95.5, y: -418}, far: {x: 90.8, y: -418}} as const;

const Sleeve: React.FC<{d: string; shadow: string; cuff: string; extra?: string; name: string}> = ({d, shadow, cuff, extra, name}) => (
	<g data-part={name}>
		<Shape d={d} fill={ZOO_COLORS.overshirt} shadow={{d: shadow, fill: ZOO_COLORS.overshirtShadow}} />
		<Stroke d={cuff} width={LINE.detailWidth} />
		{extra ? <Stroke d={extra} width={LINE.detailWidth} /> : null}
	</g>
);

/**
 * 3/4 hands, drawn for this view from the sheet (zoo_turn_34.png). Near = anatomical RIGHT hand: its
 * back faces the viewer, four finger lobes at the bottom, the thumb along the front edge. Far =
 * anatomical LEFT hand: fingers curl toward the thigh with the thumb tip resting over them.
 */
const HAND_NEAR: Pt[] = [
	[-111, -420], [-113, -400], [-114.4, -380], [-114, -362], [-112.6, -346], [-110, -336.6], [-105.6, -332], [-101.6, -333.6], [-99.6, -339, 'c'],
	[-97, -332], [-92.6, -330], [-88.6, -332], [-87, -337.6, 'c'], [-84.4, -332.4], [-80, -331.4], [-76.8, -334.6], [-76, -340, 'c'],
	[-72.4, -341.6], [-68.4, -346], [-66.4, -351, 'c'], [-63.4, -356], [-62.6, -366], [-65.4, -377], [-71, -389], [-77.4, -399], [-80, -420],
];
const HAND_NEAR_SHADOW = smooth([[-82, -402], [-60, -406], [-58, -326], [-84, -326], [-80, -350]]);
const HAND_NEAR_LINES: Pt[][] = [
	[[-99.6, -339], [-99.6, -351], [-101, -362]],
	[[-87, -337.6], [-87.4, -350], [-88.6, -361]],
	[[-76, -340], [-76.6, -351], [-77.6, -360]],
	[[-66.4, -351], [-71.4, -356], [-76.6, -357]], // thumb tip against the index finger
	[[-78.6, -396], [-74.4, -381], [-72, -368]], // thumb edge
];
const HAND_FAR: Pt[] = [
	[78, -418], [76, -402], [73, -388], [71.4, -374], [72.6, -364, 'c'], [69, -358], [68, -350], [70.6, -343], [76, -338.6], [83, -336.6],
	[90, -339], [95.4, -345], [99.6, -354], [102.6, -368], [104, -390], [103.6, -418],
];
const HAND_FAR_SHADOW = smooth([[66, -372], [84, -374], [90, -350], [80, -332], [64, -332]]);
const HAND_FAR_LINES: Pt[][] = [
	[[72.6, -364], [80, -366], [86.4, -362]], // thumb tip over the index finger
	[[70.6, -343], [78, -348], [86, -348.4]],
	[[76, -338.6], [83, -344], [91, -346]],
];

const Hand34: React.FC<{outline: Pt[]; shadow: string; lines: Pt[][]; name: string}> = ({outline, shadow, lines, name}) => (
	<g data-part={name}>
		<Shape d={smooth(outline)} fill={ZOO_COLORS.skin} shadow={{d: shadow, fill: ZOO_COLORS.skinShadow}} />
		{lines.map((l, i) => (
			<Stroke key={i} d={line(l)} width={LINE.detailWidth} />
		))}
	</g>
);

export const FarArm34: React.FC = () => (
	<g data-part="armL">
		<Hand34 outline={HAND_FAR} shadow={HAND_FAR_SHADOW} lines={HAND_FAR_LINES} name="handL" />
		<Sleeve d={smooth(SLEEVE_FAR)} shadow={SLEEVE_FAR_SHADOW} cuff={CUFF_FAR} name="sleeveL" />
	</g>
);

export const NearArm34: React.FC = () => (
	<g data-part="armR">
		<Hand34 outline={HAND_NEAR} shadow={HAND_NEAR_SHADOW} lines={HAND_NEAR_LINES} name="handR" />
		<Sleeve d={smooth(SLEEVE_NEAR)} shadow={SLEEVE_NEAR_SHADOW} cuff={CUFF_NEAR} extra={ELBOW_NEAR} name="sleeveR" />
		<circle data-part="cuffButton" cx={-125.4} cy={-436} r={2.8} fill={ZOO_COLORS.buttons} stroke={LINE.color} strokeWidth={1} />
	</g>
);

// ---------------------------------------------------------------- legs and shoes
const LEG_NEAR: Pt[] = [
	[-92, -440], [-10, -440], [-12, -330], [-14.6, -272], [-18.6, -250], [-24.6, -229], [-27, -207], [-35.6, -172], [-38, -146],
	[-41.6, -120], [-45.4, -90], [-45.6, -66], [-44.6, -44, 'c'], [-74, -46.6], [-101, -50, 'c'], [-102, -70], [-100, -86],
	[-99.6, -160], [-97.6, -188], [-94.2, -210], [-86.6, -236], [-86.6, -270], [-86, -330], [-89, -400],
];
const LEG_NEAR_SHADOW = [
	smooth([[-100, -446], [0, -446], [0, -410], [-40, -405], [-100, -408]]),
	smooth([[-12, -330], [-14.6, -272], [-24.6, -229], [-35.6, -172], [-41.6, -120], [-46, -56], [-56, -56], [-50, -150], [-36, -240], [-24, -330]]),
].join(' ');
const LEG_FAR: Pt[] = [
	[-12, -440], [66, -440], [64.4, -380], [61.6, -326], [59, -306], [57.6, -294], [54.6, -282], [53.4, -265], [50, -244],
	[49.2, -222], [45, -198], [41.4, -176], [39.6, -138], [38.2, -110], [37.4, -96], [39.6, -81], [38.4, -64], [39.4, -50.4, 'c'],
	[12, -49.6], [-14.6, -51.6, 'c'], [-15.6, -80], [-17, -108], [-17, -180], [-14.6, -196], [-14, -230], [-12, -300],
];
const LEG_FAR_SHADOW = smooth([[66, -446], [-14, -446], [-14, -410], [30, -404], [66, -408]]) + ' ' + smooth([[-17, -300], [-17, -56], [0, -56], [-4, -200], [-6, -300]]);

/** Near sneaker, a 3/4 front view (toe turned toward the viewer and screen right). */
const SHOE_NEAR: Pt[] = [
	[-106, -38.6], [-100, -46.4], [-88, -53.4], [-73, -56.6], [-58, -55], [-50.4, -49.6], [-44.6, -42], [-39.6, -31.6], [-36.4, -20],
	[-36.6, -9], [-40.4, -1.75], [-72, -1.75], [-104, -1.9], [-107.4, -8], [-107.6, -24],
];
const SHOE_NEAR_SOLE: Pt[] = [[-110, -12.4], [-72, -11.6], [-34, -12], [-34, 2], [-110, 2]];
const SHOE_NEAR_SHADOW: Pt[] = [[-110, -60], [-94, -60], [-96, -30], [-100, -12], [-110, -12]];
const SHOE_NEAR_LINES: Pt[][] = [
	[[-106.6, -12.2], [-72, -11.4], [-37.4, -12]], // sole line
	[[-82, -46], [-70, -41.4], [-58, -42.6]], // laces
	[[-84, -38], [-70, -33], [-54, -34.6]],
	[[-66, -24], [-52, -20.6], [-41, -22]], // toe cap
];
/** Far sneaker in profile pointing screen right; its heel tucks behind the near shoe. */
const SHOE_FAR: Pt[] = [
	[-36, -46], [-22, -51.4], [-4, -55], [16, -57.6], [32, -57], [44, -52], [60, -45], [78, -37.6], [94, -30.6], [103.6, -22.4],
	[106.6, -11.4], [103.4, -1.75], [60, -1.75], [-20, -1.75], [-38, -2.4], [-40.6, -16], [-39.6, -32],
];
const SHOE_FAR_SOLE: Pt[] = [[-44, -12.6], [30, -12], [108, -12.6], [108, 2], [-44, 2]];
const SHOE_FAR_SHADOW: Pt[] = [[-42, -60], [-10, -60], [-14, -30], [-18, -12], [-42, -12]];
const SHOE_FAR_LINES: Pt[][] = [
	[[-38.8, -12.6], [30, -11.8], [105.4, -12.4]],
	[[42, -48.6], [52, -45.6], [60, -41]],
	[[50, -41], [60, -37.6], [68, -33.6]],
	[[64, -23.6], [82, -22], [99, -23]],
];

export const Sneaker: React.FC<{outline: Pt[]; sole: Pt[]; shadow: Pt[]; lines: Pt[][]; name: string}> = ({outline, sole, shadow, lines, name}) => {
	const d = smooth(outline);
	return (
		<g data-part={name}>
			<path d={d} fill={ZOO_COLORS.sneaker} />
			<Clipped clip={d}>
				<path d={smooth(shadow)} fill={ZOO_COLORS.sneakerShadow} />
				<path d={smooth(sole)} fill={ZOO_COLORS.sneakerSole} />
			</Clipped>
			<path d={d} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinejoin="round" />
			{lines.map((l, i) => (
				<Stroke key={i} d={line(l)} width={i === 0 ? LINE.detailWidth : LINE.detailWidth * 0.8} />
			))}
		</g>
	);
};

/** The 3/4 sneakers on their own (the seated typing pose puts the feet in the same place). */
export const FarShoe34: React.FC = () => <Sneaker outline={SHOE_FAR} sole={SHOE_FAR_SOLE} shadow={SHOE_FAR_SHADOW} lines={SHOE_FAR_LINES} name="shoeL" />;
export const NearShoe34: React.FC = () => <Sneaker outline={SHOE_NEAR} sole={SHOE_NEAR_SOLE} shadow={SHOE_NEAR_SHADOW} lines={SHOE_NEAR_LINES} name="shoeR" />;

export const Legs34: React.FC = () => (
	<g data-part="legs" data-view="threeQuarter">
		<Sneaker outline={SHOE_FAR} sole={SHOE_FAR_SOLE} shadow={SHOE_FAR_SHADOW} lines={SHOE_FAR_LINES} name="shoeL" />
		<Shape name="legL" d={smooth(LEG_FAR)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_FAR_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
		<Sneaker outline={SHOE_NEAR} sole={SHOE_NEAR_SOLE} shadow={SHOE_NEAR_SHADOW} lines={SHOE_NEAR_LINES} name="shoeR" />
		<Shape name="legR" d={smooth(LEG_NEAR)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_NEAR_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
	</g>
);
