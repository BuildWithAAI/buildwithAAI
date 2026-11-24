import React, {useId} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

/*
 * "YOU" — Zoora AI host, concept B "Flat Bold".
 *
 * Style rules: flat fills, no outlines, exactly one flat shadow tone per colour
 * (two-tone shading, key light from screen-left), chunky readable shapes.
 *
 * Coordinate system (character units, 1 unit = 1 px at scale 1):
 *   origin (0,0) = ground point between the feet, +y down, figure ~1040 units tall.
 *   viewBox of the wrapper svg: x -600..600, y -1090..30.
 *   Named groups (data-name): torso, armL (screen-left arm), armR (screen-right arm),
 *   head, eyes, mouth, plus legs, neck, hair, brows.
 */

export const FLATBOLD = {
	ink: '#0B0C0F',
	slate: '#161A21',
	silver: '#C9CED6',
	silverDark: '#8C939E',
	white: '#F4F6F8',
	amber: '#FFB020',
	amberShade: '#C97F0C',
	skin: '#E8AC84',
	skinShade: '#C4825F',
	hair: '#6B4431',
	hairShade: '#45291D',
	pants: '#3A4250',
	pantsShade: '#2A303B',
	shoe: '#C9CED6',
	shoeShade: '#8C939E',
	mouth: '#2B1114',
	tongue: '#A64A42',
} as const;

const C = FLATBOLD;

export type FlatboldExpression = 'neutral' | 'happy' | 'worried' | 'shocked';
export type FlatboldPose = 'idle' | 'point';

export type FlatboldFigureProps = {
	expression?: FlatboldExpression;
	/** 0 = closed, 1 = fully open (drive from audio amplitude). */
	mouthOpen?: number;
	/** 0 = open eyes, 1 = fully closed. */
	blink?: number;
	pose?: FlatboldPose;
	/** -1 = look to screen-left, 1 = look to screen-right. */
	lookX?: number;
	/** Screen side the 'point' arm aims at. Default 'right'. */
	pointSide?: 'left' | 'right';
	/** Vertical breathing offset in character units (positive = chest up). */
	breath?: number;
};

export type FlatboldCharacterProps = FlatboldFigureProps & {
	/** Screen position (px) of the character origin = ground point between the feet. */
	x?: number;
	y?: number;
	/** 1 = 1 character unit per px; the figure is ~1040 px tall at scale 1. */
	scale?: number;
};

type ExprParams = {
	browY: number; // + = down
	browIn: number; // inner-end raise (+ = worried / surprised, - = frown)
	browArch: number;
	eyeRx: number;
	eyeTop: number;
	eyeBot: number;
	lowerLid: number; // 0..1 cheek push on the lower lid (smile eyes)
	irisR: number;
	smile: number; // -1..1 mouth-corner lift
	mouthW: number;
	mouthWOpen: number;
	mouthH: number; // max open height
	mouthRound: number; // 0.45 = wide grin, 1 = round O
	headTilt: number; // degrees
	shoulderLift: number;
	arms: {l: [number, number]; r: [number, number]};
};

const EXPR: Record<FlatboldExpression, ExprParams> = {
	neutral: {
		browY: 0,
		browIn: 0,
		browArch: 3,
		eyeRx: 18,
		eyeTop: 15.5,
		eyeBot: 12.5,
		lowerLid: 0,
		irisR: 12,
		smile: 0.15,
		mouthW: 44,
		mouthWOpen: 6,
		mouthH: 40,
		mouthRound: 0.6,
		headTilt: 1.5,
		shoulderLift: 0,
		arms: {l: [6, -6], r: [12, 3]},
	},
	happy: {
		browY: -6,
		browIn: -1,
		browArch: 6,
		eyeRx: 18,
		eyeTop: 15,
		eyeBot: 13,
		lowerLid: 0.62,
		irisR: 12,
		smile: 1,
		mouthW: 58,
		mouthWOpen: 4,
		mouthH: 34,
		mouthRound: 0.42,
		headTilt: -3,
		shoulderLift: 2,
		arms: {l: [11, 4], r: [13, 6]},
	},
	worried: {
		browY: -3,
		browIn: 11,
		browArch: 0,
		eyeRx: 17.5,
		eyeTop: 17,
		eyeBot: 13.5,
		lowerLid: 0,
		irisR: 11,
		smile: -0.75,
		mouthW: 40,
		mouthWOpen: 4,
		mouthH: 32,
		mouthRound: 0.7,
		headTilt: 4,
		shoulderLift: 7,
		arms: {l: [6, -14], r: [7, -18]},
	},
	shocked: {
		browY: -15,
		browIn: 3,
		browArch: 5,
		eyeRx: 20,
		eyeTop: 24,
		eyeBot: 20,
		lowerLid: 0,
		irisR: 8.5,
		smile: -0.25,
		mouthW: 30,
		mouthWOpen: 12,
		mouthH: 56,
		mouthRound: 1,
		headTilt: 0,
		shoulderLift: 11,
		arms: {l: [8, 11], r: [9, 12]},
	},
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rad = (d: number) => (d * Math.PI) / 180;
const f = (n: number) => Math.round(n * 100) / 100;

// ----------------------------------------------------------------------------
// Body geometry
// ----------------------------------------------------------------------------
const SHOULDER_Y = -762; // top of shoulder line
const HEAD_Y = -905; // head centre
const ARM_X = 132; // shoulder pivot x
const L_UPPER = 160;
const L_FORE = 158;
const W_UPPER = 66;
const W_FORE = 58;
const HEM_Y = -452;

const jacketPath = (sy: number) =>
	[
		`M -48 ${sy - 22}`,
		`C -92 ${sy - 18} -134 ${sy - 10} -150 ${sy + 14}`,
		`C -164 ${sy + 44} -158 ${sy + 130} -148 ${sy + 200}`,
		`L -134 ${HEM_Y}`,
		`Q 0 ${HEM_Y + 10} 134 ${HEM_Y}`,
		`L 148 ${sy + 200}`,
		`C 158 ${sy + 130} 164 ${sy + 44} 150 ${sy + 14}`,
		`C 134 ${sy - 10} 92 ${sy - 18} 48 ${sy - 22}`,
		`Q 0 ${sy - 8} -48 ${sy - 22} Z`,
	].join(' ');

// ----------------------------------------------------------------------------
// Arms
// ----------------------------------------------------------------------------
type HandKind = 'relaxed' | 'point' | 'hip' | 'open';

const Hand: React.FC<{kind: HandKind}> = ({kind}) => {
	// Local frame: wrist at origin, +y runs along the forearm, -x faces the body.
	if (kind === 'point') {
		// +x side of the fist = top of the hand when the arm is horizontal.
		return (
			<g>
				<rect x={-27} y={-8} width={54} height={56} rx={21} fill={C.skin} />
				<rect x={-27} y={22} width={33} height={28} rx={13} fill={C.skinShade} />
				<rect x={4} y={24} width={22} height={82} rx={11} fill={C.skin} />
				<rect x={4} y={24} width={8} height={78} rx={4} fill={C.skinShade} />
				<ellipse cx={-6} cy={12} rx={10} ry={17} fill={C.skinShade} transform="rotate(-12 -6 12)" />
			</g>
		);
	}
	if (kind === 'hip') {
		// Loose fist resting on the hip, knuckles forward.
		return (
			<g>
				<rect x={-26} y={-8} width={50} height={50} rx={21} fill={C.skin} />
				<rect x={-26} y={20} width={50} height={22} rx={11} fill={C.skinShade} />
				<ellipse cx={-14} cy={14} rx={9} ry={15} fill={C.skin} />
			</g>
		);
	}
	if (kind === 'open') {
		// Raised open palm facing the viewer, fingers along +y, thumb on +x.
		return (
			<g>
				<rect x={20} y={-2} width={13} height={38} rx={6.5} fill={C.skin} transform="rotate(-38 26 10)" />
				{[
					[-26, 32],
					[-12.5, 38],
					[1, 36],
					[14.5, 28],
				].map(([fxp, len]) => (
					<rect key={fxp} x={fxp} y={24} width={12.5} height={len} rx={6.25} fill={C.skin} />
				))}
				<rect x={-26} y={-8} width={52} height={50} rx={18} fill={C.skin} />
				<rect x={-26} y={-8} width={16} height={50} rx={8} fill={C.skinShade} />
			</g>
		);
	}
	return (
		<g>
			<rect x={-25} y={-8} width={50} height={70} rx={22} fill={C.skin} />
			<rect x={-25} y={-8} width={15} height={70} rx={7.5} fill={C.skinShade} />
			<ellipse cx={-19} cy={24} rx={10} ry={19} fill={C.skin} transform="rotate(14 -19 24)" />
			<rect x={-10} y={44} width={30} height={7} rx={3.5} fill={C.skinShade} />
		</g>
	);
};

type ArmProps = {
	a1: number; // upper arm angle from straight down, + = outward (screen-right in local frame)
	a2: number; // forearm angle
	hand: HandKind;
};

const ArmShape: React.FC<ArmProps> = ({a1, a2, hand}) => {
	const d1 = {x: Math.sin(rad(a1)), y: Math.cos(rad(a1))};
	const d2 = {x: Math.sin(rad(a2)), y: Math.cos(rad(a2))};
	const elbow = {x: d1.x * L_UPPER, y: d1.y * L_UPPER};
	const wrist = {x: elbow.x + d2.x * L_FORE, y: elbow.y + d2.y * L_FORE};
	// Shadow side = the side whose normal points inward/down.
	const shadeN = (d: {x: number; y: number}) => {
		const n1 = {x: -d.y, y: d.x};
		return n1.x * -0.8 + n1.y * 0.6 > 0 ? n1 : {x: d.y, y: -d.x};
	};
	const n1 = shadeN(d1);
	const n2 = shadeN(d2);
	const S = 7;
	const cuffA = {x: wrist.x - d2.x * 20, y: wrist.y - d2.y * 20};
	return (
		<g>
			<g transform={`translate(${f(wrist.x)} ${f(wrist.y)}) rotate(${f(-a2)})`}>
				<Hand kind={hand} />
			</g>
			{/* shadow tone base */}
			<path d={`M 0 0 L ${f(elbow.x)} ${f(elbow.y)}`} stroke={C.amberShade} strokeWidth={W_UPPER} strokeLinecap="round" />
			<path d={`M ${f(elbow.x)} ${f(elbow.y)} L ${f(wrist.x)} ${f(wrist.y)}`} stroke={C.amberShade} strokeWidth={W_FORE} />
			{/* lit tone */}
			<path
				d={`M ${f(-n1.x * S)} ${f(-n1.y * S)} L ${f(elbow.x - n1.x * S)} ${f(elbow.y - n1.y * S)}`}
				stroke={C.amber}
				strokeWidth={W_UPPER - 2 * S}
				strokeLinecap="round"
			/>
			<path
				d={`M ${f(elbow.x - n2.x * S)} ${f(elbow.y - n2.y * S)} L ${f(cuffA.x - n2.x * S)} ${f(cuffA.y - n2.y * S)}`}
				stroke={C.amber}
				strokeWidth={W_FORE - 2 * S}
			/>
			{/* cuff */}
			<path d={`M ${f(cuffA.x)} ${f(cuffA.y)} L ${f(wrist.x)} ${f(wrist.y)}`} stroke={C.amberShade} strokeWidth={W_FORE + 4} />
		</g>
	);
};

// ----------------------------------------------------------------------------
// Face parts
// ----------------------------------------------------------------------------
const eyeGeometry = (ex: number, ey: number, rx: number, top: number, bot: number, blink: number) => {
	const b = clamp01(blink);
	const closedMid = 0.42 * top;
	const topH = lerp(top, -closedMid, b);
	const botH = lerp(bot, closedMid, b);
	const kx = rx * lerp(0.96, 0.62, b);
	const yTop = ey - (topH * 4) / 3;
	const yBot = ey + (botH * 4) / 3;
	const upper = `M ${f(ex - rx)} ${f(ey)} C ${f(ex - kx)} ${f(yTop)} ${f(ex + kx)} ${f(yTop)} ${f(ex + rx)} ${f(ey)}`;
	const shape = `${upper} C ${f(ex + kx)} ${f(yBot)} ${f(ex - kx)} ${f(yBot)} ${f(ex - rx)} ${f(ey)} Z`;
	return {upper, shape};
};

const mouthGeometry = (e: ExprParams, open: number) => {
	const o = clamp01(open);
	const hw = (e.mouthW + e.mouthWOpen * o) / 2;
	const my = 64;
	const cornerY = my - e.smile * 9 + o * 2;
	const midClosed = my + e.smile * 4;
	const H = e.mouthH * o;
	const upMid = midClosed - H * 0.18;
	const loMid = midClosed + H * 0.82;
	const kx = hw * e.mouthRound;
	const ku = (4 * upMid - cornerY) / 3;
	const kl = (4 * loMid - cornerY) / 3;
	const upper = `M ${f(-hw)} ${f(cornerY)} C ${f(-kx)} ${f(ku)} ${f(kx)} ${f(ku)} ${f(hw)} ${f(cornerY)}`;
	const shape = `${upper} C ${f(kx)} ${f(kl)} ${f(-kx)} ${f(kl)} ${f(-hw)} ${f(cornerY)} Z`;
	return {upper, shape, hw, upMid, loMid, H};
};

const browPath = (side: 1 | -1, e: ExprParams) => {
	const by = -46 + e.browY;
	const xi = 15 * side;
	const xo = 62 * side;
	const xm = 38 * side;
	const yi = by - e.browIn;
	const yo = by + e.browIn * 0.25 + 3;
	const ym = (yi + yo) / 2 - e.browArch;
	return [
		`M ${f(xi)} ${f(yi - 7)}`,
		`Q ${f(xm)} ${f(ym - 9)} ${f(xo)} ${f(yo - 5)}`,
		`L ${f(xo + 2 * side)} ${f(yo + 4)}`,
		`Q ${f(xm)} ${f(ym + 4)} ${f(xi)} ${f(yi + 7)} Z`,
	].join(' ');
};

const FACE = [
	'M -86 -50',
	'C -86 -94 -50 -106 0 -106',
	'C 50 -106 86 -94 86 -50',
	'L 88 16',
	'C 88 62 66 94 36 106',
	'Q 0 116 -36 106',
	'C -66 94 -88 62 -88 16 Z',
].join(' ');

const BEARD = [
	'M -89 -6',
	'C -92 52 -72 100 -36 114',
	'Q 0 126 36 114',
	'C 72 100 92 52 89 -6',
	'L 77 -6',
	'C 76 26 66 48 46 56',
	'C 42 74 24 86 0 86',
	'C -24 86 -42 74 -46 56',
	'C -66 48 -76 26 -77 -6 Z',
].join(' ');

const MUSTACHE = [
	'M -50 66',
	'C -46 44 -20 34 0 40',
	'C 20 34 46 44 50 66',
	'C 36 54 16 52 0 55',
	'C -16 52 -36 54 -50 66 Z',
].join(' ');

// Short faded sides (shadow tone), one piece per side, tucked under the top.
const HAIR_SIDE = [
	'M -92 -4',
	'L -93 -60',
	'C -93 -84 -86 -100 -74 -108',
	'L -70 -64',
	'L -79 -4 Z',
].join(' ');

// Textured top, side part on the left, swept up and to the right.
const HAIR_TOP = [
	'M -80 -56',
	'C -98 -86 -88 -126 -48 -140',
	'C -12 -152 42 -150 78 -132',
	'C 100 -120 112 -96 105 -72',
	'C 101 -77 95 -80 88 -80',
	'C 92 -72 92 -62 88 -52',
	'C 80 -66 66 -76 46 -80',
	'C 26 -84 6 -82 -12 -78',
	'C -24 -84 -38 -88 -50 -84',
	'C -56 -74 -66 -62 -80 -56 Z',
].join(' ');

const HAIR_TEXTURE = [
	// side part
	'M -50 -84 C -48 -104 -38 -124 -16 -138 C -30 -118 -38 -102 -40 -82 Z',
	// sweep
	'M -2 -96 C 28 -120 64 -126 94 -112 C 66 -112 38 -106 10 -88 Z',
	'M 40 -86 C 60 -98 82 -100 100 -92 C 84 -90 66 -86 54 -80 Z',
];

// ----------------------------------------------------------------------------
// Figure (a <g>, for embedding in any SVG that uses character units)
// ----------------------------------------------------------------------------
export const FlatboldFigure: React.FC<FlatboldFigureProps> = ({
	expression = 'neutral',
	mouthOpen = 0,
	blink = 0,
	pose = 'idle',
	lookX = 0,
	pointSide = 'right',
	breath = 0,
}) => {
	const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
	const e = EXPR[expression];
	const look = Math.max(-1, Math.min(1, lookX));
	const sy = SHOULDER_Y - e.shoulderLift;
	const id = (s: string) => `fb-${uid}-${s}`;

	// Arms -------------------------------------------------------------------
	const pointR = pose === 'point' && pointSide === 'right';
	const pointL = pose === 'point' && pointSide === 'left';
	const pointing: ArmProps = {a1: 72, a2: 88, hand: 'point'};
	// The free arm in 'point' follows the mood: hand on hip, raised palm, or hanging.
	const freeArm = (idle: [number, number]): ArmProps =>
		expression === 'shocked'
			? {a1: 32, a2: 158, hand: 'open'}
			: expression === 'worried'
				? {a1: idle[0], a2: idle[1], hand: 'relaxed'}
				: {a1: 30, a2: -40, hand: 'hip'};
	const armR: ArmProps = pointR ? pointing : pointL ? freeArm(e.arms.r) : {a1: e.arms.r[0], a2: e.arms.r[1], hand: 'relaxed'};
	const armL: ArmProps = pointL ? pointing : pointR ? freeArm(e.arms.l) : {a1: e.arms.l[0], a2: e.arms.l[1], hand: 'relaxed'};

	// Head -------------------------------------------------------------------
	const tilt = e.headTilt + (pose === 'point' ? (pointSide === 'right' ? 3 : -3) : 0);
	const fx = look * 7; // feature shift for the head turn
	const eyeY = -6;
	const eyes = ([-1, 1] as const).map((s) => {
		const ex = s * 38 + fx;
		const g = eyeGeometry(ex, eyeY, e.eyeRx, e.eyeTop, e.eyeBot * (1 - e.lowerLid), blink);
		return {s, ex, ...g};
	});
	const m = mouthGeometry(e, mouthOpen);
	const earShift = (s: 1 | -1) => (s === Math.sign(look) ? -Math.abs(look) * 6 : Math.abs(look) * 2);

	return (
		<g>
			<defs>
				<clipPath id={id('jacket')}>
					<path d={jacketPath(sy)} />
				</clipPath>
				<clipPath id={id('face')}>
					<path d={FACE} />
				</clipPath>
				<clipPath id={id('beard')}>
					<path d={BEARD} />
				</clipPath>
				<clipPath id={id('mouth')}>
					<path d={m.shape} />
				</clipPath>
				{eyes.map((ey) => (
					<clipPath key={ey.s} id={id(`eye${ey.s}`)}>
						<path d={ey.shape} />
					</clipPath>
				))}
			</defs>

			{/* LEGS ---------------------------------------------------------- */}
			<g data-name="legs">
				<path d="M -120 -472 L 120 -472 L 106 -40 L 20 -40 L 8 -405 L -8 -405 L -20 -40 L -106 -40 Z" fill={C.pants} />
				<path d="M 74 -472 L 120 -472 L 106 -40 L 80 -40 Z" fill={C.pantsShade} />
				<path d="M -8 -405 L -20 -40 L -40 -40 L -30 -405 Z" fill={C.pantsShade} />
				<path d="M -14 -472 L 14 -472 L 8 -405 L -8 -405 Z" fill={C.pantsShade} />
				<path d="M -107 -64 L -19 -64 L -20 -40 L -106 -40 Z M 19 -64 L 107 -64 L 106 -40 L 20 -40 Z" fill={C.pantsShade} />
				{/* shoes */}
				{([-1, 1] as const).map((s) => (
					<g key={s} transform={`translate(${s * 64} 0) scale(${s} 1)`}>
						<path d="M -50 0 L 56 0 Q 66 -2 62 -22 Q 56 -50 22 -54 L -30 -54 Q -52 -50 -54 -26 Z" fill={C.shoe} />
						<path d="M 22 -54 Q 56 -50 62 -22 Q 66 -2 56 0 L 30 0 Q 40 -30 22 -54 Z" fill={C.shoeShade} />
						<rect x={-54} y={-13} width={120} height={13} rx={6} fill={C.white} />
					</g>
				))}
			</g>

			{/* UPPER BODY (breathes) ---------------------------------------- */}
			<g transform={`translate(0 ${f(-breath)})`}>
				<g data-name="torso">
					<path d={jacketPath(sy)} fill={C.amber} />
					<g clipPath={`url(#${id('jacket')})`}>
						{/* key light from screen-left: shade the right flank */}
						<path d={`M 98 ${sy} C 124 ${sy + 120} 116 ${sy + 250} 96 ${HEM_Y + 20} L 220 ${HEM_Y + 20} L 220 ${sy - 40} Z`} fill={C.amberShade} />
						{/* hem band */}
						<rect x={-200} y={HEM_Y - 22} width={400} height={40} fill={C.amberShade} />
					</g>
					{/* open front: tee */}
					<path d={`M -46 ${sy - 20} L 46 ${sy - 20} L 38 ${HEM_Y + 6} L -36 ${HEM_Y + 6} Z`} fill={C.silver} />
					<path d={`M 14 ${sy - 10} L 46 ${sy - 20} L 38 ${HEM_Y + 6} L 18 ${HEM_Y + 6} Z`} fill={C.silverDark} />
					{/* neck */}
					<g data-name="neck">
						<path d={`M -31 ${sy - 90} L 31 ${sy - 90} L 31 ${sy - 10} Q 0 ${sy + 12} -31 ${sy - 10} Z`} fill={C.skin} />
						<path d={`M -31 ${sy - 90} L 31 ${sy - 90} L 31 ${sy - 30} Q 0 ${sy - 14} -31 ${sy - 30} Z`} fill={C.skinShade} />
						<path d={`M -34 ${sy - 12} Q 0 ${sy + 18} 34 ${sy - 12}`} stroke={C.silverDark} strokeWidth={9} fill="none" strokeLinecap="round" />
					</g>
					{/* collar / lapels */}
					{([-1, 1] as const).map((s) => (
						<path
							key={s}
							transform={`scale(${s} 1)`}
							d={`M 42 ${sy - 26} C 62 ${sy - 38} 88 ${sy - 32} 100 ${sy - 14} L 64 ${sy + 70} L 40 ${sy + 30} Z`}
							fill={C.amberShade}
						/>
					))}
					{/* chest pockets: flat drop edge + flap */}
					{([-1, 1] as const).map((s) => (
						<g key={s} transform={`scale(${s} 1)`}>
							<rect x={64} y={sy + 96} width={58} height={70} rx={6} fill={C.amberShade} />
							<rect x={60} y={sy + 92} width={58} height={70} rx={6} fill={s === 1 ? C.amberShade : C.amber} />
							<path d={`M 58 ${sy + 86} L 120 ${sy + 86} L 120 ${sy + 104} L 89 ${sy + 114} L 58 ${sy + 104} Z`} fill={C.amberShade} />
							<circle cx={89} cy={sy + 104} r={4.5} fill={C.silver} />
						</g>
					))}
				</g>

				{/* ARMS -------------------------------------------------------- */}
				<g data-name="armL" transform={`translate(${-ARM_X} ${sy + 24}) scale(-1 1)`}>
					<ArmShape {...armL} />
				</g>
				<g data-name="armR" transform={`translate(${ARM_X} ${sy + 24})`}>
					<ArmShape {...armR} />
				</g>

				{/* HEAD -------------------------------------------------------- */}
				<g data-name="head" transform={`translate(0 ${HEAD_Y - e.shoulderLift * 0.3}) rotate(${tilt} 0 110)`}>
					{/* ears */}
					{([-1, 1] as const).map((s) => (
						<g key={s} transform={`translate(${s * (88 + earShift(s))} -4)`}>
							<ellipse cx={0} cy={0} rx={15} ry={25} fill={s === 1 ? C.skinShade : C.skin} />
							<ellipse cx={s * 3} cy={1} rx={6.5} ry={13} fill={s === 1 ? C.skin : C.skinShade} />
						</g>
					))}
					<path d={FACE} fill={C.skin} />
					<g clipPath={`url(#${id('face')})`}>
						{/* shaded cheek (right) */}
						<path d={`M ${62 + fx * 0.5} -120 C ${78 + fx * 0.5} -50 ${76 + fx * 0.5} 30 40 130 L 140 130 L 140 -120 Z`} fill={C.skinShade} />
						{/* hair shadow on forehead */}
						<path d="M 20 -84 C 50 -84 78 -74 94 -52 L 96 -36 C 82 -56 58 -68 20 -72 Z" fill={C.skinShade} />
					</g>

					{/* beard */}
					<g transform={`translate(${f(fx * 0.4)} 0)`}>
						<path d={BEARD} fill={C.hair} />
						<g clipPath={`url(#${id('beard')})`}>
							<path d="M 58 -20 C 70 40 54 90 20 140 L 140 140 L 140 -20 Z" fill={C.hairShade} />
						</g>
					</g>

					{/* hair */}
					<g data-name="hair" transform={`translate(${f(fx * 0.35)} 0)`}>
						<path d={HAIR_SIDE} fill={C.hairShade} />
						<path d={HAIR_SIDE} fill={C.hairShade} transform="scale(-1 1)" />
						<path d={HAIR_TOP} fill={C.hair} />
						{HAIR_TEXTURE.map((d) => (
							<path key={d} d={d} fill={C.hairShade} />
						))}
					</g>

					{/* features (shift with the head turn) */}
					<g transform={`translate(${f(fx)} 0)`}>
						{/* nose */}
						<path d="M 4 -18 C 10 2 20 14 20 24 C 20 33 10 37 0 35 C -8 34 -14 31 -14 27 C -6 29 2 29 8 25 C 8 12 4 -2 4 -18 Z" fill={C.skinShade} />
						<g data-name="mouth">
							<path d={m.shape} fill={C.mouth} stroke={C.mouth} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
							<g clipPath={`url(#${id('mouth')})`}>
								<rect x={-m.hw - 4} y={m.upMid - 6} width={m.hw * 2 + 8} height={6 + Math.min(m.H * 0.3, 13)} fill={C.white} />
								<ellipse cx={0} cy={m.loMid + 4} rx={m.hw * 0.62} ry={Math.max(0.01, m.H * 0.36)} fill={C.tongue} />
							</g>
						</g>
						<path d={MUSTACHE} fill={C.hair} />
					</g>

					{/* eyes + brows */}
					<g data-name="eyes">
						{eyes.map((ey) => (
							<g key={ey.s}>
								<path d={ey.shape} fill={C.white} />
								<g clipPath={`url(#${id(`eye${ey.s}`)})`}>
									<circle cx={ey.ex + look * 7 - ey.s * 1} cy={eyeY + 1} r={e.irisR} fill={C.hairShade} />
									<circle cx={ey.ex + look * 7 - ey.s * 1} cy={eyeY + 1} r={e.irisR * 0.52} fill={C.ink} />
									<circle cx={ey.ex + look * 7 - ey.s * 1 + e.irisR * 0.38} cy={eyeY + 1 - e.irisR * 0.4} r={e.irisR * 0.27} fill={C.white} />
								</g>
								<path d={ey.upper} stroke={C.ink} strokeWidth={6} fill="none" strokeLinecap="round" />
							</g>
						))}
					</g>
					<g data-name="brows" transform={`translate(${f(fx)} 0)`}>
						<path d={browPath(-1, e)} fill={C.hairShade} stroke={C.hairShade} strokeWidth={3} strokeLinejoin="round" />
						<path d={browPath(1, e)} fill={C.hairShade} stroke={C.hairShade} strokeWidth={3} strokeLinejoin="round" />
					</g>
				</g>
			</g>
		</g>
	);
};

// ----------------------------------------------------------------------------
// Positioned character (own <svg>, origin at the feet)
// ----------------------------------------------------------------------------
const VB = {x: -600, y: -1090, w: 1200, h: 1120};

export const FlatboldCharacter: React.FC<FlatboldCharacterProps> = ({x = 960, y = 1040, scale = 1, ...figure}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	// Idle breathing: the upper body rises 0..1.5 px (output pixels) on a 3 s sine.
	const BREATH_PX = 1.5;
	const BREATH_PERIOD_S = 3;
	const wave = (Math.sin(((2 * Math.PI) / BREATH_PERIOD_S) * (frame / fps)) + 1) / 2;
	const breath = figure.breath ?? (wave * BREATH_PX) / Math.max(scale, 0.05);
	return (
		<svg
			viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
			width={VB.w * scale}
			height={VB.h * scale}
			style={{position: 'absolute', left: x + VB.x * scale, top: y + VB.y * scale, overflow: 'visible'}}
		>
			<FlatboldFigure {...figure} breath={breath} />
		</svg>
	);
};
