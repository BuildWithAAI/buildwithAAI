/**
 * ZOO, 3/4 view (body turned to SCREEN RIGHT), standing. Assembles the 3/4 parts with the same idle
 * breathing as the front rig. Every part is authored in this view's root space at rest.
 */
import React from 'react';
import type {ViewBodyProps} from './types';
import {Head34} from './threeQuarter/Head34';
import {CollarBack34, FarArm34, Legs34, Neck34, NearArm34, Torso34} from './threeQuarter/Body34';

/** Torso breathing origin (overshirt hem) and shoulder height in the 3/4 view. */
export const TQ_BODY = {hem: -420, shoulder: -690} as const;

export const ZooThreeQuarter: React.FC<ViewBodyProps> = (p) => {
	const dy = p.breath;
	const sy = 1 + -dy / (TQ_BODY.hem - TQ_BODY.shoulder);
	const torsoT = `translate(0 ${TQ_BODY.hem}) scale(1 ${sy}) translate(0 ${-TQ_BODY.hem})`;
	return (
		<g data-view="threeQuarter">
			<g data-part="farArm" transform={`translate(0 ${dy})`}>
				<FarArm34 />
			</g>
			<Legs34 />
			<g transform={torsoT}>
				<CollarBack34 />
			</g>
			<g transform={`translate(0 ${dy})`}>
				<Neck34 />
			</g>
			<g transform={torsoT}>
				<Torso34 />
			</g>
			<g data-part="nearArm" transform={`translate(0 ${dy})`}>
				<NearArm34 />
			</g>
			<g data-part="upperBody" transform={`translate(0 ${dy})`}>
				<Head34 {...p.head} />
			</g>
		</g>
	);
};
