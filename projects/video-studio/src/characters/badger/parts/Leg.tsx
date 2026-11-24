import React from 'react';
import {BADGER_COLORS} from '../../palette';
import {DETAIL, Pt, STROKE, ShapeGeom, tr} from './shared';
import {SpotShapes} from './SpotShapes';
import type {BadgerSpot} from '../spots';

export type LegGeom = {
	readonly upper: ShapeGeom;
	readonly lowerPivot: Pt;
	readonly lower: ShapeGeom;
	readonly pawPivot: Pt;
	readonly paw: ShapeGeom;
	/** Radius of the round cut-out joint at the lower pivot (wrist / hock) and at the paw pivot. */
	readonly lowerJointR?: number;
	readonly pawJointR?: number;
};

export type LegAngles = {upper: number; lower: number; paw: number};

const circle = (r: number) => `M ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 Z`;

type SegKey = 'upper' | 'lower' | 'paw';
const SEGS: readonly SegKey[] = ['paw', 'lower', 'upper'];
const BIG = {x: -3000, y: -3000, width: 6000, height: 6000};

/**
 * A three-segment leg (upper / lower / paw). Each segment rotates about its own pivot; the chain is
 * composed explicitly. Far legs pass `far` and are filled with the coat's single shadow tone; they carry no
 * visible spots (their markings face away from the camera).
 *
 * The leg is drawn as ONE outlined shape: the segment fills go down first (paw, lower, upper), then each
 * segment's outline is drawn through a hard-edged occlusion mask made of the OTHER segments' fills, so an
 * outline never shows inside the leg when a joint bends. Joints are round cut-out joints: parent and child
 * meet on a flat cut through the pivot, and a disk of the joint radius behind them fills the bend; its outline
 * shows only where a bend exposes it. Masks are binary occlusion only (no soft edges, no shading).
 */
export const Leg: React.FC<{
	geom: LegGeom;
	mount: Pt;
	angles: LegAngles;
	uid: string;
	far?: boolean;
	spots?: readonly BadgerSpot[];
}> = ({geom, mount, angles, uid, far, spots = []}) => {
	const upperT = tr(mount, angles.upper);
	const lowerT = `${upperT} ${tr(geom.lowerPivot, angles.lower)}`;
	const pawT = `${lowerT} ${tr(geom.pawPivot, angles.paw)}`;
	const T: Record<SegKey, string> = {upper: upperT, lower: lowerT, paw: pawT};
	const color = far ? BADGER_COLORS.coatShadow : BADGER_COLORS.coat;
	const bySeg = (s: SegKey) => spots.filter((p) => (p.segment ?? 'upper') === s);
	const bent = Math.abs(angles.lower) > 0.5 || Math.abs(angles.paw) > 0.5;
	const rl = geom.lowerJointR;
	const rp = geom.pawJointR;
	const maskOf = (k: SegKey | 'joint') => `${uid}-m${k}`;
	const masks = (['paw', 'lower', 'upper', 'joint'] as const).map((k) => (
		<mask key={k} id={maskOf(k)} maskUnits="userSpaceOnUse" {...BIG}>
			<rect {...BIG} fill="#FFFFFF" />
			{SEGS.filter((s) => s !== k || false).filter((s) => k === 'joint' || s !== k).map((s) => (
				<path key={s} d={geom[s].fill} transform={T[s]} fill="#000000" />
			))}
		</mask>
	));
	return (
		<g>
			{masks}
			{rl ? <path d={circle(rl)} transform={lowerT} fill={color} /> : null}
			{rp ? <path d={circle(rp)} transform={pawT} fill={color} /> : null}
			{SEGS.map((s) => (
				<g key={s} transform={T[s]}>
					<clipPath id={`${uid}-c${s}`}>
						<path d={geom[s].fill} />
					</clipPath>
					<path d={geom[s].fill} fill={color} />
					{bySeg(s).length ? (
						<g clipPath={`url(#${uid}-c${s})`}>
							<SpotShapes spots={bySeg(s)} />
						</g>
					) : null}
				</g>
			))}
			{SEGS.map((s) => (
				<g key={`o${s}`} mask={`url(#${maskOf(s)})`}>
					<g transform={T[s]}>
						{geom[s].strokes.map((d, i) => (
							<path key={`s${i}`} d={d} {...STROKE} />
						))}
						{geom[s].details.map((d, i) => (
							<path key={`d${i}`} d={d} {...DETAIL} />
						))}
					</g>
				</g>
			))}
			{bent && (rl || rp) ? (
				<g mask={`url(#${maskOf('joint')})`}>
					<g>
						{rl ? <path d={circle(rl)} transform={lowerT} {...STROKE} /> : null}
						{rp ? <path d={circle(rp)} transform={pawT} {...STROKE} /> : null}
					</g>
				</g>
			) : null}
		</g>
	);
};
