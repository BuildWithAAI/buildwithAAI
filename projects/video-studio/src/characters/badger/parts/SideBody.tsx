import React from 'react';
import {BADGER_COLORS, BRAND, LINE} from '../../palette';
import type {BadgerHead} from '../../types';
import type {BadgerSpot} from '../spots';
import {Head, HeadState} from './heads/Head';
import {Leg, LegAngles, LegGeom} from './Leg';
import {PartShape, Pt, ShapeGeom, tr, useStrokes, useUid} from './shared';
import {SpotShapes} from './SpotShapes';
import {Tail, TailGeom} from './Tail';

/** Structural type shared by LEFT_RIG (gen_left.py) and RIGHT_RIG (gen_right.py). */
export type SideRig = {
	readonly torso: ShapeGeom & {readonly pivot: Pt};
	readonly mounts: {
		readonly neck: Pt;
		readonly tail: Pt;
		readonly legFrontNear: Pt;
		readonly legFrontFar: Pt;
		readonly legHindNear: Pt;
		readonly legHindFar: Pt;
	};
	readonly neck: ShapeGeom & {
		readonly headMount: Pt;
		readonly collar: string;
		readonly collarShadow: string;
		readonly tagRing: string;
		readonly tag: string;
		readonly tagShadow: string;
		readonly tagAnchor: Pt;
	};
	readonly legFront: LegGeom;
	readonly legHind: LegGeom;
	readonly tail: TailGeom;
};

/**
 * Where a replaceable head sits on a side rig's neck: neck rotation (SVG deg about the neck base), head pivot offset from the
 * neck's head mount and extra head rotation. `nape` (optional, neck-local): for a head turned back over the shoulder, a
 * replacement for the top of the neck's back line plus the fill between the two, so the crest of the neck runs from behind
 * the far ear past the muzzle instead of meeting the face's far contour (round-2 repair, decision BADGER-D37).
 */
export type HeadMount = {
	readonly neck: number;
	readonly dx: number;
	readonly dy: number;
	readonly rot: number;
	readonly nape?: {readonly fill: string; readonly stroke: string};
};

export type LegKey = 'frontNear' | 'frontFar' | 'hindNear' | 'hindFar';

/**
 * A side-view pose in FACING-NORMALISED degrees: a positive leg angle swings that segment FORWARD (toward
 * the head), a positive neck angle raises the head. SideBody converts to SVG rotation with the facing sign,
 * so one pose drives the left rig (faces screen left) and the right rig (faces screen right) alike. Each
 * rig keeps its own traced drawing and markings; nothing is mirrored.
 */
export type SidePose = {
	/** Whole body (torso and everything mounted on it): forward/up offsets in world units, pitch (+ = nose up). */
	readonly body: {readonly forward: number; readonly up: number; readonly pitch: number};
	readonly neck: number;
	readonly legs: Record<LegKey, LegAngles>;
	/** Extra tail rotation (+ = up) added to the wag. */
	readonly tail: number;
	/**
	 * Optional slide of a leg's mount inside the body (units; x + = forward, y + = down): the scapula / pelvis
	 * movement of the walk. The leg's top stays hidden inside the torso.
	 */
	readonly mountShift?: Partial<Record<LegKey, Pt>>;
};

export const REST_LEG: LegAngles = {upper: 0, lower: 0, paw: 0};

export const STAND_POSE: SidePose = {
	body: {forward: 0, up: 0, pitch: 0},
	neck: 0,
	legs: {frontNear: REST_LEG, frontFar: REST_LEG, hindNear: REST_LEG, hindFar: REST_LEG},
	tail: 0,
};

export type SideSpots = {
	readonly torso: readonly BadgerSpot[];
	readonly neck: readonly BadgerSpot[];
	readonly legFrontNear: readonly BadgerSpot[];
	readonly legHindNear: readonly BadgerSpot[];
	readonly tail: readonly BadgerSpot[];
};

export const spotsByPart = (spots: readonly BadgerSpot[]): SideSpots => ({
	torso: spots.filter((s) => s.part === 'torso'),
	neck: spots.filter((s) => s.part === 'neck'),
	legFrontNear: spots.filter((s) => s.part === 'legFrontNear'),
	legHindNear: spots.filter((s) => s.part === 'legHindNear'),
	tail: spots.filter((s) => s.part === 'tail'),
});

/** Neck for a side rig (drawn BEHIND the torso; the collar hides the seam). Origin = neck base pivot. */
const NeckSide: React.FC<{geom: SideRig['neck']; uid: string; spots: readonly BadgerSpot[]}> = ({geom, uid, spots}) => (
	<PartShape geom={geom} clipId={`${uid}-neck`}>
		<SpotShapes spots={spots} />
	</PartShape>
);

/** A head mount's replacement nape (neck-local): coat fill over the old back line, then the new back line. */
const NapeSide: React.FC<{nape: NonNullable<HeadMount['nape']>}> = ({nape}) => {
	const L = useStrokes();
	return (
		<g>
			<path d={nape.fill} fill={BADGER_COLORS.coat} />
			<path d={nape.stroke} {...L.stroke} />
		</g>
	);
};

/** Collar + tag for a side rig; the tag counter-rotates about its ring so it always hangs plumb. */
const CollarSide: React.FC<{geom: SideRig['neck']; worldAngle: number}> = ({geom, worldAngle}) => {
	const a = geom.tagAnchor;
	const L = useStrokes();
	return (
		<g>
			<path d={geom.collar} fill={BADGER_COLORS.collar} />
			<path d={geom.collarShadow} fill={BADGER_COLORS.collarShadow} />
			<path d={geom.collar} {...L.stroke} />
			<g transform={`rotate(${-worldAngle} ${a.x} ${a.y})`}>
				<path d={`${geom.tagRing} Z`} {...L.stroke} fill={BRAND.silver} strokeWidth={LINE.detailWidth * L.k} />
				<path d={geom.tag} fill={BADGER_COLORS.tag} />
				<path d={geom.tagShadow} fill={BADGER_COLORS.tagShadow} />
				<path d={geom.tag} {...L.stroke} strokeWidth={LINE.detailWidth * 1.1 * L.k} />
			</g>
		</g>
	);
};

const svgLeg = (a: LegAngles, dir: number): LegAngles => ({upper: -dir * a.upper, lower: -dir * a.lower, paw: -dir * a.paw});

/**
 * One side view of BADGER built from a traced rig. dir = -1 faces screen left (LEFT_RIG, left markings),
 * dir = +1 faces screen right (RIGHT_RIG, right markings). Part order, back to front: far hind leg, far front
 * leg (coatShadow, no markings), tail, neck, torso, near hind leg, near front leg, collar+tag, head.
 */
export const SideBody: React.FC<{
	rig: SideRig;
	dir: 1 | -1;
	spots: SideSpots;
	/** Back-line height in torso-local units (breathing scales the chest about it). */
	backLineY: number;
	head: BadgerHead;
	headMount: HeadMount;
	headState: HeadState;
	headTilt: number;
	tailWag: number;
	breath: number;
	neckTurn: number;
	pose: SidePose;
	/** Optional replacement for the near hind leg (folded haunch in sit / lie). */
	hindNearOverride?: React.ReactNode;
	hindFarOverride?: React.ReactNode;
	uidPrefix: string;
}> = ({rig: R, dir, spots, backLineY, head, headMount: hm, headState, headTilt, tailWag, breath, neckTurn, pose, hindNearOverride, hindFarOverride, uidPrefix}) => {
	const uid = useUid(uidPrefix);
	const M = R.mounts;
	const pitchSvg = -dir * pose.body.pitch;
	const neckAngle = hm.neck - dir * (neckTurn + pose.neck);
	const neckT = `${tr(M.neck, neckAngle)} translate(0 ${(-breath * 0.6).toFixed(2)})`;
	const headT = `${neckT} translate(${R.neck.headMount.x + hm.dx} ${R.neck.headMount.y + hm.dy}) rotate(${hm.rot + headTilt * (dir === 1 ? -1 : 1)})`;
	const breathT = `translate(0 ${backLineY}) scale(1 ${(1 + breath * 0.015).toFixed(4)}) translate(0 ${-backLineY})`;
	// restrained wag: a swing about the root plus follow-through curl toward the tip (asymmetric: up-and-out)
	const ph = tailWag * Math.PI * 2;
	const sw = Math.sin(ph);
	const sb = Math.sin(ph - 0.9);
	const wagUp = tailWag ? (sw > 0 ? 4.5 : 10) * sw : 0;
	const bendUp = tailWag ? (sb > 0 ? 5 : 11) * sb : 0;
	// wagUp/bendUp use the left rig's SVG sign (negative = tip up); the right rig's tail hangs the other way
	const tailUp = dir === -1 ? -pose.tail : pose.tail;
	const wag = (dir === -1 ? wagUp : -wagUp) + tailUp;
	const bend = dir === -1 ? bendUp : -bendUp;
	const T = R.torso.pivot;
	const rootT = `translate(${T.x + dir * pose.body.forward} ${T.y - pose.body.up}) rotate(${pitchSvg})`;
	const L = pose.legs;
	const ms = pose.mountShift ?? {};
	const mnt = (k: LegKey, p: Pt): Pt => {
		const d = ms[k];
		return d ? {x: p.x + dir * d.x, y: p.y + d.y} : p;
	};
	return (
		<g transform={rootT}>
			{hindFarOverride ?? <Leg geom={R.legHind} mount={mnt('hindFar', M.legHindFar)} angles={svgLeg(L.hindFar, dir)} uid={`${uid}-hf`} far />}
			<Leg geom={R.legFront} mount={mnt('frontFar', M.legFrontFar)} angles={svgLeg(L.frontFar, dir)} uid={`${uid}-ff`} far />
			<Tail geom={R.tail} mount={M.tail} wag={wag} bend={bend} uid={uid} />
			<g transform={neckT}>
				<NeckSide geom={R.neck} uid={uid} spots={spots.neck} />
				{hm.nape ? <NapeSide nape={hm.nape} /> : null}
			</g>
			{/* the near thigh's and near upper foreleg's top edges, under the torso: outlined only where a swing pushes them out
			    past the rump or the chest (D35) */}
			{hindNearOverride ? null : (
				<Leg geom={R.legHind} mount={mnt('hindNear', M.legHindNear)} angles={svgLeg(L.hindNear, dir)} uid={`${uid}-hnu`} pass="underlay" />
			)}
			<Leg geom={R.legFront} mount={mnt('frontNear', M.legFrontNear)} angles={svgLeg(L.frontNear, dir)} uid={`${uid}-fnu`} pass="underlay" />
			<g transform={breathT}>
				<PartShape geom={R.torso} clipId={`${uid}-torso`}>
					<SpotShapes spots={spots.torso} />
				</PartShape>
			</g>
			{hindNearOverride ?? (
				<Leg geom={R.legHind} mount={mnt('hindNear', M.legHindNear)} angles={svgLeg(L.hindNear, dir)} uid={`${uid}-hn`} spots={spots.legHindNear} />
			)}
			<Leg geom={R.legFront} mount={mnt('frontNear', M.legFrontNear)} angles={svgLeg(L.frontNear, dir)} uid={`${uid}-fn`} spots={spots.legFrontNear} />
			<g transform={neckT}>
				<CollarSide geom={R.neck} worldAngle={neckAngle + pitchSvg} />
			</g>
			<g transform={headT}>
				<Head view={head} state={headState} />
			</g>
		</g>
	);
};
