/**
 * Rekt Meter dial geometry (pure). A half dial: fraction 0 at the left end, 1 at the right end, over the top.
 * Screen coordinates (y down). Angles are in radians, pi at the left end, 0 at the right end.
 */

/** Frames the Rekt Meter needle takes to sweep to its reading (one sweep, eased in and out, no overshoot). */
export const SWEEP_FRAMES = 24;

export const angleOf = (fraction: number): number => Math.PI * (1 - Math.max(0, Math.min(1, fraction)));

export const dialPoint = (cx: number, cy: number, r: number, fraction: number): {x: number; y: number} => {
	const a = angleOf(fraction);
	return {x: cx + r * Math.cos(a), y: cy - r * Math.sin(a)};
};

const n = (v: number) => Number(v.toFixed(2));

/** Annular sector between radii r0 < r1 from fraction f0 to f1 (f0 < f1), as an SVG path. */
export const bandPath = (cx: number, cy: number, r0: number, r1: number, f0: number, f1: number): string => {
	const a = dialPoint(cx, cy, r1, f0);
	const b = dialPoint(cx, cy, r1, f1);
	const c = dialPoint(cx, cy, r0, f1);
	const d = dialPoint(cx, cy, r0, f0);
	return `M ${n(a.x)} ${n(a.y)} A ${r1} ${r1} 0 0 1 ${n(b.x)} ${n(b.y)} L ${n(c.x)} ${n(c.y)} A ${r0} ${r0} 0 0 0 ${n(d.x)} ${n(d.y)} Z`;
};

/** A tapered needle from the hub to radius `len`, base half-width `w0`, tip half-width `w1`. */
export const needlePath = (cx: number, cy: number, len: number, fraction: number, w0: number, w1: number): string => {
	const a = angleOf(fraction);
	const ux = Math.cos(a);
	const uy = -Math.sin(a);
	const px = -uy;
	const py = ux;
	const tip = {x: cx + ux * len, y: cy + uy * len};
	const pts = [
		{x: cx + px * w0, y: cy + py * w0},
		{x: tip.x + px * w1, y: tip.y + py * w1},
		{x: tip.x - px * w1, y: tip.y - py * w1},
		{x: cx - px * w0, y: cy - py * w0},
	];
	return `M ${pts.map((p) => `${n(p.x)} ${n(p.y)}`).join(' L ')} Z`;
};

/** A small triangle marker pointing at the dial from outside radius r (for a second outlet's figure). */
export const markerPath = (cx: number, cy: number, r: number, fraction: number, size: number): string => {
	const a = angleOf(fraction);
	const ux = Math.cos(a);
	const uy = -Math.sin(a);
	const px = -uy;
	const py = ux;
	const tip = {x: cx + ux * r, y: cy + uy * r};
	const base = {x: cx + ux * (r + size * 1.2), y: cy + uy * (r + size * 1.2)};
	return `M ${n(tip.x)} ${n(tip.y)} L ${n(base.x + px * size * 0.7)} ${n(base.y + py * size * 0.7)} L ${n(base.x - px * size * 0.7)} ${n(base.y - py * size * 0.7)} Z`;
};
