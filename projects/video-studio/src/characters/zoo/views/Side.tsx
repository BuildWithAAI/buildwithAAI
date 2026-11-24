/**
 * ZOO in PROFILE facing SCREEN RIGHT, standing. Same breathing as the front rig.
 */
import React from 'react';
import type {ViewBodyProps} from './types';
import {HeadSide, NeckSide} from './side/HeadSide';
import {ArmSide, CollarStandSide, LegSide, TorsoSide} from './side/BodySide';

export const SIDE_BODY = {hem: -424, shoulder: -700} as const;

export const ZooSide: React.FC<ViewBodyProps> = (p) => {
	const dy = p.breath;
	const sy = 1 + -dy / (SIDE_BODY.hem - SIDE_BODY.shoulder);
	const torsoT = `translate(0 ${SIDE_BODY.hem}) scale(1 ${sy}) translate(0 ${-SIDE_BODY.hem})`;
	return (
		<g data-view="side">
			<LegSide />
			<g transform={torsoT}>
				<CollarStandSide />
			</g>
			<g transform={`translate(0 ${dy})`}>
				<NeckSide />
			</g>
			<g transform={torsoT}>
				<TorsoSide />
			</g>
			<g data-part="nearArm" transform={`translate(0 ${dy})`}>
				<ArmSide />
			</g>
			<g data-part="upperBody" transform={`translate(0 ${dy})`}>
				<HeadSide {...p.head} />
			</g>
		</g>
	);
};
