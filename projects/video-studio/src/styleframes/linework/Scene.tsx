import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {LINEWORK_COLORS as C, LineworkCharacter, type LineworkExpression, type LineworkPose} from './Character';

export type LineworkSceneProps = {
	time: string;
	chapter: string;
	chartTag: string;
	expression: LineworkExpression;
	pose: LineworkPose;
	mouthOpen: number;
	lookX: number;
};

export const lineworkSceneDefaults: LineworkSceneProps = {
	time: '3:07 AM',
	chapter: 'DAY 1',
	chartTag: '+38.4%',
	expression: 'shocked',
	pose: 'point',
	mouthOpen: 0.35,
	lookX: 0.75,
};

/* deterministic pseudo-random so every render is identical */
const rnd = (n: number) => {
	const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
};

const WIN = {x: 120, y: 60, w: 1420, h: 760};
const HORIZON = 760;

type Bld = {x: number; w: number; h: number};
const makeSkyline = (seed: number, minW: number, maxW: number, minH: number, maxH: number, calm?: [number, number, number]) => {
	const out: Bld[] = [];
	let x = WIN.x - 20;
	let i = 0;
	while (x < WIN.x + WIN.w + 20) {
		const w = minW + rnd(seed + i) * (maxW - minW);
		let h = minH + rnd(seed + i * 3.7) * (maxH - minH);
		if (calm && x + w > calm[0] && x < calm[1]) h = Math.min(h, calm[2]);
		out.push({x, w, h});
		x += w + 4 + rnd(seed + i * 1.3) * 10;
		i++;
	}
	return out;
};

const FAR = makeSkyline(11, 50, 110, 150, 330);
const NEAR = makeSkyline(47, 90, 170, 120, 340, [600, 1040, 150]);
const CHAR = {x: 780, y: 1719, scale: 1.55};

const CANDLES = [52, 50.5, 51.5, 49, 47.5, 48.5, 46, 47, 45.5, 46.5, 44, 45, 43.5, 44.5, 42.5, 43.5, 41.5, 43, 44.5, 43.2, 46, 51, 60, 74, 92];

const Chart: React.FC<{tag: string}> = ({tag}) => {
	const W = 500;
	const H = 290;
	const lo = 38;
	const hi = 96;
	const yOf = (v: number) => 40 + (1 - (v - lo) / (hi - lo)) * (H - 70);
	const step = (W - 90) / CANDLES.length;
	const last = CANDLES[CANDLES.length - 1];
	const linePts = CANDLES.map((c, i) => `${30 + i * step + step / 2},${yOf(c)}`).join(' ');
	return (
		<svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
			<defs>
				<linearGradient id="lw-chart-fill" x1={0} y1={0} x2={0} y2={1}>
					<stop offset={0} stopColor={C.cyan} stopOpacity={0.35} />
					<stop offset={1} stopColor={C.cyan} stopOpacity={0} />
				</linearGradient>
				<filter id="lw-chart-glow" x="-20%" y="-20%" width="140%" height="140%">
					<feGaussianBlur stdDeviation={4} result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>
			<rect width={W} height={H} fill="#0A1418" />
			{/* top bar: generic UI, no brands */}
			<rect x={0} y={0} width={W} height={26} fill="#0E1C21" />
			{[0, 1, 2].map((i) => (
				<circle key={i} cx={16 + i * 14} cy={13} r={4} fill={i === 0 ? C.cyan : C.steel} opacity={i === 0 ? 1 : 0.5} />
			))}
			<text x={70} y={18} fill={C.steel} fontFamily={FONTS.body} fontWeight={700} fontSize={12} letterSpacing={1.5}>
				COIN / USD · 1H
			</text>
			{/* grid */}
			{[0, 1, 2, 3, 4].map((i) => (
				<line key={`h${i}`} x1={20} x2={W - 70} y1={50 + i * 52} y2={50 + i * 52} stroke={C.steel} strokeOpacity={0.14} strokeWidth={1} />
			))}
			{[0, 1, 2, 3, 4, 5].map((i) => (
				<line key={`v${i}`} x1={30 + i * 72} x2={30 + i * 72} y1={34} y2={H - 14} stroke={C.steel} strokeOpacity={0.1} strokeWidth={1} />
			))}
			<polygon points={`${30 + step / 2},${H - 14} ${linePts} ${30 + (CANDLES.length - 1) * step + step / 2},${H - 14}`} fill="url(#lw-chart-fill)" opacity={0.55} />
			{CANDLES.map((c, i) => {
				const o = i === 0 ? c + 1 : CANDLES[i - 1];
				const up = c >= o;
				const x = 30 + i * step + step / 2;
				const top = yOf(Math.max(o, c));
				const bot = yOf(Math.min(o, c));
				const wickT = yOf(Math.max(o, c) + 0.6 + rnd(i) * 1.6);
				const wickB = yOf(Math.min(o, c) - 0.6 - rnd(i + 9) * 1.6);
				const col = up ? C.cyan : C.steel;
				return (
					<g key={i} filter={up && i > 19 ? 'url(#lw-chart-glow)' : undefined}>
						<line x1={x} x2={x} y1={wickT} y2={wickB} stroke={col} strokeWidth={2} />
						<rect
							x={x - step * 0.32}
							y={top}
							width={step * 0.64}
							height={Math.max(2, bot - top)}
							fill={up ? C.cyan : '#0A1418'}
							stroke={col}
							strokeWidth={2}
						/>
					</g>
				);
			})}
			{/* last-price line + tag */}
			<line x1={20} x2={W - 70} y1={yOf(last)} y2={yOf(last)} stroke={C.cyan} strokeWidth={1.5} strokeDasharray="5 5" opacity={0.8} />
			<rect x={W - 68} y={yOf(last) - 14} width={62} height={28} rx={4} fill={C.cyan} />
			<text x={W - 37} y={yOf(last) + 6} textAnchor="middle" fill={C.night} fontFamily={FONTS.body} fontWeight={800} fontSize={14}>
				{tag}
			</text>
			{[0, 1, 2, 3].map((i) => (
				<text key={`p${i}`} x={W - 37} y={H - 18 - i * 62} textAnchor="middle" fill={C.steel} fontFamily={FONTS.body} fontWeight={600} fontSize={11} opacity={0.6}>
					{(40 + i * 15).toFixed(2)}
				</text>
			))}
		</svg>
	);
};

export const LineworkScene: React.FC<LineworkSceneProps> = ({time, chapter, chartTag, expression, pose, mouthOpen, lookX}) => {
	return (
		<AbsoluteFill style={{background: C.night, fontFamily: FONTS.body, overflow: 'hidden'}}>
			{/* ---------- layer 1: room wall + window with city ---------- */}
			<svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
				<defs>
					<linearGradient id="lw-sky" x1={0} y1={0} x2={0} y2={1}>
						<stop offset={0} stopColor="#07080B" />
						<stop offset={0.7} stopColor="#111722" />
						<stop offset={1} stopColor="#16222B" />
					</linearGradient>
					<radialGradient id="lw-wallglow" cx={0.78} cy={0.45} r={0.5}>
						<stop offset={0} stopColor={C.cyan} stopOpacity={0.16} />
						<stop offset={1} stopColor={C.cyan} stopOpacity={0} />
					</radialGradient>
					<clipPath id="lw-win">
						<rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} />
					</clipPath>
				</defs>
				<rect width={1920} height={1080} fill="#0D0F13" />
				<g clipPath="url(#lw-win)">
					<rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} fill="url(#lw-sky)" />
					{/* stars */}
					{Array.from({length: 40}).map((_, i) => (
						<circle key={i} cx={WIN.x + rnd(i * 5.1) * WIN.w} cy={WIN.y + rnd(i * 2.3) * 300} r={rnd(i) > 0.8 ? 2 : 1.2} fill={C.silver} opacity={0.25 + rnd(i * 7) * 0.4} />
					))}
					{/* moon: line-art crescent */}
					<g transform="translate(1310 170)">
						<circle r={40} fill="none" stroke={C.silver} strokeWidth={3} opacity={0.5} />
						<path d="M 6 -39 A 40 40 0 1 0 6 39 A 32 32 0 1 1 6 -39 Z" fill={C.silver} opacity={0.75} />
					</g>
					{/* far skyline */}
					{FAR.map((b, i) => (
						<g key={`f${i}`}>
							<rect x={b.x} y={HORIZON - b.h} width={b.w} height={b.h} fill="#121821" />
							{Array.from({length: 10}).map((_, k) =>
								rnd(i * 13 + k) > 0.72 ? (
									<rect key={k} x={b.x + 8 + (k % 3) * (b.w / 3.4)} y={HORIZON - b.h + 14 + Math.floor(k / 3) * 26} width={6} height={9} fill={C.steel} opacity={0.35} />
								) : null,
							)}
						</g>
					))}
					{/* radio tower with a circuit node */}
					<g stroke={C.steel} strokeWidth={2.5} opacity={0.6}>
						<line x1={1060} x2={1060} y1={HORIZON - 330} y2={HORIZON - 470} />
						<line x1={1040} x2={1060} y1={HORIZON - 330} y2={HORIZON - 440} />
						<line x1={1080} x2={1060} y1={HORIZON - 330} y2={HORIZON - 440} />
					</g>
					<circle cx={1060} cy={HORIZON - 476} r={6} fill={C.cyan} />
					<circle cx={1060} cy={HORIZON - 476} r={16} fill={C.cyan} opacity={0.18} />
					{/* near skyline: line art */}
					{NEAR.map((b, i) => (
						<g key={`n${i}`}>
							<rect x={b.x} y={HORIZON - b.h} width={b.w} height={b.h + 10} fill="#181E28" stroke={C.steel} strokeOpacity={0.45} strokeWidth={2.5} />
							{Array.from({length: 18}).map((_, k) => {
								const lit = rnd(i * 31 + k * 1.7);
								if (lit < 0.55) return null;
								const col = k % 3;
								const row = Math.floor(k / 3);
								const wy = HORIZON - b.h + 18 + row * 30;
								if (wy > HORIZON - 12) return null;
								return (
									<rect
										key={k}
										x={b.x + 12 + col * ((b.w - 24) / 3)}
										y={wy}
										width={(b.w - 24) / 3 - 10}
										height={12}
										fill={lit > 0.965 ? C.cyan : C.silver}
										opacity={lit > 0.965 ? 0.4 : 0.24}
									/>
								);
							})}
						</g>
					))}
					{/* glass reflections */}
					<path d={`M ${WIN.x + 160} ${WIN.y} L ${WIN.x - 60} ${WIN.y + 420}`} stroke={C.white} strokeOpacity={0.05} strokeWidth={34} />
					<path d={`M ${WIN.x + 1180} ${WIN.y} L ${WIN.x + 900} ${WIN.y + 520}`} stroke={C.white} strokeOpacity={0.04} strokeWidth={60} />
				</g>
				{/* window frame + mullions (line art) */}
				<g fill="none" stroke={C.steel} strokeWidth={4} strokeOpacity={0.75}>
					<rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} />
					<rect x={WIN.x - 16} y={WIN.y - 16} width={WIN.w + 32} height={WIN.h + 32} strokeOpacity={0.4} />
				</g>
				{[WIN.x + WIN.w / 3, WIN.x + (WIN.w * 2) / 3].map((mx) => (
					<rect key={mx} x={mx - 9} y={WIN.y} width={18} height={WIN.h} fill="#0D0F13" stroke={C.steel} strokeOpacity={0.6} strokeWidth={3} />
				))}
				<rect x={WIN.x} y={WIN.y + 300} width={WIN.w} height={14} fill="#0D0F13" stroke={C.steel} strokeOpacity={0.5} strokeWidth={3} />
				<rect width={1920} height={1080} fill="url(#lw-wallglow)" />
				{/* office chair back, behind the character */}
				<path
					d="M 550 860 L 550 600 C 550 520 620 470 780 470 C 940 470 1010 520 1010 600 L 1010 860 Z"
					fill="#12151B"
					stroke={C.steel}
					strokeOpacity={0.7}
					strokeWidth={5}
				/>
				<path d="M 600 860 L 600 610 C 600 548 660 515 780 515 C 900 515 960 548 960 610 L 960 860" fill="none" stroke={C.steel} strokeOpacity={0.3} strokeWidth={4} />
			</svg>

			{/* ---------- layer 2: the character ---------- */}
			<LineworkCharacter
				expression={expression}
				pose={pose}
				mouthOpen={mouthOpen}
				lookX={lookX}
				pointSide="right"
				x={CHAR.x}
				y={CHAR.y}
				scale={CHAR.scale}
				rim={0.9}
				rimSide="right"
			/>

			{/* ---------- layer 3: monitor (angled toward the character) ---------- */}
			<svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
				<g stroke={C.steel} strokeWidth={5} strokeLinejoin="round">
					<path d="M 1640 680 L 1650 826 L 1694 826 L 1702 680 Z" fill="#0F1217" />
				</g>
			</svg>
			<div
				style={{
					position: 'absolute',
					left: 1370,
					top: 296,
					width: 560,
					height: 380,
					transformOrigin: '100% 50%',
					transform: 'perspective(1500px) rotateY(-24deg)',
					background: '#0B0D11',
					border: `5px solid ${C.silver}`,
					borderRadius: 14,
					padding: 16,
					boxSizing: 'border-box',
					boxShadow: `0 0 140px 30px rgba(45,226,230,0.22), inset 0 0 0 2px #0B0D11`,
				}}
			>
				<div style={{width: '100%', height: '100%', borderRadius: 4, overflow: 'hidden', boxShadow: `0 0 0 2px ${C.steel}`}}>
					<Chart tag={chartTag} />
				</div>
			</div>

			{/* ---------- layer 4: desk + props (foreground) ---------- */}
			<svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
				<defs>
					<linearGradient id="lw-desk" x1={0} y1={0} x2={0} y2={1}>
						<stop offset={0} stopColor="#161A21" />
						<stop offset={1} stopColor="#0B0C0F" />
					</linearGradient>
					<radialGradient id="lw-deskglow" cx={0.8} cy={0} r={0.6}>
						<stop offset={0} stopColor={C.cyan} stopOpacity={0.22} />
						<stop offset={1} stopColor={C.cyan} stopOpacity={0} />
					</radialGradient>
				</defs>
				{/* desk surface, seen slightly from above */}
				<path d="M -10 800 L 1930 800 L 1930 1090 L -10 1090 Z" fill="url(#lw-desk)" />
				<path d="M -10 800 L 1930 800 L 1930 1090 L -10 1090 Z" fill="url(#lw-deskglow)" />
				<line x1={-10} x2={1930} y1={800} y2={800} stroke={C.silver} strokeWidth={5} />
				<g stroke={C.steel} strokeOpacity={0.12} strokeWidth={3}>
					<line x1={-10} x2={1930} y1={872} y2={872} />
					<line x1={-10} x2={1930} y1={985} y2={985} />
				</g>
				{/* monitor base + glow pool on the desk */}
				<ellipse cx={1640} cy={880} rx={330} ry={60} fill={C.cyan} opacity={0.07} />
				<path d="M 1580 822 L 1770 822 L 1790 846 L 1560 846 Z" fill="#0F1217" stroke={C.steel} strokeWidth={5} strokeLinejoin="round" />
				{/* plant in a pot (left) */}
				<g stroke={C.silver} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="#12151B">
					<path d="M 128 800 C 96 744 80 700 70 650 C 108 680 132 730 140 790" />
					<path d="M 156 800 C 160 730 176 670 206 622 C 216 690 196 750 170 800" />
					<path d="M 142 800 C 128 740 128 690 140 636 C 162 690 164 750 156 800" />
					<path d="M 100 790 L 214 790 L 202 880 L 112 880 Z" fill="#0F1217" />
					<line x1={100} x2={214} y1={808} y2={808} strokeOpacity={0.6} />
				</g>
				{/* notepad + pen */}
				<g stroke={C.silver} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round">
					<path d="M 250 930 L 470 922 L 496 1060 L 246 1074 Z" fill="#12151B" />
					<g fill="none" strokeOpacity={0.45} strokeWidth={3}>
						<path d="M 276 962 L 452 955" />
						<path d="M 278 992 L 420 986" />
						<path d="M 280 1022 L 460 1014" />
					</g>
					<path d="M 300 958 L 336 954 L 330 970 Z M 360 986 C 372 978 384 994 396 984" fill="none" stroke={C.cyan} strokeOpacity={0.9} strokeWidth={3} />
					<path d="M 506 940 L 540 1062" strokeWidth={8} stroke={C.steel} />
				</g>
				{/* keyboard */}
				<g stroke={C.silver} strokeWidth={4} strokeLinejoin="round" fill="#0F1217">
					<path d="M 610 850 L 990 850 L 1022 922 L 578 922 Z" />
					<g fill="none" strokeWidth={2.5} strokeOpacity={0.55}>
						<path d="M 600 868 L 1000 868" />
						<path d="M 592 886 L 1008 886" />
						<path d="M 585 904 L 1015 904" />
						{Array.from({length: 15}).map((_, i) => (
							<path key={i} d={`M ${635 + i * 23.5} 850 L ${606 + i * 27.5} 922`} />
						))}
					</g>
				</g>
				{/* mouse */}
				<path d="M 1088 872 C 1088 856 1126 856 1126 872 L 1128 902 C 1128 920 1086 920 1086 902 Z" fill="#0F1217" stroke={C.silver} strokeWidth={4} />
				<path d="M 1107 858 L 1107 876" stroke={C.silver} strokeWidth={3} />
				{/* mug with steam */}
				<g stroke={C.silver} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
					<path d="M 332 770 L 332 846 C 332 860 346 866 372 866 C 398 866 412 860 412 846 L 412 770 Z" fill="#12151B" />
					<ellipse cx={372} cy={770} rx={40} ry={10} fill="#0B0C0F" />
					<path d="M 412 788 C 442 788 442 830 412 830" fill="none" />
					<g fill="none" strokeOpacity={0.5}>
						<path d="M 358 748 C 346 730 370 716 358 694" />
						<path d="M 384 752 C 372 730 398 718 386 688" />
					</g>
				</g>
				{/* phone face up, glowing */}
				<g>
					<ellipse cx={1290} cy={936} rx={120} ry={34} fill={C.cyan} opacity={0.08} />
					<path d="M 1222 912 L 1346 906 L 1362 960 L 1214 968 Z" fill="#0B1A1E" stroke={C.silver} strokeWidth={4} strokeLinejoin="round" />
					<path d="M 1236 920 L 1334 915 L 1346 952 L 1230 958 Z" fill={C.cyan} opacity={0.32} />
					<path d="M 1250 930 L 1300 928" stroke={C.white} strokeWidth={4} strokeLinecap="round" opacity={0.7} />
				</g>
			</svg>

			{/* ---------- layer 5: light + vignette ---------- */}
			<AbsoluteFill
				style={{
					background: 'radial-gradient(ellipse 60% 70% at 78% 52%, rgba(45,226,230,0.13) 0%, rgba(45,226,230,0) 70%)',
					mixBlendMode: 'screen',
				}}
			/>
			<AbsoluteFill style={{background: 'radial-gradient(ellipse 85% 85% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)'}} />

			{/* ---------- layer 6: chapter card ---------- */}
			<AbsoluteFill style={{background: 'radial-gradient(ellipse 34% 30% at 16% 16%, rgba(11,12,15,0.85) 0%, rgba(11,12,15,0) 100%)'}} />
			<div style={{position: 'absolute', left: 84, top: 70}}>
				<div style={{display: 'flex', alignItems: 'center', gap: 14}}>
					<svg width={64} height={20} viewBox="0 0 64 20">
						<line x1={0} y1={10} x2={50} y2={10} stroke={C.cyan} strokeWidth={4} strokeLinecap="round" />
						<circle cx={56} cy={10} r={6} fill={C.cyan} />
					</svg>
					<div style={{fontFamily: FONTS.heading, fontWeight: 900, fontSize: 40, letterSpacing: 10, color: C.cyan}}>{chapter}</div>
				</div>
				<div style={{fontFamily: FONTS.display, fontSize: 150, lineHeight: 1, color: C.white, marginTop: 8, letterSpacing: 2}}>{time}</div>
			</div>
		</AbsoluteFill>
	);
};
