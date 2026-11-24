/**
 * The Zoora jellyfish mark, as pure geometry (mark units; origin = centre of the bell rim, y down).
 *
 * Design: the channel's existing brand is a silver line-art jellyfish with circuit nodes on black
 * (content/zoora-ai/CHANNEL.md). Zoo wears the same creature as his pin: "a small dome with three short tentacles"
 * (PROJECT_INSTRUCTIONS). The mark joins the two. The bell is organic: a dome with a gently flared margin, a
 * scalloped rim of four lobes and one highlight line on the upper left (the pin's highlight, as line art). The three
 * tentacles are geometric: circuit traces (vertical runs and 45-degree bends) rooted in the rim's three inner cusps,
 * each ending in a ring node. Nature meets machine. One uniform stroke, round caps and joins, no fills except the
 * optional accent dot, so it stays flat line art at every size (ART_GUIDE P1, SL6).
 */

export type Pt = readonly [number, number];
export type Node = {x: number; y: number; r: number};

/** Uniform line weight in mark units. Keeps the line >= 3 px when the mark is ~70 px tall (98 px avatar). */
export const STROKE = 36;

export const BELL_HALF_W = 300;
export const BELL_TOP = -352;
/** The rim's three inner cusps (where the tentacles root) and the lobe depth. */
export const CUSPS_X = [-150, 0, 150] as const;
const LOBE_DEPTH = 24;

/**
 * Closed bell outline. The dome runs from the left margin over the top to the right margin; the margins flare out a
 * little (the side tangents lean outward near the rim); the rim returns right-to-left as four shallow lobes.
 */
export const BELL = [
	`M ${-BELL_HALF_W} 0`,
	`C ${-BELL_HALF_W + 2} -96 -282 -232 -196 -300`,
	`C -142 -340 -72 ${BELL_TOP} 0 ${BELL_TOP}`,
	`C 72 ${BELL_TOP} 142 -340 196 -300`,
	`C 282 -232 ${BELL_HALF_W - 2} -96 ${BELL_HALF_W} 0`,
	// rim: four lobes between the margins and the three cusps (quadratic arcs hanging LOBE_DEPTH below the cusp line)
	`Q 225 ${2 * LOBE_DEPTH} 150 0`,
	`Q 75 ${2 * LOBE_DEPTH} 0 0`,
	`Q -75 ${2 * LOBE_DEPTH} -150 0`,
	`Q -225 ${2 * LOBE_DEPTH} ${-BELL_HALF_W} 0`,
	'Z',
].join(' ');

/** Highlight line inside the dome, upper left (open path). */
export const INNER = 'M -206 -92 C -200 -186 -146 -250 -62 -270';

export const NODE_R = 32;

/** Tentacle traces: polylines from a rim cusp down to the top of their node. Symmetric (a logo, not a character). */
const SIDE_OUT_X = 232;
const BEND_Y = 104;
const traceSide = (s: 1 | -1): Pt[] => [
	[s * 150, 0],
	[s * 150, BEND_Y],
	[s * SIDE_OUT_X, BEND_Y + (SIDE_OUT_X - 150)],
	[s * SIDE_OUT_X, 270],
];
const traceCentre = (): Pt[] => [
	[0, 0],
	[0, 336],
];
export const TRACES: readonly (readonly Pt[])[] = [traceSide(-1), traceCentre(), traceSide(1)];

/** Ring nodes at the end of each trace (the trace meets the ring's top). */
export const NODES: readonly Node[] = TRACES.map((t) => {
	const [x, y] = t[t.length - 1];
	return {x, y: y + NODE_R, r: NODE_R};
});

/** Index of the node that may carry the teal accent dot (the centre one). */
export const ACCENT_NODE = 1;
/** Fills the ring's hole, tucked 1 unit under the ring so no seam shows (ART_GUIDE SL9). */
export const ACCENT_DOT_R = NODE_R - STROKE / 2 + 1;

const round = (n: number) => Math.round(n * 100) / 100;
export const polyline = (pts: readonly Pt[]): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${round(x)} ${round(y)}`).join(' ');

/** Tight bounds of the drawn mark (stroke included), mark units. The flared margins are the widest point. */
export const BOUNDS = (() => {
	const h = STROKE / 2;
	const xs = [-BELL_HALF_W - h, BELL_HALF_W + h, ...NODES.flatMap((n) => [n.x - n.r - h, n.x + n.r + h])];
	const ys = [BELL_TOP - h, LOBE_DEPTH + h, ...NODES.map((n) => n.y + n.r + h)];
	const x0 = Math.min(...xs);
	const x1 = Math.max(...xs);
	const y0 = Math.min(...ys);
	const y1 = Math.max(...ys);
	return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
})();

/** Visual centre used when the mark is centred in a frame or circle: the bounds centre. */
export const CENTRE: Pt = [BOUNDS.x + BOUNDS.w / 2, BOUNDS.y + BOUNDS.h / 2];
