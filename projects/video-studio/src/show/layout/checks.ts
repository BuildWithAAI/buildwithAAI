/**
 * Layout rules as checks (pure; tests/layout.test.ts runs them over every shot and segment in both formats).
 *  - Outlines 3-6 px in every shot, push-in included (ART_GUIDE SL5).
 *  - Faces inside the safe area (MO18; Shorts: out of the top 10% and bottom 20%) and above the caption band; in a
 *    Short, Badger's face also stays left of the action buttons.
 *  - Text (cards, source lines, the header row, captions) never covers an on-camera face, and keeps one head width
 *    clear of Zoo's face (CV4c: the face reads through its own features).
 */
import type {Format, ShowSegment} from '../types.ts';
import type {Box} from '../diagram/layout.ts';
import {FRAME, outlinePx, pushRect, rectToScreen, SAFE, SHORTS_BUTTONS, shotFor, type Shot, type ShotName} from './shots.ts';
import {logoRect, onAirRect, stageHeads} from './stage.ts';
import {CAPTION_BAND, headerSlots, SEGMENT_BOXES} from './boxes.ts';
import {SEGMENT_SPECS} from '../segments.ts';

export type Face = {who: 'zoo' | 'badger'; box: Box};

/** On-camera face boxes of a shot, in px, at push-in factor k about the shot's anchor (1 = no push). */
export const faces = (format: Format, shot: Shot, k = 1): Face[] => {
	const heads = stageHeads(format);
	return shot.cast.map((who) => {
		const r = rectToScreen(shot, heads[who]);
		const a = shot.pushAnchor;
		return {who, box: {x: a.x + (r.x - a.x) * k, y: a.y + (r.y - a.y) * k, w: r.w * k, h: r.h * k}};
	});
};

export const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const grow = (b: Box, d: number): Box => ({x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d});
export const inside = (b: Box, s: {left: number; right: number; top: number; bottom: number}): boolean => b.x >= s.left && b.y >= s.top && b.x + b.w <= s.right && b.y + b.h <= s.bottom;

export const checkShot = (format: Format, name: ShotName): string[] => {
	const out: string[] = [];
	if (name === 'none') return out;
	const shot = shotFor(format, name);
	const o = outlinePx(shot);
	if (o.min < 3 - 1e-9 || o.max > 6 + 1e-9) out.push(`${format}/${name}: outline ${o.min.toFixed(2)}-${o.max.toFixed(2)} px outside 3-6 px`);
	if (shot.dressing.onAir) {
		// the sign sits under no graphic: clear of the header row (tag and DEVELOPING badge) and of Zoo's face zone
		const sign = rectToScreen(shot, onAirRect(format));
		const h = headerSlots(format, name);
		const header = [
			{x: h.tag.x, y: h.tag.y, w: Math.min(h.tag.maxW, 420), h: 60},
			{x: h.badge.right - 360, y: h.badge.y, w: 360, h: 84},
		];
		for (const b of header) if (overlap(sign, b)) out.push(`${format}/${name}: the ON AIR sign is under the header row`);
		// the cold open (a two-shot with the wall dressing) may carry a kicker card: the sign stays fully visible below
		// or beside it and clear of the wall logo, at rest and pushed in
		const kicker = SEGMENT_BOXES[format].coldOpen.card;
		const logo = shot.dressing.logo ? rectToScreen(shot, logoRect(format)) : null;
		for (const k of [1, shot.push]) {
			const s = pushRect(shot, sign, k);
			const at = k > 1 ? ' (pushed in)' : '';
			if (kicker && overlap(grow(s, 8), kicker)) out.push(`${format}/${name}: the cold-open kicker card covers the ON AIR sign${at}`);
			if (logo && overlap(grow(s, 8), pushRect(shot, logo, k))) out.push(`${format}/${name}: the ON AIR sign touches the logo plate${at}`);
		}
		for (const f of faces(format, shot)) if (f.who === 'zoo' && overlap(grow(f.box, f.box.w), sign)) out.push(`${format}/${name}: the ON AIR sign is inside Zoo's face clear zone`);
		if (!inside(sign, {left: 0, right: FRAME[format].width, top: 0, bottom: FRAME[format].height})) out.push(`${format}/${name}: the ON AIR sign leaves the frame`);
	}
	for (const k of [1, shot.push]) {
		for (const f of faces(format, shot, k)) {
			const where = `${format}/${name} ${f.who} face${k > 1 ? ' (pushed in)' : ''}`;
			if (!inside(f.box, SAFE[format])) out.push(`${where} leaves the safe area: ${JSON.stringify(f.box)}`);
			if (overlap(f.box, CAPTION_BAND[format])) out.push(`${where} is under the caption band`);
			if (format === 'vertical' && f.box.y + f.box.h > SHORTS_BUTTONS.y && f.box.x + f.box.w > SHORTS_BUTTONS.x) out.push(`${where} reaches the Shorts buttons (x > ${SHORTS_BUTTONS.x})`);
		}
	}
	return out;
};

/** Text boxes a segment draws in this shot (card, source line, header row). */
export const textBoxes = (format: Format, seg: ShowSegment, shot: ShotName, hasCard = true): Array<{what: string; box: Box}> => {
	const b = SEGMENT_BOXES[format][seg];
	const h = headerSlots(format, shot);
	const out: Array<{what: string; box: Box}> = [];
	if (b.card && seg !== 'beat' && hasCard) out.push({what: 'card', box: b.card});
	if (b.source) out.push({what: 'source line', box: b.source});
	if (SEGMENT_SPECS[seg].tag) out.push({what: 'tag', box: {x: h.tag.x, y: h.tag.y, w: Math.min(h.tag.maxW, 420), h: 60}});
	out.push({what: 'DEVELOPING badge', box: {x: h.badge.right - 360, y: h.badge.y, w: 360, h: 84}});
	return out;
};

/** Zoo's clear zone: one head width around his face (CV4c). Badger's: no overlap plus a small margin. */
export const clearance = (f: Face): number => (f.who === 'zoo' ? f.box.w : 24);

/** `hasCard` false: the scene draws no card (a desk scene without copy, a cold open without a kicker). */
export const checkSegment = (format: Format, seg: ShowSegment, shot: ShotName, hasCard = true): string[] => {
	const out: string[] = [];
	const s = shotFor(format, shot);
	const fs = shot === 'none' ? [] : [...faces(format, s, 1), ...faces(format, s, s.push)];
	for (const t of textBoxes(format, seg, shot, hasCard)) {
		if (!inside(t.box, SAFE[format])) out.push(`${format}/${seg}: ${t.what} leaves the safe area: ${JSON.stringify(t.box)}`);
		for (const f of fs) if (overlap(grow(f.box, clearance(f)), t.box)) out.push(`${format}/${seg} (${shot}): ${t.what} is inside ${f.who}'s face clear zone`);
	}
	return out;
};
