/**
 * Steps: numbered steps revealed on their word timings. Slate number badges joined by a silver rail that grows as the
 * steps arrive; the current step's text is full ink, earlier ones muted. ZOO glances toward each new step.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, OUTLINE} from '../theme';
import {LAYOUTS, type Box} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import {fontFor} from '../i18n/fonts';
import {CharacterLayer, entry, SceneBg, useDirection, type SceneCtx} from './parts';
import {BadgerInsert, inInsert} from './Insert';
import {list, str} from '../validate';

/** Row layout (pure, shared with the fit test): each row is max(badge, text) tall, rows `gap` apart. */
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

export const StepsScene: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const frame = useCurrentFrame();
	const L = LAYOUTS.steps[ctx.format];
	const vertical = ctx.format === 'vertical';
	const badgerPlace = ctx.sc.badger?.present ? L.badger : null;
	const dir = useDirection(ctx, {zooView: 'front', badgerPlace, badgerInsert: vertical});
	const steps = (list(ctx.sc, 'steps') ?? []).slice(0, 5);
	const title = str(ctx.sc, 'title') ?? '';
	const titleFit = useFit(title, L.title, ctx.lang);
	const fits = [0, 1, 2, 3, 4].map((i) => useFit(steps[i] ?? '', L.item, ctx.lang)); // eslint-disable-line react-hooks/rules-of-hooks
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;

	const rows = stackRows(
		steps.map((_, i) => fits[i].height),
		L.badge,
		L.gap,
	);
	const listBox: Box = title ? L.list : {...L.list, y: L.title.box.y, h: L.list.h + (L.list.y - L.title.box.y)};
	if (rows.total > listBox.h + 0.5) throw new Error(`steps ${ctx.sc.id}: ${steps.length} steps need ${rows.total}px but the list has ${listBox.h}px; shorten them`);
	const y0 = vertical ? listBox.y : Math.round(listBox.y + (listBox.h - rows.total) / 2);
	const revealed = dir.reveals.filter((r) => frame >= r).length;
	const num = fontFor(ctx.lang, 'heading', 900);
	const cx = listBox.x + L.badge / 2;
	const rowCenter = (i: number) => y0 + rows.tops[i] + Math.min(rows.heights[i], L.badge) / 2;
	// the rail grows from badge to badge as steps arrive
	const railTo = (() => {
		if (revealed < 2) return null;
		const i = revealed - 1;
		const p = entry(frame, dir.reveals[i], 10);
		return rowCenter(i - 1) + (rowCenter(i) - rowCenter(i - 1)) * p;
	})();
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			{title ? <Lines fit={titleFit} spec={L.title} lang={ctx.lang} color={C.ink} style={{clipPath: `inset(0 ${(1 - entry(frame, 2, 12)) * 100}% 0 0)`}} /> : null}
			{railTo !== null ? <div style={{position: 'absolute', left: cx - 3, top: rowCenter(0), width: 6, height: railTo - rowCenter(0), backgroundColor: C.silver}} /> : null}
			{steps.map((s, i) => {
				const at = dir.reveals[i] ?? 0;
				const p = entry(frame, at, 9);
				if (p <= 0) return null;
				const top = y0 + rows.tops[i];
				const textBox: Box = {x: listBox.x + L.badge + 26, y: Math.round(top + (rows.heights[i] - fits[i].height) / 2), w: L.item.box.w, h: Math.ceil(fits[i].height)};
				const current = i === revealed - 1;
				const scale = 0.7 + 0.3 * p;
				return (
					<React.Fragment key={i}>
						<div
							style={{
								position: 'absolute',
								left: listBox.x,
								top: Math.round(rowCenter(i) - L.badge / 2),
								width: L.badge,
								height: L.badge,
								boxSizing: 'border-box',
								borderRadius: L.badge / 2,
								backgroundColor: C.slate,
								border: `${OUTLINE}px solid ${C.ink}`,
								transform: `scale(${scale})`,
								color: C.onDark,
								fontFamily: num.fontFamily,
								fontWeight: num.fontWeight,
								fontSize: Math.round(L.badge * 0.5),
								lineHeight: `${L.badge - 2 * OUTLINE}px`,
								textAlign: 'center',
							}}
						>
							{String(i + 1)}
						</div>
						<div style={{position: 'absolute', inset: 0, clipPath: `inset(0 ${Math.max(0, 1920 - (textBox.x + textBox.w * p + 8))}px 0 0)`}}>
							<Lines fit={fits[i]} spec={L.item} lang={ctx.lang} color={current ? C.ink : C.inkMuted} box={textBox} />
						</div>
					</React.Fragment>
				);
			})}
		</SceneBg>
	);
};
