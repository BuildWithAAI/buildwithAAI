/**
 * ZOO hair, front view. Asymmetric by design (never mirrored): the top sweeps over from the
 * screen-left spike and curls at the crown, a pointed forelock hangs onto the forehead left of
 * centre, the sides are short and tidy. Silhouette traced from zoo_turn_front.png and
 * zoo_expr_neutral.png (they agree within ~3 units).
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, smooth, type Pt} from '../geometry';
import {Shape, Stroke} from './Shape';

/** Visible top of the silhouette (left ear top -> over the crown -> right ear top), soft rounded tufts. */
const TOP: Pt[] = [
	[-63.7, -807.8], [-66.2, -813.2], [-66.6, -819.5], [-70.5, -825.3], [-77.5, -831.1], [-83.5, -836.4], [-85.1, -839.5], [-82.1, -841.6],
	[-74.5, -842.8], [-69.5, -848.6], [-71.6, -854.5], [-74.6, -862.3], [-75.3, -866.8], [-72.1, -868], [-64.7, -865.7], [-57.2, -868.6],
	[-55, -875], [-53.2, -881], [-50.4, -884.6], [-46.6, -884.6], [-42.6, -882.8], [-35, -884.8], [-23.7, -891.2], [-10.2, -897],
	[3.4, -898], [17, -895.1], [26.6, -889.2], [31.4, -884.3, 'c'], [40.2, -880], [46.9, -873.2], [52.8, -868.4], [59.7, -860.7], [64.6, -851],
	[66.1, -842.8], [68.3, -836.4], [67.9, -832.5], [64.5, -829.8], [60.5, -826.9], [58.6, -817.6], [54.7, -807.9],
];
/** Hidden lower part (behind the ears and jaw). */
const BOTTOM: Pt[] = [[53.9, -797.1], [50.1, -786.4], [39.4, -776.7], [15.1, -768], [-23.8, -767.9], [-48.2, -776.5], [-58, -787.3], [-61.8, -799]];
export const HAIR_SILHOUETTE: Pt[] = [...TOP, ...BOTTOM];
const TOP_OUTLINE = TOP;

/** Hairline: from the lock over the left ear, across the forehead (with the forelock) to the right ear. */
const HAIRLINE: Pt[] = [
	[-59, -810.5], [-50, -816], [-45, -826], [-44, -836], [-41, -843], [-33, -843.5], [-24, -846.5], [-18, -850.5],
	[-13, -857, 'c'], [-14.5, -849], [-17.5, -841, 'c'], [-10, -844.5], [-3.5, -850], [0.5, -857], [3, -863.5],
	[13, -864.5], [27, -861], [37, -852], [41, -838], [42.5, -826], [46, -816], [52, -811.5], [56.5, -810],
];

/** Front hair fill: top silhouette + hairline. */
const FRONT_FILL: Pt[] = [
	...TOP_OUTLINE.slice(1, TOP_OUTLINE.length - 1),
	[58.5, -809],
	...HAIRLINE.slice().reverse(),
	[-63.5, -808],
];

/** Interior strand lines that define the locks. */
const STRANDS: Pt[][] = [
	[[-72, -856], [-59, -868.5], [-41, -878.5], [-21, -885.5], [-7, -887.5]], // main sweep edge (left wing -> crown)
	[[-3, -885], [-6.6, -873], [-10.6, -862], [-13.4, -855.6]], // forelock's left edge, down from the crown
	[[-1, -878], [6.5, -887], [18, -890.5], [28.5, -885.5], [33.5, -875], [34, -866]], // crown curl over the hollow
	[[37, -880.5], [48, -872.5], [56.5, -860]], // right wave
	[[-81, -840.6], [-69, -841.4], [-58.6, -837.6]], // lower-left wing
];

/** One flat shadow tone: crown hollow above the forehead, right temple, left temple under the wings. */
const FRONT_SHADOW = [
	smooth([[2.4, -863.6], [1.6, -871], [7, -880], [15, -884.4], [24, -882.6], [30.4, -874.6], [32, -863.6]]),
	smooth([[38, -864], [50, -859], [60, -845], [62, -826], [57, -810], [47, -813], [43, -829], [41.4, -850]]),
	smooth([[-43, -841], [-55, -842], [-63, -832], [-61, -818], [-54, -811], [-46, -820]]),
	smooth([[-40, -842.6], [-31, -850], [-20, -853.6], [-15.4, -851], [-21, -847], [-33, -843.4]]),
].join(' ');

const BACK = smooth(HAIR_SILHOUETTE);
const BACK_SHADOW = smooth([[70, -830], [64, -800], [50, -770], [-50, -770], [-64, -800], [-70, -830], [0, -840]]);

/** Behind the ears and face. */
export const HairBack: React.FC = () => (
	<Shape name="hairBack" d={BACK} fill={ZOO_COLORS.hair} shadow={{d: BACK_SHADOW, fill: ZOO_COLORS.hairShadow}} />
);

/** In front of the forehead: swept top, crown curl and forelock. */
export const HairFront: React.FC = () => (
	<g data-part="hairFront">
		<Shape d={smooth(FRONT_FILL)} fill={ZOO_COLORS.hair} shadow={{d: FRONT_SHADOW, fill: ZOO_COLORS.hairShadow}} stroke={0} />
		{STRANDS.map((s, i) => (
			<Stroke key={i} d={line(s)} width={LINE.detailWidth} />
		))}
		<Stroke d={line(HAIRLINE)} width={LINE.width} />
		<Stroke d={line(TOP_OUTLINE)} width={LINE.width} />
	</g>
);
