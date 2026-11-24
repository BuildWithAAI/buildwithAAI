import React, {useId} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

/*
 * "Ink Noir" host character: YOU, an adult everyman (late 20s / early 30s).
 *
 * Coordinate system (one viewBox for everything):
 *   origin (0,0) = floor point between the feet; +x = screen right; -y = up.
 *   Figure height ~940 units (hair top at y = -940). At scale=1, 1 unit = 1 px.
 *   Groups carry className + data-part: head, eyes, brows, nose, mouth, hair,
 *   torso, armL, armR, legs. armL / armR are the arms on SCREEN left / right.
 *
 * Lighting: one key light (the monitor) on `lightFrom` side; halftone-dot shadows
 * fall on the opposite side, with a thin silver rim (window back-light) on that edge.
 */

export type InknoirExpression = 'neutral' | 'happy' | 'worried' | 'shocked';
export type InknoirPose = 'idle' | 'point';

export type InknoirCharacterProps = {
	expression?: InknoirExpression;
	/** 0 = closed, 1 = fully open. Driven by audio amplitude. */
	mouthOpen?: number;
	/** 0 = eyes open, 1 = fully closed. */
	blink?: number;
	pose?: InknoirPose;
	/** -1 (look screen-left) .. 1 (look screen-right). Moves pupils and turns the face. */
	lookX?: number;
	/** Position of the feet origin in the parent's pixels. */
	x?: number;
	y?: number;
	scale?: number;
	/** Screen side the 'point' arm extends toward. Default 'right'. */
	pointSide?: 'left' | 'right';
	/** Screen side of the key light. Default 'left'. */
	lightFrom?: 'left' | 'right';
	/** Soft contact shadow under the feet. Default true. */
	floorShadow?: boolean;
	style?: React.CSSProperties;
};

export const INKNOIR = {
	ink: '#0B0C0F',
	slate: '#161A21',
	slate2: '#1E232B',
	slate3: '#2A303A',
	steel: '#5B6472',
	silver: '#C9CED6',
	silverDark: '#8C939E',
	white: '#F4F6F8',
	accent: '#FF4D6D',
	skin: '#E7DFD5',
	skinDot: '#5E5550',
	skinLine: '#7A6F68',
	stubble: '#8D837B',
	stubbleTone: '#DCD3C9',
	hair: '#14171D',
	hairStrand: '#454D5A',
	shirt: '#3C4451',
	shirtLight: '#4D5664',
	tee: '#C9CED6',
	teeDot: '#3E4553',
	pants: '#262C36',
	shoe: '#D4D8DE',
	sole: '#8C939E',
	mouth: '#26161A',
	tongue: '#7A4250',
	iris: '#353D49',
	phone: '#1C2028',
} as const;

const C = INKNOIR;
const LINE = 2.6;

type V = {x: number; y: number};
const v = (x: number, y: number): V => ({x, y});
const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (p: V) => `${r2(p.x)},${r2(p.y)}`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: V, b: V, t: number) => v(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Tapered capsule from a (radius ra) to b (radius rb). */
const capsule = (a: V, b: V, ra: number, rb: number) => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len;
	const ny = dx / len;
	return (
		`M${pt(v(a.x + nx * ra, a.y + ny * ra))} L${pt(v(b.x + nx * rb, b.y + ny * rb))} ` +
		`A${r2(rb)},${r2(rb)} 0 0 0 ${pt(v(b.x - nx * rb, b.y - ny * rb))} ` +
		`L${pt(v(a.x - nx * ra, a.y - ny * ra))} A${r2(ra)},${r2(ra)} 0 0 0 ${pt(v(a.x + nx * ra, a.y + ny * ra))} Z`
	);
};

/** Unit normal of segment a->b that points toward the shadow (light from upper `side`-opposite). */
const shadowNormal = (a: V, b: V, side: number): V => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy) || 1;
	let n = v(-dy / len, dx / len);
	if (n.x * side + n.y * 0.7 < 0) n = v(-n.x, -n.y);
	return n;
};

/* ------------------------------------------------------------------ */
/* Expressions                                                          */
/* ------------------------------------------------------------------ */

type Expr = {
	brow: [number, number, number]; // inner, mid, outer y (screen-right brow)
	lid: number; // resting upper-lid closure 0..1
	lower: number; // lower-lid lift 0..1 (smiling eyes)
	eyeScale: number;
	iris: number;
	mouth: {w: number; cL: number; cR: number; u: number; base: number; round: number};
	tilt: number;
	lift: number;
	smile?: boolean;
	worry?: boolean;
	forehead?: boolean;
};

const EXPR: Record<InknoirExpression, Expr> = {
	neutral: {
		brow: [-21, -27, -23],
		lid: 0.04,
		lower: 0,
		eyeScale: 1,
		iris: 6.4,
		mouth: {w: 30, cL: 0.5, cR: -0.5, u: 1, base: 0, round: 0.55},
		tilt: 0,
		lift: 0,
	},
	happy: {
		brow: [-24, -31, -26],
		lid: 0.16,
		lower: 0.5,
		eyeScale: 1,
		iris: 6.4,
		mouth: {w: 40, cL: -7, cR: -8, u: 2.5, base: 0.3, round: 0.6},
		tilt: 2.5,
		lift: -2,
		smile: true,
	},
	worried: {
		brow: [-31, -28, -19],
		lid: 0.02,
		lower: 0.12,
		eyeScale: 1.04,
		iris: 6,
		mouth: {w: 27, cL: 4, cR: 6.5, u: -0.5, base: 0.08, round: 0.5},
		tilt: -3,
		lift: 1,
		worry: true,
	},
	shocked: {
		brow: [-33, -42, -33],
		lid: 0,
		lower: 0,
		eyeScale: 1.17,
		iris: 5.1,
		mouth: {w: 24, cL: 2, cR: 2, u: -5, base: 0.55, round: 0.93},
		tilt: 0,
		lift: -5,
		forehead: true,
	},
};

/* ------------------------------------------------------------------ */
/* Defs                                                                 */
/* ------------------------------------------------------------------ */

const dots = (id: string, r: number, color: string, size = 5, angle = 32) => (
	<pattern key={id} id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
		<circle cx={size / 2} cy={size / 2} r={r} fill={color} />
	</pattern>
);

/* ------------------------------------------------------------------ */
/* Head                                                                 */
/* ------------------------------------------------------------------ */

const headPath = (j: number) =>
	`M0,-84 C33,-84 56,-64 57,-32 C58,-12 57,6 56,20 C55,${32 + j * 0.3} 53,${40 + j * 0.5} 48,${50 + j * 0.6} ` +
	`C42,${60 + j * 0.8} 33,${69 + j} 21,${74 + j} Q0,${80 + j} -21,${74 + j} C-33,${69 + j} -42,${60 + j * 0.8} -48,${50 + j * 0.6} ` +
	`C-53,${40 + j * 0.5} -55,${32 + j * 0.3} -56,20 C-57,6 -58,-12 -57,-32 C-56,-64 -33,-84 0,-84 Z`;

const HAIR =
	'M-55,-10 L-58,-30 C-62,-46 -65,-70 -58,-88 C-52,-102 -41,-111 -29,-113 ' +
	'C-23,-124 -8,-128 2,-121 C10,-132 29,-133 40,-122 C54,-121 68,-113 75,-101 ' +
	'C79,-94 77,-86 69,-85 C66,-72 61,-56 59,-40 L57,-12 L53,-10 L52,-36 ' +
	'C44,-47 32,-55 18,-56 C8,-57 0,-54 -6,-50 C-10,-44 -14,-38 -21,-31 ' +
	'C-22,-38 -24,-44 -28,-48 C-38,-50 -47,-45 -52,-36 L-52,-12 Z';

const HAIR_STRANDS = [
	'M-44,-94 C-26,-110 4,-114 36,-108',
	'M-50,-74 C-30,-94 10,-102 56,-96',
	'M-30,-56 C-18,-74 14,-88 62,-88',
	'M-4,-54 C4,-66 20,-74 48,-76',
	'M-56,-50 C-50,-62 -40,-70 -26,-76',
];

type EyeProps = {
	p: string;
	m: 1 | -1; // 1 = screen-right eye, -1 = screen-left eye
	cx: number;
	cy: number;
	scale: number;
	closure: number;
	lower: number;
	iris: number;
	px: number;
	s: number;
	happy: boolean;
};

const Eye: React.FC<EyeProps> = ({p, m, cx, cy, scale, closure, lower, iris, px, s, happy}) => {
	const X = (q: V) => v(q.x * m, q.y);
	const I = X(v(-14, 1.5));
	const O = X(v(15, -0.5));
	const c1 = X(v(-8, -9.5));
	const c2 = X(v(6, -10.5));
	const ly = 7 - lower * 7.5;
	const c3 = X(v(8, ly));
	const c4 = X(v(-7, ly));
	const closedY = 5.2 - lower * 7;
	const k1 = lerpV(c1, X(v(-7, closedY)), closure);
	const k2 = lerpV(c2, X(v(7, closedY)), closure);
	const shape = `M${pt(I)} C${pt(c1)} ${pt(c2)} ${pt(O)} C${pt(c3)} ${pt(c4)} ${pt(I)} Z`;
	const lidEdge = `M${pt(I)} C${pt(k1)} ${pt(k2)} ${pt(O)}`;
	const lidFill = `${lidEdge} L${pt(X(v(19, -26)))} L${pt(X(v(-18, -26)))} Z`;
	const crease1 = lerpV(c1, X(v(-7, closedY)), closure * 0.55);
	const crease2 = lerpV(c2, X(v(7, closedY)), closure * 0.55);
	const crease = `M${pt(X(v(-9, -7)))} C${pt(v(crease1.x, crease1.y - 7.5))} ${pt(v(crease2.x, crease2.y - 7.5))} ${pt(X(v(12, -8.5)))}`;
	const clipId = `${p}-eye${m > 0 ? 'R' : 'L'}`;
	const ip = v(px / scale, 0.6);
	return (
		<g transform={`translate(${r2(cx)},${r2(cy)}) scale(${scale})`}>
			<defs>
				<clipPath id={clipId}>
					<path d={shape} />
				</clipPath>
			</defs>
			<g clipPath={`url(#${clipId})`}>
				<path d={shape} fill={C.white} />
				<circle cx={ip.x} cy={ip.y} r={iris} fill={C.iris} stroke={C.ink} strokeWidth={1} />
				<circle cx={ip.x} cy={ip.y} r={iris * 0.5} fill={C.ink} />
				<circle cx={ip.x - 2.4 * s} cy={ip.y - 2.6} r={1.7} fill={C.white} />
				<circle cx={ip.x + 2.1 * s} cy={ip.y + 2.2} r={0.8} fill={C.white} opacity={0.8} />
				{/* upper-lid shadow on the eyeball */}
				<path d={lidEdge} fill="none" stroke={C.silverDark} strokeWidth={3} opacity={0.55} transform="translate(0,2.2)" />
				<path d={lidFill} fill={C.skin} />
				{lower > 0.01 ? (
					<path
						d={`M${pt(O)} C${pt(c3)} ${pt(c4)} ${pt(I)} L${pt(X(v(-18, 16)))} L${pt(X(v(19, 16)))} Z`}
						fill={C.skin}
					/>
				) : null}
			</g>
			<path d={crease} fill="none" stroke={C.skinLine} strokeWidth={1.2} strokeLinecap="round" opacity={0.7} />
			<path
				d={`M${pt(O)} C${pt(c3)} ${pt(c4)} ${pt(I)}`}
				fill="none"
				stroke={happy ? C.ink : C.skinLine}
				strokeWidth={happy ? 1.8 : 1.3}
				strokeLinecap="round"
			/>
			<path
				d={lidEdge}
				fill="none"
				stroke={C.ink}
				strokeWidth={3}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</g>
	);
};

const browPath = (m: number, yi: number, ym: number, yo: number) => {
	const X = (x: number) => r2(x * m);
	return (
		`M${X(7)},${r2(yi - 4.4)} Q${X(23)},${r2(ym - 4.2)} ${X(39)},${r2(yo - 1.6)} ` +
		`Q${X(41.5)},${r2(yo + 0.3)} ${X(39)},${r2(yo + 1.8)} ` +
		`Q${X(23)},${r2(ym + 2.8)} ${X(7.5)},${r2(yi + 4)} Q${X(5.5)},${r2(yi)} ${X(7)},${r2(yi - 4.4)} Z`
	);
};

type HeadProps = {
	p: string;
	e: Expr;
	mouthOpen: number;
	blink: number;
	lookX: number;
	s: number;
};

const Head: React.FC<HeadProps> = ({p, e, mouthOpen, blink, lookX, s}) => {
	const mo = e.mouth;
	const eff = clamp01(mo.base + (1 - mo.base) * clamp01(mouthOpen));
	const j = eff * 6; // jaw drop
	const fx = lookX * 6.5; // feature shift (head turn)
	const nx = lookX * 9.5;
	const mx = lookX * 6;
	const head = headPath(j);
	const closure = clamp01(e.lid + (1 - e.lid) * clamp01(blink));

	// Mouth geometry
	const w = mo.w * (1 - 0.14 * eff);
	const my = 46 + j * 0.45;
	const u = mo.u - eff * 3;
	const depth = eff * 30;
	const kx = (w / 2) * mo.round;
	const L = v(mx - w / 2, my + mo.cL);
	const R = v(mx + w / 2, my + mo.cR);
	const upper = `M${pt(L)} C${pt(v(mx - kx, my + u))} ${pt(v(mx + kx, my + u))} ${pt(R)}`;
	const lowerCtl = my + u + depth * 1.33;
	const mouthShape = `${upper} C${pt(v(mx + kx, lowerCtl))} ${pt(v(mx - kx, lowerCtl))} ${pt(L)} Z`;
	const teethH = Math.min(7.5, 2 + depth * 0.5);
	const teeth = `${upper} L${pt(v(R.x, R.y + teethH))} C${pt(v(mx + kx, my + u + teethH))} ${pt(v(mx - kx, my + u + teethH))} ${pt(v(L.x, L.y + teethH))} Z`;
	const mouthBottom = my + 0.125 * (mo.cL + mo.cR) + 0.75 * (u + depth * 1.33);

	return (
		<g className="head" data-part="head">
			<defs>
				<clipPath id={`${p}-face`}>
					<path d={head} />
				</clipPath>
				<clipPath id={`${p}-mouth`}>
					<path d={mouthShape} />
				</clipPath>
				<clipPath id={`${p}-hairc`}>
					<path d={HAIR} />
				</clipPath>
				<clipPath id={`${p}-hairtop`}>
					<rect x={-90} y={-150} width={180} height={98} />
				</clipPath>
			</defs>

			{/* ears (behind the face) */}
			<g transform={`translate(${r2(-lookX * 2)},0)`}>
				{[-1, 1].map((m) => (
					<g key={m}>
						<path
							d={`M${54 * m},-14 C${65 * m},-19 ${70 * m},0 ${65 * m},13 C${62 * m},21 ${58 * m},25 ${52 * m},22 Z`}
							fill={C.skin}
							stroke={C.ink}
							strokeWidth={LINE}
							strokeLinejoin="round"
						/>
						<path d={`M${57 * m},-6 C${63 * m},-5 ${63 * m},7 ${58 * m},12`} fill="none" stroke={C.skinLine} strokeWidth={1.6} strokeLinecap="round" />
						{m === s ? <path d={`M${54 * m},-14 C${65 * m},-19 ${70 * m},0 ${65 * m},13 C${62 * m},21 ${58 * m},25 ${52 * m},22 Z`} fill={`url(#${p}-sk1)`} /> : null}
					</g>
				))}
			</g>

			{/* face */}
			<path d={head} fill={C.skin} />
			<g clipPath={`url(#${p}-face)`}>
				{/* key-light terminator: halftone on the shadow side */}
				<g transform={`translate(${r2(lookX * 8)},0) scale(${s},1)`}>
					<path d="M31,-95 C47,-54 47,-12 43,18 C39,46 27,68 8,92 L95,92 L95,-95 Z" fill={`url(#${p}-sk1)`} />
					<path d="M46,-95 C58,-44 57,-2 53,24 C49,50 39,68 24,92 L95,92 L95,-95 Z" fill={`url(#${p}-sk2)`} />
				</g>
				{/* five-o'clock shadow: a flat tone + fine stipple */}
				<g transform={`translate(${r2(lookX * 3)},0)`}>
					<path
						d={`M-60,-12 L-54,-12 C-52,6 -46,20 -33,29 C-25,34 -13,${r2(31 + j * 0.2)} ${r2(mx)},${r2(32 + j * 0.2)} C13,${r2(31 + j * 0.2)} 25,34 33,29 C46,20 52,6 54,-12 L60,-12 L62,${96 + j} L-62,${96 + j} Z`}
						fill={C.stubbleTone}
					/>
					<path
						d={`M-60,-12 L-54,-12 C-52,6 -46,20 -33,29 C-25,34 -13,${r2(31 + j * 0.2)} ${r2(mx)},${r2(32 + j * 0.2)} C13,${r2(31 + j * 0.2)} 25,34 33,29 C46,20 52,6 54,-12 L60,-12 L62,${96 + j} L-62,${96 + j} Z`}
						fill={`url(#${p}-stb)`}
						opacity={0.55}
					/>
				</g>
				{/* hair cast shadow: a thin band under the hairline */}
				<path d={HAIR} fill={`url(#${p}-sk1)`} transform={`translate(${r2(2 * s)},5)`} />
				{/* back-light rim on the shadow edge */}
				<path d={head} fill="none" stroke={C.silver} strokeWidth={5} mask={`url(#${p}-rim)`} opacity={0.9} />
			</g>
			<path d={head} fill="none" stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />

			{/* adult details: forehead, worry and smile lines */}
			{e.forehead ? (
				<g fill="none" stroke={C.skinLine} strokeWidth={1.4} strokeLinecap="round">
					<path d={`M${r2(fx - 22)},-43 Q${r2(fx)},-47 ${r2(fx + 22)},-43`} />
				</g>
			) : null}
			{e.worry ? (
				<g fill="none" stroke={C.skinLine} strokeWidth={1.5} strokeLinecap="round">
					<path d={`M${r2(fx - 4)},-31 Q${r2(fx - 2.5)},-25 ${r2(fx - 5)},-19`} />
					<path d={`M${r2(fx + 4)},-31 Q${r2(fx + 2.5)},-25 ${r2(fx + 5)},-19`} />
				</g>
			) : null}
			{e.smile ? (
				<g fill="none" stroke={C.skinLine} strokeWidth={1.7} strokeLinecap="round">
					<path d={`M${r2(nx + 13)},25 C${r2(nx + 22)},31 ${r2(mx + 27)},40 ${r2(mx + 25)},52`} />
					<path d={`M${r2(nx - 13)},25 C${r2(nx - 22)},31 ${r2(mx - 27)},40 ${r2(mx - 25)},52`} />
					{/* crow's feet */}
					<path d={`M${r2(fx + 41)},-6 L${r2(fx + 46)},-8 M${r2(fx + 41)},-1 L${r2(fx + 46)},0`} />
					<path d={`M${r2(fx - 41)},-6 L${r2(fx - 46)},-8 M${r2(fx - 41)},-1 L${r2(fx - 46)},0`} />
				</g>
			) : null}

			{/* eyes */}
			<g className="eyes" data-part="eyes">
				{([-1, 1] as const).map((m) => (
					<g key={m}>
						<path
							d={`M${r2(fx + m * 13)},${r2(-3 + 11 * e.eyeScale)} Q${r2(fx + m * 22)},${r2(-3 + 14 * e.eyeScale)} ${r2(fx + m * 31)},${r2(-3 + 10.5 * e.eyeScale)}`}
							fill="none"
							stroke={C.skinLine}
							strokeWidth={1.1}
							opacity={0.7}
							strokeLinecap="round"
						/>
						<Eye
							p={p}
							m={m}
							cx={fx + m * 23}
							cy={-3}
							scale={e.eyeScale}
							closure={closure}
							lower={e.lower}
							iris={e.iris}
							px={lookX * 5.5}
							s={s}
							happy={!!e.smile}
						/>
					</g>
				))}
			</g>

			{/* brows */}
			<g className="brows" data-part="brows" transform={`translate(${r2(fx)},0)`}>
				<path d={browPath(1, e.brow[0], e.brow[1], e.brow[2])} fill={C.hair} />
				<path d={browPath(-1, e.brow[0], e.brow[1], e.brow[2])} fill={C.hair} />
			</g>

			{/* nose */}
			<g className="nose" data-part="nose">
				<ellipse cx={r2(nx + 6 * s)} cy={20} rx={5.5} ry={9} fill={`url(#${p}-sk2)`} />
				<ellipse cx={r2(nx + 2 * s)} cy={35} rx={10} ry={3.6} fill={`url(#${p}-sk2)`} />
				<path
					d={`M${r2(nx + 3 * s)},-8 C${r2(nx + 5 * s)},6 ${r2(nx + 8 * s)},15 ${r2(nx + 9.5 * s)},22`}
					fill="none"
					stroke={C.ink}
					strokeWidth={1.8}
					strokeLinecap="round"
				/>
				<path
					d={`M${r2(nx - 9)},22.5 C${r2(nx - 13)},28 ${r2(nx - 8)},31.5 ${r2(nx - 4)},29.5 Q${r2(nx)},32 ${r2(nx + 4)},29.5 C${r2(nx + 8)},31.5 ${r2(nx + 13)},28 ${r2(nx + 9)},22.5`}
					fill="none"
					stroke={C.ink}
					strokeWidth={2.2}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</g>

			{/* mouth */}
			<g className="mouth" data-part="mouth">
				<path d={mouthShape} fill={C.mouth} />
				<g clipPath={`url(#${p}-mouth)`}>
					<ellipse cx={mx} cy={r2(my + u + depth * 1.05 + 2)} rx={r2(w * 0.3)} ry={r2(Math.max(1, depth * 0.36))} fill={C.tongue} />
					<path d={teeth} fill={C.white} />
				</g>
				<path d={mouthShape} fill="none" stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" strokeLinecap="round" />
				{/* lower-lip shadow */}
				<path
					d={`M${r2(mx - 7)},${r2(mouthBottom + 6)} Q${r2(mx)},${r2(mouthBottom + 9)} ${r2(mx + 7)},${r2(mouthBottom + 6)}`}
					fill="none"
					stroke={C.skinLine}
					strokeWidth={1.5}
					strokeLinecap="round"
				/>
			</g>

			{/* hair */}
			<g className="hair" data-part="hair" transform={`translate(${r2(lookX * 2.5)},0)`}>
				<path d={HAIR} fill={C.hair} />
				<g clipPath={`url(#${p}-hairc)`}>
					<g fill="none" stroke={C.hairStrand} strokeWidth={1.8} strokeLinecap="round">
						{HAIR_STRANDS.map((d) => (
							<path key={d} d={d} />
						))}
					</g>
					<g clipPath={`url(#${p}-hairtop)`}>
						<path d={HAIR} fill="none" stroke={C.silver} strokeWidth={6} mask={`url(#${p}-rim)`} />
					</g>
					{/* key-light sheen */}
					<g transform={`scale(${s},1)`} fill="none" stroke={C.silverDark} strokeWidth={2.2} strokeLinecap="round" opacity={0.75}>
						<path d="M-46,-90 C-38,-100 -28,-106 -16,-108" />
						<path d="M-54,-66 C-48,-78 -40,-86 -30,-90" />
					</g>
				</g>
				<path d={HAIR} fill="none" stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
			</g>
		</g>
	);
};

/* ------------------------------------------------------------------ */
/* Arms                                                                 */
/* ------------------------------------------------------------------ */

const IDLE_HAND = 'M-14,-2 C-16,14 -17,30 -14,44 C-12,56 -6,64 2,64 C10,64 15,56 15,44 C16,30 15,14 13,-2 Z';
const IDLE_THUMB = 'M-12,10 C-22,15 -24,30 -18,38 C-15,42 -10,39 -10,33 C-10,27 -9,20 -8,15 Z';
const POINT_FIST = 'M0,-15 C10,-19 30,-19 37,-12 C43,-5 43,10 37,16 C29,22 8,22 0,16 Z';
const POINT_FINGER = 'M29,-15 L67,-13.5 C76,-12.5 76,-3 67,-2 L33,-3 Z';
const POINT_THUMB = 'M5,-14 C13,-23 26,-20 31,-11 C27,-6 16,-6 7,-8 Z';

type ArmProps = {
	p: string;
	id: 'L' | 'R';
	point: boolean;
	side: number; // shadow side in the arm's own (unmirrored) coordinates
	alt?: boolean; // alternate idle hang, so the two arms are not mirror images
};

const Arm: React.FC<ArmProps> = ({p, id, point, side, alt}) => {
	const S = v(104, -660);
	const E = point ? v(244, -642) : alt ? v(132, -514) : v(124, -517);
	const W = point ? v(372, -664) : alt ? v(122, -386) : v(134, -382);
	const up = {x: E.x - S.x, y: E.y - S.y};
	const ul = Math.hypot(up.x, up.y);
	const d1 = v(up.x / ul, up.y / ul);
	const fa = {x: W.x - E.x, y: W.y - E.y};
	const fl = Math.hypot(fa.x, fa.y);
	const d2 = v(fa.x / fl, fa.y / fl);
	const ang = (Math.atan2(d2.y, d2.x) * 180) / Math.PI;

	const n1 = shadowNormal(S, E, side);
	const n2 = shadowNormal(E, W, side);
	const sleeve = capsule(S, E, 27, 23);
	const sleeveShade = capsule(v(S.x + n1.x * 12, S.y + n1.y * 12), v(E.x + n1.x * 10, E.y + n1.y * 10), 15, 13);
	const forearmA = v(E.x + d2.x * 6, E.y + d2.y * 6);
	const forearm = capsule(forearmA, W, 20.5, 16);
	const forearmShade = capsule(v(forearmA.x + n2.x * 9, forearmA.y + n2.y * 9), v(W.x + n2.x * 7, W.y + n2.y * 7), 11.5, 9);
	// rolled cuff: a flat band across the arm at the elbow, slightly wider than the sleeve
	const q = (c: V, d: V, along: number, across: number) => v(c.x + d.x * along + n1.x * across, c.y + d.y * along + n1.y * across);
	const cuff =
		`M${pt(q(E, d1, -12, 25))} C${pt(q(E, d1, -14, 0))} ${pt(q(E, d1, -14, 0))} ${pt(q(E, d1, -12, -25))} ` +
		`Q${pt(q(E, d1, -1, -28))} ${pt(q(E, d1, 10, -24))} C${pt(q(E, d1, 13, 0))} ${pt(q(E, d1, 13, 0))} ${pt(q(E, d1, 10, 24))} ` +
		`Q${pt(q(E, d1, -1, 28))} ${pt(q(E, d1, -12, 25))} Z`;
	const cuffShade =
		`M${pt(q(E, d1, -12, 25))} Q${pt(q(E, d1, -1, 28))} ${pt(q(E, d1, 10, 24))} L${pt(q(E, d1, 11, 10))} L${pt(q(E, d1, -13, 10))} Z`;
	const handId = `${p}-hand${id}`;
	const rimLine = (a: V, b: V, ra: number, rb: number, n: V) =>
		`M${pt(v(a.x + n.x * ra, a.y + n.y * ra))} L${pt(v(b.x + n.x * rb, b.y + n.y * rb))}`;

	return (
		<g>
			{/* forearm (skin) */}
			<path d={forearm} fill={C.skin} stroke={C.ink} strokeWidth={LINE} />
			<path d={forearmShade} fill={`url(#${p}-sk1)`} />
			<path d={rimLine(forearmA, W, 17, 13, n2)} stroke={C.silver} strokeWidth={2.2} strokeLinecap="round" opacity={0.8} />

			{/* hand */}
			<g transform={`translate(${pt(W)}) rotate(${r2(point ? ang : ang - 90)}) scale(1.14)`}>
				<defs>
					<clipPath id={handId}>
						<path d={point ? `${POINT_FIST} ${POINT_FINGER}` : IDLE_HAND} />
					</clipPath>
				</defs>
				{point ? (
					<g>
						<path d={POINT_FINGER} fill={C.skin} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
						<path d={POINT_FIST} fill={C.skin} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
						<path d="M8,21 C20,22 32,20 37,14 C42,8 42,0 40,-6 L48,-4 L48,24 L4,24 Z" fill={`url(#${p}-sk2)`} clipPath={`url(#${handId})`} />
						<path d="M64,-12 Q69,-8 64,-4" fill="none" stroke={C.skinLine} strokeWidth={1.3} />
						<path d="M37,-2 C41,0 41,6 37,8 M36,8 C40,10 39,15 35,16" fill="none" stroke={C.ink} strokeWidth={1.6} strokeLinecap="round" />
						<path d={POINT_THUMB} fill={C.skin} stroke={C.ink} strokeWidth={2.2} strokeLinejoin="round" />
					</g>
				) : (
					<g>
						<path d={IDLE_HAND} fill={C.skin} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
						<path
							d="M6,-4 C10,14 12,34 10,50 C8,60 4,66 0,66 L24,66 L24,-4 Z"
							fill={`url(#${p}-sk2)`}
							clipPath={`url(#${handId})`}
							transform={`scale(${side},1)`}
						/>
						<g fill="none" stroke={C.ink} strokeWidth={1.5} strokeLinecap="round">
							<path d="M3,36 C4,46 4,53 2,59" />
							<path d="M-5,38 C-5,47 -6,53 -7,57" />
							<path d="M10,34 C11,42 11,49 9,54" />
						</g>
						<path d={IDLE_THUMB} fill={C.skin} stroke={C.ink} strokeWidth={2.2} strokeLinejoin="round" />
					</g>
				)}
			</g>

			{/* sleeve (rolled overshirt sleeve) */}
			<path d={sleeve} fill={C.shirt} stroke={C.ink} strokeWidth={LINE} />
			<path d={sleeveShade} fill={`url(#${p}-ik1)`} />
			<path d={rimLine(S, E, 24, 20, n1)} stroke={C.silver} strokeWidth={2.4} strokeLinecap="round" opacity={0.75} />
			<path d={`M${pt(v(S.x - n1.x * 14, S.y - n1.y * 14 + 6))} L${pt(v(E.x - n1.x * 12, E.y - n1.y * 12 - 18))}`} stroke={C.shirtLight} strokeWidth={2} strokeLinecap="round" opacity={0.9} />
			<path d={cuff} fill={C.shirtLight} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
			<path d={cuffShade} fill={`url(#${p}-ik1)`} />
			<path d={`M${pt(q(E, d1, -1, 26))} Q${pt(q(E, d1, 1, 0))} ${pt(q(E, d1, -1, -26))}`} fill="none" stroke={C.ink} strokeWidth={1.4} />
		</g>
	);
};

/* ------------------------------------------------------------------ */
/* Torso and legs                                                       */
/* ------------------------------------------------------------------ */

const TORSO =
	'M-26,-712 C-50,-706 -84,-698 -104,-688 C-122,-680 -130,-660 -130,-634 L-126,-560 ' +
	'C-122,-500 -114,-460 -112,-420 L-110,-404 C-60,-396 60,-396 110,-404 L112,-420 ' +
	'C114,-460 122,-500 126,-560 L130,-634 C130,-660 122,-680 104,-688 C84,-698 50,-706 26,-712 Z';

const TEE = 'M-26,-711 C-14,-697 14,-697 26,-711 L31,-690 C36,-600 40,-500 43,-399 L-43,-399 C-40,-500 -36,-600 -31,-690 Z';

const COLLAR_L = 'M-23,-716 C-29,-700 -34,-680 -40,-652 L-66,-684 C-64,-698 -56,-710 -44,-718 Z';
const NECK = 'M-21,-776 L21,-776 C21,-744 22,-722 26,-700 L-26,-700 C-22,-722 -21,-744 -21,-776 Z';

const PANTS =
	'M-106,-434 L106,-434 C109,-330 99,-200 86,-30 L38,-30 C35,-160 24,-280 6,-346 Q0,-352 -6,-346 ' +
	'C-24,-280 -35,-160 -38,-30 L-86,-30 C-99,-200 -109,-330 -106,-434 Z';

const SHOE_R = 'M34,-42 L88,-42 C98,-34 114,-26 125,-17 C133,-10 130,0 119,0 L29,0 C21,0 19,-8 23,-17 C27,-27 31,-35 34,-42 Z';
const SOLE_R = 'M21,-11 L130.5,-11 C131.5,-3 127,0 119,0 L29,0 C23,0 20,-5 21,-11 Z';

const Torso: React.FC<{p: string; s: number}> = ({p, s}) => (
	<g className="torso" data-part="torso">
		<defs>
			<clipPath id={`${p}-torso`}>
				<path d={TORSO} />
			</clipPath>
			<clipPath id={`${p}-tee`}>
				<path d={TEE} />
			</clipPath>
			<clipPath id={`${p}-neck`}>
				<path d={NECK} />
			</clipPath>
		</defs>
		{/* back collar */}
		<path d="M-32,-704 C-34,-726 34,-726 32,-704 Z" fill={C.shirtLight} stroke={C.ink} strokeWidth={LINE} />
		{/* headphone band (behind the neck) */}
		<path d="M-46,-708 C-48,-752 48,-752 46,-708" fill="none" stroke={C.ink} strokeWidth={13} strokeLinecap="round" />
		<path d="M-46,-708 C-48,-752 48,-752 46,-708" fill="none" stroke={C.slate3} strokeWidth={7} strokeLinecap="round" />
		<path d="M-40,-728 C-36,-744 36,-744 40,-728" fill="none" stroke={C.steel} strokeWidth={1.6} strokeLinecap="round" />

		{/* neck */}
		<path d={NECK} fill={C.skin} />
		<g clipPath={`url(#${p}-neck)`}>
			<path d={headPath(0)} transform="translate(0,-802)" fill={`url(#${p}-sk2)`} />
			<path d={headPath(0)} transform="translate(0,-794)" fill={`url(#${p}-sk1)`} />
			<path d="M8,-780 L40,-780 L40,-690 L14,-690 Z" transform={`scale(${s},1)`} fill={`url(#${p}-sk1)`} />
		</g>
		<path d={NECK} fill="none" stroke={C.ink} strokeWidth={LINE} />
		<path d="M-3,-728 Q0,-724 3,-728" fill="none" stroke={C.skinLine} strokeWidth={1.3} strokeLinecap="round" />

		{/* overshirt body */}
		<path d={TORSO} fill={C.shirt} />
		<g clipPath={`url(#${p}-torso)`}>
			<g transform={`scale(${s},1)`}>
				<path d="M76,-720 C90,-640 88,-520 84,-390 L150,-390 L150,-720 Z" fill={`url(#${p}-ik1)`} />
				<path d="M98,-720 C108,-640 106,-520 104,-390 L150,-390 L150,-720 Z" fill={`url(#${p}-ik2)`} />
			</g>
			<path d={COLLAR_L} transform="translate(4,8)" fill={`url(#${p}-ik2)`} />
			<path d={COLLAR_L} transform="translate(-4,8) scale(-1,1)" fill={`url(#${p}-ik2)`} />
			<path d={TORSO} fill="none" stroke={C.silver} strokeWidth={5} mask={`url(#${p}-rim)`} />
		</g>
		<path d={TORSO} fill="none" stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />

		{/* tee */}
		<path d={TEE} fill={C.tee} />
		<g clipPath={`url(#${p}-tee)`}>
			<path d="M-40,-712 C-14,-690 14,-690 40,-712 L40,-694 C14,-684 -14,-684 -40,-694 Z" fill={`url(#${p}-tx1)`} />
			<g transform={`scale(${s},1)`}>
				<path d="M16,-700 C22,-600 26,-500 28,-390 L60,-390 L60,-700 Z" fill={`url(#${p}-tx1)`} />
			</g>
			<path d="M-50,-420 L50,-420 L50,-390 L-50,-390 Z" fill={`url(#${p}-tx1)`} />
		</g>
		<path d={TEE} fill="none" stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />

		{/* buttons on the open placket */}
		{[-662, -604, -546, -488].map((yy, i) => (
			<circle key={yy} cx={r2(36 + i * 1.6)} cy={yy} r={2.6} fill={C.silverDark} stroke={C.ink} strokeWidth={1.2} />
		))}
		{/* chest pocket */}
		<path d="M-100,-626 L-62,-626 L-62,-584 Q-81,-578 -100,-584 Z" fill="none" stroke={C.ink} strokeWidth={1.6} strokeLinejoin="round" />
		<path d="M-100,-616 L-62,-616" stroke={C.ink} strokeWidth={1.4} />
		{/* hem fold */}
		<path d="M-108,-414 C-80,-408 -60,-406 -44,-405 M44,-405 C60,-406 80,-408 108,-414" fill="none" stroke={C.shirtLight} strokeWidth={1.6} />

		{/* collars */}
		<path d={COLLAR_L} fill={C.shirtLight} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
		<path d={COLLAR_L} transform="scale(-1,1)" fill={C.shirtLight} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />

		{/* headphone cups resting on the collarbones: the one accent detail on the outfit */}
		{[-1, 1].map((m) => (
			<g key={m} transform={`translate(${48 * m},-702) rotate(${-22 * m})`}>
				<ellipse cx={0} cy={4} rx={22} ry={14} fill={C.accent} stroke={C.ink} strokeWidth={LINE} />
				<ellipse cx={0} cy={0} rx={22} ry={14} fill={C.slate2} stroke={C.ink} strokeWidth={LINE} />
				<ellipse cx={0} cy={-1.5} rx={15} ry={8.5} fill={C.ink} />
				<path d="M-15,-4 Q-5,-11 9,-9" fill="none" stroke={C.steel} strokeWidth={1.8} strokeLinecap="round" />
			</g>
		))}
	</g>
);

const Legs: React.FC<{p: string; s: number}> = ({p, s}) => (
	<g className="legs" data-part="legs">
		<defs>
			<clipPath id={`${p}-pants`}>
				<path d={PANTS} />
			</clipPath>
		</defs>
		{[1, -1].map((m) => (
			<g key={m} transform={`scale(${m},1)`}>
				<path d={SHOE_R} fill={C.shoe} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
				<path d={SOLE_R} fill={C.sole} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
				<path d="M96,-36 C102,-26 112,-20 122,-16" fill="none" stroke={C.ink} strokeWidth={1.4} />
				<path d="M50,-34 L62,-30 M58,-38 L70,-33 M66,-41 L77,-36" stroke={C.ink} strokeWidth={1.6} strokeLinecap="round" />
				{m === s ? <path d="M70,-40 C90,-30 110,-22 124,-12 L60,-12 Z" fill={`url(#${p}-tx1)`} opacity={0.8} /> : null}
			</g>
		))}
		<path d={PANTS} fill={C.pants} />
		<g clipPath={`url(#${p}-pants)`}>
			<g transform={`scale(${s},1)`}>
				<path d="M70,-440 C74,-330 68,-200 62,-20 L120,-20 L120,-440 Z" fill={`url(#${p}-ik2)`} />
				<path d="M-38,-440 C-30,-330 -36,-200 -40,-20 L-22,-20 C-24,-200 -12,-300 2,-350 Z" fill={`url(#${p}-ik1)`} />
			</g>
			<path d="M-120,-440 L120,-440 L120,-404 Q0,-392 -120,-404 Z" fill={`url(#${p}-ik2)`} />
			<path d={PANTS} fill="none" stroke={C.silver} strokeWidth={4} mask={`url(#${p}-rim)`} opacity={0.8} />
		</g>
		<path d={PANTS} fill="none" stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
		<g fill="none" stroke={C.ink} strokeWidth={1.4} strokeLinecap="round">
			<path d="M-84,-48 L-42,-48 M42,-48 L84,-48" />
			<path d="M-74,-250 C-66,-244 -58,-244 -50,-250 M50,-250 C58,-244 66,-244 74,-250" />
		</g>
	</g>
);

/* ------------------------------------------------------------------ */
/* Figure (an SVG <g>, origin at the feet)                              */
/* ------------------------------------------------------------------ */

export type InknoirFigureProps = Omit<InknoirCharacterProps, 'x' | 'y' | 'scale' | 'style'>;

export const InknoirFigure: React.FC<InknoirFigureProps> = ({
	expression = 'neutral',
	mouthOpen = 0,
	blink = 0,
	pose = 'idle',
	lookX = 0,
	pointSide = 'right',
	lightFrom = 'left',
	floorShadow = true,
}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const p = `ink${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
	const s = lightFrom === 'left' ? 1 : -1;
	const e = EXPR[expression];
	const lx = Math.max(-1, Math.min(1, lookX));
	// Idle breathing: ~1.5 units, period 3 s.
	const breath = Math.sin((frame / (3 * fps)) * Math.PI * 2);
	const by = r2(-1.5 * breath);
	const pointR = pose === 'point' && pointSide === 'right';
	const pointL = pose === 'point' && pointSide === 'left';

	return (
		<g className="inknoir-figure">
			<defs>
				{dots(`${p}-sk1`, 0.7, C.skinDot, 4)}
				{dots(`${p}-sk2`, 1.1, C.skinDot, 4)}
				{dots(`${p}-tx1`, 0.85, C.teeDot, 4.5)}
				{dots(`${p}-ik1`, 1.0, C.ink)}
				{dots(`${p}-ik2`, 1.6, C.ink)}
				{dots(`${p}-stb`, 0.45, C.stubble, 2.6, 10)}
				<linearGradient id={`${p}-rimG`} x1={s > 0 ? 0 : 1} y1={0} x2={s > 0 ? 1 : 0} y2={0}>
					<stop offset={0.62} stopColor="#000" />
					<stop offset={0.9} stopColor="#fff" />
				</linearGradient>
				<mask id={`${p}-rim`} maskContentUnits="objectBoundingBox">
					<rect x={0} y={0} width={1} height={1} fill={`url(#${p}-rimG)`} />
				</mask>
			</defs>
			{floorShadow ? <ellipse cx={0} cy={0} rx={150} ry={14} fill={C.ink} opacity={0.55} /> : null}
			<Legs p={p} s={s} />
			<g transform={`translate(0,${by})`}>
				<Torso p={p} s={s} />
				<g className="armL" data-part="armL" transform="scale(-1,1)">
					<Arm p={p} id="L" point={pointL} side={-s} alt={!pointL} />
				</g>
				<g className="armR" data-part="armR">
					<Arm p={p} id="R" point={pointR} side={s} />
				</g>
				<g transform={`translate(${r2(lx * 3)},${r2(-812 + e.lift + by * 0.4)}) rotate(${e.tilt})`}>
					<Head p={p} e={e} mouthOpen={mouthOpen} blink={blink} lookX={lx} s={s} />
				</g>
			</g>
		</g>
	);
};

/* ------------------------------------------------------------------ */
/* Public component: positioned SVG                                     */
/* ------------------------------------------------------------------ */

const VB = {x: -500, y: -1000, w: 1000, h: 1040};

export const InknoirCharacter: React.FC<InknoirCharacterProps> = ({x = 960, y = 1000, scale = 1, style, ...rest}) => (
	<svg
		viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
		width={VB.w * scale}
		height={VB.h * scale}
		style={{position: 'absolute', left: x + VB.x * scale, top: y + VB.y * scale, overflow: 'visible', ...style}}
	>
		<InknoirFigure {...rest} />
	</svg>
);
