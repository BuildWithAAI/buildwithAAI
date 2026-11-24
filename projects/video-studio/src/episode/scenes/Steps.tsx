/**
 * Steps: numbered steps revealed on their word timings. Slate number badges joined by a silver rail that grows as the
 * steps arrive; the current step's text is full ink, earlier ones muted. ZOO glances toward each new step. Title and
 * list form one block, centred in the text column of either format.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, OUTLINE} from '../theme';
import {LAYOUTS, type Box} from '../layout/specs';
import {Lines, useFit, useFitGroup} from '../text/FitText';
import {fontFor} from '../i18n/fonts';
import {CharacterLayer, entry, SceneBg, useDirection, type SceneCtx} from './parts';
import {BadgerInsert, inInsert} from './Insert';
import {list, str} from '../validate';
import {placeBlock, stackRows} from '../layout/blocks';

export const StepsScene: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const frame = useCurrentFrame();
	const L = LAYOUTS.steps[ctx.format];
	const vertical = ctx.format === 'vertical';
	const badgerPlace = ctx.sc.badger?.present ? L.badger : null;
	const dir = useDirection(ctx, {zooView: 'front', badgerPlace, badgerInsert: vertical});
	const steps = (list(ctx.sc, 'steps') ?? []).slice(0, 5);
	const title = str(ctx.sc, 'title') ?? '';
	const titleFit = useFit(title, L.title, ctx.lang);
	// all steps at one size, shrunk together until title + list fit the column
	const titleH = title ? titleFit.height : 0;
	const fits = useFitGroup(
		steps,
		L.item,
		ctx.lang,
		(rs) =>
			placeBlock(
				L.column,
				titleH,
				stackRows(
					rs.map((r) => r.height),
					L.badge,
					L.gap,
				).total,
			).fits,
		`steps ${ctx.sc.id}`,
	);
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;

	const rows = stackRows(
		fits.map((r) => r.height),
		L.badge,
		L.gap,
	);
	const block = placeBlock(L.column, titleH, rows.total);
	const y0 = block.listY;
	const revealed = dir.reveals.filter((r) => frame >= r).length;
	const num = fontFor(ctx.lang, 'heading', 900);
	const cx = L.list.x + L.badge / 2;
	const rowCenter = (i: number) => y0 + rows.tops[i] + rows.heights[i] / 2;
	// the rail grows from badge to badge as steps arrive
	const railTo = (() => {
		if (revealed < 2) return null;
		const i = revealed - 1;
		const p = entry(frame, dir.reveals[i], 10);
		return rowCenter(i - 1) + (rowCenter(i) - rowCenter(i - 1)) * p;
	})();
	const titleBox: Box = {...L.title.box, y: block.titleY, h: Math.ceil(titleFit.height)};
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			{title ? <Lines fit={titleFit} spec={L.title} lang={ctx.lang} color={C.ink} box={titleBox} style={{clipPath: `inset(0 ${(1 - entry(frame, 2, 12)) * 100}% 0 0)`}} /> : null}
			{railTo !== null ? <div style={{position: 'absolute', left: cx - 3, top: rowCenter(0), width: 6, height: railTo - rowCenter(0), backgroundColor: C.silver}} /> : null}
			{steps.map((s, i) => {
				const at = dir.reveals[i] ?? 0;
				const p = entry(frame, at, 9);
				if (p <= 0) return null;
				const textBox: Box = {x: L.list.x + L.badge + 26, y: Math.round(rowCenter(i) - fits[i].height / 2), w: L.item.box.w, h: Math.ceil(fits[i].height)};
				const current = i === revealed - 1;
				return (
					<React.Fragment key={s + i}>
						<div
							style={{
								position: 'absolute',
								left: L.list.x,
								top: Math.round(rowCenter(i) - L.badge / 2),
								width: L.badge,
								height: L.badge,
								boxSizing: 'border-box',
								borderRadius: L.badge / 2,
								backgroundColor: C.slate,
								border: `${OUTLINE}px solid ${C.ink}`,
								transform: `scale(${0.7 + 0.3 * p})`,
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
						<div style={{position: 'absolute', left: textBox.x, top: textBox.y - 8, width: textBox.w, height: textBox.h + 16, overflow: 'hidden', clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`}}>
							<Lines fit={fits[i]} spec={L.item} lang={ctx.lang} color={current ? C.ink : C.inkMuted} box={{x: 0, y: 8, w: textBox.w, h: textBox.h}} />
						</div>
					</React.Fragment>
				);
			})}
		</SceneBg>
	);
};
