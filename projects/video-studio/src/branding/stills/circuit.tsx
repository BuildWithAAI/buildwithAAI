/**
 * Circuit-trace decoration for the Zoora brand: polylines with 45-degree bends ending in ring nodes, the same
 * language as the jellyfish's tentacles. Drawn as plain strokes (no SVG pattern element and no texture: ART_GUIDE LS banned list).
 * Coordinates are px on the canvas they are authored for.
 */
import React from 'react';

export type Trace = {pts: ReadonlyArray<readonly [number, number]>; nodeStart?: boolean; nodeEnd?: boolean};

const ringPoint = (cx: number, cy: number, r: number, deg: number): [number, number] => {
	const a = (deg * Math.PI) / 180;
	return [Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))];
};

/** Run from p at 45 degrees until y reaches `toY` (dx sign = dir). */
const diag = (p: readonly [number, number], toY: number, dir: 1 | -1): [number, number] => [p[0] + dir * Math.abs(toY - p[1]), toY];

/**
 * Traces for the 2560x1440 Zoora banner, built around the porthole (centre 1790,800, radius 380 + ring).
 * They stay out of the lockup's box (x 560-1300, y 560-880) so the name always sits on clean black.
 */
export const ZOORA_TRACES: readonly Trace[] = (() => {
	const R = 380 + 5;
	const P = (deg: number) => ringPoint(1790, 800, R, deg);
	const t: Trace[] = [];
	// up and left from the ring, above the lockup
	{
		const a = P(214);
		const b = diag(a, 430, -1);
		t.push({pts: [a, b, [980, 430], diag([980, 430], 330, -1)], nodeEnd: true});
	}
	{
		const a = P(244);
		const b: [number, number] = [a[0], 290];
		t.push({pts: [a, b, diag(b, 150, -1), [1060, 150]], nodeEnd: true});
	}
	// up and right
	{
		const a = P(300);
		const b: [number, number] = [a[0], 250];
		t.push({pts: [a, b, diag(b, 110, 1), [2330, 110]], nodeEnd: true});
	}
	{
		const a = P(330);
		const b = diag(a, 470, 1);
		t.push({pts: [a, b, [2460, 470]], nodeEnd: true});
	}
	// down and right
	{
		const a = P(28);
		const b = diag(a, 1150, 1);
		t.push({pts: [a, b, [2390, 1150], diag([2390, 1150], 1260, 1)], nodeEnd: true});
	}
	{
		const a = P(62);
		const b: [number, number] = [a[0], 1300];
		t.push({pts: [a, b, diag(b, 1380, 1), [2200, 1380]], nodeEnd: true});
	}
	// down and left, under the lockup
	{
		const a = P(148);
		const b = diag(a, 1060, -1);
		t.push({pts: [a, b, [880, 1060], diag([880, 1060], 1160, -1)], nodeEnd: true});
	}
	{
		const a = P(118);
		const b: [number, number] = [a[0], 1250];
		t.push({pts: [a, b, diag(b, 1330, -1), [700, 1330]], nodeEnd: true});
	}
	// the far left (TV and the desktop band's left wing)
	t.push({pts: [[0, 640], [300, 640], [380, 720], [440, 720]], nodeEnd: true});
	t.push({pts: [[0, 820], [210, 820], [290, 900], [290, 980]], nodeEnd: true});
	t.push({pts: [[0, 250], [360, 250], [460, 350]], nodeEnd: true});
	t.push({pts: [[0, 1200], [240, 1200], [340, 1100], [520, 1100]], nodeEnd: true});
	return t;
})();

/** Centre of a ring node placed just past `end`, continuing the last segment's direction (the trace meets the ring's edge). */
export const nodeCentre = (prev: readonly [number, number], end: readonly [number, number], r: number): [number, number] => {
	const dx = end[0] - prev[0];
	const dy = end[1] - prev[1];
	const len = Math.hypot(dx, dy) || 1;
	return [end[0] + (dx / len) * r, end[1] + (dy / len) * r];
};

export const CircuitField: React.FC<{traces: readonly Trace[]; color: string; width: number; nodeR: number}> = ({traces, color, width, nodeR}) => (
	<g data-part="circuit" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
		{traces.map((tr, i) => {
			const d = tr.pts.map(([x, y], j) => `${j ? 'L' : 'M'} ${x} ${y}`).join(' ');
			const n = tr.pts.length;
			const end = nodeCentre(tr.pts[n - 2], tr.pts[n - 1], nodeR);
			const start = nodeCentre(tr.pts[1], tr.pts[0], nodeR);
			return (
				<g key={i}>
					<path d={d} />
					{tr.nodeEnd ? <circle cx={end[0]} cy={end[1]} r={nodeR} /> : null}
					{tr.nodeStart ? <circle cx={start[0]} cy={start[1]} r={nodeR} /> : null}
				</g>
			);
		})}
	</g>
);
