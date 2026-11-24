/**
 * Hook: a bold title card plus ZOO's reaction. The text block (kicker pill, display title, small teal rule, subtitle) is
 * centred in its column and enters line by line; ZOO reacts once the title has landed (a brow lift, or a swap to the
 * storyboard expression on a blink). Badger, if present, shares the frame (landscape) or cuts in (vertical).
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, R} from '../theme';
import {FRAME, LAYOUTS, type Box} from '../layout/specs';
import {hookBlock, RULE_H} from '../layout/blocks';
import {Lines, useFit} from '../text/FitText';
import {CharacterLayer, entry, RiseClip, SceneBg, useDirection, type SceneCtx} from './parts';
import {BadgerInsert, inInsert} from './Insert';
import {str} from '../validate';

export const HookScene: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const frame = useCurrentFrame();
	const L = LAYOUTS.hook[ctx.format];
	const vertical = ctx.format === 'vertical';
	const badgerPlace = ctx.sc.badger?.present ? L.badger : null;
	const dir = useDirection(ctx, {zooView: 'front', badgerPlace, badgerInsert: vertical});
	const kicker = str(ctx.sc, 'kicker') ?? '';
	const subtitle = (L.subtitle && str(ctx.sc, 'subtitle')) || '';
	const kFit = useFit(kicker, L.kicker, ctx.lang);
	const tFit = useFit(str(ctx.sc, 'title') ?? '', L.title, ctx.lang);
	const sFit = useFit(subtitle, L.subtitle ?? L.kicker, ctx.lang);
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;

	// vertical rhythm: kicker, title, rule, subtitle, centred in the text column
	const g = hookBlock(L.column, {kicker: kicker ? L.kicker.box.h : 0, title: tFit.height, subtitle: subtitle ? sFit.height : 0});
	if (!g.fits) throw new Error(`hook ${ctx.sc.id}: the title block needs ${g.height}px; the column has ${L.column.bottom - L.column.top}px. Shorten the title.`);
	const kBox: Box = {...L.kicker.box, y: g.kickerY};
	const tBox: Box = {...L.title.box, y: g.titleY, h: Math.ceil(tFit.height)};
	const rule: Box = {x: vertical ? Math.round(FRAME.vertical.width / 2 - 48) : L.title.box.x, y: g.ruleY, w: 96, h: RULE_H};
	const sBox: Box | null = L.subtitle ? {...L.subtitle.box, y: g.subtitleY, h: Math.ceil(sFit.height)} : null;

	const lineH = tFit.fontSize * tFit.lineHeight;
	const pillW = Math.ceil(kFit.width) + 2 * 24;
	const pillX = vertical ? Math.round(540 - pillW / 2) : kBox.x;
	const pk = entry(frame, 2, 8);
	const ruleP = entry(frame, 6 + 4 * tFit.lines.length, 10);
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			{kicker ? (
				<div style={{position: 'absolute', left: pillX, top: kBox.y, width: pillW, height: kBox.h, overflow: 'hidden', clipPath: `inset(0 ${(1 - pk) * 100}% 0 0)`}}>
					<div style={{position: 'absolute', inset: 0, backgroundColor: C.slate, borderRadius: R.m}} />
					<Lines fit={kFit} spec={{...L.kicker, align: 'center', valign: 'center'}} lang={ctx.lang} color={C.onDark} box={{x: 0, y: 0, w: pillW, h: kBox.h}} />
				</div>
			) : null}
			{tFit.lines.map((_, i) => {
				const lb: Box = {x: tBox.x, y: Math.round(tBox.y + i * lineH), w: tBox.w, h: Math.ceil(lineH) + 8};
				return (
					<RiseClip key={i} box={lb} p={entry(frame, 4 + 4 * i, 10)}>
						<Lines fit={{...tFit, lines: [tFit.lines[i]], height: lineH}} spec={{...L.title, valign: 'top'}} lang={ctx.lang} color={C.ink} box={{...lb, h: Math.ceil(lineH)}} />
					</RiseClip>
				);
			})}
			<div style={{position: 'absolute', left: rule.x, top: rule.y, width: rule.w * ruleP, height: rule.h, backgroundColor: C.teal}} />
			{sBox && subtitle ? (
				<RiseClip box={{...sBox, h: sBox.h + 8}} p={entry(frame, 10 + 4 * tFit.lines.length, 10)}>
					<Lines fit={sFit} spec={L.subtitle!} lang={ctx.lang} color={C.inkMuted} box={sBox} />
				</RiseClip>
			) : null}
		</SceneBg>
	);
};
