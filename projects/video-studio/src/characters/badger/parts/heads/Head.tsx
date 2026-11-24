import React from 'react';
import {BADGER_COLORS, LINE} from '../../../palette';
import type {BadgerHead, Expression} from '../../../types';
import {useStrokes, useUid} from '../shared';
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
	/** Rotation of the eye almond in degrees (pitched heads). */
	readonly rot: number;
};
type BrowGeom = {readonly side: string; readonly outer: P; readonly mid: P; readonly inner: P};
type MouthGeom = {readonly strokes: readonly string[]; readonly details: readonly string[]; readonly fills: readonly Fill[]};
export type HeadViewGeom = {
	/** Optional jaw-to-neck bridge drawn under the skull (profiles / looking up). */
	readonly throat: {readonly fill: string; readonly stroke: string} | null;
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
	/** 3/4 views: clip the mouth to the skull so the far lip line hides behind the snout. */
	readonly clipMouth: boolean;
	/** 3/4 views: the lower-jaw contour. */
	readonly chin: string | null;
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
	/** 0..1 mouth opening driven by a real-dog sound clip's amplitude (owner request); 0 = the expression's own mouth. */
	mouthOpen?: number;
};

/** Below this, mouthOpen leaves the expression's mouth untouched (amplitude noise floor). */
const MOUTH_OPEN_MIN = 0.06;

/** Scale a path's y about `y0` (the upper lip), so an open mouth grows downward from the lip. */
const scaleY = (d: string, y0: number, k: number): string => {
	let i = 0;
	return d.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (m) => (i++ % 2 === 1 ? f1(y0 + (Number(m) - y0) * k) : m));
};
const minY = (d: string): number => {
	const n = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
	let m = Infinity;
	for (let i = 1; i < n.length; i += 2) m = Math.min(m, n[i]);
	return m;
};

const f1 = (n: number) => (Math.round(n * 100) / 100).toString();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: P, b: P, t: number): P => ({x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)});
const pp = (p: P) => `${f1(p.x)} ${f1(p.y)}`;

/** Per-expression eye scaling: shocked widens the eye opening and shows more white. */
/** innerLift raises the inner half of the upper lid (worried), as a fraction of `up`. */
const EYE_SCALE: Record<
	Expression,
	{w: number; up: number; low: number; iris: number; open: number; irisUp: number; innerLift: number; drop: number}
> = {
	neutral: {w: 1, up: 1, low: 1, iris: 1, open: 1, irisUp: 0, innerLift: 0, drop: 1},
	happy: {w: 1, up: 0.95, low: 0.74, iris: 1, open: 0.96, irisUp: 0, innerLift: 0, drop: 0.9},
	worried: {w: 0.98, up: 1.12, low: 1.06, iris: 0.97, open: 1, irisUp: 0.22, innerLift: 0.35, drop: -0.25},
	shocked: {w: 1.06, up: 1.75, low: 1.45, iris: 0.8, open: 1, irisUp: 0, innerLift: 0, drop: 0.4},
};

/** Brow offsets (head-local units, + = down) per expression: [outer, mid, inner]. */
const BROW_DY: Record<Expression, [number, number, number]> = {
	neutral: [0, 0, 0],
	happy: [-0.4, -0.9, -0.4],
	worried: [2.4, -4.2, -8.5],
	shocked: [-5.5, -8, -5.5],
};
/** Brow-line darkness per expression (0 = only the soft grey brow). */
const BROW_INK: Record<Expression, number> = {neutral: 0, happy: 0.55, worried: 1, shocked: 1};
const JUDGE_DY: [number, number, number] = [-0.6, 1.6, 3.4];

const Eye: React.FC<{e: EyeGeom; st: HeadState; uid: string}> = ({e, st, uid}) => {
	const L = useStrokes();
	const k = EYE_SCALE[st.expression];
	const w = e.w * k.w;
	const up = e.up * k.up;
	const low = e.low * k.low;
	const s = e.inner;
	const drop = e.drop * k.drop;
	const O = {x: e.c.x - s * w, y: e.c.y - drop / 2};
	const I = {x: e.c.x + s * w, y: e.c.y + drop / 2};
	const X = (t: number) => O.x + s * 2 * w * t;
	const u1 = {x: X(0.24), y: e.c.y - 1.333 * up - drop * 0.2};
	const u2 = {x: X(0.74), y: e.c.y - 1.333 * up + drop * 0.05 - k.innerLift * up};
	const l1 = {x: X(0.76), y: e.c.y + 1.333 * low + drop * 0.3};
	const l2 = {x: X(0.28), y: e.c.y + 1.333 * low + drop * 0.05};
	const almond = `M ${pp(O)} C ${pp(u1)} ${pp(u2)} ${pp(I)} C ${pp(l1)} ${pp(l2)} ${pp(O)} Z`;
	// lid openness: expression base, lowered a little by `judge` (never below 0.86: the locked acting keeps the eyes open
	// between blinks; the judging look is carried by the brow, head angle and ears), closed by `blink`
	const open = Math.max(0, k.open * lerp(1, 0.86, st.judge) * (1 - st.blink));
	const k1 = lerpP(l2, u1, open);
	const k2 = lerpP(l1, u2, open);
	const lidCover = `M ${pp(O)} C ${pp(u1)} ${pp(u2)} ${pp(I)} C ${pp(k2)} ${pp(k1)} ${pp(O)} Z`;
	const lidLine = `M ${pp(O)} C ${pp(k1)} ${pp(k2)} ${pp(I)}`;
	const lowerLine = `M ${pp(I)} C ${pp(l1)} ${pp(l2)} ${pp(O)}`;
	// a closed eye is a nearly flat lid line (the full lower-lid curve read as a happy squint, worst on pitched heads)
	const closedLine = `M ${pp(I)} C ${pp(lerpP(lerpP(I, O, 0.24), l1, 0.4))} ${pp(lerpP(lerpP(I, O, 0.72), l2, 0.4))} ${pp(O)}`;
	const r = e.irisR * k.iris;
	const ic = {x: e.c.x + e.irisDX + st.lookX * w * 0.28, y: e.c.y + e.irisDY + st.lookY * up * 0.35 - k.irisUp * up};
	const clip = `${uid}-eye${e.side}`;
	const closed = open < 0.06;
	return (
		<g transform={e.rot ? `rotate(${e.rot} ${f1(e.c.x)} ${f1(e.c.y)})` : undefined}>
			<clipPath id={clip}>
				<path d={almond} />
			</clipPath>
			{!closed && (
				<>
					{/* profile eyes read as a small dark almond on the sheet: iris colour fills the almond, no white */}
					<path d={almond} fill={e.profile ? BADGER_COLORS.eyeIris : BADGER_COLORS.eyeWhite} />
					<g clipPath={`url(#${clip})`}>
						<circle cx={ic.x} cy={ic.y} r={r} fill={BADGER_COLORS.eyeIris} />
						<circle cx={ic.x} cy={ic.y} r={r * (e.profile ? 0.52 : 0.46)} fill={BADGER_COLORS.pupil} />
						<circle cx={ic.x - r * 0.34} cy={ic.y - r * 0.38} r={r * 0.2} fill={BADGER_COLORS.eyeWhite} />
						<path d={lidCover} fill={BADGER_COLORS.coat} />
					</g>
					<path d={lowerLine} {...L.detail} strokeWidth={LINE.detailWidth * 0.8 * L.k} />
				</>
			)}
			<path d={closed ? closedLine : lidLine} {...L.stroke} />
		</g>
	);
};

const Brow: React.FC<{b: BrowGeom; st: HeadState}> = ({b, st}) => {
	const L = useStrokes();
	const dy = BROW_DY[st.expression];
	const j = st.judge;
	const o = {x: b.outer.x, y: b.outer.y + dy[0] + JUDGE_DY[0] * j};
	const m = {x: b.mid.x, y: b.mid.y + dy[1] + JUDGE_DY[1] * j};
	const i = {x: b.inner.x, y: b.inner.y + dy[2] + JUDGE_DY[2] * j};
	const c1 = lerpP(o, m, 2 / 3);
	const c2 = lerpP(i, m, 2 / 3);
	const d = `M ${pp(o)} C ${pp(c1)} ${pp(c2)} ${pp(i)}`;
	// soft grey brow always; a near-black brow line appears with expression intensity or judging
	const intensity = Math.max(BROW_INK[st.expression], j);
	return (
		<g>
			<path d={d} fill="none" stroke={BADGER_COLORS.brow} strokeWidth={LINE.detailWidth * 1.1 * L.k} strokeLinecap="round" />
			{intensity > 0.02 ? <path d={d} {...L.detail} strokeWidth={LINE.detailWidth * (0.45 + 0.65 * intensity) * L.k} /> : null}
		</g>
	);
};

const Ear: React.FC<{ear: EarGeom; earsBack: number; lift?: number; uid: string}> = ({ear, earsBack, lift = 0, uid}) => {
	// earsBack swings the flap down/back about its base; `lift` (a vocalisation) perks it up a little the other way
	const L = useStrokes();
	const a = ear.backRot * (earsBack - 0.35 * lift);
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
				<path key={`s${i}`} d={d} {...L.stroke} />
			))}
			{ear.details.map((d, i) => (
				<path key={`d${i}`} d={d} {...L.detail} />
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
	const L = useStrokes();
	const g = headGeom(view);
	const skullClip = `${uid}-skull`;
	// judging folds the ears back slightly (part of the look is carried by the ears, not by heavier lids)
	const earsBack = Math.max(state.earsBack, 0.3 * state.judge);
	// mouthOpen: this view's own open-mouth drawing (the 'shocked' mouth) grows down from the upper lip with the amount;
	// the jaw line (the front head's first shocked stroke) stays put
	const open = Math.max(0, Math.min(1, state.mouthOpen ?? 0));
	const lift = open > MOUTH_OPEN_MIN ? open : 0;
	const m: MouthGeom = (() => {
		if (open <= MOUTH_OPEN_MIN || state.expression === 'shocked') return g.mouth[state.expression];
		const sh = g.mouth.shocked;
		if (!sh.fills.length) return g.mouth[state.expression];
		const y0 = minY(sh.fills[0].d);
		const k = lerp(0.3, 1, open);
		const opening = sh.strokes.length ? sh.strokes[sh.strokes.length - 1] : null;
		return {
			strokes: [...sh.strokes.slice(0, -1), ...(opening ? [scaleY(opening, y0, k)] : [])],
			details: sh.details,
			fills: sh.fills.map((x) => ({...x, d: scaleY(x.d, y0, k)})),
		};
	})();
	return (
		<g data-head={view}>
			{g.throat ? (
				<g>
					<path d={g.throat.fill} fill={BADGER_COLORS.coat} />
					<path d={g.throat.stroke} {...L.stroke} />
				</g>
			) : null}
			{g.earsBehind.map((e) => (
				<Ear key={e.side} ear={e} earsBack={earsBack} lift={lift} uid={`${uid}b`} />
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
				<path key={`s${i}`} d={d} {...L.stroke} />
			))}
			{g.skull.details.map((d, i) => (
				<path key={`d${i}`} d={d} {...L.detail} />
			))}
			{g.chin ? <path d={g.chin} {...L.stroke} /> : null}
			<g clipPath={g.clipMouth ? `url(#${skullClip})` : undefined}>
				{m.fills.map((x, i) => (
					<path key={`mf${i}`} d={x.d} fill={col(x.color)} />
				))}
				{g.philtrum ? <path d={g.philtrum} {...L.detail} /> : null}
				{m.strokes.map((d, i) => (
					<path key={`ms${i}`} d={d} {...L.stroke} />
				))}
				{m.details.map((d, i) => (
					<path key={`md${i}`} d={d} {...L.detail} />
				))}
			</g>
			<path d={g.nose.d} fill={BADGER_COLORS.nose} {...{stroke: LINE.color, strokeWidth: LINE.width * L.k, strokeLinejoin: 'round' as const}} />
			{g.eyes.map((e) => (
				<Eye key={e.side} e={e} st={state} uid={uid} />
			))}
			{g.brows.map((b) => (
				<Brow key={b.side} b={b} st={state} />
			))}
			{g.earsFront.map((e) => (
				<Ear key={e.side} ear={e} earsBack={earsBack} lift={lift} uid={`${uid}f`} />
			))}
		</g>
	);
};
