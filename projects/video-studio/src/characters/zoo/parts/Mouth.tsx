/**
 * MouthShape-driven mouth. Drawn on the face skin between the moustache (above, drawn later) and
 * the chin beard (whose lip patch drops by the shape's `hole`), so every shape stays inside the
 * beard area. Expression modifiers (smirk corner lift, worried downturn, shocked open scale) are
 * applied on top of the library shape.
 */
import React from 'react';
import {LINE, ZOO_COLORS} from '../../palette';
import type {MouthShape} from '../../types';
import {clamp01, line, smooth, type Pt} from '../geometry';
import {MOUTHS, type MouthSpec} from '../mouth';
import {MOD0, PIVOTS, type MouthMod} from '../rig';
import {ZOO_LINE} from '../lines';
import {Clipped, Stroke, useLineScale} from './Shape';

const halfWidth = (spec: MouthSpec) => {
	const pts = spec.kind === 'line' ? spec.line : [...spec.top, ...spec.bottom];
	return Math.max(...pts.map((p) => Math.abs(p[0])));
};

/**
 * The drawing for a mouth: the library shape, or the expression's own drawing of it when the expression has one and no
 * explicit mouth was passed (repair round 4, ZOO-E3: shocked). Heads pass EXPRESSIONS[e].mouthSpec only in that case.
 */
export const mouthSpecFor = (shape: MouthShape, override?: MouthSpec): MouthSpec => override ?? MOUTHS[shape];

/** Drops for the beard/jaw after modifiers (used by the head to keep the beard coherent). */
export const mouthDrops = (shape: MouthShape, mod: MouthMod, override?: MouthSpec) => {
	const s = mouthSpecFor(shape, override);
	return {hole: s.hole * (s.hole > 0 ? mod.openScale : 1), jaw: s.jaw * (s.jaw > 0 ? mod.openScale : 1)};
};

/** Maps a modified mouth-local point (origin = jaw anchor, front-view units) to head space. */
export type MouthProjection = (x: number, y: number) => readonly [number, number];
const FRONT_PROJECTION: MouthProjection = (x, y) => [PIVOTS.jaw.x + x, PIVOTS.jaw.y + y];

const makeMap = (spec: MouthSpec, mod: MouthMod, project: MouthProjection) => {
	const hw = halfWidth(spec);
	return (p: Pt): Pt => {
		const u = p[0] / hw; // -1..1
		const tR = Math.pow(clamp01((u - 0.15) / 0.85), 1.6);
		const tL = Math.pow(clamp01((-u - 0.15) / 0.85), 1.6);
		const lx = p[0] * mod.widthScale + mod.cornerR * 0.35 * tR - mod.cornerL * 0.35 * tL;
		const ly = p[1] * (spec.kind === 'open' ? mod.openScale : 1) - mod.cornerR * tR - mod.cornerL * tL + mod.wave * 0.8 * Math.sin(u * Math.PI);
		const [x, y] = project(lx, ly);
		return p.length === 3 ? [x, y, 'c'] : [x, y];
	};
};

/**
 * `project` lets other views reuse the same library: it receives the modified mouth-local point
 * (front-view units, anatomical left = +x) and returns head-space coordinates. It never mirrors.
 */
export const Mouth: React.FC<{shape: MouthShape; mod?: MouthMod; project?: MouthProjection; lineScale?: number; spec?: MouthSpec}> = ({
	shape,
	mod = MOD0,
	project = FRONT_PROJECTION,
	lineScale = 1,
	spec: override,
}) => {
	const spec = mouthSpecFor(shape, override);
	const M = makeMap(spec, mod, project);
	const ls = useLineScale();
	if (spec.kind === 'line') {
		// The sheet's closed mouth is a thin dark-brown lip line (core #5C3D2C ~ beardShadow) with the pale lower lip below.
		return (
			<g data-part="mouth" data-shape={shape}>
				{spec.lowerLip ? <Stroke d={line(spec.lowerLip.map(M))} width={ZOO_LINE.fine} color={ZOO_COLORS.skinShadow} /> : null}
				{mod.cornerR > 2 ? <Stroke name="smirkLip" d={line(([[-8, 3.4], [1, 4.4], [7, 3.8], [11.5, 2.2]] as Pt[]).map(M))} width={ZOO_LINE.fine} color={ZOO_COLORS.skinShadow} /> : null}
				<Stroke name="lipLine" d={line(spec.line.map(M))} width={spec.width * lineScale} color={ZOO_COLORS.beardShadow} />
			</g>
		);
	}
	const opening = smooth([...spec.top, ...spec.bottom].map(M));
	return (
		<g data-part="mouth" data-shape={shape} data-variant={override ? 'expression' : undefined}>
			<path d={opening} fill={ZOO_COLORS.mouthInterior} />
			<Clipped clip={opening}>
				{spec.cavity ? <path data-part="cavity" d={smooth(spec.cavity.map(M))} fill={ZOO_COLORS.brow} /> : null}
				{spec.tongue ? <path d={smooth(spec.tongue.map(M))} fill={ZOO_COLORS.tongue} /> : null}
				{spec.teeth ? (
					<>
						<path d={smooth(spec.teeth.shape.map(M))} fill={ZOO_COLORS.teeth} />
						<Stroke d={line(spec.teeth.divider.map(M))} width={ZOO_LINE.fine * 0.75} />
					</>
				) : null}
			</Clipped>
			<path d={opening} fill="none" stroke={LINE.color} strokeWidth={ZOO_LINE.feature * lineScale * ls} strokeLinejoin="round" />
		</g>
	);
};
