/**
 * Sentences and claims of a narration. Parsing uses the episode engine's own markup parser (src/episode/markup.ts),
 * so the gate reads {display|spoken} and [src:id] exactly as the voice step and the renderer do.
 *
 * A claim is the text a [src:id] tag backs: from the start of its sentence (or the previous tag in the same sentence)
 * up to the tag. Text after the last tag of a sentence ("..., the largest this year.") joins the last claim, so it is
 * checked against the same source. A tag right after a full stop backs the sentence before it.
 */
import {parseMarkup, MarkupError} from '../../../src/episode/markup.ts';
import type {Segment} from '../../../src/episode/markup.ts';

export {MarkupError};

export type Pair = {display: string; spoken: string};
export type ClaimSpan = {display: string; spoken: string; srcIds: string[]};
export type Sentence = {display: string; spoken: string; srcIds: string[]; claims: ClaimSpan[]; pairs: Pair[]};

// Abbreviations whose dot does not end a sentence (lower case, without the final dot).
const ABBREV = new Set(
	'mr mrs ms dr sr jr st vs etc e.g i.e inc ltd co corp no nos approx est jan feb mar apr jun jul aug sep sept oct nov dec u.s u.k u.n e.u a.m p.m fig gen gov sen rep dept'.split(' '),
);
// ... unless the next word starts with a capital (then "in the U.S. The firm said" ends at "U.S.").
const MAY_END = new Set('etc inc ltd co corp u.s u.k u.n e.u a.m p.m'.split(' '));
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»']);

const tidy = (s: string): string =>
	s
		.replace(/\s+([.,;:!?…)\]}»”%])/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();

const tidyClaim = (s: string): string => tidy(s).replace(/^[,;:\-–—]\s*/, '');

type Tag = {ids: string[]; d: number; s: number};
type Work = {d: string; s: string; tags: Tag[]; pairs: Pair[]};

const finish = (w: Work): Sentence => {
	const claims: ClaimSpan[] = [];
	if (w.tags.length) {
		// tags with only whitespace between them back the same text
		const groups: Tag[] = [];
		for (const t of [...w.tags].sort((a, b) => a.d - b.d)) {
			const g = groups[groups.length - 1];
			if (g && !w.d.slice(g.d, t.d).trim()) g.ids.push(...t.ids.filter((id) => !g.ids.includes(id)));
			else groups.push({ids: [...t.ids], d: t.d, s: t.s});
		}
		let pd = 0;
		let ps = 0;
		for (const g of groups) {
			claims.push({display: w.d.slice(pd, g.d), spoken: w.s.slice(ps, g.s), srcIds: g.ids});
			pd = g.d;
			ps = g.s;
		}
		const restD = w.d.slice(pd);
		const restS = w.s.slice(ps);
		if (restD.replace(/[\s.!?…"'”’)\]]/g, '')) {
			const last = claims[claims.length - 1];
			last.display += restD;
			last.spoken += restS;
		}
		for (const c of claims) {
			c.display = tidyClaim(c.display);
			c.spoken = tidyClaim(c.spoken);
		}
	}
	const srcIds: string[] = [];
	for (const t of w.tags) for (const id of t.ids) if (!srcIds.includes(id)) srcIds.push(id);
	return {display: tidy(w.d), spoken: tidy(w.s), srcIds, claims: claims.filter((c) => c.display || c.spoken), pairs: w.pairs};
};

const isBoundary = (text: string, k: number, nextSeg: Segment | undefined, d: string): boolean => {
	const ch = text[k];
	let j = k + 1;
	while (j < text.length && CLOSERS.has(text[j])) j++;
	const atEnd = j >= text.length;
	if (!atEnd && !/\s/.test(text[j])) return false;
	if (atEnd && nextSeg && nextSeg.kind === 'spoken') return false; // "pools.{...}" without a space
	if (ch === '.') {
		const word = /([\p{L}.]+)\.?$/u.exec(d.slice(0, d.length))?.[1]?.toLowerCase().replace(/\.$/, '') ?? '';
		if (ABBREV.has(word)) {
			const rest = text.slice(j).trimStart();
			const nextUpper = rest ? /^\p{Lu}/u.test(rest) : false;
			if (!(MAY_END.has(word) && nextUpper)) return false;
		}
	}
	return true;
};

/** Split a narration into sentences with their claims. Throws MarkupError on malformed markup. */
export const splitNarration = (narration: string): Sentence[] => {
	const segs = parseMarkup(narration);
	const out: Sentence[] = [];
	let w: Work = {d: '', s: '', tags: [], pairs: []};
	const flush = () => {
		if (w.d.trim() || w.s.trim() || w.tags.length) out.push(finish(w));
		w = {d: '', s: '', tags: [], pairs: []};
	};
	segs.forEach((seg, idx) => {
		if (seg.kind === 'src') {
			if (!w.d.trim() && !w.s.trim() && out.length) {
				// A tag after the full stop backs the sentence before it: its last claim, or the whole sentence.
				const prev = out[out.length - 1];
				if (!prev.srcIds.includes(seg.id)) prev.srcIds.push(seg.id);
				const last = prev.claims[prev.claims.length - 1];
				if (last) {
					if (!last.srcIds.includes(seg.id)) last.srcIds.push(seg.id);
				} else prev.claims.push({display: tidyClaim(prev.display), spoken: tidyClaim(prev.spoken), srcIds: [seg.id]});
				return;
			}
			w.tags.push({ids: [seg.id], d: w.d.length, s: w.s.length});
			return;
		}
		if (seg.kind === 'spoken') {
			w.d += seg.display;
			w.s += seg.spoken;
			w.pairs.push({display: seg.display, spoken: seg.spoken});
			return;
		}
		const text = seg.text;
		for (let k = 0; k < text.length; k++) {
			const ch = text[k];
			w.d += ch;
			w.s += ch;
			if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
				if (isBoundary(text, k, segs[idx + 1], w.d.slice(0, -1))) {
					// keep closing quotes with the sentence
					while (k + 1 < text.length && CLOSERS.has(text[k + 1])) {
						k++;
						w.d += text[k];
						w.s += text[k];
					}
					flush();
				}
			}
		}
	});
	flush();
	return out;
};

/** Source ids cited anywhere in a narration (in order, unique). */
export const narrationSourceIds = (narration: string): string[] => {
	const ids: string[] = [];
	for (const s of parseMarkup(narration)) if (s.kind === 'src' && !ids.includes(s.id)) ids.push(s.id);
	return ids;
};
