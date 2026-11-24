import React from 'react';
import {AbsoluteFill, random} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {INKNOIR as C, InknoirCharacter, type InknoirExpression, type InknoirPose} from './Character';

export type InknoirSceneProps = {
	timeLabel: string;
	dayLabel: string;
	ticker: string;
	alertLabel: string;
	expression: InknoirExpression;
	mouthOpen: number;
	blink: number;
	pose: InknoirPose;
	lookX: number;
};

export const inknoirSceneDefaults: InknoirSceneProps = {
	timeLabel: '3:07 AM',
	dayLabel: 'DAY 1',
	ticker: 'TOKEN / USD  ·  1M',
	alertLabel: 'ALERT',
	expression: 'shocked',
	mouthOpen: 0.25,
	blink: 0,
	pose: 'idle',
	lookX: -0.55,
};

const W = 1920;
const H = 1080;
const DESK_Y = 866; // back edge of the desk top
const DESK_FRONT = 948;
const WIN = {x: 70, y: 60, w: 1330, h: 806};
const CHAR = {x: 1110, headY: 432, scale: 1.7};

/* ---------- city ---------- */

type Building = {x: number; w: number; h: number; windows: Array<{x: number; y: number; o: number}>};

const makeLayer = (seed: string, x0: number, x1: number, minH: number, maxH: number, minW: number, maxW: number, density: number): Building[] => {
	const out: Building[] = [];
	let x = x0;
	let i = 0;
	while (x < x1) {
		const w = minW + random(`${seed}-w-${i}`) * (maxW - minW);
		const h = minH + random(`${seed}-h-${i}`) * (maxH - minH);
		const windows: Building['windows'] = [];
		const cols = Math.floor((w - 10) / 12);
		const rows = Math.floor((h - 14) / 16);
		for (let c = 0; c < cols; c++) {
			for (let r = 0; r < rows; r++) {
				const k = random(`${seed}-win-${i}-${c}-${r}`);
				if (k < density) windows.push({x: 8 + c * 12, y: 12 + r * 16, o: 0.25 + random(`${seed}-o-${i}-${c}-${r}`) * 0.6});
			}
		}
		out.push({x, w, h, windows});
		x += w + random(`${seed}-g-${i}`) * 10;
		i++;
	}
	return out;
};

const FAR = makeLayer('far', 60, 1420, 120, 300, 40, 90, 0.08);
const MID = makeLayer('mid', 40, 1420, 160, 420, 60, 120, 0.12);
const NEAR = makeLayer('near', 20, 1420, 200, 560, 90, 170, 0.1);

const City: React.FC = () => {
	const ground = 866;
	const layer = (bs: Building[], fill: string, winFill: string, winScale: number) =>
		bs.map((b) => (
			<g key={`${fill}-${b.x}`} transform={`translate(${b.x.toFixed(1)},${(ground - b.h).toFixed(1)})`}>
				<rect x={0} y={0} width={b.w} height={b.h + 40} fill={fill} />
				{b.windows.map((w) => (
					<rect key={`${w.x}-${w.y}`} x={w.x} y={w.y} width={5 * winScale} height={7 * winScale} fill={winFill} opacity={w.o} />
				))}
			</g>
		));
	return (
		<g>
			{layer(FAR, '#151922', '#6E7683', 0.8)}
			{layer(MID, '#1A1F28', '#9AA1AC', 0.9)}
			{layer(NEAR, '#20252F', C.silver, 1)}
			{/* one tall tower with a red aircraft beacon */}
			<rect x={318} y={250} width={70} height={600} fill="#252B35" />
			<rect x={348} y={200} width={8} height={50} fill="#252B35" />
			<circle cx={352} cy={198} r={4} fill={C.accent} />
			<circle cx={352} cy={198} r={12} fill={C.accent} opacity={0.18} />
		</g>
	);
};

/* ---------- chart on the monitor ---------- */

const CANDLES = (() => {
	const out: Array<{o: number; c: number; h: number; l: number}> = [];
	let price = 60;
	for (let i = 0; i < 24; i++) {
		const drift = -0.4 + (random(`cd-${i}`) - 0.5) * 9;
		const o = price;
		const c = price + drift;
		const h = Math.max(o, c) + random(`ch-${i}`) * 4;
		const l = Math.min(o, c) - random(`cl-${i}`) * 4;
		out.push({o, c, h, l});
		price = c;
	}
	return out;
})();

const Chart: React.FC<{w: number; h: number; ticker: string; alert: string}> = ({w, h, ticker, alert}) => {
	const pad = 26;
	const top = 70;
	const chartH = h - top - 30;
	const all = CANDLES.flatMap((c) => [c.h, c.l]);
	const lo = Math.min(...all) - 6;
	const hi = Math.max(...all) + 6;
	// the spike candle goes far above the old range
	const spikeTop = hi + (hi - lo) * 1.7;
	const yOf = (vv: number) => top + chartH - ((vv - lo) / (spikeTop - lo)) * chartH;
	const n = CANDLES.length + 1;
	const step = (w - pad * 2 - 70) / n;
	const last = CANDLES[CANDLES.length - 1];
	const sx = pad + (n - 1) * step + step / 2;
	return (
		<g>
			<rect x={0} y={0} width={w} height={h} fill="#0E1218" />
			{[0, 1, 2, 3, 4].map((i) => (
				<line key={i} x1={pad} x2={w - pad} y1={top + (chartH / 4) * i} y2={top + (chartH / 4) * i} stroke="#222833" strokeWidth={1.5} />
			))}
			{CANDLES.map((c, i) => {
				const x = pad + i * step + step / 2;
				const up = c.c >= c.o;
				const y1 = yOf(Math.max(c.o, c.c));
				const y2 = yOf(Math.min(c.o, c.c));
				return (
					<g key={i}>
						<line x1={x} x2={x} y1={yOf(c.h)} y2={yOf(c.l)} stroke={C.silverDark} strokeWidth={2} />
						<rect
							x={x - step * 0.32}
							y={y1}
							width={step * 0.64}
							height={Math.max(2, y2 - y1)}
							fill={up ? '#0E1218' : C.steel}
							stroke={up ? C.silver : C.steel}
							strokeWidth={2}
						/>
					</g>
				);
			})}
			{/* the spike */}
			<line x1={sx} x2={sx} y1={yOf(spikeTop) - 8} y2={yOf(last.c) + 6} stroke={C.accent} strokeWidth={3} />
			<rect x={sx - step * 0.36} y={yOf(spikeTop - 6)} width={step * 0.72} height={yOf(last.c) - yOf(spikeTop - 6)} fill={C.accent} style={{filter: `drop-shadow(0 0 10px ${C.accent})`}} />
			<line x1={pad} x2={w - 70} y1={yOf(spikeTop - 6)} y2={yOf(spikeTop - 6)} stroke={C.accent} strokeWidth={1.5} strokeDasharray="6 6" opacity={0.8} />
			<g transform={`translate(${w - 92},${yOf(spikeTop - 6) - 15})`}>
				<rect x={0} y={0} width={80} height={30} rx={4} fill={C.accent} />
				<text x={40} y={21} textAnchor="middle" fontFamily={FONTS.body} fontWeight={800} fontSize={16} fill={C.ink} letterSpacing={1}>
					{alert}
				</text>
			</g>
			{/* header */}
			<text x={pad} y={40} fontFamily={FONTS.body} fontWeight={700} fontSize={20} fill={C.silver} letterSpacing={1}>
				{ticker}
			</text>
			<circle cx={w - 110} cy={33} r={5} fill={C.silver} />
			<text x={w - 98} y={40} fontFamily={FONTS.body} fontWeight={700} fontSize={18} fill={C.silverDark} letterSpacing={2}>
				LIVE
			</text>
			<line x1={pad} x2={w - pad} y1={56} y2={56} stroke="#222833" strokeWidth={1.5} />
		</g>
	);
};

/* ---------- layers ---------- */

const Background: React.FC = () => (
	<svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
		<defs>
			<linearGradient id="in-sky" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stopColor="#090A0D" />
				<stop offset="70%" stopColor="#161B24" />
				<stop offset="100%" stopColor="#262D39" />
			</linearGradient>
			<pattern id="in-wall-dots" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
				<circle cx={3} cy={3} r={1.2} fill={C.ink} />
			</pattern>
			<pattern id="in-mesh" width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
				<line x1={0} y1={0} x2={0} y2={7} stroke={C.ink} strokeWidth={1.6} />
			</pattern>
			<radialGradient id="in-halo" cx="50%" cy="50%" r="50%">
				<stop offset="0%" stopColor="#3A4250" stopOpacity={0.75} />
				<stop offset="100%" stopColor="#3A4250" stopOpacity={0} />
			</radialGradient>
			<radialGradient id="in-moon" cx="40%" cy="40%" r="60%">
				<stop offset="0%" stopColor={C.white} />
				<stop offset="100%" stopColor={C.silverDark} />
			</radialGradient>
			<clipPath id="in-window">
				<rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} />
			</clipPath>
		</defs>

		{/* wall */}
		<rect x={0} y={0} width={W} height={H} fill="#12151B" />
		<rect x={WIN.x + WIN.w} y={0} width={W - WIN.x - WIN.w} height={H} fill="url(#in-wall-dots)" opacity={0.5} />

		{/* window: sky, moon, city, rain */}
		<g clipPath="url(#in-window)">
			<rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} fill="url(#in-sky)" />
			<circle cx={800} cy={200} r={120} fill={C.silver} opacity={0.05} />
			<circle cx={800} cy={200} r={58} fill="url(#in-moon)" opacity={0.85} />
			<City />
			<g stroke={C.silver} strokeWidth={1.2} opacity={0.12}>
				{Array.from({length: 46}).map((_, i) => {
					const x = WIN.x + random(`rx${i}`) * WIN.w;
					const y = 80 + random(`ry${i}`) * 700;
					return <line key={i} x1={x} y1={y} x2={x - 10} y2={y + 42} />;
				})}
			</g>
			{/* blinds, half raised and tilted */}
			<g>
				{Array.from({length: 13}).map((_, i) => {
					const y = WIN.y + i * 17;
					const drop = (i / 12) * 34;
					const x2 = WIN.x + WIN.w;
					return (
						<g key={i}>
							<path d={`M${WIN.x},${y} L${x2},${y + drop} L${x2},${y + drop + 9} L${WIN.x},${y + 9} Z`} fill="#1C2129" />
							<path d={`M${WIN.x},${y + 9} L${x2},${y + drop + 9}`} stroke="#3A4250" strokeWidth={1.4} />
						</g>
					);
				})}
				<path d={`M${WIN.x},270 L${WIN.x + WIN.w},304 L${WIN.x + WIN.w},314 L${WIN.x},280 Z`} fill="#2A303A" stroke={C.ink} strokeWidth={2} />
				<line x1={480} y1={WIN.y} x2={480} y2={420} stroke="#3A4250" strokeWidth={1.4} />
				<line x1={1000} y1={WIN.y} x2={1000} y2={432} stroke="#3A4250" strokeWidth={1.4} />
			</g>
		</g>
		{/* window frame */}
		<g fill="none" stroke={C.ink}>
			<rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} strokeWidth={22} />
			<line x1={540} y1={WIN.y} x2={540} y2={WIN.y + WIN.h} strokeWidth={16} />
			<line x1={1240} y1={WIN.y} x2={1240} y2={WIN.y + WIN.h} strokeWidth={16} />
		</g>
		<g stroke="#3A4250" strokeWidth={2}>
			<line x1={WIN.x + 12} y1={WIN.y + 12} x2={WIN.x + WIN.w - 12} y2={WIN.y + 12} />
			<line x1={549} y1={320} x2={549} y2={WIN.y + WIN.h} />
			<line x1={1249} y1={320} x2={1249} y2={WIN.y + WIN.h} />
		</g>

		{/* right wall: shelf with books and a plant */}
		<g>
			<rect x={1500} y={600} width={380} height={12} fill="#232933" stroke={C.ink} strokeWidth={2} />
			<line x1={1500} y1={600} x2={1880} y2={600} stroke={C.silverDark} strokeWidth={1.5} opacity={0.5} />
			{[0, 1, 2, 3, 4].map((i) => (
				<rect key={i} x={1530 + i * 22} y={600 - (70 + (i % 3) * 14)} width={18} height={70 + (i % 3) * 14} fill={i % 2 ? '#262C36' : '#2E3540'} stroke={C.ink} strokeWidth={2} />
			))}
			<rect x={1646} y={540} width={60} height={20} transform="rotate(-18 1646 560)" fill="#2E3540" stroke={C.ink} strokeWidth={2} />
			<path d="M1790,600 L1798,560 L1832,560 L1840,600 Z" fill="#2E3540" stroke={C.ink} strokeWidth={2} />
			<g fill="#1A1F27" stroke={C.ink} strokeWidth={2}>
				<path d="M1815,560 C1800,530 1782,518 1766,520 C1782,532 1798,546 1810,562 Z" />
				<path d="M1816,560 C1822,526 1838,506 1856,502 C1846,522 1832,542 1820,562 Z" />
				<path d="M1815,560 C1812,530 1816,502 1824,486 C1826,510 1824,538 1818,562 Z" />
			</g>
		</g>

		{/* separation halo behind the head */}
		<ellipse cx={CHAR.x} cy={CHAR.headY + 20} rx={340} ry={320} fill="url(#in-halo)" />

		{/* office chair back (mesh) */}
		<g transform={`translate(${CHAR.x},0)`}>
			<path d="M-250,1040 L-260,660 C-260,606 -216,580 -150,577 L150,577 C216,580 260,606 260,660 L250,1040 Z" fill="#191D25" stroke={C.ink} strokeWidth={4} />
			<path d="M-228,1030 L-238,666 C-238,624 -206,602 -146,600 L146,600 C206,602 238,624 238,666 L228,1030 Z" fill="url(#in-mesh)" opacity={0.6} />
			<path d="M260,660 L250,1040" stroke={C.silver} strokeWidth={3} opacity={0.55} />
			<path d="M150,577 C216,580 260,606 260,660" fill="none" stroke={C.silver} strokeWidth={3} opacity={0.55} />
		</g>
	</svg>
);

const MON = {x: 150, y: 452, w: 590, h: 340};

const Foreground: React.FC<{ticker: string; alert: string}> = ({ticker, alert}) => (
	<svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
		<defs>
			<linearGradient id="in-desk" x1="0" y1="0" x2="1" y2="0">
				<stop offset="0%" stopColor="#2B323D" />
				<stop offset="40%" stopColor="#222833" />
				<stop offset="100%" stopColor="#161A21" />
			</linearGradient>
			<linearGradient id="in-front" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stopColor="#0E1015" />
				<stop offset="100%" stopColor="#07080A" />
			</linearGradient>
			<radialGradient id="in-glow" cx="50%" cy="50%" r="50%">
				<stop offset="0%" stopColor="#DCE6F5" stopOpacity={0.35} />
				<stop offset="100%" stopColor="#DCE6F5" stopOpacity={0} />
			</radialGradient>
			<radialGradient id="in-vignette" cx="50%" cy="48%" r="75%">
				<stop offset="55%" stopColor={C.ink} stopOpacity={0} />
				<stop offset="100%" stopColor={C.ink} stopOpacity={0.85} />
			</radialGradient>
			<pattern id="in-keys" width={13} height={11} patternUnits="userSpaceOnUse">
				<rect x={1} y={1} width={10} height={8} rx={1.5} fill="#2A303A" />
			</pattern>
			<pattern id="in-desk-dots" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
				<circle cx={3} cy={3} r={1.4} fill={C.ink} />
			</pattern>
			<filter id="in-soft" x="-30%" y="-30%" width="160%" height="160%">
				<feGaussianBlur stdDeviation={36} />
			</filter>
			<clipPath id="in-screen">
				<rect x={0} y={0} width={MON.w} height={MON.h} />
			</clipPath>
		</defs>

		{/* desk */}
		<path d={`M0,${DESK_Y} L${W},${DESK_Y} L${W},${DESK_FRONT} L0,${DESK_FRONT} Z`} fill="url(#in-desk)" />
		<path d={`M960,${DESK_Y} L${W},${DESK_Y} L${W},${DESK_FRONT} L960,${DESK_FRONT} Z`} fill="url(#in-desk-dots)" opacity={0.5} />
		<line x1={0} x2={W} y1={DESK_Y} y2={DESK_Y} stroke={C.ink} strokeWidth={4} />
		<path d={`M0,${DESK_FRONT} L${W},${DESK_FRONT} L${W},${H} L0,${H} Z`} fill="url(#in-front)" />
		<line x1={0} x2={1100} y1={DESK_FRONT} y2={DESK_FRONT} stroke={C.silver} strokeWidth={3} opacity={0.5} />

		{/* monitor light pooled on the desk */}
		<ellipse cx={500} cy={900} rx={540} ry={70} fill="url(#in-glow)" />

		{/* monitor */}
		<g>
			<path d="M370,890 L530,890 L516,872 L384,872 Z" fill="#1C2129" stroke={C.ink} strokeWidth={3} />
			<rect x={430} y={770} width={40} height={106} fill="#1C2129" stroke={C.ink} strokeWidth={3} />
			<g transform={`translate(${MON.x},${MON.y}) skewY(-3)`}>
				<rect x={-16} y={-16} width={MON.w + 32} height={MON.h + 32} rx={10} fill={C.ink} />
				<rect x={-16} y={-16} width={MON.w + 32} height={MON.h + 32} rx={10} fill="none" stroke={C.silver} strokeWidth={2} opacity={0.5} />
				<g clipPath="url(#in-screen)">
					<Chart w={MON.w} h={MON.h} ticker={ticker} alert={alert} />
				</g>
			</g>
		</g>

		{/* keyboard and phone */}
		<path d="M920,888 L1300,888 L1318,928 L902,928 Z" fill="#161A21" stroke={C.ink} strokeWidth={3} />
		<path d="M930,892 L1292,892 L1306,924 L914,924 Z" fill="url(#in-keys)" />
		<path d="M920,888 L1300,888" stroke={C.silver} strokeWidth={2} opacity={0.5} />
		<g transform="rotate(-8 760 905)">
			<rect x={720} y={888} width={92} height={40} rx={8} fill="#1A1E26" stroke={C.ink} strokeWidth={3} />
			<rect x={720} y={888} width={92} height={40} rx={8} fill="none" stroke={C.silverDark} strokeWidth={1.5} opacity={0.6} />
		</g>

		{/* mug */}
		<g>
			<path d="M1440,806 L1520,806 L1514,904 C1512,914 1448,914 1446,904 Z" fill="#2A303A" stroke={C.ink} strokeWidth={3} />
			<path d="M1518,828 C1550,828 1552,876 1514,882" fill="none" stroke={C.ink} strokeWidth={9} />
			<path d="M1518,828 C1550,828 1552,876 1514,882" fill="none" stroke="#2A303A" strokeWidth={4} />
			<ellipse cx={1480} cy={806} rx={40} ry={7} fill="#15181E" stroke={C.ink} strokeWidth={3} />
			<path d="M1452,816 L1450,896" stroke={C.silver} strokeWidth={3} opacity={0.6} />
			<g fill="none" stroke={C.silverDark} strokeWidth={2.2} strokeLinecap="round" opacity={0.6}>
				<path d="M1468,788 C1456,772 1478,760 1466,742" />
				<path d="M1490,784 C1480,770 1500,758 1490,740" />
			</g>
		</g>

		{/* spill of monitor light toward the face (screen blend) */}
		<g style={{mixBlendMode: 'screen'}}>
			<path
				d={`M${MON.x + MON.w + 10},${MON.y - 10} L1080,330 L1100,780 L${MON.x + MON.w + 10},${MON.y + MON.h} Z`}
				fill="#DCE6F5"
				opacity={0.09}
				filter="url(#in-soft)"
			/>
		</g>

		{/* vignette */}
		<rect x={0} y={0} width={W} height={H} fill="url(#in-vignette)" />
	</svg>
);

const TitleCard: React.FC<{time: string; day: string}> = ({time, day}) => (
	<div style={{position: 'absolute', right: 76, top: 92, textAlign: 'right'}}>
		<div style={{display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16}}>
			<div style={{width: 46, height: 4, background: C.accent}} />
			<div style={{fontFamily: FONTS.heading, fontWeight: 900, fontSize: 38, letterSpacing: 12, color: C.silver, marginRight: -12}}>{day}</div>
		</div>
		<div
			style={{
				fontFamily: FONTS.display,
				fontSize: 150,
				lineHeight: 1,
				marginTop: 8,
				color: C.white,
				textShadow: `0 6px 0 ${C.ink}`,
			}}
		>
			{time}
		</div>
	</div>
);

export const InknoirScene: React.FC<InknoirSceneProps> = ({timeLabel, dayLabel, ticker, alertLabel, expression, mouthOpen, blink, pose, lookX}) => {
	return (
		<AbsoluteFill style={{backgroundColor: C.ink, overflow: 'hidden'}}>
			<Background />
			<InknoirCharacter x={CHAR.x} y={CHAR.headY + 812 * CHAR.scale} scale={CHAR.scale} expression={expression} mouthOpen={mouthOpen} blink={blink} pose={pose} lookX={lookX} pointSide="left" lightFrom="left" floorShadow={false} />
			<Foreground ticker={ticker} alert={alertLabel} />
			<TitleCard time={timeLabel} day={dayLabel} />
		</AbsoluteFill>
	);
};
