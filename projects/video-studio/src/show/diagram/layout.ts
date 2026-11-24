/**
 * HowItWorked diagram layout (pure): 2-5 nodes in a chain.
 *  - row: nodes left to right, arrows between them, each arrow's label in a band ABOVE the icons (centred on the
 *    arrow, as wide as one node pitch, so it never collides with an icon or another label), node labels under icons.
 *  - column: nodes top to bottom (the narrow vertical frame with 4-5 nodes), icon left and its label right, arrows
 *    down between icons with their labels beside the arrow.
 */

export type Box = {x: number; y: number; w: number; h: number};
export type NodeBox = {icon: Box; label: Box};
export type ArrowBox = {x1: number; y1: number; x2: number; y2: number; label: Box};
export type DiagramLayout = {orientation: 'row' | 'column'; nodes: NodeBox[]; arrows: ArrowBox[]};

export const LINK_BAND = 64; // row layout: room for arrow labels above the icons (2 lines at 26 px)
export const LABEL_H = 100; // row layout: room for node labels under the icons (3 lines at 28 px)

export const layoutDiagram = (n: number, box: Box, orientation: 'row' | 'column'): DiagramLayout => {
	if (n < 1) return {orientation, nodes: [], arrows: []};
	if (orientation === 'row') {
		const pitch = box.w / n;
		const icon = Math.min(170, pitch * 0.58, box.h - LINK_BAND - LABEL_H - 24);
		const top = box.y + LINK_BAND + Math.max(0, (box.h - LINK_BAND - LABEL_H - 24 - icon) / 2);
		const nodes: NodeBox[] = [];
		for (let i = 0; i < n; i++) {
			const cx = box.x + pitch * (i + 0.5);
			nodes.push({icon: {x: cx - icon / 2, y: top, w: icon, h: icon}, label: {x: cx - pitch / 2 + 8, y: top + icon + 16, w: pitch - 16, h: LABEL_H}});
		}
		const arrows: ArrowBox[] = [];
		for (let i = 0; i < n - 1; i++) {
			const a = nodes[i].icon;
			const b = nodes[i + 1].icon;
			const y = top + icon / 2;
			const x1 = a.x + a.w + 14;
			const x2 = b.x - 14;
			arrows.push({x1, y1: y, x2, y2: y, label: {x: (x1 + x2) / 2 - pitch / 2 + 6, y: top - LINK_BAND, w: pitch - 12, h: LINK_BAND - 6}});
		}
		return {orientation, nodes, arrows};
	}
	const pitch = box.h / n;
	const icon = Math.min(150, pitch * 0.66);
	const nodes: NodeBox[] = [];
	for (let i = 0; i < n; i++) {
		const cy = box.y + pitch * (i + 0.5);
		nodes.push({icon: {x: box.x, y: cy - icon / 2, w: icon, h: icon}, label: {x: box.x + icon + 28, y: cy - icon / 2, w: box.w - icon - 28, h: icon}});
	}
	const arrows: ArrowBox[] = [];
	for (let i = 0; i < n - 1; i++) {
		const a = nodes[i].icon;
		const b = nodes[i + 1].icon;
		const x = box.x + icon / 2;
		const y1 = a.y + a.h + 6;
		const y2 = b.y - 6;
		arrows.push({x1: x, y1, x2: x, y2, label: {x: x + 28, y: y1, w: box.w - icon / 2 - 28, h: Math.max(0, y2 - y1)}});
	}
	return {orientation, nodes, arrows};
};

/** Boxes overlap (used by the layout tests). */
export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
