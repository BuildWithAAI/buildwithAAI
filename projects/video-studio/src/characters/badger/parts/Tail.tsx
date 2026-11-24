import React from 'react';
import {BADGER_COLORS} from '../../palette';
import {PartShape, Pt, ShapeGeom} from './shared';

/**
 * Bends an authored path about the tail root: every point rotates by `wag + bend * (d / len)^1.6`
 * where d is its distance from the root (origin). The root stays put, the tip curls the most, and
 * the shape stays a smooth cubic path because control points are transformed with the same field.
 */
export const bendPath = (d: string, wag: number, bend: number, len: number): string => {
	if (!wag && !bend) return d;
	const toks = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
	const out: string[] = [];
	let i = 0;
	while (i < toks.length) {
		const t = toks[i];
		if (/[A-Za-z]/.test(t)) {
			out.push(t);
			i++;
			continue;
		}
		const x = Number(toks[i]);
		const y = Number(toks[i + 1]);
		i += 2;
		const r = Math.hypot(x, y);
		const a = ((wag + bend * Math.pow(Math.min(1.2, r / len), 1.6)) * Math.PI) / 180;
		const c = Math.cos(a);
		const s = Math.sin(a);
		out.push(`${(x * c - y * s).toFixed(2)} ${(x * s + y * c).toFixed(2)}`);
	}
	return out.join(' ');
};

export type TailGeom = ShapeGeom & {readonly tip: Pt};

/** Tail part (drawn behind the torso). Origin = tail root pivot. */
export const Tail: React.FC<{geom: TailGeom; mount: Pt; wag: number; bend: number; uid: string}> = ({geom, mount, wag, bend, uid}) => {
	const len = Math.hypot(geom.tip.x, geom.tip.y);
	const bent: ShapeGeom = {
		fill: bendPath(geom.fill, wag, bend, len),
		strokes: geom.strokes.map((d) => bendPath(d, wag, bend, len)),
		details: geom.details.map((d) => bendPath(d, wag, bend, len)),
	};
	return (
		<g transform={`translate(${mount.x} ${mount.y})`}>
			<PartShape geom={bent} clipId={`${uid}-tail`} color={BADGER_COLORS.coat} />
		</g>
	);
};
