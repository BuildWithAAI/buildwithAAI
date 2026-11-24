/**
 * ScamOfTheWeek: the week's scam pattern as a "case file": its name, then up to three rows (how it works, the tell,
 * the fix), each landing on the words that say it. Landscape: a full-frame card. Vertical: the card over the two-shot.
 * The rows hold concepts and defences, never the attacker's steps (claim gate R5; validate.ts concept guard).
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {boxesOf, CardIn, SceneSource, SceneStage, type SceneCtx} from './common';
import {HeaderRow, PanelCard, Pill} from './cards';
import {str} from '../segments';
import {FitText, t, useFit} from '../graphics/text';
import {enter} from '../graphics/parts';
import {G} from '../graphics/theme';
import {showLabel, type ShowUiKey} from '../ui';

const ROWS: Array<{key: 'how' | 'tell' | 'fix'; label: ShowUiKey}> = [
	{key: 'how', label: 'howItWorks'},
	{key: 'tell', label: 'tell'},
	{key: 'fix', label: 'fix'},
];

export const ScamOfTheWeek: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const {sc, sb, lang, format} = ctx;
	const frame = useCurrentFrame();
	const card = boxesOf(ctx).card!;
	const r = ctx.plan.scenes[ctx.k].reveals;
	const land = format === 'landscape';
	const pad = land ? 56 : 30;
	const rows = ROWS.map((row) => ({...row, text: str(sc, row.key)})).filter((x): x is typeof x & {text: string} => !!x.text);
	const titleSpec = land ? t('heading', 900, 88, 48, 2, 1.06, {balance: true}) : t('heading', 900, 50, 32, 2, 1.06, {balance: true});
	const title = useFit(str(sc, 'title') ?? '', titleSpec, lang, card.w - 2 * pad, land ? 210 : 116, `${sc.id} scam title`);
	const titleH = Math.ceil(title.height);
	const rowsH = land ? Math.min(360, card.h - 2 * pad - titleH - 40) : card.h - 2 * pad - titleH - 14;
	const blockH = titleH + (rows.length ? (land ? 48 : 14) + rowsH : 0);
	const top = card.y + pad + Math.max(0, (card.h - 2 * pad - blockH) / 2);
	const rowsTop = top + titleH + (land ? 48 : 14);
	return (
		<>
			<SceneStage ctx={ctx} />
			<CardIn ctx={ctx} box={card} at={r.card}>
				<PanelCard box={card} lang={lang} format={format}>
					<FitText text={str(sc, 'title') ?? ''} spec={titleSpec} lang={lang} box={{x: card.x + pad, y: top, w: card.w - 2 * pad, h: titleH}} color={G.ink} what={`${sc.id} scam title`} />
					{rows.map((row, i) => {
						const p = enter(frame, r.items[i] ?? r.card + 20 + i * 18, 8);
						if (p <= 0) return null;
						const clip = p >= 1 ? undefined : `inset(0 ${(1 - p) * 100}% 0 0)`;
						if (land) {
							const colW = (card.w - 2 * pad - 2 * 48) / 3;
							const x = card.x + pad + i * (colW + 48);
							return (
								<div key={row.key} style={{position: 'absolute', inset: 0, clipPath: clip}}>
									<Pill text={showLabel(sb, row.label)} x={x} y={rowsTop} lang={lang} h={56} maxW={colW} tone="slate" />
									<FitText text={row.text} spec={t('body', 600, 44, 28, 5, 1.2)} lang={lang} box={{x, y: rowsTop + 80, w: colW, h: rowsH - 80}} color={G.ink} what={`${sc.id} scam ${row.key}`} />
								</div>
							);
						}
						const rowH = rowsH / Math.max(1, rows.length);
						const y = rowsTop + i * rowH;
						return (
							<div key={row.key} style={{position: 'absolute', inset: 0, clipPath: clip}}>
								<Pill text={showLabel(sb, row.label)} x={card.x + pad} y={y + (rowH - 44) / 2} lang={lang} h={44} maxW={260} tone="slate" />
								<FitText text={row.text} spec={t('body', 700, 32, 24, 2, 1.1)} lang={lang} box={{x: card.x + pad + 276, y, w: card.w - 2 * pad - 276, h: rowH - 6}} color={G.ink} valign="center" what={`${sc.id} scam ${row.key}`} />
							</div>
						);
					})}
				</PanelCard>
			</CardIn>
			<SceneSource ctx={ctx} />
			<HeaderRow ctx={ctx} />
		</>
	);
};
