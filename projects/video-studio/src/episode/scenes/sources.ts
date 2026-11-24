/**
 * When and where the sources line is on screen (pure; used by Overlays.tsx SourcesCard and the tests).
 * Added 2026-11-24 (final check): each cited claim used to get its own card, so a scene that cites the same study in
 * three sentences (the demo's s02) blanked the card for one frame and wiped it in again at every new sentence
 * (scripts/qa: one-frame-state and flicker). Now a claim citing the source already on screen extends that card, and a
 * claim citing a different source swaps the text in place, with no exit, no blank frame and no new wipe.
 */
import type {Box, TextSpec} from '../layout/specs';

export type SourceCue = {id: string; from: number; claimEnd: number};

/** `from`/`to`: frames of the scene; `enter`/`exit`: whether the card wipes in at `from` / fades out before `to`. */
export type SourceSpan = {id: string; from: number; to: number; enter: boolean; exit: boolean};

/** Lead before the sentence, minimum hold, and hold after the claim (frames at 30 fps), as before the change. */
export const SOURCE_LEAD = 6;
export const SOURCE_MIN_HOLD = 120;
export const SOURCE_AFTER_CLAIM = 90;

export const sourceSpans = (cues: readonly SourceCue[], frames: number): SourceSpan[] => {
	const out: SourceSpan[] = [];
	for (const c of cues) {
		const from = c.from - SOURCE_LEAD;
		const to = Math.min(frames, Math.max(c.from + SOURCE_MIN_HOLD, c.claimEnd + SOURCE_AFTER_CLAIM));
		const last = out[out.length - 1];
		if (!last || from > last.to) {
			out.push({id: c.id, from, to, enter: true, exit: true});
			continue;
		}
		if (last.id === c.id) {
			last.to = Math.max(last.to, to); // the same source again: one longer card
			continue;
		}
		if (from <= last.from) {
			// several sources on one claim ([src:a,b]): the last one is shown, as before
			out[out.length - 1] = {...last, id: c.id, to: Math.max(last.to, to)};
		} else {
			last.to = from; // a different source takes over in place
			last.exit = false;
			out.push({id: c.id, from, to, enter: false, exit: true});
		}
		// a swap can bring back the source of the card before it: join them into one card
		const prev = out[out.length - 2];
		const cur = out[out.length - 1];
		if (prev && prev.id === cur.id && cur.from <= prev.to) {
			prev.to = Math.max(prev.to, cur.to);
			prev.exit = cur.exit;
			out.pop();
		}
	}
	return out;
};

/** The span on screen at `frame` (null: none). */
export const sourceSpanAt = (spans: readonly SourceSpan[], frame: number): SourceSpan | null =>
	spans.find((s) => frame >= s.from && frame < s.to) ?? null;

/** Horizontal padding of the sources card around its text (px). */
export const SOURCE_PAD_X = 16;

/** A horizontal span: the safe area of a format (specs.ts SAFE). */
type Span = {left: number; right: number};

/**
 * The width the line's text is fitted to: its box, but never more than the safe width less the card's padding, so the
 * card always fits inside the safe area. Only the full-width vertical box (972 px) is narrowed, to 940 px.
 */
export const sourcesFitWidth = (box: Box, safe: Span): number => Math.min(box.w, safe.right - safe.left - 2 * SOURCE_PAD_X);

/**
 * The card around a text `textWidth` wide: placed by its box's alignment, then slid back inside the safe area. Fixed
 * 2026-11-24 (final check): the text was fitted to the box and the card's padding added around it, so in landscape talk
 * and CTA, whose boxes end at the safe edge (x 1824), a long line crossed it (pt-br demo s02: the text 9 px past the
 * edge, scripts/qa safe-area). Such a card now slides left, by at most 2 x SOURCE_PAD_X; a line that fits does not move.
 */
export const sourcesCardBox = (box: Box, align: TextSpec['align'], textWidth: number, safe: Span): {x: number; w: number} => {
	const w = Math.ceil(textWidth) + 2 * SOURCE_PAD_X;
	const x = align === 'right' ? box.x + box.w - w : align === 'center' ? Math.round(box.x + (box.w - w) / 2) : box.x;
	return {x: Math.max(safe.left, Math.min(x, safe.right - w)), w};
};
