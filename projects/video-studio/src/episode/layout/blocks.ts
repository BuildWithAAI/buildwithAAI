/**
 * Block geometry of the templates (pure): given fitted text heights, where each part goes and whether the block fits
 * its column. The scene components and the Node fit test use these same functions.
 */
export type Column = {top: number; bottom: number};

const centre = (column: Column, height: number) => Math.round(column.top + Math.max(0, (column.bottom - column.top - height) / 2));
const fitsIn = (column: Column, height: number) => height <= column.bottom - column.top + 0.5;

/** Hook: kicker pill, title, teal rule, subtitle. */
export const HOOK_GAP = 30;
export const RULE_H = 8;
export const hookBlock = (column: Column, h: {kicker: number; title: number; subtitle: number}) => {
	const kH = h.kicker ? h.kicker + HOOK_GAP : 0;
	const sH = h.subtitle ? HOOK_GAP + Math.ceil(h.subtitle) : 0;
	const height = kH + Math.ceil(h.title) + HOOK_GAP + RULE_H + sH;
	const top = centre(column, height);
	const kickerY = top;
	const titleY = top + kH;
	const ruleY = titleY + Math.ceil(h.title) + HOOK_GAP;
	const subtitleY = ruleY + RULE_H + HOOK_GAP;
	return {top, height, kickerY, titleY, ruleY, subtitleY, fits: fitsIn(column, height)};
};

/** Cards (talk bullets): each card is its text plus padding; cards are `gap` apart. */
export const stackCards = (textHeights: number[], padY: number, gap: number): {tops: number[]; heights: number[]; total: number} => {
	const heights = textHeights.map((h) => Math.ceil(h) + 2 * padY);
	const tops: number[] = [];
	let y = 0;
	for (const h of heights) {
		tops.push(y);
		y += h + gap;
	}
	return {tops, heights, total: heights.length ? y - gap : 0};
};

/** Rows (steps): each row is max(badge, text) tall, rows `gap` apart. */
export const stackRows = (textHeights: number[], badge: number, gap: number): {tops: number[]; heights: number[]; total: number} => {
	const heights = textHeights.map((h) => Math.max(badge, Math.ceil(h)));
	const tops: number[] = [];
	let y = 0;
	for (const h of heights) {
		tops.push(y);
		y += h + gap;
	}
	return {tops, heights, total: heights.length ? y - gap : 0};
};

/** Title over a list, as one block centred in the column. */
export const TITLE_GAP = 44;
export const placeBlock = (column: Column, titleH: number, listH: number): {titleY: number; listY: number; height: number; fits: boolean} => {
	const gap = titleH > 0 && listH > 0 ? TITLE_GAP : 0;
	const height = Math.ceil(titleH) + gap + listH;
	const top = centre(column, height);
	return {titleY: top, listY: top + Math.ceil(titleH) + gap, height, fits: fitsIn(column, height)};
};

/** Quote card: mark, quote, attribution, source, wrapped in a card centred in the column. */
export const quoteBlock = (L: {column: Column; pad: number; markSize: number}, h: {quote: number; attribution: number; source: number}) => {
	const markH = Math.round(L.markSize * 0.62);
	const q = Math.ceil(h.quote);
	const a = Math.ceil(h.attribution);
	const sH = Math.ceil(h.source);
	const inner = markH + 20 + q + (a ? 40 + a : 0) + (sH ? 12 + sH : 0);
	const cardH = inner + 2 * L.pad;
	const cardY = centre(L.column, cardH);
	const markY = cardY + L.pad;
	const quoteY = markY + markH + 20;
	const attrY = quoteY + q + (a ? 40 : 0);
	const srcY = attrY + a + (sH ? 12 : 0);
	return {cardY, cardH, markY, quoteY, attrY, srcY, fits: fitsIn(L.column, cardH)};
};

/** CTA: title, button, disclosure, stacked (in a card in landscape) and centred in the column. */
export const ctaBlock = (L: {column: Column; pad: number; button: {h: number}}, h: {title: number; disclosure: number}) => {
	const t = Math.ceil(h.title);
	const d = Math.ceil(h.disclosure);
	const inner = t + (t ? 40 : 0) + L.button.h + (d ? 44 + d : 0);
	const height = inner + 2 * L.pad;
	const top = centre(L.column, height);
	const titleY = top + L.pad;
	const buttonY = titleY + t + (t ? 40 : 0);
	const disclosureY = buttonY + L.button.h + 44;
	return {top, height, titleY, buttonY, disclosureY, fits: fitsIn(L.column, height)};
};
