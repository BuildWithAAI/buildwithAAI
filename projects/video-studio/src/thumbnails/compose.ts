/**
 * Final geometry of a thumbnail once the headline is fitted (pure; the component draws from it, the Node tests check it,
 * and the render logs it for scripts/thumbnails.ts, which verifies contrast and legibility on the actual pixels).
 */
import type {Fitted} from './fit.ts';
import {badgerFaceBox, badgerHeadBox, zooFaceBox, zooHeadBox, type Rect, type ThumbLayout} from './layout.ts';

export type Composed = {
	size: number;
	lines: Array<{text: string; x: number; baseline: number; ascent: number; descent: number; width: number}>;
	/** The headline's ink block (union of the glyph boxes on a uniform pitch). */
	ink: Rect;
	accent: Rect;
	plate: Rect | null;
	zooHead: Rect;
	badgerHead: Rect | null;
	zooFace: Rect;
	badgerFace: Rect | null;
	textColor: string;
	behind: string;
};

export const compose = (L: ThumbLayout, fit: Fitted): Composed => {
	const box = L.text.box;
	const top = box.y + (box.h - fit.height) / 2;
	const inkX = L.text.align === 'left' ? box.x : box.x + box.w - fit.width;
	const lines = fit.lines.map((l, i) => ({
		text: l.text,
		// SVG text is drawn at its origin; the ink starts l px left of it, so shift to put the ink on the box edge
		x: (L.text.align === 'left' ? box.x : box.x + box.w - l.w) + l.l,
		baseline: top + fit.ascent + i * fit.pitch,
		ascent: l.a,
		descent: l.d,
		width: l.w,
	}));
	const ink: Rect = {x: inkX, y: top, w: fit.width, h: fit.height};
	const a = L.accent;
	let accent: Rect;
	if (a.kind === 'side') accent = {x: ink.x - a.gap - a.w, y: ink.y, w: a.w, h: ink.h};
	else {
		const y = a.kind === 'under' ? ink.y + ink.h + a.gap * fit.size : ink.y - a.gap * fit.size - a.h;
		accent = {x: L.text.align === 'left' ? ink.x : ink.x + ink.w - a.w, y, w: a.w, h: a.h};
	}
	let plate: Rect | null = null;
	if (L.plate) {
		const sideW = a.kind === 'side' ? a.gap + a.w : 0;
		const left = L.plate.bleedLeft ? -L.plate.r : ink.x - sideW - L.plate.padX;
		const right = ink.x + ink.w + L.plate.padX;
		plate = {x: left, y: ink.y - L.plate.padY, w: right - left, h: ink.h + 2 * L.plate.padY};
	}
	return {
		size: fit.size,
		lines,
		ink,
		accent,
		plate,
		zooHead: zooHeadBox(L.zoo),
		badgerHead: L.badger ? badgerHeadBox(L.badger) : null,
		zooFace: zooFaceBox(L.zoo),
		badgerFace: L.badger ? badgerFaceBox(L.badger) : null,
		textColor: L.text.color,
		behind: L.text.behind,
	};
};

/** The console line the render prints for the render script (one JSON object after the tag). */
export const LAYOUT_LOG_TAG = '[thumbnail-layout]';
