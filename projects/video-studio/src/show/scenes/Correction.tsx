/**
 * Correction: the pinned correction card (owner rule: pin corrections). A pushpin and the date, what we said (struck
 * through) and what is correct, with its source and where in the earlier video it applies. Zoo is a little worried
 * here (perf/plan.ts DEFAULT_EXPRESSION), never flippant: accuracy comes first.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {boxesOf, CardIn, SceneSource, SceneStage, type SceneCtx} from './common';
import {HeaderRow, PanelCard, Pill} from './cards';
import {str} from '../segments';
import {FitText, t, useFit} from '../graphics/text';
import {enter} from '../graphics/parts';
import {G} from '../graphics/theme';
import {Pushpin} from '../graphics/glyphs';
import {showLabel} from '../ui';
import {fontFor} from '../../episode/i18n/fonts';
import type {TextSpec} from '../graphics/text';

/** Struck-through text: the fitted lines with a near-black rule through each one (no opacity, P1). */
const Struck: React.FC<{text: string; box: {x: number; y: number; w: number; h: number}; lang: SceneCtx['lang']; spec: TextSpec}> = ({text, box, lang, spec}) => {
	const fit = useFit(text, spec, lang, box.w, box.h, 'correction: what we said');
	const font = fontFor(lang, spec.role, spec.weight);
	const lh = fit.fontSize * fit.lineHeight;
	return (
		<div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h}}>
			{fit.lines.map((line, i) => (
				<div
					key={i}
					style={{
						position: 'absolute',
						left: 0,
						top: i * lh,
						height: lh,
						lineHeight: `${lh}px`,
						fontFamily: font.fontFamily,
						fontWeight: font.fontWeight,
						fontSize: fit.fontSize,
						color: G.inkMuted,
						whiteSpace: 'pre',
						textDecoration: 'line-through',
						textDecorationThickness: Math.max(3, Math.round(fit.fontSize / 11)),
						textDecorationColor: G.ink,
					}}
				>
					{line}
				</div>
			))}
		</div>
	);
};

export const Correction: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const {sc, sb, lang, format} = ctx;
	const frame = useCurrentFrame();
	const card = boxesOf(ctx).card!;
	const r = ctx.plan.scenes[ctx.k].reveals;
	const land = format === 'landscape';
	const pad = land ? 48 : 30;
	const wrong = str(sc, 'wrong');
	const ref = str(sc, 'ref');
	const date = str(sc, 'date') ?? '';
	const dateH = land ? 44 : 36;
	const labelH = land ? 50 : 40;
	const inner = {x: card.x + pad, y: card.y + pad + dateH + (land ? 22 : 12), w: card.w - 2 * pad, h: card.h - 2 * pad - dateH - (land ? 22 : 12) - (ref ? 44 : 0)};
	const wrongSpec = land ? t('body', 600, 46, 28, 3, 1.18) : t('body', 600, 32, 24, 2, 1.15);
	const correctSpec = land ? t('heading', 900, 60, 34, 4, 1.1) : t('heading', 900, 38, 26, 3, 1.1);
	const wrongFit = useFit(wrong ?? '', wrongSpec, lang, inner.w, inner.h * 0.4, `${sc.id} correction: what we said`);
	const wrongH = wrong ? Math.ceil(wrongFit.height) : 0;
	const correctY = inner.y + (wrong ? labelH + 10 + wrongH + (land ? 34 : 14) : 0);
	const pWrong = wrong ? enter(frame, r.items[0] ?? r.card + 8, 8) : 0;
	const pCorrect = enter(frame, r.items[wrong ? 1 : 0] ?? r.card + 20, 8);
	return (
		<>
			<SceneStage ctx={ctx} />
			<CardIn ctx={ctx} box={card} at={r.card}>
				<PanelCard box={card} lang={lang} format={format}>
					<FitText text={date} spec={t('heading', 800, land ? 34 : 28, 24, 1, 1.0)} lang={lang} box={{x: card.x + pad + (land ? 64 : 52), y: card.y + pad, w: card.w - 2 * pad - 64, h: dateH}} color={G.inkMuted} valign="center" what={`${sc.id} correction date`} />
					{wrong && pWrong > 0 ? (
						<div style={{position: 'absolute', inset: 0, clipPath: pWrong >= 1 ? undefined : `inset(0 ${(1 - pWrong) * 100}% 0 0)`}}>
							<Pill text={showLabel(sb, 'weSaid')} x={inner.x} y={inner.y} lang={lang} h={labelH} tone="light" />
							<Struck text={wrong} box={{x: inner.x, y: inner.y + labelH + 10, w: inner.w, h: wrongH + 2}} lang={lang} spec={wrongSpec} />
						</div>
					) : null}
					{pCorrect > 0 ? (
						<div style={{position: 'absolute', inset: 0, clipPath: pCorrect >= 1 ? undefined : `inset(0 ${(1 - pCorrect) * 100}% 0 0)`}}>
							<Pill text={showLabel(sb, 'correct')} x={inner.x} y={correctY} lang={lang} h={labelH} />
							<FitText text={str(sc, 'correct') ?? ''} spec={correctSpec} lang={lang} box={{x: inner.x, y: correctY + labelH + 10, w: inner.w, h: inner.y + inner.h - (correctY + labelH + 10)}} color={G.ink} what={`${sc.id} correction`} />
						</div>
					) : null}
					{ref ? <FitText text={ref} spec={t('body', 600, 28, 24, 1, 1.0, {ellipsis: true})} lang={lang} box={{x: inner.x, y: card.y + card.h - pad - 34, w: inner.w, h: 34}} color={G.inkMuted} what={`${sc.id} correction ref`} /> : null}
				</PanelCard>
				<Pushpin x={card.x + pad - 14} y={card.y + pad - 8} size={land ? 64 : 52} />
			</CardIn>
			<SceneSource ctx={ctx} />
			<HeaderRow ctx={ctx} />
		</>
	);
};
