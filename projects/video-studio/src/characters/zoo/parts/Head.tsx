/**
 * ZOO head, front view. Layer order (back to front): back hair, ears, face skin, mouth, beard, moustache, jaw
 * outline, nose, eyes, front hair, brows. The brows are drawn AFTER the front hair (repair round 1, blocker): a
 * raised brow stays fully visible, and when it would reach the forelock the forelock's lower part lifts
 * (Hair.tsx forelockLiftFor), as on the sheet's shocked panel. The whole head rotates about the neck pivot
 * (PIVOTS.head) for headTilt.
 */
import React from 'react';
import {LINE} from '../../palette';
import type {Expression, MouthShape} from '../../types';
import {ZOO_LINE} from '../lines';
import {BROW_LIFT, EXPRESSIONS, MOD0, PIVOTS, type MouthMod} from '../rig';
import {Beard, Moustache} from './Beard';
import {BROW_R, browTopIn, Brows, posed} from './Brows';
import {Ears} from './Ears';
import {Eyes} from './Eyes';
import {FaceSkin, jawOutline} from './Face';
import {FORELOCK_TIP, forelockLiftFor, HairBack, HairFront} from './Hair';
import {Mouth, mouthDrops} from './Mouth';
import {Nose} from './Nose';
import {useLineScale} from './Shape';

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
export const explicitMod = (m: MouthMod): MouthMod => ({
	...MOD0,
	cornerL: m.cornerL * 0.5,
	cornerR: m.cornerR * 0.5,
	wave: m.wave * 0.4,
	moustacheLiftR: m.moustacheLiftR * 0.6,
});

/** Per-side brow raise in units for browLift 0..1 (the deadpan raise is one-sided: anatomical left leads). */
export const browLifts = (browLift: number) => {
	const b = Math.max(0, Math.min(1, browLift));
	return {liftL: b * BROW_LIFT.left, liftR: b * BROW_LIFT.right};
};

export const Head: React.FC<HeadProps> = ({expression, mouth, blink, browLift, lookX, lookY, headTilt}) => {
	const spec = EXPRESSIONS[expression];
	const shape = mouth ?? spec.mouth;
	const mod = mouth ? explicitMod(spec.mod) : spec.mod;
	const {hole, jaw} = mouthDrops(shape, mod);
	const {liftL, liftR} = browLifts(browLift);
	// The screen-left brow (anatomical right, BROW_R) passes under the forelock tip.
	const forelockLift = forelockLiftFor(browTopIn(posed(BROW_R, spec.browR, liftR), FORELOCK_TIP.x - 2, FORELOCK_TIP.x + 11));
	const ls = useLineScale();
	return (
		<g data-part="head" transform={`rotate(${headTilt} ${PIVOTS.head.x} ${PIVOTS.head.y})`}>
			<HairBack />
			<Ears />
			<FaceSkin jawDrop={jaw} />
			<Mouth shape={shape} mod={mod} />
			<Beard hole={hole} jawDrop={jaw} />
			<Moustache liftR={mod.moustacheLiftR} />
			<path data-part="jawOutline" d={jawOutline(jaw)} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.outline * ls} strokeLinecap="round" strokeLinejoin="round" />
			<Nose />
			<Eyes pose={spec.eyes} blink={blink} lookX={lookX} lookY={lookY} />
			<HairFront forelockLift={forelockLift} />
			<Brows left={spec.browL} right={spec.browR} liftL={liftL} liftR={liftR} crease={spec.crease} />
		</g>
	);
};
