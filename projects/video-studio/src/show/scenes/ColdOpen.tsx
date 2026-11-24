/**
 * ColdOpen: the wide shot of the set, ON AIR lights, Zoo delivers a dry one-liner to camera and Badger answers it with
 * a look (his default beat: a slow deadpan blink; a `beat` scene after it gives the punchline its own reaction shot).
 * Optional onScreen.kicker: a small slate plate (e.g. "Nov 24 · Daily brief").
 */
import React from 'react';
import {boxesOf, CardIn, SceneStage, type SceneCtx} from './common';
import {HeaderRow} from './cards';
import {str} from '../segments';
import {FitText, t} from '../graphics/text';
import {G, OUTLINE, R} from '../graphics/theme';

export const ColdOpen: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const kicker = str(ctx.sc, 'kicker');
	const card = boxesOf(ctx).card;
	const r = ctx.plan.scenes[ctx.k].reveals;
	return (
		<>
			<SceneStage ctx={ctx} />
			{kicker && card ? (
				<CardIn ctx={ctx} box={card} at={r.card}>
					<div style={{position: 'absolute', left: card.x, top: card.y, width: card.w, height: card.h, backgroundColor: G.slate, border: `${OUTLINE}px solid ${G.ink}`, borderRadius: R.m, boxSizing: 'border-box'}} />
					<FitText text={kicker} spec={t('heading', 800, 40, 26, 1, 1.0)} lang={ctx.lang} box={{x: card.x + 28, y: card.y, w: card.w - 56, h: card.h}} color={G.onDark} valign="center" what="cold open kicker" />
				</CardIn>
			) : null}
			<HeaderRow ctx={ctx} />
		</>
	);
};
