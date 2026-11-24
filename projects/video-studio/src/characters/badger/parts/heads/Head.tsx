import React from 'react';
import {BADGER_COLORS, LINE} from '../../../palette';
import type {BadgerHead, Expression} from '../../../types';
import {DETAIL, STROKE, useUid} from '../shared';
import {HEAD_GEOM} from './headGeom';

type P = {readonly x: number; readonly y: number};
type ColorKey = 'coat' | 'coatShadow' | 'earCap' | 'earPaleInner' | 'spot' | 'nose' | 'mouth' | 'tongue';
type Fill = {readonly d: string; readonly color: string; readonly clip?: boolean};
type EarGeom = {
	readonly side: string;
	readonly pivot: P;
	readonly backRot: number;
	readonly backSx: number;
	readonly fills: readonly Fill[];
	readonly strokes: readonly string[];
	readonly details: readonly string[];
};
type EyeGeom = {
	readonly side: string;
	readonly c: P;
	readonly w: number;
	readonly up: number;
	readonly low: number;
	readonly drop: number;
	readonly inner: number;
	readonly irisR: number;
	readonly irisDX: number;
	readonly irisDY: number;
	readonly profile: boolean;
};
type BrowGeom = {readonly side: string; readonly outer: P; readonly mid: P; readonly inner: P};
type MouthGeom = {readonly strokes: readonly string[]; readonly details: readonly string[]; readonly fills: readonly Fill[]};
export type HeadViewGeom = {
	readonly earsBehind: readonly EarGeom[];
	readonly skull: {readonly fill: string; readonly strokes: readonly string[]; readonly details: readonly string[]};
	readonly shadows: readonly Fill[];
	readonly markings: readonly {readonly id: string; readonly d: string}[];
	readonly nose: {readonly d: string};
	readonly philtrum: string | null;
	readonly eyes: readonly EyeGeom[];
	readonly brows: readonly BrowGeom[];
	readonly mouth: Record<Expression, MouthGeom>;
	readonly earsFront: readonly EarGeom[];
};

const COLORS: Record<ColorKey, string> = {
	coat: BADGER_COLORS.coat,
	coatShadow: BADGER_COLORS.coatShadow,
	earCap: BADGER_COLORS.earCap,
	earPaleInner: BADGER_COLORS.earPaleInner,
	spot: BADGER_COLORS.spot,
	nose: BADGER_COLORS.nose,
	mouth: BADGER_COLORS.mouth,
	tongue: BADGER_COLORS.tongue,
};
const col = (k: string): string => COLORS[k as ColorKey] ?? BADGER_COLORS.coat;

export type HeadState = {
	expression: Expression;
	blink: number; // 0 open .. 1 closed
	judge: number; // 0..1
	earsBack: number; // 0..1
	lookX: number; // -1..1 iris shift (screen)
	lookY: number;
};

const f1 = (n: number) => (Math.round(n * 100) / 100).toString();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: P, b: P, t: number): P => ({x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)});
const pp = (p: P) => `${f1(p.x)} ${f1(p.y)}`;

/** Per-expression eye scaling: shocked widens the eye opening and shows more white. */
const EYE_SCALE: Record<Expression, {w: number; up: number; low: number; iris: number; open: number}> = {
	neutral: {w: 1, up: 1, low: 1, iris: 1, open: 1},
	happy: {w: 1, up: 0.96, low: 0.78, iris: 1, open: 0.97},
	worried: {w: 1, up: 1.08, low: 1.05, iris: 0.98, open: 1},
	shocked: {w: 1.08, up: 1.45, low: 1.4, iris: 0.86, open: 1},
};

/** Brow offsets (head-local units, + = down) per expression: [outer, mid, inner]. */
const BROW_DY: Record<Expression, [number, number, number]> = {
	neutral: [0, 0, 0],
	happy: [-1.2, -1.8, -1.2],
	worried: [1.8, -1.6, -6.5],
	shocked: [-5, -7, -5],
};
const JUDGE_DY: [number, number, number] = [-0.6, 1.6, 3.4];

const Eye: React.FC<{e: EyeGeom; st: HeadState; uid: string}> = ({e, st, uid}) => {
	const k = EYE_SCALE[st.expression];
	const w = e.w * k.w;
	const up = e.up * k.up;
	const low = e.low * k.low;
	const s = e.inner;
	const O = {x: e.c.x - s * w, y: e.c.y - e.drop / 2};
	const I = {x: e.c.x + s * w, y: e.c.y + e.drop / 2};
	const X = (t: number) => O.x + s * 2 * w * t;
	const u1 = {x: X(0.24), y: e.c.y - 1.333 * up - e.drop * 0.2};
	const u2 = {x: X(0.74), y: e.c.y - 1.333 * up + e.drop * 0.05};
	const l1 = {x: X(0.76), y: e.c.y + 1.333 * low + e.drop * 0.3};
	const l2 = {x: X(0.28), y: e.c.y + 1.333 * low + e.drop * 0.05};
	const almond = `M ${pp(O)} C ${pp(u1)} ${pp(u2)} ${pp(I)} C ${pp(l1)} ${pp(l2)} ${pp(O)} Z`;
	// lid openness: expression base, lowered by `judge`, closed by `blink`
	const open = Math.max(0, k.open * lerp(1, 0.56, st.judge) * (1 - st.blink));
	const k1 = lerpP(l2, u1, open);
	const k2 = lerpP(l1, u2, open);
	const lidCover = `M ${pp(O)} C ${pp(u1)} ${pp(u2)} ${pp(I)} C ${pp(k2)} ${pp(k1)} ${pp(O)} Z`;
	const lidLine = `M ${pp(O)} C ${pp(k1)} ${pp(k2)} ${pp(I)}`;
	const lowerLine = `M ${pp(I)} C ${pp(l1)} ${pp(l2)} ${pp(O)}`;
	const r = e.irisR * k.iris;
	const ic = {x: e.c.x + e.irisDX + st.lookX * w * 0.28, y: e.c.y + e.irisDY + st.lookY * up * 0.35};
	const clip = `${uid}-eye${e.side}`;
	const closed = open < 0.06;
	return (
		<g>
			<clipPath id={clip}>
				<path d={almond} />
			</clipPath>
			{!closed && (
				<>
					<path d={almond} fill={BADGER_COLORS.eyeWhite} />
					<g clipPath={`url(#${clip})`}>
						<circle cx={ic.x} cy={ic.y} r={r} fill={BADGER_COLORS.eyeIris} />
						<circle cx={ic.x} cy={ic.y} r={r * 0.46} fill={BADGER_COLORS.pupil} />
						<circle cx={ic.x - r * 0.34} cy={ic.y - r * 0.38} r={r * 0.2} fill={BADGER_COLORS.eyeWhite} />
						<path d={lidCover} fill={BADGER_COLORS.coat} />
					</g>
					<path d={lowerLine} {...DETAIL} strokeWidth={LINE.detailWidth * 0.8} />
				</>
			)}
			<path d={closed ? lowerLine : lidLine} {...STROKE} strokeWidth={LINE.width * (e.profile ? 0.95 : 1.15)} />
		</g>
	);
};

const Brow: React.FC<{b: BrowGeom; st: HeadState}> = ({b, st}) => {
	const dy = BROW_DY[st.expression];
	const j = st.judge;
	const o = {x: b.outer.x, y: b.outer.y + dy[0] + JUDGE_DY[0] * j};
	const m = {x: b.mid.x, y: b.mid.y + dy[1] + JUDGE_DY[1] * j};
	const i = {x: b.inner.x, y: b.inner.y + dy[2] + JUDGE_DY[2] * j};
	const c1 = lerpP(o, m, 2 / 3);
	const c2 = lerpP(i, m, 2 / 3);
	const d = `M ${pp(o)} C ${pp(c1)} ${pp(c2)} ${pp(i)}`;
	// soft grey brow always; a near-black brow line appears with expression intensity or judging
	const intensity = Math.max(st.expression === 'neutral' ? 0 : 1, j);
	return (
		<g>
			<path d={d} fill="none" stroke={BADGER_COLORS.brow} strokeWidth={LINE.detailWidth * 1.1} strokeLinecap="round" />
			{intensity > 0.02 ? <path d={d} {...DETAIL} strokeWidth={LINE.detailWidth * (0.45 + 0.65 * intensity)} /> : null}
		</g>
	);
};

const Ear: React.FC<{ear: EarGeom; earsBack: number; uid: string}> = ({ear, earsBack, uid}) => {
	const a = ear.backRot * earsBack;
	const sx = 1 - (1 - ear.backSx) * earsBack;
	const t = `translate(${f1(ear.pivot.x)} ${f1(ear.pivot.y)}) rotate(${f1(a)}) scale(${f1(sx)} 1) translate(${f1(-ear.pivot.x)} ${f1(-ear.pivot.y)})`;
	const clip = `${uid}-ear${ear.side}`;
	const base = ear.fills.find((x) => !x.clip);
	return (
		<g transform={t}>
			{base ? (
				<clipPath id={clip}>
					<path d={ear.fills[0].d} />
				</clipPath>
			) : null}
			{ear.fills.map((x, i) =>
				x.clip ? (
					<g key={i} clipPath={`url(#${clip})`}>
						<path d={x.d} fill={col(x.color)} />
					</g>
				) : (
					<path key={i} d={x.d} fill={col(x.color)} />
				),
			)}
			{ear.strokes.map((d, i) => (
				<path key={`s${i}`} d={d} {...STROKE} />
			))}
			{ear.details.map((d, i) => (
				<path key={`d${i}`} d={d} {...DETAIL} />
			))}
		</g>
	);
};

export const headGeom = (view: BadgerHead): HeadViewGeom => {
	const g = (HEAD_GEOM as unknown as Record<string, HeadViewGeom | undefined>)[view];
	return g ?? (HEAD_GEOM.front as unknown as HeadViewGeom);
};

/** One replaceable head view in head-local space (origin = the head pivot on the neck). */
export const Head: React.FC<{view: BadgerHead; state: HeadState}> = ({view, state}) => {
	const uid = useUid('bh');
	const g = headGeom(view);
	const m = g.mouth[state.expression];
	const skullClip = `${uid}-skull`;
	return (
		<g data-head={view}>
			{g.earsBehind.map((e) => (
				<Ear key={e.side} ear={e} earsBack={state.earsBack} uid={`${uid}b`} />
			))}
			<clipPath id={skullClip}>
				<path d={g.skull.fill} />
			</clipPath>
			<path d={g.skull.fill} fill={BADGER_COLORS.coat} />
			<g clipPath={`url(#${skullClip})`}>
				{g.shadows.map((s, i) => (
					<path key={i} d={s.d} fill={col(s.color)} />
				))}
				{g.markings.map((s) => (
					<path key={s.id} d={s.d} fill={BADGER_COLORS.spot} data-spot={s.id} />
				))}
			</g>
			{g.skull.strokes.map((d, i) => (
				<path key={`s${i}`} d={d} {...STROKE} />
			))}
			{g.skull.details.map((d, i) => (
				<path key={`d${i}`} d={d} {...DETAIL} />
			))}
			{m.fills.map((x, i) => (
				<path key={`mf${i}`} d={x.d} fill={col(x.color)} />
			))}
			{g.philtrum && state.expression !== 'shocked' ? <path d={g.philtrum} {...DETAIL} /> : null}
			{m.strokes.map((d, i) => (
				<path key={`ms${i}`} d={d} {...STROKE} />
			))}
			{m.details.map((d, i) => (
				<path key={`md${i}`} d={d} {...DETAIL} />
			))}
			<path d={g.nose.d} fill={BADGER_COLORS.nose} {...{stroke: LINE.color, strokeWidth: LINE.width, strokeLinejoin: 'round' as const}} />
			{g.eyes.map((e) => (
				<Eye key={e.side} e={e} st={state} uid={uid} />
			))}
			{g.brows.map((b) => (
				<Brow key={b.side} b={b} st={state} />
			))}
			{g.earsFront.map((e) => (
				<Ear key={e.side} ear={e} earsBack={state.earsBack} uid={`${uid}f`} />
			))}
		</g>
	);
};
