/**
 * Talk: ZOO talking, with up to 4 bullets that appear on their word timings. ZOO points at the first bullet (and the
 * last of three or more) in landscape; other bullets get a 2-frame eye dart. The newest bullet is the dark card, so
 * the eye lands on the point being made; earlier bullets turn light. Title and list form one block, centred in the
 * text column of either format.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, OUTLINE, R} from '../theme';
import {LAYOUTS, type Box} from '../layout/specs';
import {Lines, useFit, useFitGroup} from '../text/FitText';
import {CharacterLayer, entry, SceneBg, useDirection, type SceneCtx} from './parts';
import {BadgerInsert, inInsert} from './Insert';
import {list, str} from '../validate';
import {placeBlock, stackCards} from '../layout/blocks';
import {useLowerThird} from './Overlays';

export const TalkScene: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const frame = useCurrentFrame();
	const L = LAYOUTS.talk[ctx.format];
	const vertical = ctx.format === 'vertical';
	const badgerPlace = ctx.sc.badger?.present ? L.badger : null;
	const dir = useDirection(ctx, {zooView: 'front', badgerPlace, badgerInsert: vertical});
	const bullets = (list(ctx.sc, 'bullets') ?? []).slice(0, 4);
	const title = str(ctx.sc, 'title') ?? '';
	const titleFit = useFit(title, L.title, ctx.lang);
	// a lower-third plate that reaches into the text column keeps the block above it (landscape)
	const lt = useLowerThird(ctx.format, ctx.lang, ctx.sc);
	const column = lt && lt.box.x + lt.box.w > L.list.x - 16 ? {top: L.column.top, bottom: Math.min(L.column.bottom, lt.box.y - 16)} : L.column;
	// all bullets at one size, shrunk together until title + list fit the column
	const titleH = title ? titleFit.height : 0;
	const fits = useFitGroup(
		bullets,
		L.item,
		ctx.lang,
		(rs) =>
			placeBlock(
				column,
				titleH,
				stackCards(
					rs.map((r) => r.height),
					L.itemPad.y,
					L.gap,
				).total,
			).fits,
		`talk ${ctx.sc.id}`,
	);
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;

	const stack = stackCards(
		fits.map((r) => r.height),
		L.itemPad.y,
		L.gap,
	);
	const block = placeBlock(column, titleH, stack.total);
	const revealed = dir.reveals.filter((r) => frame >= r).length;
	const titleBox: Box = {...L.title.box, y: block.titleY, h: Math.ceil(titleFit.height)};
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			{title ? <Lines fit={titleFit} spec={L.title} lang={ctx.lang} color={C.ink} box={titleBox} style={{clipPath: `inset(0 ${(1 - entry(frame, 2, 12)) * 100}% 0 0)`}} /> : null}
			{bullets.map((b, i) => {
				const at = dir.reveals[i] ?? 0;
				const p = entry(frame, at, 9);
				if (p <= 0) return null;
				const active = i === revealed - 1;
				const box: Box = {x: L.list.x, y: block.listY + stack.tops[i], w: L.list.w, h: stack.heights[i]};
				const fill = active ? C.slate : C.card;
				const ink = active ? C.onDark : C.ink;
				const textBox: Box = {x: L.itemPad.x + L.marker, y: L.itemPad.y, w: L.item.box.w, h: Math.ceil(fits[i].height)}; // relative to the card
				const m = Math.round(L.marker * 0.4);
				const firstLine = fits[i].fontSize * fits[i].lineHeight;
				return (
					<div
						key={b + i}
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
