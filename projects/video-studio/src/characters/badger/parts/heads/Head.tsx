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
	/** Lengthwise stretch at earsBack 1 along `axis` (deg, head-local; root to tip): the worried flap splays out. */
	readonly stretch?: number;
	readonly axis?: number;
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
type MouthGeom = {
	readonly strokes: readonly string[];
	readonly details: readonly string[];
	readonly fills: readonly Fill[];
	/**
	 * Round 4: strokes drawn only when the head is mounted on a SIDE rig (Head prop `mounted`). The front head's happy
	 * mouth leaves the lower face open as the panel draws it; on a side neck that edge meets the background, so this
	 * closes it (cheek -> jaw -> lower lip -> jaw -> cheek, one stroke).
	 */
	readonly sideStrokes?: readonly string[];
	/** Round 5: this mouth's jaw line is the whole lower contour (the front shocked gasp): no side-mount jaw closure with it. */
	readonly fullJaw?: boolean;
};
export type HeadViewGeom = {
	/** Optional jaw-to-neck bridge drawn under the skull (profiles / looking up). */
	readonly throat: {readonly fill: string; readonly stroke: string} | null;
	readonly earsBehind: readonly EarGeom[];
	readonly skull: {readonly fill: string; readonly strokes: readonly string[]; readonly details: readonly string[]};
	readonly shadows: readonly Fill[];
	readonly markings: readonly {readonly id: string; readonly d: string}[];
	readonly nose: {readonly d: string; readonly details?: readonly string[]};
	readonly philtrum: string | null;
	readonly eyes: readonly EyeGeom[];
	readonly brows: readonly BrowGeom[];
	readonly mouth: Record<Expression, MouthGeom>;
	readonly earsFront: readonly EarGeom[];
	/** 3/4 views: clip the mouth to the skull so the far lip line hides behind the snout. */
	readonly clipMouth: boolean;
	/** 3/4 views: the lower-jaw contour. */
	readonly chin: string | null;
	/** 3/4 views: the bridge line from below the far eye to the nose (detail weight since round 4: at full weight it
	 * boxed the far eye in with the far contour; badger_turn_34.png draws it thin). */
	readonly bridge?: string | null;
	/**
	 * Look-up heads (round 4): a dedicated look-up neck for the head's own side rig, in NECK-local units. Its back stroke
	 * is ONE nape cubic from under the hanging ear (where it leaves the skull's back contour) to the collar, plus the back
	 * line under the collar; its throat is one concave curve from the jaw angle to the collar; its fill's edges are those
	 * curves. SideBody draws it in place of the rig's neck when the head is mounted on that rig, and draws `over` (the same
	 * neck above the collar's centre line, strokes stopping under the collar) again after the torso, so the torso's back
	 * stroke start, which the turned neck exposes above the collar, stays behind the neck.
	 */
	readonly neckUp?: {
		readonly rig: 'left' | 'right';
		readonly fill: string;
		readonly strokes: readonly string[];
		readonly over: {readonly fill: string; readonly strokes: readonly string[]};
	} | null;
	/**
	 * Profile and look-up heads (round 4): the lower jaw for mouthOpen. `lip` is the mouth line, ONE cubic from the
	 * commissure `pivot` to the lip front under the nose; `contour` is the jaw's underside from there back to the pivot (the
	 * skull's own lower stroke); `tongue` rides on the lower jaw; `deg` is the full-open rotation (front down).
	 */
	readonly jaw?: JawGeom | null;
	/**
	 * Round 5 (decision BADGER-D55): the uniform scale this view was generated at (1 = the traced size). The expressions'
	 * brow offsets (BROW_DY, JUDGE_DY, head-local units) are multiplied by it so every expression keeps its proportions.
	 */
	readonly scale?: number;
	/**
	 * Round 5: jaw closures for side mounts, each for one rig (head-local). The stroke runs from the face's own lower contour
	 * (the 3/4 heads: the end of the near cheek stroke; the front head: the chin edge the jaw lines already cover) into that
	 * rig's throat line and a few units down it; the fill closes the gap between the stroke and the skull / neck fills. Head
	 * draws the one for the rig it is mounted on (prop `rig`), the fill first and the stroke after the skull strokes, and not
	 * with a mouth whose own jaw line is the whole lower contour (MouthGeom.fullJaw). Generated by dev/trace/gen_heads.py.
	 */
	readonly mountJaws?: readonly {readonly rig: 'left' | 'right'; readonly fill: string; readonly stroke: string}[];
	/**
	 * Round 5: a 3/4 head on a TURNED mount (looking back over the shoulder: the 3/4-right head on the left rig, the 3/4-left
	 * head on the right rig) brings the crest of the neck for that rig: `nape` (NECK-local) runs from under the far ear to the
	 * neck's back line, with its fill; SideBody draws it after the neck (gen_heads.py, TURNED 3/4 MOUNTS).
	 */
	readonly turned?: {
		readonly rig: 'left' | 'right';
		readonly nape: {readonly fill: string; readonly stroke: string};
	} | null;
};
type JawGeom = {readonly pivot: P; readonly lip: string; readonly contour: string; readonly tongue: string; readonly deg: number};

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

const NUM = /-?\d*\.?\d+(?:e-?\d+)?/g;
/** Map every coordinate pair of an absolute M/L/C path. */
const mapPairs = (d: string, f: (p: P) => P): string =>
	d.replace(/(-?\d*\.?\d+(?:e-?\d+)?)[\s,]+(-?\d*\.?\d+(?:e-?\d+)?)/g, (_m, xs: string, ys: string) => pp(f({x: Number(xs), y: Number(ys)})));
const rotAbout = (c: P, deg: number) => {
	const a = (deg * Math.PI) / 180;
	const cs = Math.cos(a);
	const sn = Math.sin(a);
	return (p: P): P => ({x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs});
};

/**
 * mouthOpen on a profile / look-up head (round 4, R3 review): the lower jaw (the lens between the mouth line and the jaw's
 * underside) rotates `deg` about the commissure, front down; the gap between the fixed mouth line and the rotated one is
 * the open mouth (mouth colour, tongue on the jaw), so the chin visibly drops.
 */
const jawDrop = (j: JawGeom, deg: number) => {
	const n = (j.lip.match(NUM) ?? []).map(Number);
	const [p, c1, c2, fr] = [0, 2, 4, 6].map((i) => ({x: n[i], y: n[i + 1]}));
	const r = rotAbout(j.pivot, deg);
	const rot = (d: string) => mapPairs(d, r);
	const contour = rot(j.contour);
	// the opening's front edge bows in toward the commissure (a straight edge read as a hinged flap)
	const f2 = r(fr);
	const len = Math.hypot(f2.x - fr.x, f2.y - fr.y);
	const nx = (fr.y - f2.y) / (len || 1);
	const ny = (f2.x - fr.x) / (len || 1);
	const s = (p.x - fr.x) * nx + (p.y - fr.y) * ny > 0 ? 0.14 * len : -0.14 * len;
	const k1 = {x: lerp(fr.x, f2.x, 1 / 3) + nx * s, y: lerp(fr.y, f2.y, 1 / 3) + ny * s};
	const k2 = {x: lerp(fr.x, f2.x, 2 / 3) + nx * s, y: lerp(fr.y, f2.y, 2 / 3) + ny * s};
	return {
		wedge: `M ${pp(p)} C ${pp(c1)} ${pp(c2)} ${pp(fr)} C ${pp(k1)} ${pp(k2)} ${pp(f2)} C ${pp(r(c2))} ${pp(r(c1))} ${pp(p)} Z`,
		lower: `${rot(j.lip)} ${contour.replace(/^M\s*\S+\s+\S+\s*/, '')} Z`,
		contour,
		tongue: rot(j.tongue),
	};
};

/** Per-expression eye scaling: shocked widens the eye opening and shows more white. */
/** innerLift raises the inner half of the upper lid (worried), as a fraction of `up`. */
const EYE_SCALE: Record<
	Expression,
	{w: number; up: number; low: number; iris: number; open: number; irisUp: number; innerLift: number; drop: number}
> = {
	neutral: {w: 1, up: 1, low: 1, iris: 1, open: 1, irisUp: 0, innerLift: 0, drop: 1},
	happy: {w: 1, up: 0.95, low: 0.74, iris: 1, open: 0.96, irisUp: 0, innerLift: 0, drop: 0.9},
	worried: {w: 0.98, up: 1.12, low: 1.06, iris: 0.97, open: 1, irisUp: 0.22, innerLift: 0.35, drop: -0.25},
	// round 3: the sheet's shocked irises are big and round and the opening is rounder (height 0.76 of its width on
	// badger_expr_shocked.png); the lid opening carries the shock (iris was 0.8 and read as pin-pupilled)
	shocked: {w: 1.04, up: 1.95, low: 1.6, iris: 1, open: 1, irisUp: 0, innerLift: 0, drop: 0.4},
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

const Brow: React.FC<{b: BrowGeom; st: HeadState; k: number}> = ({b, st, k}) => {
	const L = useStrokes();
	const dy = BROW_DY[st.expression];
	const j = st.judge;
	const o = {x: b.outer.x, y: b.outer.y + (dy[0] + JUDGE_DY[0] * j) * k};
	const m = {x: b.mid.x, y: b.mid.y + (dy[1] + JUDGE_DY[1] * j) * k};
	const i = {x: b.inner.x, y: b.inner.y + (dy[2] + JUDGE_DY[2] * j) * k};
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
	const st = 1 + ((ear.stretch ?? 1) - 1) * earsBack;
	const ax = ear.axis ?? 0;
	const stretchT = st !== 1 ? ` rotate(${f1(ax)}) scale(${f1(st)} 1) rotate(${f1(-ax)})` : '';
	const t = `translate(${f1(ear.pivot.x)} ${f1(ear.pivot.y)}) rotate(${f1(a)})${stretchT} scale(${f1(sx)} 1) translate(${f1(-ear.pivot.x)} ${f1(-ear.pivot.y)})`;
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
export const Head: React.FC<{view: BadgerHead; state: HeadState; mounted?: boolean; rig?: 'left' | 'right'}> = ({view, state, mounted = false, rig}) => {
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
	// profile / look-up heads drop the jaw instead (round 4)
	const jd = g.jaw && open > MOUTH_OPEN_MIN && state.expression !== 'shocked' ? jawDrop(g.jaw, g.jaw.deg * lerp(0.3, 1, open)) : null;
	const m: MouthGeom = (() => {
		if (jd) return {strokes: [], details: [], fills: []};
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
			fullJaw: sh.fullJaw,
		};
	})();
	// round 5: the side mount's jaw closure for the rig this head is mounted on (none with a full-jaw mouth)
	const tj = mounted && rig && !m.fullJaw ? (g.mountJaws ?? []).find((j) => j.rig === rig) ?? null : null;
	return (
		<g data-head={view}>
			{tj ? <path d={tj.fill} fill={BADGER_COLORS.coat} /> : null}
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
			{tj ? <path d={tj.stroke} {...L.stroke} /> : null}
			{g.skull.details.map((d, i) => (
				<path key={`d${i}`} d={d} {...L.detail} />
			))}
			{g.chin ? <path d={g.chin} {...L.stroke} /> : null}
			{g.bridge ? <path d={g.bridge} {...L.detail} /> : null}
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
				{mounted
					? (m.sideStrokes ?? []).map((d, i) => <path key={`mm${i}`} d={d} {...L.stroke} />)
					: null}
			</g>
			{jd ? (
				<g>
					<clipPath id={`${uid}-jaw`}>
						<path d={jd.wedge} />
					</clipPath>
					<path d={jd.wedge} fill={BADGER_COLORS.mouth} />
					<g clipPath={`url(#${uid}-jaw)`}>
						<path d={jd.tongue} fill={BADGER_COLORS.tongue} />
					</g>
					<path d={jd.lower} fill={BADGER_COLORS.coat} />
					<path d={jd.wedge} {...L.stroke} />
					<path d={jd.contour} {...L.stroke} />
				</g>
			) : null}
			<path d={g.nose.d} fill={BADGER_COLORS.nose} {...{stroke: LINE.color, strokeWidth: LINE.width * L.k, strokeLinejoin: 'round' as const}} />
			{(g.nose.details ?? []).map((d, i) => (
				<path key={`nd${i}`} d={d} {...L.detail} />
			))}
			{g.eyes.map((e) => (
				<Eye key={e.side} e={e} st={state} uid={uid} />
			))}
			{g.brows.map((b) => (
				<Brow key={b.side} b={b} st={state} k={g.scale ?? 1} />
			))}
			{g.earsFront.map((e) => (
				<Ear key={e.side} ear={e} earsBack={earsBack} lift={lift} uid={`${uid}f`} />
			))}
		</g>
	);
};
