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
import {LINE, ZOO_COLORS} from '../../../palette';
import {line, smooth, type Pt} from '../../geometry';
import {Clipped, Shape, Stroke} from '../../parts/Shape';

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
const BUTTONS: Pt[] = [[29.4, -686], [43.6, -625], [50.6, -567], [52.8, -509], [53.2, -452]];

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
		<Stroke d={PLACKET} width={LINE.detailWidth * 0.8} />
		<g data-part="buttons">
			{BUTTONS.map(([x, y]) => (
				<ellipse key={y} cx={x} cy={y} rx={2.8} ry={3.7} fill={ZOO_COLORS.buttons} stroke={LINE.color} strokeWidth={1.1} />
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
 * Anatomical RIGHT hand seen from its outer side (back of the hand), fingers hanging and curling
 * slightly forward: four finger lobes at the bottom, the thumb edge along the front. Drawn for the
 * side view (the sheet shows no separate thumb lobe here).
 */
const HAND: Pt[] = [
	[-20, -424], [-21, -400], [-21.6, -380], [-20.8, -362], [-19.2, -350], [-17, -342], [-13, -338.6], [-8.6, -340], [-6.4, -344.4, 'c'],
	[-4.6, -338.4], [0, -336.6], [4, -338.4], [5.4, -342.2, 'c'], [7.4, -337.6], [11.6, -336.8], [14.6, -339.6], [15.4, -343.8, 'c'],
	[18, -341.8], [21, -343.2], [22.6, -348], [22.8, -356], [24.6, -370], [26, -388], [26, -405], [24.8, -424],
];
const HAND_SHADOW = smooth([[8, -400], [26, -404], [26, -330], [-4, -330], [4, -352], [10, -370]]);
const HAND_LINES: Pt[][] = [
	[[-6.4, -344.4], [-6, -357]],
	[[5.4, -342.2], [5.8, -355]],
	[[15.4, -343.8], [15.8, -355]],
	[[24, -396], [21.4, -380], [21.6, -366]], // thumb edge
];

export const ArmSide: React.FC = () => (
	<g data-part="armR">
		<g data-part="handR">
			<Shape d={smooth(HAND)} fill={ZOO_COLORS.skin} shadow={{d: HAND_SHADOW, fill: ZOO_COLORS.skinShadow}} />
			{HAND_LINES.map((l, i) => (
				<Stroke key={i} d={line(l)} width={LINE.detailWidth} />
			))}
		</g>
		<Shape name="sleeveR" d={smooth(SLEEVE)} fill={ZOO_COLORS.overshirt} shadow={{d: SLEEVE_SHADOW, fill: ZOO_COLORS.overshirtShadow}} />
		<Stroke d={CUFF_SEAM} width={LINE.detailWidth} />
		<Stroke d={ARMHOLE} width={LINE.detailWidth * 0.8} />
		<Stroke d={ELBOW} width={LINE.detailWidth * 0.8} />
		<circle data-part="cuffButton" cx={-26} cy={-433} r={3} fill={ZOO_COLORS.buttons} stroke={LINE.color} strokeWidth={1} />
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

const SHOE: Pt[] = [
	[-71, -42], [-60, -40], [-45, -39], [-30, -41.4], [-16, -46.4], [-4, -53], [4, -55.4], [14, -48.4], [28, -39.6], [44, -32], [57, -26.6],
	[64.6, -19], [66, -8.6], [61.6, -1.75], [0, -1.75], [-66, -1.75], [-71.4, -6], [-72.4, -22], [-71.6, -34],
];
const SHOE_SOLE: Pt[] = [[-76, -11], [0, -10.4], [70, -11.4], [70, 2], [-76, 2]];
const SHOE_SHADOW: Pt[] = [[-76, -44], [-58, -44], [-56, -26], [-60, -11], [-76, -11]];
const SHOE_LINES: Pt[][] = [
	[[-71.4, -10.8], [0, -10.2], [65.6, -11]],
	[[8, -49], [14, -45.4]],
	[[14, -43.6], [21, -40]],
	[[21, -39], [28, -35.4]],
	[[36, -22.6], [50, -19.6], [61, -20.4]],
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
				<path d={shoe} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinejoin="round" />
				{SHOE_LINES.map((l, i) => (
					<Stroke key={i} d={line(l)} width={i === 0 ? LINE.detailWidth : LINE.detailWidth * 0.8} />
				))}
			</g>
			<Shape name="legR" d={smooth(LEG)} fill={ZOO_COLORS.trousers} shadow={{d: LEG_SHADOW, fill: ZOO_COLORS.trousersShadow}} />
			<Stroke d={LEG_CREASE} width={LINE.detailWidth * 0.7} color={ZOO_COLORS.trousersShadow} />
		</g>
	);
};
