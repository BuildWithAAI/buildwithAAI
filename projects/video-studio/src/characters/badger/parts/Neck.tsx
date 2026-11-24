import React from 'react';
import {BADGER_COLORS, BRAND, LINE} from '../../palette';
import {FRONT_NECK_SPOTS, spotsFor} from '../spots';
import {FRONT_NECK_GEOM} from './heads/headGeom';
import {LEFT_RIG} from './rigLeft';
import {PartShape, useStrokes, useUid} from './shared';
import {SpotShapes} from './SpotShapes';

const N = LEFT_RIG.neck;

/** Left-view neck (drawn BEHIND the torso; the collar hides the seam). Local origin = neck base pivot. */
export const NeckLeft: React.FC<{uid: string}> = ({uid}) => (
	<PartShape geom={N} clipId={`${uid}-neck`}>
		<SpotShapes spots={spotsFor('neck')} />
	</PartShape>
);

/**
 * Collar + tag for the left view. Rendered in its own layer ABOVE the torso but with the neck's
 * transform. The tag hangs from the collar ring and counter-rotates so it always hangs plumb.
 */
export const CollarLeft: React.FC<{neckAngle: number}> = ({neckAngle}) => {
	const a = N.tagAnchor;
	const L = useStrokes();
	return (
		<g>
			<path d={N.collar} fill={BADGER_COLORS.collar} />
			<path d={N.collarShadow} fill={BADGER_COLORS.collarShadow} />
			<path d={N.collar} {...L.stroke} />
			<g transform={`rotate(${-neckAngle} ${a.x} ${a.y})`}>
				<path d={`${N.tagRing} Z`} {...L.stroke} fill={BRAND.silver} strokeWidth={LINE.detailWidth * L.k} />
				<path d={N.tag} fill={BADGER_COLORS.tag} />
				<path d={N.tagShadow} fill={BADGER_COLORS.tagShadow} />
				<path d={N.tag} {...L.stroke} strokeWidth={LINE.detailWidth * 1.1 * L.k} />
			</g>
		</g>
	);
};

/** Front-facing neck, collar and round teal tag (bust used under front heads). Origin = neck centre at the collar. */
export const NeckFront: React.FC = () => {
	const uid = useUid('bnf');
	const g = FRONT_NECK_GEOM;
	const L = useStrokes();
	return (
		<g>
			<PartShape geom={{fill: g.fill, strokes: g.strokes, details: g.details}} clipId={`${uid}-n`}>
				<SpotShapes spots={FRONT_NECK_SPOTS} />
			</PartShape>
			<path d={g.collar} fill={BADGER_COLORS.collar} />
			<path d={g.collarShadow} fill={BADGER_COLORS.collarShadow} />
			<path d={g.collar} {...L.stroke} />
			<path d={`${g.tagRing} Z`} {...L.stroke} fill={BRAND.silver} strokeWidth={LINE.detailWidth * L.k} />
			<path d={g.tag} fill={BADGER_COLORS.tag} />
			<path d={g.tagShadow} fill={BADGER_COLORS.tagShadow} />
			<path d={g.tag} {...L.stroke} strokeWidth={LINE.detailWidth * 1.2 * L.k} />
		</g>
	);
};
