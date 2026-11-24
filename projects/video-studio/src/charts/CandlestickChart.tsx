// CandlestickChart.tsx: the chart component (CHART_SPEC 7). All geometry and text come from layoutChart()
// (chartLayout.ts), which validates nothing itself; this component validates the data first (step 1).
import React, {useMemo} from 'react';
import {useCurrentFrame} from 'remotion';
import {FONTS} from '../brand/fonts';
import {assertChartData, type ChartData} from './chartData.ts';
import {HOUSE_OUTLINE, layoutChart, SUBSCRIPTS, SUB_SCALE, TEXT, type Box, type RevealSpec, type Text} from './chartLayout.ts';

export type {ChartData} from './chartData.ts';
export type {Box, RevealSpec} from './chartLayout.ts';

export type CandlestickChartProps = {
	data: ChartData; // validated again on mount with assertValid (cheap); calculateMetadata validates first
	box: Box; // integer px, screen space (L1)
	surface?: 'dark' | 'light'; // default 'dark'
	scale?: 'auto' | 'linear' | 'log'; // default 'auto' (L6)
	reveal?: RevealSpec | null; // null = all shown
	showVolume?: boolean; // default true
	lastPrice?: boolean; // default true (L8)
	callout?: {candlesBack: number; label: string} | null; // e.g. {candlesBack: 12, label: 'vs 1 h ago'} on 5m data
	hollowUp?: boolean; // close-ups only (L10)
	draft?: boolean; // prints `seed N` after the fictional-token label (CHART_SPEC 8: draft renders only)
};

/** A fmtUsd string; subscript zero counts ($0.0₅32) are drawn as smaller Inter digits set below the baseline. */
const UsdText: React.FC<{t: Text; size: number; weight: number; fill: string}> = ({t, size, weight, fill}) => {
	const parts: Array<{s: string; sub: boolean}> = [];
	for (const ch of t.text) {
		const sub = SUBSCRIPTS.includes(ch);
		const s = sub ? String(SUBSCRIPTS.indexOf(ch)) : ch;
		const lastPart = parts[parts.length - 1];
		if (lastPart && lastPart.sub === sub) lastPart.s += s;
		else parts.push({s, sub});
	}
	const drop = Math.round(size * 0.22);
	return (
		<text x={t.x} y={t.y} fontFamily={FONTS.body} fontWeight={weight} fontSize={size} fill={fill}>
			{parts.map((p, k) =>
				p.sub ? (
					<tspan key={k} fontSize={Math.round(size * SUB_SCALE)} dy={drop}>
						{p.s}
					</tspan>
				) : (
					<tspan key={k} dy={k > 0 && parts[k - 1].sub ? -drop : 0}>
						{p.s}
					</tspan>
				),
			)}
		</text>
	);
};

export const CandlestickChart: React.FC<CandlestickChartProps> = (props) => {
	const frame = useCurrentFrame();
	// 1. validate (throws, so a bad series never reaches a frame)
	const data = useMemo(() => assertChartData(props.data), [props.data]);
	// 2-5, 7. scale, slots, reveal, rects and every text, computed from the data
	const m = layoutChart({...props, data}, frame);
	const {T} = m;
	const font = FONTS.body;

	// 6. draw in the G5 order: grid -> volume -> wick -> body -> pill -> text. Marks are integer rects, crispEdges,
	// no strokes, filters or opacity. The panel outline is the house line, drawn last over the panel edge (SL4).
	return (
		<svg
			width={m.box.w}
			height={m.box.h}
			viewBox={`${m.box.x} ${m.box.y} ${m.box.w} ${m.box.h}`}
			style={{position: 'absolute', left: m.box.x, top: m.box.y, overflow: 'visible'}}
		>
			<rect x={m.panel.x} y={m.panel.y} width={m.panel.w} height={m.panel.h} rx={m.panel.r} fill={T.surface} />
			<g shapeRendering="crispEdges">
				<g fill={T.grid}>
					{m.grid.map((r, k) => (
						<rect key={k} x={r.x} y={r.y} width={r.w} height={r.h} />
					))}
				</g>
				<g fill={T.axisText}>
					{m.lastLine.map((r, k) => (
						<rect key={k} x={r.x} y={r.y} width={r.w} height={r.h} />
					))}
				</g>
				{m.volume.map((r, k) => (
					<rect key={k} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
				))}
				{m.volBaseline ? <rect x={m.volBaseline.x} y={m.volBaseline.y} width={m.volBaseline.w} height={m.volBaseline.h} fill={T.axisText} /> : null}
				{m.candles.map((c) => (
					<g key={c.i} fill={c.fill}>
						<rect x={c.wick.x} y={c.wick.y} width={c.wick.w} height={c.wick.h} />
						<rect x={c.body.x} y={c.body.y} width={c.body.w} height={c.body.h} />
						{c.inner ? <rect x={c.inner.x} y={c.inner.y} width={c.inner.w} height={c.inner.h} fill={T.surface} /> : null}
					</g>
				))}
			</g>
			{m.pill ? <rect x={m.pill.rect.x} y={m.pill.rect.y} width={m.pill.rect.w} height={m.pill.rect.h} rx={m.pill.r} fill={m.pill.fill} /> : null}
			{m.header.map((t, k) => (
				<text key={k} x={t.x} y={t.y} fontFamily={font} fontWeight={TEXT.header.weight} fontSize={TEXT.header.size} fill={T.ink}>
					{t.text}
				</text>
			))}
			{m.tickLabels.map((t, k) => (
				<UsdText key={k} t={t} size={TEXT.axis.size} weight={TEXT.axis.weight} fill={T.axisText} />
			))}
			{m.pill ? <UsdText t={m.pill.label} size={TEXT.pill.size} weight={TEXT.pill.weight} fill={T.pillText} /> : null}
			{m.callout ? (
				<>
					<path d={m.callout.glyph} fill={m.callout.fill} />
					<text x={m.callout.label.x} y={m.callout.label.y} fontFamily={font} fontWeight={TEXT.callout.weight} fontSize={TEXT.callout.size} fill={T.ink}>
						{m.callout.label.text}
					</text>
				</>
			) : null}
			<text x={m.footerLabel.x} y={m.footerLabel.y} textAnchor="end" fontFamily={font} fontWeight={TEXT.footer.weight} fontSize={TEXT.footer.size} fill={T.axisText}>
				{m.footerLabel.text}
			</text>
			<rect x={m.outline.x} y={m.outline.y} width={m.outline.w} height={m.outline.h} rx={m.outline.r} fill="none" stroke={HOUSE_OUTLINE} strokeWidth={m.outline.width} />
		</svg>
	);
};
