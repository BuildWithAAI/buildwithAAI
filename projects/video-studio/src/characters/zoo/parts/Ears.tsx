/**
 * Ears: a bilateral pair (left and right ears are anatomical mirror images; no markings), tucked
 * under the side hair at the top and behind the face edge at the attachment.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import {line, mirrorX, smooth, type Pt} from '../geometry';
import {Shape, Stroke} from './Shape';

/** Anatomical left ear (screen right). */
const EAR_L: Pt[] = [[39, -816], [47, -818], [54.5, -815], [58, -806.5], [57.5, -797], [54, -789], [48, -784], [40.5, -783.5]];
const EAR_L_SHADOW: Pt[] = [[41, -813], [50, -811], [53, -801], [50, -792], [43, -789]];
const EAR_L_DETAIL: Pt[] = [[50, -811], [54, -804], [52.5, -795.5], [47.5, -791]];
const EAR_L_INNER: Pt[] = [[46.5, -807], [48.8, -800], [46, -795]];

const Ear: React.FC<{side: 1 | -1}> = ({side}) => {
	const m = (p: Pt[]) => (side === 1 ? p : mirrorX(p));
	return (
		<g data-part={side === 1 ? 'earL' : 'earR'}>
			<Shape d={smooth(m(EAR_L))} fill={ZOO_COLORS.skin} shadow={{d: smooth(m(EAR_L_SHADOW)), fill: ZOO_COLORS.skinShadow}} />
			<Stroke d={line(m(EAR_L_DETAIL))} width={LINE.detailWidth} />
			<Stroke d={line(m(EAR_L_INNER))} width={LINE.detailWidth * 0.8} />
		</g>
	);
};

export const Ears: React.FC = () => (
	<g data-part="ears">
		<Ear side={1} />
		<Ear side={-1} />
	</g>
);
