/**
 * ZOO head, front view. Layer order (back to front): back hair, ears, face skin, mouth, beard,
 * moustache, jaw outline, nose, eyes, brows, front hair. The whole head rotates about the neck
 * pivot (PIVOTS.head) for headTilt.
 */
import React from 'react';
import {LINE} from '../../palette';
import type {Expression, MouthShape} from '../../types';
import {EXPRESSIONS, MOD0, PIVOTS, type MouthMod} from '../rig';
import {Beard, Moustache} from './Beard';
import {Brows} from './Brows';
import {Ears} from './Ears';
import {Eyes} from './Eyes';
import {FaceSkin, jawOutline} from './Face';
import {HairBack, HairFront} from './Hair';
import {Mouth, mouthDrops} from './Mouth';
import {Nose} from './Nose';

export type HeadProps = {
	expression: Expression;
	mouth?: MouthShape;
	blink: number;
	browLift: number;
	lookX: number;
	lookY: number;
	headTilt: number;
};

/** Expression modifiers that still apply (softened) when an explicit mouth shape is given. */
const explicitMod = (m: MouthMod): MouthMod => ({
	...MOD0,
	cornerL: m.cornerL * 0.5,
	cornerR: m.cornerR * 0.5,
	wave: m.wave * 0.4,
	moustacheLiftR: m.moustacheLiftR * 0.6,
});

export const Head: React.FC<HeadProps> = ({expression, mouth, blink, browLift, lookX, lookY, headTilt}) => {
	const spec = EXPRESSIONS[expression];
	const shape = mouth ?? spec.mouth;
	const mod = mouth ? explicitMod(spec.mod) : spec.mod;
	const {hole, jaw} = mouthDrops(shape, mod);
	const lift = Math.max(0, Math.min(1, browLift)) * 3.5;
	return (
		<g data-part="head" transform={`rotate(${headTilt} ${PIVOTS.head.x} ${PIVOTS.head.y})`}>
			<HairBack />
			<Ears />
			<FaceSkin jawDrop={jaw} />
			<Mouth shape={shape} mod={mod} />
			<Beard hole={hole} jawDrop={jaw} />
			<Moustache liftR={mod.moustacheLiftR} />
			<path data-part="jawOutline" d={jawOutline(jaw)} fill="none" stroke={LINE.color} strokeWidth={LINE.width} strokeLinecap="round" strokeLinejoin="round" />
			<Nose />
			<Eyes pose={spec.eyes} blink={blink} lookX={lookX} lookY={lookY} />
			<Brows left={spec.browL} right={spec.browR} lift={lift} crease={spec.crease} />
			<HairFront />
		</g>
	);
};
