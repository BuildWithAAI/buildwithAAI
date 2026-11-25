/**
 * ZOO head, front view. Layer order (back to front): back hair, ears, face skin, mouth, beard, nose, moustache, jaw
 * outline, eyes, front hair, brows (round 6: the nose moved under the moustache). The brows are drawn AFTER the front hair (repair round 1, blocker): a
 * raised brow stays fully visible, and when it would reach the forelock the forelock's lower part lifts
 * (Hair.tsx forelockLiftFor), as on the sheet's shocked panel. The whole head rotates about the neck pivot
 * (PIVOTS.head) for headTilt.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import type {Expression, MouthShape} from '../../types';
import {ZOO_LINE} from '../lines';
import {tapered, type Pt} from '../geometry';
import {BROW_LIFT, EXPRESSIONS, explicitMod, mouthFor, PIVOTS} from '../rig';
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

/** Expression modifiers for an explicit (spoken) mouth shape; moved to rig.ts in repair round 6 (re-exported here). */
export {explicitMod};

/**
 * The smile crease on the screen-right cheek (repair round 4, ZOO-E4): a short soft fold beside the lifted moustache end, in
 * the skin-shadow tone, tapered at both ends.
 */
export const CHEEK_CREASE: Pt[] = [[24.2, -789.4], [27.8, -785.2], [30, -780], [30.6, -775.6]];

/** How far the lip-patch edge rises beside a mouth corner lifted by `corner` u (smiles only; frowns leave it). */
export const smileOf = (corner: number) => Math.max(0, corner) * 0.4;

/** Per-side brow raise in units for browLift 0..1 (the deadpan raise is one-sided: anatomical left leads). */
export const browLifts = (browLift: number) => {
	const b = Math.max(0, Math.min(1, browLift));
	return {liftL: b * BROW_LIFT.left, liftR: b * BROW_LIFT.right};
};

export const Head: React.FC<HeadProps> = ({expression, mouth, blink, browLift, lookX, lookY, headTilt}) => {
	const spec = EXPRESSIONS[expression];
	// mouth undefined or 'closed' = the expression's rest mouth (rig.ts mouthFor, ZOO-E7); other shapes are lip-sync
	const {shape, mod, spec: mouthSpec} = mouthFor(expression, mouth);
	const {hole, jaw} = mouthDrops(shape, mod, mouthSpec);
	const {liftL, liftR} = browLifts(browLift);
	// The screen-left brow (anatomical right, BROW_R) passes under the forelock tip.
	const forelockLift = forelockLiftFor(browTopIn(posed(BROW_R, spec.browR, liftR), FORELOCK_TIP.x - 2, FORELOCK_TIP.x + 11));
	const ls = useLineScale();
	return (
		<g data-part="head" transform={`rotate(${headTilt} ${PIVOTS.head.x} ${PIVOTS.head.y})`}>
			<HairBack />
			<Ears />
			<FaceSkin jawDrop={jaw} />
			<Mouth shape={shape} mod={mod} spec={mouthSpec} />
			<Beard hole={hole} jawDrop={jaw} smileR={smileOf(mod.cornerR)} smileL={smileOf(mod.cornerL)} />
			{/* Round 6: the nose before the moustache, so the moustache's top edge covers the under-tip shadow instead of a
			    skin-shadow patch showing on it (the smile raises the moustache to the nose base, as on zoo_expr_happy.png). */}
			<Nose />
			<Moustache liftR={mod.moustacheLiftR} liftL={mod.moustacheLiftL ?? 0} raise={mod.moustacheRaise ?? 0} thin={mod.moustacheThin ?? 0} />
			{spec.cheek ? (
				<path data-part="cheekCrease" d={tapered(CHEEK_CREASE, (t) => ZOO_LINE.fine * 1.25 * spec.cheek! * ls * Math.sin(Math.PI * Math.min(1, Math.max(0, t * 0.96 + 0.02))))} fill={ZOO_COLORS.skinShadow} />
			) : null}
			<path data-part="jawOutline" d={jawOutline(jaw)} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.outline * ls} strokeLinecap="round" strokeLinejoin="round" />
			<Eyes pose={spec.eyes} blink={blink} lookX={lookX} lookY={lookY} />
			<HairFront forelockLift={forelockLift} />
			<Brows left={spec.browL} right={spec.browR} liftL={liftL} liftR={liftR} crease={spec.crease} />
		</g>
	);
};
