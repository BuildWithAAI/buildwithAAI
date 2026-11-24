/**
 * Torso, front view: near-black crewneck tee under an OPEN slate overshirt. Asymmetric details are
 * placed per side, never mirrored: the small silver buttons run down the screen-left panel
 * (wearer's right placket), the chest pocket is on the screen-right panel, and the jellyfish pin
 * sits above that pocket on the anatomical-left chest. The collar leaves are a symmetric pair.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, type Pt} from '../geometry';
import {JellyfishPin} from './Pin';
import {Shape, Stroke} from './Shape';

const TEE = smooth([
	[-37, -733], [-27, -724.6], [-14, -718], [0, -715.8], [14, -718], [27, -724.6], [37, -733], [39, -700], [36, -419], [-36, -419],
	[-39, -700],
]);
const TEE_RIB = line([[-25.4, -720.6], [-13, -713.8], [0, -711.8], [13, -713.8], [25.4, -720.6]]);

/** Screen-left panel (wearer's right front, carries the buttons). */
const PANEL_SL: Pt[] = [
	[-28, -736], [-46, -731.5], [-60, -722.5], [-76, -712.2], [-96, -702], [-111, -692], [-118, -679.5], [-118, -650], [-111, -600],
	[-105, -540], [-102, -470], [-101, -428], [-80, -421], [-50, -418.6], [-26, -418.6], [-21.6, -421.8], [-21, -432], [-21, -600],
	[-21.6, -690], [-24, -705], [-26.4, -722],
];
/** Screen-right panel (wearer's left front, carries the pocket and pin). */
const PANEL_SR: Pt[] = [
	[28, -736], [46, -731.5], [60, -722.5], [76, -712.2], [96, -702], [111, -692], [118, -679.5], [118, -650], [111, -600], [105, -540],
	[102, -470], [101, -428], [80, -421], [50, -418.6], [29, -418.6], [24.6, -421.8], [24, -432], [24, -600], [24.6, -690], [27, -705],
	[29.4, -722],
];
const PANEL_SHADOW_SL = smooth([[-123, -686], [-96, -695], [-92, -640], [-91, -470], [-93, -416], [-125, -416]]);
const PANEL_SHADOW_SR = smooth([[123, -686], [96, -695], [92, -640], [91, -470], [93, -416], [125, -416]]);

const COLLAR_BACK = smooth([[-31, -724], [-29, -738], [-15, -742.5], [0, -743.5], [15, -742.5], [29, -738], [31, -724]]);
/** Screen-left collar leaf; the screen-right leaf is its garment mirror. */
const COLLAR_SL: Pt[] = [[-26, -738.4], [-37, -737], [-50, -731.6], [-62, -723.4, 'c'], [-59.4, -707.6], [-49.4, -688.6, 'c'], [-40.4, -696.6], [-31.2, -709], [-25, -724]];
const COLLAR_SHADOW: Pt[] = [[-61, -706], [-50.4, -686], [-40.6, -693.4], [-31, -705.6], [-23, -697], [-38, -680], [-54, -676.6], [-63.6, -692]];

const POCKET = smooth([[39, -637, 'c'], [81, -637, 'c'], [81, -601, 'c'], [60, -592.4, 'c'], [39, -601, 'c']]);
const POCKET_HEM = line([[39.5, -630.4], [80.5, -630.4]]);
const BUTTON_X = -28.4;
const BUTTON_Y = [-686, -625, -567, -509, -452];

export const Torso: React.FC = () => (
	<g data-part="torso">
		<Shape name="tee" d={TEE} fill={ZOO_COLORS.tee} />
		<Stroke d={TEE_RIB} width={LINE.detailWidth * 0.8} color={ZOO_COLORS.overshirt} />
		<Shape name="overshirtRightPanel" d={smooth(PANEL_SL)} fill={ZOO_COLORS.overshirt} shadow={{d: PANEL_SHADOW_SL, fill: ZOO_COLORS.overshirtShadow}} />
		<Shape name="overshirtLeftPanel" d={smooth(PANEL_SR)} fill={ZOO_COLORS.overshirt} shadow={{d: PANEL_SHADOW_SR, fill: ZOO_COLORS.overshirtShadow}} />
		<g data-part="collarShadow">
			<path d={smooth(COLLAR_SHADOW)} fill={ZOO_COLORS.overshirtShadow} />
			<path d={smooth(mirrorX(COLLAR_SHADOW))} fill={ZOO_COLORS.overshirtShadow} />
		</g>
		<Shape name="collarR" d={smooth(COLLAR_SL)} fill={ZOO_COLORS.overshirt} />
		<Shape name="collarL" d={smooth(mirrorX(COLLAR_SL))} fill={ZOO_COLORS.overshirt} />
		<g data-part="pocket">
			<path d={POCKET} fill="none" stroke={LINE.color} strokeWidth={LINE.detailWidth} strokeLinejoin="round" />
			<Stroke d={POCKET_HEM} width={LINE.detailWidth * 0.7} />
		</g>
		<g data-part="buttons">
			{BUTTON_Y.map((y) => (
				<circle key={y} cx={BUTTON_X} cy={y} r={3.7} fill={ZOO_COLORS.buttons} stroke={LINE.color} strokeWidth={1.1} />
			))}
		</g>
		<JellyfishPin />
	</g>
);

/** Collar stand behind the neck (drawn before the neck). */
export const CollarBack: React.FC = () => <Shape name="collarBack" d={COLLAR_BACK} fill={ZOO_COLORS.overshirtShadow} />;
