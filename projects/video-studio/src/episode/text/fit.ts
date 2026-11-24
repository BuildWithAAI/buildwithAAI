/**
 * Text auto-fit (pure). Shrink to a floor, then wrap: the text first shrinks from maxSize until it fits in its
 * preferred number of lines; at the floor (minSize) it may wrap onto more lines while the box height allows. If it
 * still does not fit, the result says `overflow` and the validator fails the render (text is never clipped silently).
 * The width measure is injected: canvas measureText in the browser, real font tables in the Node tests.
 */

/** Width in px of `text` at `size` px, for one bound font (family + weight). */
export type Measure = (text: string, size: number) => number;

export type FitSpec = {
	maxWidth: number;
	maxHeight: number;
	maxSize: number;
	minSize: number;
	maxLines: number; // preferred line count while shrinking
	lineHeight: number; // multiple of the font size
	unspaced?: boolean; // zh/ja: break between characters (with kinsoku rules)
	balance?: boolean; // even out line lengths (titles)
	ellipsis?: boolean; // at the floor, cut the text with "…" instead of overflowing (source lines only)
};

export type FitResult = {
	fontSize: number;
	lines: string[];
	width: number; // widest line, px
	height: number; // lines × size × lineHeight
	wrappedPastPreferred: boolean; // floor reached, more lines than maxLines
	brokeWord: boolean; // a single word wider than the box had to be split
	truncated: boolean; // shortened with an ellipsis (spec.ellipsis)
	overflow: boolean; // does not fit the box even at the floor
};

/** Characters that must not start a line (CJK closing punctuation) or end one (opening punctuation). */
const NO_START = '、。，．・：；？！ー）」』】〕〉》｝’”…,.!?:;)%';
const NO_END = '（「『【〔〈《｛‘“(';

/** Break units: words with their trailing space for spaced text; characters (kinsoku-glued) for unspaced text. */
const units = (text: string, unspaced: boolean): string[] => {
	if (!unspaced) return text.split(/\s+/).filter(Boolean);
	const out: string[] = [];
	for (const ch of Array.from(text.replace(/\s+/g, ''))) {
		const last = out.length - 1;
		if (last >= 0 && (NO_START.includes(ch) || NO_END.includes(out[last].slice(-1)) || /[A-Za-z0-9$%.,]/.test(ch) && /[A-Za-z0-9$]$/.test(out[last]))) out[last] += ch;
		else out.push(ch);
	}
	return out;
};

const joinUnits = (u: string[], unspaced: boolean) => u.join(unspaced ? '' : ' ');

/** Split one too-wide word into pieces that fit (last resort). */
const breakWord = (w: string, maxWidth: number, size: number, measure: Measure): string[] => {
	const out: string[] = [];
	let cur = '';
	for (const ch of Array.from(w)) {
		if (cur && measure(cur + ch, size) > maxWidth) {
			out.push(cur);
			cur = ch;
		} else cur += ch;
	}
	if (cur) out.push(cur);
	return out;
};

/** Greedy wrap at `size`. Returns the lines and whether a word had to be broken. */
export const wrapText = (text: string, maxWidth: number, size: number, measure: Measure, unspaced = false): {lines: string[]; broke: boolean} => {
	const us = units(text.trim(), unspaced);
	const lines: string[] = [];
	let cur: string[] = [];
	let broke = false;
	for (const u of us) {
		const cand = joinUnits([...cur, u], unspaced);
		if (measure(cand, size) <= maxWidth) {
			cur.push(u);
			continue;
		}
		if (cur.length) lines.push(joinUnits(cur, unspaced));
		cur = [];
		if (measure(u, size) <= maxWidth) cur = [u];
		else {
			broke = true;
			const pieces = breakWord(u, maxWidth, size, measure);
			lines.push(...pieces.slice(0, -1));
			cur = [pieces[pieces.length - 1]];
		}
	}
	if (cur.length) lines.push(joinUnits(cur, unspaced));
	return {lines, broke};
};

const result = (lines: string[], size: number, spec: FitSpec, measure: Measure, broke: boolean, past: boolean): FitResult => {
	const height = lines.length * size * spec.lineHeight;
	const width = Math.max(0, ...lines.map((l) => measure(l, size)));
	return {fontSize: size, lines, width, height, wrappedPastPreferred: past, brokeWord: broke, truncated: false, overflow: height > spec.maxHeight + 0.5 || width > spec.maxWidth + 0.5};
};

/** Even out the lines: the narrowest width that still wraps into the same number of lines. */
const balanced = (text: string, n: number, size: number, spec: FitSpec, measure: Measure): string[] => {
	let lo = spec.maxWidth * 0.45;
	let hi = spec.maxWidth;
	let best = wrapText(text, hi, size, measure, spec.unspaced).lines;
	for (let k = 0; k < 14; k++) {
		const mid = (lo + hi) / 2;
		const w = wrapText(text, mid, size, measure, spec.unspaced);
		if (w.lines.length <= n && !w.broke) {
			best = w.lines;
			hi = mid;
		} else lo = mid;
	}
	return best;
};

export const fitText = (text: string, spec: FitSpec, measure: Measure): FitResult => {
	const t = text.trim();
	if (!t) return {fontSize: spec.maxSize, lines: [], width: 0, height: 0, wrappedPastPreferred: false, brokeWord: false, truncated: false, overflow: false};
	const maxSize = Math.max(spec.minSize, Math.floor(spec.maxSize));
	for (let size = maxSize; size >= spec.minSize; size--) {
		const w = wrapText(t, spec.maxWidth, size, measure, spec.unspaced);
		if (w.broke) continue; // prefer shrinking over splitting a word
		if (w.lines.length <= spec.maxLines && w.lines.length * size * spec.lineHeight <= spec.maxHeight) {
			const lines = spec.balance && w.lines.length > 1 ? balanced(t, w.lines.length, size, spec, measure) : w.lines;
			return result(lines, size, spec, measure, false, false);
		}
	}
	// floor reached: wrap onto more lines while the box height allows
	const w = wrapText(t, spec.maxWidth, spec.minSize, measure, spec.unspaced);
	const lines = spec.balance && w.lines.length > 1 && !w.broke ? balanced(t, w.lines.length, spec.minSize, spec, measure) : w.lines;
	const r = result(lines, spec.minSize, spec, measure, w.broke, lines.length > spec.maxLines);
	if (!r.overflow || !spec.ellipsis) return r;
	// ellipsis: keep the lines that fit, then shorten the last one word by word until "…" fits
	const keep = Math.max(1, Math.min(spec.maxLines, Math.floor(spec.maxHeight / (spec.minSize * spec.lineHeight))));
	const kept = w.lines.slice(0, keep);
	const sep = spec.unspaced ? '' : ' ';
	let last = units(kept[keep - 1] + sep + w.lines.slice(keep).join(sep), spec.unspaced ?? false);
	while (last.length > 1 && measure(joinUnits(last, spec.unspaced ?? false) + '…', spec.minSize) > spec.maxWidth) last = last.slice(0, -1);
	kept[keep - 1] = joinUnits(last, spec.unspaced ?? false).replace(/[\s,;:·-]+$/u, '') + '…';
	return {...result(kept, spec.minSize, spec, measure, w.broke, false), truncated: true};
};
