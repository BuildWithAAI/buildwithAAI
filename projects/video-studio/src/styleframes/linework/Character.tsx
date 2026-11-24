import React, {useId} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

/*
 * "YOU" — Linework host character for Zoora AI.
 *
 * Silver line art with one uniform stroke weight on dark fills, echoing the
 * channel's jellyfish logo. Signature silhouette: a swept quiff whose three
 * back flicks end in circuit nodes, and a tall popped tech-jacket collar.
 *
 * Coordinate system (character units): one viewBox, origin (0,0) on the floor
 * between the feet, -y is up. The figure is ~6 heads tall (crown at y≈-910,
 * eye line at y=-825, hips at y≈-450). armL / armR are the screen-left and
 * screen-right arms. The <svg> works both inside HTML (absolute positioning)
 * and nested inside another <svg> (x/y/width/height attributes).
 */

export type LineworkExpression = 'neutral' | 'happy' | 'worried' | 'shocked';
export type LineworkPose = 'idle' | 'point';

export type LineworkCharacterProps = {
	expression?: LineworkExpression;
	/** 0 = closed, 1 = fully open. Drive from audio amplitude. */
	mouthOpen?: number;
	/** 0 = open eyes, 1 = fully closed. */
	blink?: number;
	pose?: LineworkPose;
	/** -1 (screen-left) .. 1 (screen-right): pupils + head turn. */
	lookX?: number;
	/** Parent-space position of the origin (floor, between the feet). */
	x?: number;
	y?: number;
	/** Parent pixels per character unit. */
	scale?: number;
	/** Which screen side the 'point' arm reaches toward. */
	pointSide?: 'left' | 'right';
	/** 0..1 strength of the cyan rim light (screen glow). */
	rim?: number;
	rimSide?: 'left' | 'right';
	/** Idle breathing (sine, ~1.5 units, 3 s period). */
	breathe?: boolean;
};

export const LINEWORK_COLORS = {
	night: '#0B0C0F',
	slate: '#161A21',
	silver: '#C9CED6',
	steel: '#8C939E',
	white: '#F4F6F8',
	cyan: '#2DE2E6',
	skin: '#262C36',
	stubble: '#1C2028',
	jacket: '#161A21',
	tee: '#0B0C0F',
	pants: '#101319',
	hair: '#0B0C0F',
	mouth: '#07080A',
	tongue: '#2E3440',
} as const;

export const LINEWORK_VIEWBOX = {minX: -440, minY: -1000, width: 880, height: 1030} as const;

/** Useful points in character units (before x/y/scale). */
export const LINEWORK_ANCHORS = {
	eyes: {x: 0, y: -825},
	chin: {x: 0, y: -743},
	hips: {x: 0, y: -450},
	pointTipRight: {x: 410, y: -712},
	pointTipLeft: {x: -410, y: -712},
} as const;

const C = LINEWORK_COLORS;
const STROKE = 5;
const EYE_Y = -825;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clampS = (v: number) => Math.min(1, Math.max(-1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const r1 = (n: number) => Math.round(n * 10) / 10;

type Expr = {
	open: number; // upper-lid height multiplier
	lower: number; // lower-lid depth multiplier
	pupil: number; // iris size multiplier
	pupilY: number;
	browIn: number; // inner brow end y (head space)
	browOut: number; // outer brow end y
	arch: number;
	mouthW: number; // half width
	lift: number; // + = corners down, - = corners up
	bend: number; // + = smile curve, - = frown curve
	base: number; // minimum opening held by the expression
	depth: number; // max opening depth
	tilt: number; // head tilt (deg)
	headY: number;
	// body language for the idle arms: [swing at shoulder, bend at elbow] in degrees
	armL: [number, number];
	armR: [number, number];
	shrug: number; // shoulders lift (units)
};

const EXPR: Record<LineworkExpression, Expr> = {
	neutral: {open: 1, lower: 1, pupil: 1, pupilY: 0, browIn: -27, browOut: -28, arch: 4, mouthW: 17, lift: 0, bend: 1.5, base: 0, depth: 18, tilt: 0, headY: 0, armL: [-1, 4], armR: [-2.5, 10], shrug: 0},
	happy: {open: 1, lower: 0.2, pupil: 1, pupilY: -1, browIn: -33, browOut: -32, arch: 8, mouthW: 23, lift: -7, bend: 6, base: 0, depth: 19, tilt: 2.5, headY: -2, armL: [-2, 6], armR: [-3.5, 13], shrug: 0},
	worried: {open: 1.08, lower: 1, pupil: 0.86, pupilY: -1.5, browIn: -40, browOut: -25, arch: 2, mouthW: 15, lift: 5, bend: -3.5, base: 0.08, depth: 15, tilt: -3, headY: 3, armL: [1, 16], armR: [0.5, 20], shrug: 7},
	shocked: {open: 1.38, lower: 1.3, pupil: 0.6, pupilY: 0, browIn: -46, browOut: -43, arch: 8, mouthW: 12.5, lift: 1, bend: -1, base: 0.36, depth: 20, tilt: 0, headY: -6, armL: [-7, -4], armR: [-9, -6], shrug: 5},
};

type Ids = {ink: string; brow: string; eyeL: string; eyeR: string; mouth: string; face: string; rim: string};

/* ------------------------------------------------------------------ head */

const eyePath = (cx: number, side: -1 | 1, e: Expr, blink: number) => {
	const xi = cx - side * 16; // inner corner (toward the nose)
	const xo = cx + side * 16; // outer corner
	const d = xo - xi;
	const closed = 5; // closed lid sags into a soft arc
	const up = lerp(-15 * e.open, closed, blink);
	const lo = lerp(9 * e.lower, closed, blink);
	return `M ${r1(xi)} 0 C ${r1(xi + d * 0.22)} ${r1(up)} ${r1(xi + d * 0.72)} ${r1(up * 1.04)} ${r1(xo)} -1.5 C ${r1(xi + d * 0.72)} ${r1(lo)} ${r1(xi + d * 0.28)} ${r1(lo)} ${r1(xi)} 0 Z`;
};

const browPath = (e: Expr) => {
	// Drawn for the screen-right brow; mirrored for the left one.
	const xi = 12;
	const xo = 47;
	const yi = e.browIn;
	const yo = e.browOut;
	const xm = 30;
	const ym = (yi + yo) / 2 - e.arch;
	return `M ${xi} ${yi - 3.8} Q ${xm} ${ym - 4.2} ${xo} ${yo - 1.6} Q ${xo + 2.4} ${yo} ${xo} ${yo + 1.6} Q ${xm} ${ym + 3} ${xi} ${yi + 3.8} Q ${xi - 2} ${yi} ${xi} ${yi - 3.8} Z`;
};

const mouthGeom = (e: Expr, open: number) => {
	const o = clamp01(e.base + (1 - e.base) * open);
	const smile = e.lift < 0;
	const w = e.mouthW * (smile ? 1 - 0.08 * o : 1 - 0.24 * o);
	const y = 48;
	const cy = y + e.lift - (smile ? o * 2 : 0);
	const upCtrl = y + e.bend - o * 5;
	const upApex = cy + 0.75 * (upCtrl - cy);
	const loApex = y + e.bend + o * e.depth;
	const loCtrl = cy + (loApex - cy) / 0.75;
	// Control points spread outward as the mouth opens, so the corners round off
	// instead of pinching into a lens.
	const ux = w * (0.55 + 0.25 * o);
	const lx = w * (0.62 + 0.36 * o);
	const d = `M ${r1(-w)} ${r1(cy)} C ${r1(-ux)} ${r1(upCtrl)} ${r1(ux)} ${r1(upCtrl)} ${r1(w)} ${r1(cy)} C ${r1(lx)} ${r1(loCtrl)} ${r1(-lx)} ${r1(loCtrl)} ${r1(-w)} ${r1(cy)} Z`;
	return {d, o, w, cy, upApex, loApex};
};

const Eye: React.FC<{cx: number; side: -1 | 1; e: Expr; blink: number; look: number; clipId: string}> = ({cx, side, e, blink, look, clipId}) => {
	const d = eyePath(cx, side, e, blink);
	const ir = 8.6 * e.pupil;
	const px = cx + look * 6;
	const py = 1 + e.pupilY;
	return (
		<g data-part={side < 0 ? 'eyeL' : 'eyeR'}>
			<clipPath id={clipId}>
				<path d={d} />
			</clipPath>
			<path d={d} fill={C.white} stroke="none" />
			{blink < 0.9 ? (
				<g clipPath={`url(#${clipId})`}>
					<circle cx={px} cy={py} r={ir} fill={C.night} stroke="none" />
					<circle cx={px + ir * 0.36} cy={py - ir * 0.38} r={Math.max(1.6, ir * 0.3)} fill={C.white} stroke="none" />
					<circle cx={px - ir * 0.4} cy={py + ir * 0.4} r={Math.max(1, ir * 0.17)} fill={C.cyan} stroke="none" />
				</g>
			) : null}
			<path d={d} fill="none" />
		</g>
	);
};

const Head: React.FC<{e: Expr; expression: LineworkExpression; mouthOpen: number; blink: number; look: number; ids: Ids}> = ({
	e,
	expression,
	mouthOpen,
	blink,
	look,
	ids,
}) => {
	const m = mouthGeom(e, mouthOpen);
	const j = m.o * 7; // jaw drop while speaking
	const fx = look * 8; // feature shift for head turn
	const cx = look * 4; // chin follows a little
	const face = `M -62 -10 C -64 -60 -36 -86 0 -86 C 36 -86 64 -60 62 -10 C 61 12 ${58 + cx} ${30 + j * 0.4} ${52 + cx} ${46 + j * 0.7} C ${44 + cx} ${62 + j} ${30 + cx} ${73 + j} ${16 + cx} ${78 + j} Q ${cx} ${83 + j} ${-16 + cx} ${78 + j} C ${-30 + cx} ${73 + j} ${-44 + cx} ${62 + j} ${-52 + cx} ${46 + j * 0.7} C ${-58 + cx} ${30 + j * 0.4} -61 12 -62 -10 Z`;
	const under = Math.max(m.loApex + 9, 60);
	const stubble = `M -90 0 L -61 6 C -56 30 -44 44 ${r1(-30 + fx)} ${r1(m.cy + 6)} C ${r1(-22 + fx)} ${r1(under)} ${r1(-10 + fx)} ${r1(under + 2)} ${r1(fx)} ${r1(under + 2)} C ${r1(10 + fx)} ${r1(under + 2)} ${r1(22 + fx)} ${r1(under)} ${r1(30 + fx)} ${r1(m.cy + 6)} C 44 44 56 30 61 6 L 90 0 L 90 140 L -90 140 Z`;
	const ear = 'M 59 -16 C 71 -27 85 -14 81 3 C 79 15 72 24 60 22';
	const earIn = 'M 67 -7 C 74 -5 75 6 68 11';
	const hair =
		'M -60 -2 L -66 -32 C -71 -62 -63 -86 -46 -100 C -30 -114 -8 -126 16 -129 C 42 -132 66 -124 82 -112 ' +
		'L 112 -121 C 100 -108 92 -101 86 -96 L 114 -90 C 100 -80 88 -76 78 -71 L 98 -58 C 86 -53 75 -50 69 -45 ' +
		'C 68 -30 66 -16 62 -2 L 56 -2 C 56 -20 54 -36 46 -48 C 30 -60 2 -62 -20 -58 C -38 -55 -50 -45 -54 -30 L -54 -2 Z';
	const tips: Array<[number, number]> = [
		[112, -121],
		[114, -90],
		[98, -58],
	];
	const teethTop = m.upApex - 4;
	const teethH = 6 + m.o * 3;
	const showTeeth = m.o > 0.14;
	return (
		<g data-part="head">
			{/* ears sit behind the face */}
			<g transform={`translate(${r1(-look * 5)} 0)`}>
				<path d={ear} fill={C.skin} />
				<path d={earIn} fill="none" />
				<g transform="scale(-1 1)">
					<path d={ear} fill={C.skin} />
					<path d={earIn} fill="none" />
				</g>
			</g>
			<path d={face} fill={C.skin} />
			<clipPath id={ids.face}>
				<path d={face} />
			</clipPath>
			<path d={stubble} fill={C.stubble} stroke="none" clipPath={`url(#${ids.face})`} />
			{/* hair: swept quiff, three flicks ending in circuit nodes */}
			<g data-part="hair" transform={`translate(${r1(look * 2)} 0)`}>
				<path d={hair} fill={C.hair} />
				<path d="M -44 -64 C -26 -96 8 -112 48 -114" fill="none" />
				<path d="M -26 -60 C -6 -82 26 -94 62 -96" fill="none" />
				<circle cx={48} cy={-114} r={4.5} fill={C.hair} />
				<circle cx={62} cy={-96} r={4.5} fill={C.hair} />
				<path d="M -60 -34 C -60 -50 -56 -62 -50 -70" fill="none" />
				{tips.map(([tx, ty]) => (
					<circle key={`${tx}${ty}`} cx={tx} cy={ty} r={6} fill={C.cyan} />
				))}
			</g>
			<g data-part="face" transform={`translate(${r1(fx)} 0)`}>
				{/* brows */}
				<g data-part="brows">
					<path d={browPath(e)} fill={`url(#${ids.brow})`} />
					<g transform="scale(-1 1)">
						<path d={browPath(e)} fill={`url(#${ids.brow})`} />
					</g>
				</g>
				<g data-part="eyes">
					<Eye cx={-31} side={-1} e={e} blink={blink} look={look} clipId={ids.eyeL} />
					<Eye cx={31} side={1} e={e} blink={blink} look={look} clipId={ids.eyeR} />
				</g>
				{/* nose */}
				<path d="M -1 2 C -2 14 -9 26 -8 32 C -6 38 1 38 7 35" fill="none" />
				{/* mouth */}
				<g data-part="mouth">
					<clipPath id={ids.mouth}>
						<path d={m.d} />
					</clipPath>
					{m.o > 0.02 ? (
						<g clipPath={`url(#${ids.mouth})`}>
							<path d={m.d} fill={C.mouth} stroke="none" />
							{showTeeth ? <rect x={-m.w} y={teethTop} width={m.w * 2} height={teethH} fill={C.white} stroke="none" /> : null}
							<ellipse cx={0} cy={m.loApex + 2} rx={m.w * 0.6} ry={4 + m.o * 5} fill={C.tongue} stroke="none" />
						</g>
					) : null}
					<path d={m.d} fill="none" />
				</g>
				{/* chin crease (adult jaw) */}
				<path d={`M -7 ${r1(70 + j)} Q 0 ${r1(72.5 + j)} 7 ${r1(70 + j)}`} fill="none" opacity={clamp01((0.6 - m.o) / 0.25)} />
				{expression === 'happy' ? (
					<g data-part="smile-lines">
						<path d={`M ${r1(-m.w - 4)} ${r1(m.cy - 10)} Q ${r1(-m.w - 10)} ${r1(m.cy - 1)} ${r1(-m.w - 4)} ${r1(m.cy + 6)}`} fill="none" />
						<path d={`M ${r1(m.w + 4)} ${r1(m.cy - 10)} Q ${r1(m.w + 10)} ${r1(m.cy - 1)} ${r1(m.w + 4)} ${r1(m.cy + 6)}`} fill="none" />
					</g>
				) : null}
				{expression === 'worried' ? (
					<g data-part="worry">
						<path d="M -9 -47 Q 0 -50.5 9 -47" fill="none" />
						<path d="M -82 -34 C -77 -27 -74 -22 -74 -17 A 8 8 0 0 1 -90 -17 C -90 -22 -87 -27 -82 -34 Z" fill={C.cyan} />
					</g>
				) : null}
			</g>
			{expression === 'shocked' ? (
				<g data-part="pop-lines" fill="none">
					<path d="M -84 -104 L -100 -122" />
					<path d="M -96 -78 L -118 -86" />
					<path d="M -62 -124 L -70 -146" />
				</g>
			) : null}
		</g>
	);
};

/* ------------------------------------------------------------- body parts */

// All limb parts are drawn for the screen-right side and mirrored for the left.

const IdleArm: React.FC<{swing: number; bend: number}> = ({swing, bend}) => (
	<g transform={`rotate(${swing} 104 -700)`}>
		{/* forearm + hand pivot at the elbow */}
		<g transform={`rotate(${bend} 132 -556)`}>
			<path d="M 124 -442 C 120 -420 119 -400 122 -384 C 125 -370 130 -357 138 -350 C 145 -344 153 -348 154 -358 C 155 -384 155 -414 152 -442 Z" fill={C.skin} />
			<path d="M 126 -428 C 115 -418 113 -401 118 -392 C 122 -386 129 -389 130 -396" fill={C.skin} />
			<path d="M 131 -374 C 137 -369 144 -368 150 -372" fill="none" />
			<path d="M 116 -560 C 116 -576 149 -576 149 -560 C 151 -520 153 -480 155 -440 L 118 -436 C 117 -476 116 -516 116 -560 Z" fill={C.jacket} />
			<path d="M 154 -455 L 118 -452" fill="none" />
		</g>
		<path
			d="M 102 -707 C 124 -708 139 -694 141 -670 C 144 -640 147 -600 149 -566 C 150 -548 142 -538 132 -538 C 122 -538 116 -546 115 -556 C 113 -584 109 -604 104 -622 C 110 -650 110 -686 102 -707 Z"
			fill={C.jacket}
		/>
	</g>
);

const PointArm: React.FC = () => (
	<g transform="rotate(-5 100 -690)">
		<g transform="translate(322 -681) scale(1.1) translate(-322 681)">
		<path
			d="M 316 -700 C 332 -709 352 -707 364 -699 L 402 -695 C 413 -694 413 -682 402 -681 L 369 -681 C 375 -673 373 -662 362 -658 C 348 -652 330 -654 316 -662 Z"
			fill={C.skin}
		/>
		<path d="M 367 -681 C 363 -675 360 -671 354 -669" fill="none" />
		<path d="M 335 -703 C 345 -706 356 -704 362 -697" fill="none" />
		</g>
		<path
			d="M 102 -707 C 140 -720 190 -716 234 -707 L 322 -703 L 320 -660 L 232 -660 C 196 -658 162 -650 136 -640 C 122 -634 113 -628 106 -622 C 112 -652 110 -686 102 -707 Z"
			fill={C.jacket}
		/>
		<path d="M 148 -715 C 160 -694 158 -664 144 -646" fill="none" />
		<path d="M 226 -668 L 240 -678" fill="none" />
		<path d="M 305 -703 L 304 -660" fill="none" />
	</g>
);

const Leg: React.FC = () => (
	<g>
		<path d="M 2 -478 L 104 -478 C 107 -400 104 -320 98 -244 C 95 -170 93 -100 93 -46 L 31 -46 C 29 -110 26 -180 22 -244 C 18 -320 12 -400 3 -438 Z" fill={C.pants} />
		<path d="M 38 -64 C 52 -58 70 -58 88 -66" fill="none" />
		<path
			d="M 27 -50 L 97 -50 C 109 -44 119 -28 119 -14 C 119 -4 113 2 103 2 L 27 2 C 18 2 14 -5 14 -14 C 14 -28 19 -42 27 -50 Z"
			fill={C.jacket}
		/>
		<path d="M 16 -13 L 117 -13" fill="none" />
		<path d="M 45 -49 C 51 -36 73 -36 81 -49" fill="none" />
	</g>
);

const Torso: React.FC = () => (
	<g data-part="torso">
		{/* back of the stand collar, behind the neck */}
		<path d="M -50 -712 L -56 -780 Q 0 -792 56 -780 L 50 -712 Z" fill={C.jacket} />
		{/* tee visible in the open zip */}
		<path d="M -27 -714 L 0 -606 L 27 -714 Z" fill={C.tee} stroke="none" />
		<path d="M -26 -792 L -27 -706 Q 0 -690 27 -706 L 26 -792 Z" fill={C.skin} />
		{/* jacket body with the V opening */}
		<path
			d="M -24 -709 L -42 -715 C -66 -713 -88 -710 -104 -705 C -114 -700 -118 -684 -116 -664 L -108 -620 C -104 -590 -98 -560 -97 -530 C -97 -505 -100 -480 -102 -456 Q -52 -446 0 -448 Q 52 -446 102 -456 C 100 -480 97 -505 97 -530 C 98 -560 104 -590 108 -620 L 116 -664 C 118 -684 114 -700 104 -705 C 88 -710 66 -713 42 -715 L 24 -709 L 0 -612 Z"
			fill={C.jacket}
		/>
		{/* zipper + pull node */}
		<path d="M 0 -612 L 0 -450" fill="none" />
		<rect x={-5.5} y={-616} width={11} height={22} rx={5.5} fill={C.cyan} />
		{/* hem rib + welt pockets */}
		<path d="M -102 -475 Q 0 -463 102 -475" fill="none" />
		<path d="M -82 -562 L -70 -506" fill="none" />
		<path d="M 82 -562 L 70 -506" fill="none" />
		{/* chest pocket zip as a circuit trace */}
		<path d="M -96 -626 L -76 -626 L -60 -642 L -60 -660" fill="none" />
		<circle cx={-60} cy={-666} r={5.5} fill={C.cyan} />
		{/* popped stand collar: two tall flaps framing the jaw */}
		<path d="M 23 -709 L 37 -788 L 76 -777 L 68 -703 Z" fill={C.jacket} />
		<path d="M -23 -709 L -37 -788 L -76 -777 L -68 -703 Z" fill={C.jacket} />
		<path d="M 30 -717 L 41 -777" fill="none" stroke={C.cyan} strokeWidth={3} />
		<path d="M -30 -717 L -41 -777" fill="none" stroke={C.cyan} strokeWidth={3} />
	</g>
);

/* -------------------------------------------------------------- character */

export const LineworkCharacter: React.FC<LineworkCharacterProps> = ({
	expression = 'neutral',
	mouthOpen = 0,
	blink = 0,
	pose = 'idle',
	lookX = 0,
	x = 0,
	y = 0,
	scale = 1,
	pointSide = 'right',
	rim = 0,
	rimSide = 'right',
	breathe = true,
}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const raw = useId().replace(/[^a-zA-Z0-9_-]/g, '');
	const ids: Ids = {
		ink: `lw${raw}ink`,
		brow: `lw${raw}brow`,
		eyeL: `lw${raw}eyeL`,
		eyeR: `lw${raw}eyeR`,
		mouth: `lw${raw}mouth`,
		face: `lw${raw}face`,
		rim: `lw${raw}rim`,
	};
	const e = EXPR[expression];
	const look = clampS(lookX);
	const b = breathe ? Math.sin(((frame / fps) * Math.PI * 2) / 3) : 0; // 3 s period
	const vb = LINEWORK_VIEWBOX;
	const rs = rimSide === 'right' ? 1 : -1;
	const pointR = pose === 'point' && pointSide === 'right';
	const pointL = pose === 'point' && pointSide === 'left';
	const ink = `url(#${ids.ink})`;
	const left = x + vb.minX * scale;
	const top = y + vb.minY * scale;


	return (
		<svg
			x={left}
			y={top}
			width={vb.width * scale}
			height={vb.height * scale}
			viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`}
			overflow="visible"
			style={{position: 'absolute', left, top, overflow: 'visible'}}
		>
			<defs>
				<linearGradient id={ids.ink} gradientUnits="userSpaceOnUse" x1={0} y1={-960} x2={0} y2={0}>
					<stop offset={0} stopColor={C.white} />
					<stop offset={0.42} stopColor={C.silver} />
					<stop offset={1} stopColor={C.steel} />
				</linearGradient>
				<linearGradient id={ids.brow} gradientUnits="userSpaceOnUse" x1={0} y1={-140} x2={0} y2={60}>
					<stop offset={0} stopColor={C.white} />
					<stop offset={1} stopColor={C.silver} />
				</linearGradient>
				<filter id={ids.rim} x="-40%" y="-20%" width="180%" height="140%" colorInterpolationFilters="sRGB">
					<feMorphology in="SourceAlpha" operator="dilate" radius={1.5} result="fat" />
					<feOffset in="fat" dx={rs * 6} dy={-2} result="off" />
					<feFlood floodColor={C.cyan} floodOpacity={clamp01(rim)} />
					<feComposite in2="off" operator="in" result="edge" />
					<feGaussianBlur in="edge" stdDeviation={6} result="blur" />
					<feComponentTransfer in="blur" result="glow">
						<feFuncA type="linear" slope={0.42} />
					</feComponentTransfer>
					<feMerge>
						<feMergeNode in="glow" />
						<feMergeNode in="edge" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>
			<g
				data-part="figure"
				filter={rim > 0 ? `url(#${ids.rim})` : undefined}
				stroke={ink}
				strokeWidth={STROKE}
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<g data-part="legs">
					<Leg />
					<g transform="scale(-1 1)">
						<Leg />
					</g>
				</g>
				<g data-part="upper" transform={`translate(0 ${r1(-b * 1.6)})`}>
					<Torso />
					<g data-part="armL" transform={`translate(0 ${-e.shrug}) scale(-1 1)`}>
						{pointL ? <PointArm /> : <IdleArm swing={e.armL[0]} bend={e.armL[1]} />}
					</g>
					<g data-part="armR" transform={`translate(0 ${-e.shrug})`}>
						{pointR ? <PointArm /> : <IdleArm swing={e.armR[0]} bend={e.armR[1]} />}
					</g>
					<g transform={`translate(${r1(look * 3)} ${r1(EYE_Y + e.headY - b * 0.5)}) rotate(${r1(e.tilt + look * 2)} 0 70)`}>
						<Head e={e} expression={expression} mouthOpen={clamp01(mouthOpen)} blink={clamp01(blink)} look={look} ids={ids} />
					</g>
				</g>
			</g>
		</svg>
	);
};
