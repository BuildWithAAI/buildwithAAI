import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {FLATBOLD as C, FlatboldCharacter} from './Character';

// Scene palette: brand base + amber accent, plus a few flat night tones (no gradients).
const S = {
	sky: '#0B0C0F',
	skyBand: '#0F1217',
	farCity: '#151920',
	nearCity: '#1D222B',
	nearCityShade: '#181C24',
	frame: '#08090B',
	wall: '#12151B',
	wallLit: '#191D25',
	deskTop: '#2C323D',
	deskTopLit: '#424A59',
	deskFront: '#1A1E26',
	deskFrontShade: '#13161C',
	bezel: '#222730',
	bezelShade: '#181B22',
	screen: '#121720',
	grid: '#1E2530',
};

const DESK_Y = 900;

// Synthetic demo data: a slow bleed, then a spike on the last candles.
const CLOSES = [63, 54, 59, 50, 55, 46, 51, 42, 47, 38, 43, 34, 39, 30, 51, 92];
const VMIN = 22;
const VMAX = 108;

const Chart: React.FC<{x: number; y: number; w: number; h: number}> = ({x, y, w, h}) => {
	const n = CLOSES.length;
	const step = w / n;
	const vy = (v: number) => y + h - ((v - VMIN) / (VMAX - VMIN)) * h;
	const last = CLOSES[n - 1];
	const lx = x + step * (n - 0.5);
	const ly = vy(last);
	return (
		<g>
			{[0.25, 0.5, 0.75].map((t) => (
				<rect key={t} x={x} y={y + h * t} width={w} height={2} fill={S.grid} />
			))}
			{/* flat burst at the spike */}
			{[-160, -125, -90, -55, -20].map((deg) => {
				const r1 = 28;
				const r2 = 48;
				const cx0 = lx;
				const cy0 = ly - 24;
				const t = (deg * Math.PI) / 180;
				return (
					<path
						key={deg}
						d={`M ${cx0 + Math.cos(t) * r1} ${cy0 + Math.sin(t) * r1} L ${cx0 + Math.cos(t) * r2} ${cy0 + Math.sin(t) * r2}`}
						stroke={C.amber}
						strokeWidth={6}
						strokeLinecap="round"
					/>
				);
			})}
			{CLOSES.map((c, i) => {
				const o = i === 0 ? 66 : CLOSES[i - 1];
				const up = c >= o;
				const hi = Math.max(o, c) + (i % 3 === 0 ? 3 : 1.8);
				const lo = Math.min(o, c) - (i % 2 === 0 ? 2.4 : 1.6);
				const cx = x + step * (i + 0.5);
				const col = up ? C.amber : C.silverDark;
				const bw = step * 0.5;
				const top = vy(Math.max(o, c));
				const bh = Math.max(5, vy(Math.min(o, c)) - top);
				return (
					<g key={i}>
						<rect x={cx - 2.5} y={vy(hi)} width={5} height={vy(lo) - vy(hi)} fill={col} />
						<rect x={cx - bw / 2} y={top} width={bw} height={bh} rx={2} fill={col} />
					</g>
				);
			})}
			{/* last-price dashed line */}
			{Array.from({length: 20}).map((_, i) => (
				<rect key={i} x={x + i * (w / 20)} y={ly - 1.5} width={w / 40} height={3} fill={C.amber} opacity={0.6} />
			))}
			<path d={`M ${lx - 17} ${ly - 18} L ${lx} ${ly - 40} L ${lx + 17} ${ly - 18} Z`} fill={C.amber} />
		</g>
	);
};

const City: React.FC = () => {
	const far = [
		[0, 360, 120],
		[110, 300, 90],
		[190, 410, 150],
		[330, 260, 80],
		[400, 340, 140],
		[530, 290, 100],
		[620, 380, 160],
		[770, 250, 90],
		[850, 330, 120],
		[1140, 290, 110],
		[1240, 220, 90],
		[1320, 330, 130],
		[1440, 260, 100],
		[1530, 350, 140],
		[1660, 240, 110],
		[1760, 330, 120],
		[1860, 280, 100],
	];
	const near = [
		[-20, 480, 210],
		[230, 440, 170],
		[470, 530, 190],
		[700, 460, 150],
		[900, 510, 230],
		[1180, 430, 180],
		[1400, 520, 200],
		[1640, 450, 170],
		[1820, 500, 160],
	];
	return (
		<g>
			{far.map(([x, top, w], i) => (
				<g key={`f${i}`}>
					<rect x={x} y={top} width={w} height={DESK_Y - top} fill={S.farCity} />
					{Array.from({length: 7}).map((_, r) =>
						Array.from({length: Math.floor(w / 34)}).map((__, c) =>
							(r * 7 + c * 3 + i) % 5 === 0 ? (
								<rect key={`${r}-${c}`} x={x + 12 + c * 34} y={top + 20 + r * 40} width={12} height={16} fill={C.silverDark} opacity={0.3} />
							) : null,
						),
					)}
				</g>
			))}
			{near.map(([x, top, w], i) => (
				<g key={`n${i}`}>
					<rect x={x} y={top} width={w} height={DESK_Y - top} fill={S.nearCity} />
					<rect x={x + w * 0.64} y={top} width={w * 0.36} height={DESK_Y - top} fill={S.nearCityShade} />
					{Array.from({length: 7}).map((_, r) =>
						Array.from({length: Math.floor(w / 40)}).map((__, c) => {
							const k = (r * 5 + c * 7 + i * 3) % 9;
							if (k > 2) return null;
							return (
								<rect
									key={`${r}-${c}`}
									x={x + 16 + c * 40}
									y={top + 26 + r * 46}
									width={18}
									height={24}
									fill={k === 0 ? C.amber : C.silver}
									opacity={k === 0 ? 0.7 : 0.2}
								/>
							);
						}),
					)}
				</g>
			))}
		</g>
	);
};

export const FlatboldScene: React.FC = () => {
	return (
		<AbsoluteFill style={{background: S.sky, fontFamily: FONTS.body}}>
			{/* LAYER 1 — night window, city, moon ------------------------- */}
			<svg width={1920} height={1080} style={{position: 'absolute'}}>
				<defs>
					<clipPath id="fb-scene-moon">
						<circle cx={1010} cy={170} r={66} />
					</clipPath>
				</defs>
				<rect x={0} y={0} width={1920} height={1080} fill={S.sky} />
				<rect x={0} y={0} width={1920} height={300} fill={S.skyBand} />
				<circle cx={1010} cy={170} r={66} fill={C.silver} />
				<g clipPath="url(#fb-scene-moon)">
					<circle cx={1048} cy={150} r={66} fill={C.silverDark} />
				</g>
				<City />
				{/* window frame + sill + wall */}
				<rect x={0} y={0} width={1920} height={30} fill={S.frame} />
				<rect x={560} y={0} width={24} height={780} fill={S.frame} />
				<rect x={1168} y={0} width={24} height={780} fill={S.frame} />
				<rect x={0} y={768} width={1920} height={DESK_Y - 768} fill={S.wall} />
				{/* monitor light spilling on the wall under the window */}
				<path d={`M 40 776 L 760 776 L 860 ${DESK_Y} L 0 ${DESK_Y} Z`} fill={S.wallLit} />
				<rect x={0} y={762} width={1920} height={14} fill={S.frame} />
			</svg>

			{/* LAYER 2 — YOU, standing behind the desk ------------------- */}
			<FlatboldCharacter x={1460} y={1484} scale={1.28} expression="shocked" mouthOpen={0.75} pose="point" pointSide="left" lookX={-0.1} />

			{/* LAYER 3 — desk, monitor, props ----------------------------- */}
			<svg width={1920} height={1080} style={{position: 'absolute'}}>
				<rect x={0} y={DESK_Y} width={1920} height={44} fill={S.deskTop} />
				<path d={`M 60 ${DESK_Y} L 760 ${DESK_Y} L 840 ${DESK_Y + 44} L 0 ${DESK_Y + 44} Z`} fill={S.deskTopLit} />
				<rect x={0} y={DESK_Y + 44} width={1920} height={1080 - DESK_Y - 44} fill={S.deskFront} />
				<rect x={0} y={DESK_Y + 44} width={1920} height={12} fill={S.deskFrontShade} />
				<rect x={1300} y={DESK_Y + 56} width={8} height={200} fill={S.deskFrontShade} />
				<rect x={1450} y={DESK_Y + 96} width={150} height={12} rx={6} fill={S.deskTop} />

				{/* monitor */}
				<rect x={370} y={850} width={60} height={56} fill={S.bezelShade} />
				<rect x={290} y={DESK_Y - 8} width={220} height={14} rx={7} fill={S.bezel} />
				<rect x={80} y={398} width={640} height={462} rx={20} fill={S.bezel} />
				<rect x={672} y={398} width={48} height={462} rx={20} fill={S.bezelShade} />
				<rect x={98} y={416} width={604} height={426} rx={8} fill={S.screen} />
				<circle cx={124} cy={442} r={7} fill={C.silverDark} opacity={0.6} />
				<circle cx={146} cy={442} r={7} fill={C.silverDark} opacity={0.6} />
				<circle cx={168} cy={442} r={7} fill={C.silverDark} opacity={0.6} />
				<rect x={200} y={436} width={120} height={12} rx={6} fill={S.grid} />
				<rect x={562} y={436} width={120} height={12} rx={6} fill={S.grid} />
				<Chart x={120} y={500} w={560} h={310} />

				{/* keyboard + mouse */}
				<path d={`M 190 ${DESK_Y + 8} L 620 ${DESK_Y + 8} L 644 ${DESK_Y + 36} L 166 ${DESK_Y + 36} Z`} fill={S.bezel} />
				<path d={`M 204 ${DESK_Y + 14} L 610 ${DESK_Y + 14} L 618 ${DESK_Y + 24} L 196 ${DESK_Y + 24} Z`} fill={S.deskTopLit} />
				<ellipse cx={730} cy={DESK_Y + 24} rx={30} ry={13} fill={S.bezel} />

				{/* mug */}
				<path d="M 1196 836 Q 1236 838 1232 864 Q 1228 888 1196 886" stroke={C.silverDark} strokeWidth={14} fill="none" />
				<rect x={1112} y={814} width={86} height={96} rx={12} fill={C.silver} />
				<rect x={1166} y={814} width={32} height={96} rx={10} fill={C.silverDark} />
				<ellipse cx={1155} cy={816} rx={43} ry={9} fill={C.silverDark} />
				<path d="M 1140 790 Q 1128 770 1142 750 Q 1154 732 1142 712" stroke={C.silver} strokeWidth={7} fill="none" strokeLinecap="round" opacity={0.3} />
				<path d="M 1168 794 Q 1158 776 1170 758" stroke={C.silver} strokeWidth={7} fill="none" strokeLinecap="round" opacity={0.22} />
			</svg>

			{/* LAYER 4 — chapter card ------------------------------------- */}
			<div style={{position: 'absolute', left: 80, top: 64, display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
				<div
					style={{
						fontFamily: FONTS.heading,
						fontWeight: 900,
						fontSize: 40,
						letterSpacing: 6,
						color: C.ink,
						background: C.amber,
						padding: '8px 20px 6px 24px',
						borderRadius: 8,
					}}
				>
					DAY 1
				</div>
				<div style={{fontFamily: FONTS.display, fontSize: 176, lineHeight: 1, color: C.white, marginTop: 14, letterSpacing: 2}}>3:07 AM</div>
			</div>
		</AbsoluteFill>
	);
};
