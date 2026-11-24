/**
 * ZooOneFix: one actionable safety tip on a card. Landscape: Zoo on the left gestures to the card on the right as it
 * lands. Vertical: Zoo's single under the card. The tip and its one-line reason are centred as one block.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {boxesOf, CardIn, SceneSource, SceneStage, type SceneCtx} from './common';
import {HeaderRow, headerSpace, PanelCard} from './cards';
import {str} from '../segments';
import {FitText, t, useFit} from '../graphics/text';
import {G} from '../graphics/theme';
import {ShieldCheck} from '../graphics/glyphs';
import {enter} from '../graphics/parts';

export const ZooOneFix: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const {sc, lang, format} = ctx;
	const frame = useCurrentFrame();
	const card = boxesOf(ctx).card!;
	const r = ctx.plan.scenes[ctx.k].reveals;
	const land = format === 'landscape';
	const title = str(sc, 'title');
	const head = headerSpace(title, format);
	const pad = land ? 48 : 32;
	const glyph = land ? 140 : 104;
	const gap = land ? 36 : 26;
	const detail = str(sc, 'detail');
	const inner = {x: card.x + pad, y: card.y + head + pad, w: card.w - 2 * pad, h: card.h - head - 2 * pad};
	const tw = inner.w - glyph - gap;
	const fixSpec = land ? t('heading', 900, 68, 40, 4, 1.1, {balance: true}) : t('heading', 900, 50, 32, 3, 1.1, {balance: true});
	const detailSpec = land ? t('body', 600, 40, 26, 3, 1.18) : t('body', 600, 32, 24, 2, 1.15);
	const fixMax = detail ? inner.h * 0.64 : inner.h;
	const fixFit = useFit(str(sc, 'fix') ?? '', fixSpec, lang, tw, fixMax, `${sc.id} fix`);
	const detailFit = useFit(detail ?? '', detailSpec, lang, tw, inner.h - fixFit.height - 20, `${sc.id} fix detail`);
	const block = fixFit.height + (detail ? 20 + detailFit.height : 0);
	const top = inner.y + Math.max(0, (inner.h - block) / 2);
	const detailP = detail ? enter(frame, r.items[0] ?? r.card + 14, 8) : 0;
	return (
		<>
			<SceneStage ctx={ctx} />
			<CardIn ctx={ctx} box={card} at={r.card}>
				<PanelCard box={card} title={title} lang={lang} format={format}>
					<ShieldCheck x={inner.x} y={top + Math.max(0, Math.min(fixFit.height, glyph) - glyph) / 2} size={glyph} />
					<FitText text={str(sc, 'fix') ?? ''} spec={fixSpec} lang={lang} box={{x: inner.x + glyph + gap, y: top, w: tw, h: Math.ceil(fixFit.height)}} color={G.ink} what={`${sc.id} fix`} />
					{detail && detailP > 0 ? (
						<div style={{position: 'absolute', inset: 0, clipPath: detailP >= 1 ? undefined : `inset(0 ${(1 - detailP) * 100}% 0 0)`}}>
							<FitText text={detail} spec={detailSpec} lang={lang} box={{x: inner.x + glyph + gap, y: top + fixFit.height + 20, w: tw, h: Math.ceil(detailFit.height) + 2}} color={G.inkMuted} what={`${sc.id} fix detail`} />
						</div>
					) : null}
				</PanelCard>
			</CardIn>
			<SceneSource ctx={ctx} />
			<HeaderRow ctx={ctx} />
		</>
	);
};
