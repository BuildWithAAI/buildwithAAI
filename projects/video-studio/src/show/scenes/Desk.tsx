/**
 * Desk: plain desk talk, the fallback for scenes without a segment (any news storyboard renders in the show format).
 * With a title, bullets, steps or a quote: Zoo's single with a card. Without: the wide two-shot.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {boxesOf, CardIn, SceneSource, SceneStage, type SceneCtx} from './common';
import {HeaderRow} from './cards';
import {list, str} from '../segments';
import {Card, enter} from '../graphics/parts';
import {FitText, t} from '../graphics/text';
import {G, R} from '../graphics/theme';

export const Desk: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const {sc, lang, format} = ctx;
	const frame = useCurrentFrame();
	const plan = ctx.plan.scenes[ctx.k];
	if (!plan.hasCard)
		return (
			<>
				<SceneStage ctx={ctx} />
				<HeaderRow ctx={ctx} />
			</>
		);
	const card = boxesOf(ctx).card!;
	const land = format === 'landscape';
	const pad = land ? 40 : 28;
	const title = str(sc, 'title');
	const quote = str(sc, 'quote');
	const items = list(sc, 'bullets').length ? list(sc, 'bullets') : list(sc, 'steps');
	const titleH = title ? (land ? 170 : 100) : 0;
	const top = card.y + pad + titleH + (title ? 16 : 0);
	const avail = card.y + card.h - pad - top;
	const rowH = items.length ? avail / Math.max(items.length, land ? 4 : 3) : 0;
	return (
		<>
			<SceneStage ctx={ctx} />
			<CardIn ctx={ctx} box={card} at={plan.reveals.card}>
				<Card box={card} />
				{title ? <FitText text={title} spec={land ? t('heading', 900, 60, 36, 2, 1.08, {balance: true}) : t('heading', 900, 44, 30, 2, 1.08)} lang={lang} box={{x: card.x + pad, y: card.y + pad, w: card.w - 2 * pad, h: titleH}} color={G.ink} valign="center" what={`${sc.id} title`} /> : null}
				{quote ? <FitText text={`“${quote}”`} spec={t('heading', 800, land ? 48 : 36, 28, 5, 1.15)} lang={lang} box={{x: card.x + pad, y: top, w: card.w - 2 * pad, h: avail - 50}} color={G.ink} what={`${sc.id} quote`} /> : null}
				{quote && str(sc, 'attribution') ? <FitText text={`— ${str(sc, 'attribution')}`} spec={t('body', 700, 30, 24, 1, 1.0)} lang={lang} box={{x: card.x + pad, y: card.y + card.h - pad - 40, w: card.w - 2 * pad, h: 40}} color={G.inkMuted} align="right" what={`${sc.id} attribution`} /> : null}
				{items.map((item, i) => {
					const p = enter(frame, plan.reveals.items[i] ?? 10 + i * 14, 8);
					if (p <= 0) return null;
					const y = top + i * rowH;
					return (
						<div key={i} style={{position: 'absolute', inset: 0, clipPath: p >= 1 ? undefined : `inset(0 ${(1 - p) * 100}% 0 0)`}}>
							<div style={{position: 'absolute', left: card.x + pad, top: y + rowH / 2 - 9, width: 18, height: 18, backgroundColor: G.slate, borderRadius: R.s}} />
							<FitText text={item} spec={t('body', 700, land ? 40 : 32, 24, 2, 1.12)} lang={lang} box={{x: card.x + pad + 36, y, w: card.w - 2 * pad - 36, h: rowH}} color={G.ink} valign="center" what={`${sc.id} bullet ${i + 1}`} />
						</div>
					);
				})}
			</CardIn>
			<SceneSource ctx={ctx} />
			<HeaderRow ctx={ctx} />
		</>
	);
};
