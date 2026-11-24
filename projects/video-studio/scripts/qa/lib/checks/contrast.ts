/**
 * Text contrast from rendered pixels. For each text node the frame is rendered twice: as is (P) and with every
 * text paint made transparent (T, same layout). Pixels where P and T differ are exactly the text's own pixels,
 * whatever lies behind them, so low-contrast text is found even when it nearly matches its background.
 *
 * Two contrasts per text, WCAG 2.x ratio from the rendered colours:
 *  - behind: each glyph pixel (P) against what is behind that exact pixel (T), 20th percentile;
 *  - edge: the glyph colour against the ring of pixels 2-3 px outside the glyph cores (P): the outline,
 *    plate or background the eye actually sees next to the letters (this is what outlined text relies on).
 * The text passes when the better of the two meets the minimum.
 */
import type {FrameFacts, TextFact} from '../../../../src/qa/protocol.ts';
import {contrastRgb, percentile, rgbToHex, type RGB} from '../color.ts';
import {clampRect, dilate, inflate, type Image} from '../image.ts';
import type {Finding} from '../issues.ts';
import {THRESHOLDS as T} from '../thresholds.ts';

export type ContrastMeasure = {
	contrast: number;
	behind: number;
	edge: number;
	glyphPx: number;
	textColor: string;
	background: string;
};

const q = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** Measure one text node; null when the text has no rendered pixels at all (reported as invisible). */
export const measureContrast = (P: Image, Tx: Image, t: TextFact): ContrastMeasure | null => {
	const c = clampRect(inflate(t.box, 4), P.width, P.height);
	if (!c) return null;
	const w = c.x1 - c.x0;
	const h = c.y1 - c.y0;
	const n = w * h;
	const d = new Uint8Array(n);
	let maxD = 0;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = ((c.y0 + y) * P.width + c.x0 + x) * 4;
			const v = Math.max(Math.abs(P.data[i] - Tx.data[i]), Math.abs(P.data[i + 1] - Tx.data[i + 1]), Math.abs(P.data[i + 2] - Tx.data[i + 2]));
			d[y * w + x] = v;
			if (v > maxD) maxD = v;
		}
	if (maxD < T.contrast.glyphDiff) return null;
	const thr = Math.max(T.contrast.glyphDiff, 0.25 * maxD);
	const M = new Uint8Array(n);
	for (let i = 0; i < n; i++) M[i] = d[i] >= thr ? 1 : 0;
	// glyph cores: close to the declared text colour when it is a plain opaque colour, else the strongest pixels
	const F = new Uint8Array(n);
	let fCount = 0;
	const col = t.color && t.color[3] >= 0.9 ? t.color : null;
	for (let i = 0; i < n; i++) {
		if (!M[i]) continue;
		const y = Math.floor(i / w);
		const x = i - y * w;
		const pi = ((c.y0 + y) * P.width + c.x0 + x) * 4;
		const core = col ? Math.max(Math.abs(P.data[pi] - col[0]), Math.abs(P.data[pi + 1] - col[1]), Math.abs(P.data[pi + 2] - col[2])) <= 40 : d[i] >= 0.75 * maxD;
		if (core) {
			F[i] = 1;
			fCount++;
		}
	}
	if (fCount < 4) {
		F.set(M);
		fCount = M.reduce((a, v) => a + v, 0);
	}
	// rendered text colour: per-channel median of the cores
	const rs: number[] = [];
	const gs: number[] = [];
	const bs: number[] = [];
	const behind: number[] = [];
	for (let i = 0; i < n; i++) {
		if (!F[i]) continue;
		const y = Math.floor(i / w);
		const pi = ((c.y0 + y) * P.width + c.x0 + (i - y * w)) * 4;
		rs.push(P.data[pi]);
		gs.push(P.data[pi + 1]);
		bs.push(P.data[pi + 2]);
		behind.push(contrastRgb([P.data[pi], P.data[pi + 1], P.data[pi + 2]], [Tx.data[pi], Tx.data[pi + 1], Tx.data[pi + 2]]));
	}
	const textRgb: RGB = [percentile(rs, 50), percentile(gs, 50), percentile(bs, 50)];
	const d1 = dilate(F, w, h, 1);
	const d3 = dilate(F, w, h, 3);
	const edge: number[] = [];
	const br: number[] = [];
	const bg: number[] = [];
	const bb: number[] = [];
	for (let i = 0; i < n; i++) {
		if (!d3[i] || d1[i] || F[i]) continue;
		const y = Math.floor(i / w);
		const pi = ((c.y0 + y) * P.width + c.x0 + (i - y * w)) * 4;
		edge.push(contrastRgb(textRgb, [P.data[pi], P.data[pi + 1], P.data[pi + 2]]));
		br.push(Tx.data[pi]);
		bg.push(Tx.data[pi + 1]);
		bb.push(Tx.data[pi + 2]);
	}
	const pe = edge.length ? percentile(edge, T.contrast.percentile) : 0;
	const pb = behind.length ? percentile(behind, T.contrast.percentile) : 0;
	return {
		contrast: Math.round(Math.max(pe, pb) * 100) / 100,
		behind: Math.round(pb * 100) / 100,
		edge: Math.round(pe * 100) / 100,
		glyphPx: fCount,
		textColor: rgbToHex(textRgb),
		background: br.length ? rgbToHex([percentile(br, 50), percentile(bg, 50), percentile(bb, 50)]) : 'n/a',
	};
};

export const contrastFindings = (f: FrameFacts, P: Image, Tx: Image, settled: (t: TextFact) => boolean = () => true): {findings: Finding[]; measured: number; skipped: number; lowest: number} => {
	const out: Finding[] = [];
	let measured = 0;
	let skipped = 0;
	let lowest = Infinity;
	for (const t of f.texts) {
		if (t.role === 'badge') continue;
		// fading, mostly clipped or animating (moving, scaling, being revealed): measured when it settles
		if (t.opacity < T.contrast.minOpacity || t.visibleFrac < 0.5 || !settled(t)) {
			skipped++;
			continue;
		}
		const m = measureContrast(P, Tx, t);
		measured++;
		lowest = Math.min(lowest, m ? m.contrast : 1);
		const subject = `"${q(t.text)}"`;
		const key = `${t.role}|${t.text}|${t.path}`;
		if (!m) {
			out.push({
				check: 'contrast',
				severity: 'error',
				frame: f.frame,
				box: t.box,
				subject,
				key,
				message: 'the text has no visible pixels: it is covered by other artwork or drawn in its background colour',
				measured: {contrast: 1},
				score: 21,
			});
			continue;
		}
		// punctuation or symbols only (a decorative quote mark, a bullet): WCAG treats pure decoration as exempt;
		// a meaningful symbol still needs the 3:1 non-text minimum (WCAG 1.4.11)
		const symbolOnly = /^[\p{P}\p{S}\s]+$/u.test(t.text);
		if (symbolOnly && m.contrast < T.contrast.min) {
			out.push({
				check: 'contrast',
				severity: 'info',
				frame: f.frame,
				box: t.box,
				subject,
				key,
				message: `symbol-only text at ${m.contrast}:1 (${m.textColor} on ${m.background}): fine if decorative; a symbol that carries meaning needs 3:1`,
				measured: {contrast: m.contrast, textColor: m.textColor, background: m.background},
				score: 0,
			});
			continue;
		}
		if (m.contrast < T.contrast.min) {
			const large = t.effPx >= 24 || (t.effPx >= 18.66 && t.weight >= 700);
			out.push({
				check: 'contrast',
				severity: 'error',
				frame: f.frame,
				box: t.box,
				subject,
				key,
				message: `contrast ${m.contrast}:1 (minimum ${T.contrast.min}:1): text ${m.textColor} on ${m.background}${large && m.contrast >= 3 ? '; WCAG would accept 3:1 for this large text, the project minimum is 4.5:1' : m.contrast < 3 ? '; fails even the 3:1 large-text minimum' : ''}`,
				measured: {contrast: m.contrast, behind: m.behind, edge: m.edge, textColor: m.textColor, background: m.background, px: t.effPx},
				score: T.contrast.min - m.contrast,
			});
		}
	}
	return {findings: out, measured, skipped, lowest};
};
