/**
 * Browser ink measure for fit.ts: canvas measureText with the same family stack and weight the SVG text uses, so the
 * browser's own font fallback and shaping (Devanagari conjuncts, CJK) are measured, not estimated. Call it only after
 * loadLangFonts() resolved (the Thumbnail gates rendering on that).
 */
import {canvasFont, fontFor, type FontSpec} from '../episode/i18n/fonts';
import type {Lang} from '../episode/types';
import type {Ink, InkMeasure} from './fit';

/** Headline face: Anton for Latin scripts; for hi/zh/ja the heading stack at 900 with Noto Sans Devanagari/SC/JP. */
export const headlineFont = (lang: Lang): FontSpec => fontFor(lang, 'display', 900);

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, Ink>();

export const inkMeasure = (font: FontSpec): InkMeasure => (text, size) => {
	const f = canvasFont(font, size);
	const key = `${f}\u0000${text}`;
	const hit = cache.get(key);
	if (hit) return hit;
	if (!ctx) {
		const k = document.createElement('canvas').getContext('2d');
		if (!k) throw new Error('canvas 2d context unavailable for text measurement');
		ctx = k;
	}
	ctx.font = f;
	ctx.textBaseline = 'alphabetic';
	ctx.textAlign = 'left';
	const m = ctx.measureText(text);
	const ink: Ink = {w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent, l: m.actualBoundingBoxLeft};
	cache.set(key, ink);
	return ink;
};
