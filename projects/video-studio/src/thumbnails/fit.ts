/**
 * Headline fit for thumbnails (pure; the width/ink measure is injected: canvas in the browser, a fake in the tests).
 *
 * Every way to break the text into 1..maxLines lines is tried (at most 4 words, or 10 zh/ja characters, so there are
 * few), each at the largest size that fits the box. Bigger type wins, because the headline must survive 168x94:
 * stacked lines when the column is narrow, one line when it is wide. Two mild preferences shape near-ties:
 *  - a line much shorter than the longest one (a lone "MY" over "BOT DID") costs up to 20% of the score;
 *  - each extra line costs 2%, so equal sizes keep the fewer lines.
 * A newline in the text is an explicit break chosen by the writer; then only the size is fitted.
 *
 * Lines are stacked on their INK (measured ascent and descent), not on CSS line boxes, so the block sits exactly where
 * the layout puts it in every script.
 */

/**
 * Ink of `text` at `size` px, from the actual glyphs: w = ink width (left edge to right edge), a/d = ascent/descent
 * around the baseline, l = how far the ink starts LEFT of the drawing origin (negative when it starts to the right).
 */
export type Ink = {w: number; a: number; d: number; l: number};
export type InkMeasure = (text: string, size: number) => Ink;

export type FitSpec = {
	w: number; // box width, px
	h: number; // box height, px
	maxSize: number;
	minSize: number;
	maxLines: number;
	gap: number; // ink gap between lines, as a multiple of the font size
	unspaced: boolean; // zh/ja: break between characters
};

export type FitLine = {text: string} & Ink;

export type Fitted = {
	size: number;
	lines: FitLine[];
	pitch: number; // baseline to baseline
	ascent: number; // max ink ascent over the lines
	descent: number; // max ink descent over the lines
	width: number; // widest line
	height: number; // ink block height: first line's top ink to the last line's bottom ink (uniform pitch)
};

/** Characters that must not start a line (they join the previous unit) and that must not end one (they join the next). */
const NO_START = '、。，．・：；？！ー）」』】〕〉》｝’”…,.!?:;)%';
const NO_END = '（「『【〔〈《｛‘“(¿¡';

/** Break units: words for spaced scripts; for zh/ja single characters, Latin/digit runs kept whole, kinsoku-glued. */
export const breakUnits = (text: string, unspaced: boolean): string[] => {
	const t = text.replace(/\s+/g, ' ').trim();
	if (!t) return [];
	if (!unspaced) return t.split(' ');
	const raw = t.match(/[A-Za-z0-9$%.,'’-]+|\s+|./gu) ?? [];
	const out: string[] = [];
	let carry = '';
	for (const piece of raw) {
		if (/^\s+$/.test(piece)) continue;
		const last = out.length - 1;
		if (last >= 0 && !carry && NO_START.includes(piece[0])) {
			out[last] += piece;
			continue;
		}
		if (piece.length === 1 && NO_END.includes(piece)) {
			carry += piece;
			continue;
		}
		out.push(carry + piece);
		carry = '';
	}
	if (carry) {
		if (out.length) out[out.length - 1] += carry;
		else out.push(carry);
	}
	return out;
};

/** Every split of `units` into 1..maxLines consecutive lines. */
export const lineSplits = (units: string[], maxLines: number, unspaced: boolean): string[][] => {
	const join = (u: string[]) => u.join(unspaced ? '' : ' ');
	const out: string[][] = [];
	const rec = (start: number, acc: string[]) => {
		if (start === units.length) {
			out.push(acc);
			return;
		}
		if (acc.length === maxLines) return;
		for (let end = start + 1; end <= units.length; end++) {
			if (acc.length === maxLines - 1 && end !== units.length) continue;
			rec(end, [...acc, join(units.slice(start, end))]);
		}
	};
	rec(0, []);
	return out;
};

/** The writer's explicit lines (text with newlines), or null. */
export const explicitLines = (text: string): string[] | null => {
	if (!text.includes('\n')) return null;
	const lines = text
		.split('\n')
		.map((l) => l.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
	return lines.length ? lines : null;
};

const REF = 100; // reference size for the linear scaling of widths and ink
const SHORT_LINE_COST = 0.2;
const EXTRA_LINE_COST = 0.02;

/** Largest size at which `lines` fit the box (linear in the size), and the candidate's score. */
const evaluate = (lines: string[], spec: FitSpec, measure: InkMeasure): {size: number; score: number} => {
	const inks = lines.map((l) => measure(l, REF));
	const maxW = Math.max(...inks.map((i) => i.w));
	const minW = Math.min(...inks.map((i) => i.w));
	const maxA = Math.max(...inks.map((i) => i.a));
	const maxD = Math.max(0, ...inks.map((i) => i.d));
	const n = lines.length;
	const hRef = n * (maxA + maxD) + (n - 1) * spec.gap * REF;
	const size = Math.floor(Math.min(spec.maxSize, (spec.w / maxW) * REF, (spec.h / hRef) * REF) * 4) / 4;
	const shortness = n > 1 ? Math.max(0, 1 - (2 * minW) / maxW) : 0; // 0 while the shortest line is >= half the longest
	return {size, score: size * (1 - SHORT_LINE_COST * shortness) * (1 - EXTRA_LINE_COST * (n - 1))};
};

/** Fit `text` into the box, or return null when nothing fits at minSize (the caller fails the render). */
export const fitHeadline = (text: string, spec: FitSpec, measure: InkMeasure): Fitted | null => {
	const fixed = explicitLines(text);
	const candidates = fixed ? [fixed] : lineSplits(breakUnits(text, spec.unspaced), spec.maxLines, spec.unspaced);
	let best: {lines: string[]; size: number; score: number} | null = null;
	for (const lines of candidates) {
		if (!lines.length) continue;
		const e = evaluate(lines, spec, measure);
		if (e.size < spec.minSize) continue;
		if (!best || e.score > best.score + 1e-9) best = {lines, ...e};
	}
	if (!best) return null;
	const chosen = best.lines;
	const at = (size: number): Fitted => {
		const lines = chosen.map((l) => ({text: l, ...measure(l, size)}));
		const ascent = Math.max(...lines.map((l) => l.a));
		const descent = Math.max(0, ...lines.map((l) => l.d));
		const pitch = ascent + descent + spec.gap * size;
		return {size, lines, pitch, ascent, descent, width: Math.max(...lines.map((l) => l.w)), height: (lines.length - 1) * pitch + ascent + descent};
	};
	// widths scale linearly in practice; re-measure at the chosen size and step down if rounding says otherwise
	let f = at(best.size);
	while ((f.width > spec.w + 0.01 || f.height > spec.h + 0.01) && f.size - 0.5 >= spec.minSize) f = at(f.size - 0.5);
	return f.width > spec.w + 0.01 || f.height > spec.h + 0.01 ? null : f;
};
