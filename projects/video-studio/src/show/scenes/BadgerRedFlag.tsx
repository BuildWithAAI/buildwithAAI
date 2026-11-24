/**
 * BadgerRedFlag: Badger's close-up. He judges as the card naming the warning sign lands, and closes with a slow blink.
 * Zoo is the voice over it. The flag glyph is near-black, not red (graphics/glyphs.tsx: ART_GUIDE CV5).
 */
import React from 'react';
import {boxesOf, CardIn, SceneSource, SceneStage, type SceneCtx} from './common';
import {HeaderRow, headerSpace, PanelCard} from './cards';
import {str} from '../segments';
import {FitText, t} from '../graphics/text';
import {G} from '../graphics/theme';
import {FlagGlyph} from '../graphics/glyphs';

export const BadgerRedFlag: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const {sc, lang, format} = ctx;
	const card = boxesOf(ctx).card!;
	const r = ctx.plan.scenes[ctx.k].reveals;
	const land = format === 'landscape';
	const title = str(sc, 'title');
	const head = headerSpace(title, format);
	const pad = land ? 48 : 32;
	const glyph = land ? 170 : 130;
	const gap = land ? 36 : 26;
	const inner = {x: card.x + pad, y: card.y + head + pad, w: card.w - 2 * pad, h: card.h - head - 2 * pad};
	return (
		<>
			<SceneStage ctx={ctx} />
			<CardIn ctx={ctx} box={card} at={r.card}>
				<PanelCard box={card} title={title} lang={lang} format={format}>
					<FlagGlyph x={inner.x} y={inner.y + (inner.h - glyph) / 2} size={glyph} />
					<FitText
						text={str(sc, 'flag') ?? ''}
						spec={land ? t('heading', 900, 74, 40, 5, 1.1, {balance: true}) : t('heading', 900, 56, 32, 5, 1.1, {balance: true})}
						lang={lang}
						box={{x: inner.x + glyph + gap, y: inner.y, w: inner.w - glyph - gap, h: inner.h}}
						color={G.ink}
						valign="center"
						what={`${sc.id} red flag`}
					/>
				</PanelCard>
			</CardIn>
			<SceneSource ctx={ctx} />
			<HeaderRow ctx={ctx} />
		</>
	);
};
