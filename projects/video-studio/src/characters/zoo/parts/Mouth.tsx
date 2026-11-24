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
import {Clipped, Stroke} from './Shape';

const halfWidth = (spec: MouthSpec) => {
	const pts = spec.kind === 'line' ? spec.line : [...spec.top, ...spec.bottom];
	return Math.max(...pts.map((p) => Math.abs(p[0])));
};

/** Drops for the beard/jaw after modifiers (used by the head to keep the beard coherent). */
export const mouthDrops = (shape: MouthShape, mod: MouthMod) => {
	const s = MOUTHS[shape];
	return {hole: s.hole * (s.hole > 0 ? mod.openScale : 1), jaw: s.jaw * (s.jaw > 0 ? mod.openScale : 1)};
};

const makeMap = (spec: MouthSpec, mod: MouthMod) => {
	const hw = halfWidth(spec);
	const ax = PIVOTS.jaw.x;
	const ay = PIVOTS.jaw.y;
	return (p: Pt): Pt => {
		const u = p[0] / hw; // -1..1
		const tR = Math.pow(clamp01((u - 0.15) / 0.85), 1.6);
		const tL = Math.pow(clamp01((-u - 0.15) / 0.85), 1.6);
		const x = ax + p[0] * mod.widthScale + mod.cornerR * 0.35 * tR - mod.cornerL * 0.35 * tL;
		const y = ay + p[1] * (spec.kind === 'open' ? mod.openScale : 1) - mod.cornerR * tR - mod.cornerL * tL + mod.wave * 0.8 * Math.sin(u * Math.PI);
		return p.length === 3 ? [x, y, 'c'] : [x, y];
	};
};

export const Mouth: React.FC<{shape: MouthShape; mod?: MouthMod}> = ({shape, mod = MOD0}) => {
	const spec = MOUTHS[shape];
	const M = makeMap(spec, mod);
	if (spec.kind === 'line') {
		return (
			<g data-part="mouth" data-shape={shape}>
				{spec.lowerLip ? <Stroke d={line(spec.lowerLip.map(M))} width={1.6} color={ZOO_COLORS.skinShadow} /> : null}
				<Stroke d={line(spec.line.map(M))} width={spec.width} />
			</g>
		);
	}
	const opening = smooth([...spec.top, ...spec.bottom].map(M));
	return (
		<g data-part="mouth" data-shape={shape}>
			<path d={opening} fill={ZOO_COLORS.mouthInterior} />
			<Clipped clip={opening}>
				{spec.tongue ? <path d={smooth(spec.tongue.map(M))} fill={ZOO_COLORS.tongue} /> : null}
				{spec.teeth ? (
					<>
						<path d={smooth(spec.teeth.shape.map(M))} fill={ZOO_COLORS.teeth} />
						<Stroke d={line(spec.teeth.divider.map(M))} width={1.1} />
					</>
				) : null}
			</Clipped>
			<path d={opening} fill="none" stroke={LINE.color} strokeWidth={LINE.detailWidth} strokeLinejoin="round" />
		</g>
	);
};
