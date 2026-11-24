/**
 * Talk: ZOO talking, with up to 4 bullets that appear on their word timings. ZOO points at the first bullet (and the
 * last of three or more) in landscape; other bullets get a 2-frame eye dart. The newest bullet is the dark card, so
 * the eye lands on the point being made; earlier bullets turn light.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, OUTLINE, R} from '../theme';
import {LAYOUTS, type Box} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import {CharacterLayer, entry, SceneBg, useDirection, type SceneCtx} from './parts';
import {BadgerInsert, inInsert} from './Insert';
import {list, str} from '../validate';

/** Stack heights (pure, shared with the fit test): each card is its text plus padding; cards are `gap` apart. */
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

export const TalkScene: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const frame = useCurrentFrame();
	const L = LAYOUTS.talk[ctx.format];
	const vertical = ctx.format === 'vertical';
	const badgerPlace = ctx.sc.badger?.present ? L.badger : null;
	const dir = useDirection(ctx, {zooView: 'front', badgerPlace, badgerInsert: vertical});
	const bullets = (list(ctx.sc, 'bullets') ?? []).slice(0, 4);
	const title = str(ctx.sc, 'title') ?? '';
	const titleFit = useFit(title, L.title, ctx.lang);
	// one fit per bullet (hooks need a fixed count: always 4)
	const fits = [0, 1, 2, 3].map((i) => useFit(bullets[i] ?? '', L.item, ctx.lang)); // eslint-disable-line react-hooks/rules-of-hooks
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;

	const stack = stackCards(
		bullets.map((_, i) => fits[i].height),
		L.itemPad.y,
		L.gap,
	);
	const listBox: Box = title ? L.list : {...L.list, y: L.title.box.y, h: L.list.h + (L.list.y - L.title.box.y)};
	if (stack.total > listBox.h + 0.5) throw new Error(`talk ${ctx.sc.id}: ${bullets.length} bullets need ${stack.total}px but the list has ${listBox.h}px; shorten them`);
	// centre the stack in the list area (landscape) / top-align (vertical, nearer the title)
	const y0 = vertical ? listBox.y : Math.round(listBox.y + (listBox.h - stack.total) / 2);
	const revealed = dir.reveals.filter((r) => frame >= r).length;
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			{title ? <Lines fit={titleFit} spec={L.title} lang={ctx.lang} color={C.ink} style={{clipPath: `inset(0 ${(1 - entry(frame, 2, 12)) * 100}% 0 0)`}} /> : null}
			{bullets.map((b, i) => {
				const at = dir.reveals[i] ?? 0;
				const p = entry(frame, at, 9);
				if (p <= 0) return null;
				const active = i === revealed - 1;
				const box: Box = {x: listBox.x, y: y0 + stack.tops[i], w: listBox.w, h: stack.heights[i]};
				const fill = active ? C.slate : C.card;
				const ink = active ? C.onDark : C.ink;
				const textBox: Box = {x: L.itemPad.x + L.marker, y: L.itemPad.y, w: L.item.box.w, h: Math.ceil(fits[i].height)}; // relative to the card
				const m = Math.round(L.marker * 0.4);
				const firstLine = fits[i].fontSize * L.item.lineHeight;
				return (
					<div
						key={i}
						style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, transform: `translateX(${(1 - p) * 30}px)`}}
					>
						<div style={{position: 'absolute', inset: 0, boxSizing: 'border-box', backgroundColor: fill, border: `${OUTLINE}px solid ${C.ink}`, borderRadius: R.l}} />
						<div style={{position: 'absolute', left: L.itemPad.x, top: Math.round(L.itemPad.y + firstLine / 2 - m / 2), width: m, height: m, backgroundColor: C.teal, borderRadius: R.s}} />
						<Lines fit={fits[i]} spec={L.item} lang={ctx.lang} color={ink} box={textBox} />
					</div>
				);
			})}
		</SceneBg>
	);
};
