import React from 'react';
import {BADGER_COLORS, BRAND, LINE} from '../../palette';
import type {BadgerSpot} from '../spots';
import {Pt, useStrokes, useUid} from './shared';
import {SpotShapes} from './SpotShapes';
import {bendPath} from './Tail';

/**
 * Renderer for the traced non-side body views (front, back, three-quarter) and the sit / lie pose bodies.
 * A view is a list of parts in draw order; every part is a solid fill, its own markings clipped to it, then its
 * open outline strokes and detail lines. Animated groups: 'tail' (wag = bend about the tail root), 'torso'
 * (breathing about the 'breath' pivot), 'neck' / 'neckBack' / 'tag' / 'headBack' (neck turn about the 'neck'
 * pivot; the tag counter-rotates so it hangs plumb). The replaceable head and any extra node (e.g. the front
 * neck bust) are inserted after a named part.
 */
export type ViewPart = {
	readonly id: string;
	readonly color: string;
	readonly group: string | null;
	readonly fill: string;
	readonly strokes: readonly string[];
	readonly details: readonly string[];
	readonly strokeWidth?: number;
};

export type ViewRig = {readonly parts: readonly ViewPart[]; readonly pivots: Readonly<Record<string, Pt>>};

const COLOR: Record<string, string> = {
	coat: BADGER_COLORS.coat,
	coatShadow: BADGER_COLORS.coatShadow,
	earCap: BADGER_COLORS.earCap,
	collar: BADGER_COLORS.collar,
	collarShadow: BADGER_COLORS.collarShadow,
	tag: BADGER_COLORS.tag,
	tagShadow: BADGER_COLORS.tagShadow,
	spot: BADGER_COLORS.spot,
	silver: BRAND.silver, // the tag's split ring
};

const NUM = /-?\d*\.?\d+(?:e-?\d+)?/g;
/** Shift every coordinate pair of an absolute M/L/C path. */
export const shiftPath = (d: string, dx: number, dy: number): string => {
	let i = 0;
	return d.replace(NUM, (m) => {
		const v = Number(m) + (i++ % 2 === 0 ? dx : dy);
		return (Math.round(v * 100) / 100).toString();
	});
};

export type Insert = {readonly after: string; readonly node: React.ReactNode; readonly group?: string};

export const ViewBody: React.FC<{
	rig: ViewRig;
	spots: readonly BadgerSpot[];
	tailWag: number;
	/** Extra tail rotation (deg) added to the wag (e.g. the tail lying on the ground). */
	tailBase?: number;
	breath: number;
	neckTurn: number;
	inserts?: readonly Insert[];
	hide?: readonly string[];
	uidPrefix: string;
}> = ({rig, spots, tailWag, tailBase = 0, breath, neckTurn, inserts = [], hide = [], uidPrefix}) => {
	const uid = useUid(uidPrefix);
	const L = useStrokes();
	const pv = rig.pivots;
	const ph = tailWag * Math.PI * 2;
	const wag = tailWag ? 9 * Math.sin(ph) + tailBase : tailBase;
	const bend = tailWag ? 10 * Math.sin(ph - 0.9) : 0;
	const tr = pv.tailRoot;
	const nk = pv.neck;
	const br = pv.breath;
	const ta = pv.tagAnchor;
	const groupT = (g: string | null): string | undefined => {
		if (g === 'torso' && br) return `translate(0 ${br.y}) scale(1 ${(1 + breath * 0.015).toFixed(4)}) translate(0 ${-br.y})`;
		if ((g === 'neck' || g === 'neckBack' || g === 'headBack' || g === 'tag' || g === 'head') && nk && neckTurn)
			return `rotate(${neckTurn} ${nk.x} ${nk.y})`;
		return undefined;
	};
	const tailLen = (p: ViewPart) => {
		const n = (p.fill.match(NUM) ?? []).map(Number);
		let m = 1;
		for (let i = 0; i + 1 < n.length; i += 2) m = Math.max(m, Math.hypot(n[i] - (tr?.x ?? 0), n[i + 1] - (tr?.y ?? 0)));
		return m;
	};
	const out: React.ReactNode[] = [];
	for (const p of rig.parts) {
		if (hide.includes(p.id)) continue;
		let fill = p.fill;
		let strokes = p.strokes;
		let details = p.details;
		let t = groupT(p.group);
		if (p.group === 'tail' && tr && (wag || bend)) {
			const len = tailLen(p);
			const b = (d: string) => shiftPath(bendPath(shiftPath(d, -tr.x, -tr.y), wag, bend, len), tr.x, tr.y);
			fill = b(fill);
			strokes = strokes.map(b);
			details = details.map(b);
		}
		if (p.group === 'tag' && ta && nk && neckTurn) t = `${t ?? ''} rotate(${-neckTurn} ${ta.x} ${ta.y})`;
		const own = spots.filter((s) => s.part === p.id);
		const clip = `${uid}-${p.id}`;
		const sw = (p.strokeWidth ?? (p.id === 'tagRing' ? LINE.detailWidth : LINE.width)) * L.k;
		out.push(
			<g key={p.id} transform={t} data-part={p.id}>
				{p.color !== 'none' ? <path d={fill} fill={COLOR[p.color] ?? BADGER_COLORS.coat} /> : null}
				{own.length ? (
					<>
						<clipPath id={clip}>
							<path d={fill} />
						</clipPath>
						<g clipPath={`url(#${clip})`}>
							<SpotShapes spots={own} />
						</g>
					</>
				) : null}
				{strokes.map((d, i) => (
					<path key={`s${i}`} d={d} {...L.stroke} strokeWidth={sw} />
				))}
				{details.map((d, i) => (
					<path key={`d${i}`} d={d} {...L.detail} />
				))}
			</g>,
		);
		for (const ins of inserts.filter((x) => x.after === p.id)) {
			out.push(
				<g key={`ins-${p.id}-${out.length}`} transform={groupT(ins.group ?? null)}>
					{ins.node}
				</g>,
			);
		}
	}
	return <g>{out}</g>;
};
