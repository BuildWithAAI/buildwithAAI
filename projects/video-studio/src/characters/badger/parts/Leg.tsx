import React from 'react';
import {BADGER_COLORS} from '../../palette';
import {PartShape, Pt, ShapeGeom, tr} from './shared';
import {SpotShapes} from './SpotShapes';
import type {BadgerSpot} from '../spots';

export type LegGeom = {
	readonly upper: ShapeGeom;
	readonly lowerPivot: Pt;
	readonly lower: ShapeGeom;
	readonly pawPivot: Pt;
	readonly paw: ShapeGeom;
};

export type LegAngles = {upper: number; lower: number; paw: number};

/**
 * A three-segment leg (upper / lower / paw). Each segment rotates about its own pivot; the chain is
 * composed explicitly so the draw order can be paw -> lower -> upper (each upper segment's fill
 * covers the joint of the one below it). Far legs pass `far` and are filled with the coat's single
 * shadow tone; they carry no visible spots (their markings face away from the camera).
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
	const color = far ? BADGER_COLORS.coatShadow : BADGER_COLORS.coat;
	const bySeg = (s: 'upper' | 'lower' | 'paw') => spots.filter((p) => (p.segment ?? 'upper') === s);
	return (
		<g>
			<g transform={pawT}>
				<PartShape geom={geom.paw} clipId={`${uid}-paw`} color={color}>
					<SpotShapes spots={bySeg('paw')} />
				</PartShape>
			</g>
			<g transform={lowerT}>
				<PartShape geom={geom.lower} clipId={`${uid}-low`} color={color}>
					<SpotShapes spots={bySeg('lower')} />
				</PartShape>
			</g>
			<g transform={upperT}>
				<PartShape geom={geom.upper} clipId={`${uid}-up`} color={color}>
					<SpotShapes spots={bySeg('upper')} />
				</PartShape>
			</g>
		</g>
	);
};
