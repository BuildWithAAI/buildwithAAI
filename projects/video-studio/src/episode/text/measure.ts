/**
 * Browser text measurement for fit.ts: canvas measureText with the same family stack and weight the DOM renders, so the
 * browser's own font fallback and shaping (Devanagari conjuncts, CJK) are measured, not estimated. Only call it after
 * loadLangFonts() resolved (the Episode gates rendering on that).
 */
import type {Measure} from './fit';
import {canvasFont, type FontSpec} from '../i18n/fonts';

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

const context = (): CanvasRenderingContext2D => {
	if (!ctx) {
		const c = document.createElement('canvas');
		const k = c.getContext('2d');
		if (!k) throw new Error('canvas 2d context unavailable for text measurement');
		ctx = k;
	}
	return ctx;
};

export const measureFor = (font: FontSpec): Measure => (text: string, size: number) => {
	const f = canvasFont(font, size);
	const key = `${f}\u0000${text}`;
	const hit = cache.get(key);
	if (hit !== undefined) return hit;
	const k = context();
	k.font = f;
	const w = k.measureText(text).width;
	cache.set(key, w);
	return w;
};
