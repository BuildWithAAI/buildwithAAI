/**
 * <JellyfishMark/>: the Zoora jellyfish as an SVG <g> (embed it in a parent <svg> whose units are pixels).
 * Flat line art: one stroke colour, round caps and joins, optional single teal accent dot (ART_GUIDE P1, SL6, CV5).
 * Animation: `draw` reveals each part along its length (0..1); everything is a pure function of the props.
 */
import React from 'react';
import {ACCENT_DOT_R, ACCENT_NODE, BELL, BOUNDS, CENTRE, INNER, NODES, polyline, STROKE, TRACES} from './jellyfishGeometry';

export type JellyfishDraw = {bell: number; inner: number; traces: number; nodes: number; accent: number};
export const FULL_DRAW: JellyfishDraw = {bell: 1, inner: 1, traces: 1, nodes: 1, accent: 1};

export type JellyfishMarkProps = {
	/** Centre of the mark's bounds, px. */
	cx: number;
	cy: number;
	/** Height of the mark's bounds, px (stroke included). */
	height: number;
	color: string;
	/** Fill colour of the centre node's dot; null = no accent. */
	accent?: string | null;
	draw?: Partial<JellyfishDraw>;
	/** Bell pulse: 0 = rest; small positive values (<= 0.04) widen the bell about its rim (a swim pulse). */
	pulse?: number;
	/** Extra px added to the line weight (e.g. +1 px on very small watermarks). Default 0. */
	strokeBoostPx?: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A stroke revealed along its length. Hidden entirely at 0 so a round cap never shows as a stray dot. */
const Reveal: React.FC<{d: string; p: number; color: string; width: number}> = ({d, p, color, width}) => {
	const t = clamp01(p);
	if (t <= 0) return null;
	return (
		<path
			d={d}
			fill="none"
			stroke={color}
			strokeWidth={width}
			strokeLinecap="round"
			strokeLinejoin="round"
			pathLength={1}
			strokeDasharray={t >= 1 ? undefined : '1 1'}
			strokeDashoffset={t >= 1 ? undefined : 1 - t}
		/>
	);
};

export const markScaleFor = (heightPx: number) => heightPx / BOUNDS.h;

export const JellyfishMark: React.FC<JellyfishMarkProps> = ({cx, cy, height, color, accent = null, draw, pulse = 0, strokeBoostPx = 0}) => {
	const d = {...FULL_DRAW, ...draw};
	const k = markScaleFor(height);
	const w = STROKE + strokeBoostPx / k;
	const sx = 1 + pulse;
	const sy = 1 - pulse * 0.6;
	return (
		<g data-mark="zoora-jellyfish" transform={`translate(${cx - CENTRE[0] * k} ${cy - CENTRE[1] * k}) scale(${k})`}>
			<g transform={`scale(${sx} ${sy})`}>
				<Reveal d={BELL} p={d.bell} color={color} width={w} />
				<Reveal d={INNER} p={d.inner} color={color} width={w} />
			</g>
			{TRACES.map((t, i) => (
				<Reveal key={`t${i}`} d={polyline(t)} p={d.traces} color={color} width={w} />
			))}
			{NODES.map((n, i) => {
				const s = clamp01(d.nodes);
				if (s <= 0) return null;
				return (
					<g key={`n${i}`} transform={`translate(${n.x} ${n.y}) scale(${s}) translate(${-n.x} ${-n.y})`}>
						{accent && i === ACCENT_NODE && d.accent > 0 ? (
							<circle cx={n.x} cy={n.y} r={ACCENT_DOT_R * clamp01(d.accent)} fill={accent} />
						) : null}
						<circle cx={n.x} cy={n.y} r={n.r} fill="none" stroke={color} strokeWidth={w} />
					</g>
				);
			})}
		</g>
	);
};
