/**
 * OutroEndScreen. Landscape (ShowEpisode): both hosts at the desk on the left, the end-screen guide zones on a slate
 * panel on the right, where YouTube's end-screen elements go in the last 5-20 s: the evergreen explainer every news
 * video links to (slot 1), the latest brief (slot 2) and the subscribe circle. The zones carry their labels so the
 * frame still reads on platforms without end screens.
 * Vertical (ShowShort): a card naming the explainer and pointing down to the Short's related-video link.
 */
import React from 'react';
import {boxesOf, SceneStage, type SceneCtx} from './common';
import {HeaderRow, PanelCard, Pill} from './cards';
import {str} from '../segments';
import {FitText, t} from '../graphics/text';
import {G, OUTLINE, R} from '../graphics/theme';
import {END_ZONES} from '../layout/boxes';
import {showLabel} from '../ui';

const DownArrow: React.FC<{x: number; y: number; size: number}> = ({x, y, size}) => (
	<svg width={size} height={size} viewBox="0 0 100 100" style={{position: 'absolute', left: x, top: y}}>
		<path d="M 50 10 V 70" stroke={G.ink} strokeWidth={12} strokeLinecap="round" />
		<path d="M 22 56 L 50 88 L 78 56 Z" fill={G.ink} stroke={G.ink} strokeWidth={6} strokeLinejoin="round" />
	</svg>
);

export const OutroEndScreen: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const {sc, sb, lang, format} = ctx;
	const card = boxesOf(ctx).card!;
	// the end-screen card is at its final layout from the cut: a slide-in would cross the header row (and the
	// DEVELOPING badge) for its first frames
	const explainer = str(sc, 'explainer') ?? '';
	const title = str(sc, 'title');
	if (format === 'vertical') {
		const pad = 30;
		return (
			<>
				<SceneStage ctx={ctx} />
				<>
					<PanelCard box={card} lang={lang} format={format}>
						<Pill text={showLabel(sb, 'explainer')} x={card.x + pad} y={card.y + pad} lang={lang} h={44} tone="slate" />
						<FitText text={explainer} spec={t('heading', 900, 60, 34, 3, 1.08, {balance: true})} lang={lang} box={{x: card.x + pad, y: card.y + pad + 60, w: card.w - 2 * pad, h: card.h - 2 * pad - 60 - 70}} color={G.ink} valign="center" what="outro explainer" />
						<DownArrow x={card.x + pad} y={card.y + card.h - pad - 56} size={56} />
						<FitText text={showLabel(sb, 'linkedBelow')} spec={t('heading', 800, 36, 24, 1, 1.0)} lang={lang} box={{x: card.x + pad + 70, y: card.y + card.h - pad - 56, w: card.w - 2 * pad - 70, h: 56}} color={G.ink} valign="center" what="outro linked below" />
					</PanelCard>
				</>
				<HeaderRow ctx={ctx} />
			</>
		);
	}
	const [s1, s2] = END_ZONES.slots;
	const sub = END_ZONES.subscribe;
	const zone = (b: {x: number; y: number; w: number; h: number}) => ({position: 'absolute' as const, left: b.x, top: b.y, width: b.w, height: b.h, boxSizing: 'border-box' as const, border: `${OUTLINE}px solid ${G.silver}`, borderRadius: R.m, backgroundColor: G.slate});
	return (
		<>
			<SceneStage ctx={ctx} />
			{title ? <FitText text={title} spec={t('heading', 900, 60, 36, 2, 1.08, {balance: true})} lang={lang} box={{x: 96, y: 70, w: 880, h: 180}} color={G.ink} valign="center" what="outro line" /> : null}
			<>
				<div style={{position: 'absolute', left: card.x, top: card.y, width: card.w, height: card.h, backgroundColor: G.slate, border: `${OUTLINE}px solid ${G.ink}`, borderRadius: R.l, boxSizing: 'border-box'}} />
				<FitText text={`${showLabel(sb, 'explainer')}: ${explainer}`} spec={t('heading', 800, 34, 24, 1, 1.0, {ellipsis: true})} lang={lang} box={{x: s1.x, y: s1.y - 62, w: s1.w, h: 50}} color={G.onDark} valign="bottom" what="end screen explainer label" />
				<div data-zone="endscreen-video" style={zone(s1)} />
				<FitText text={explainer} spec={t('heading', 900, 52, 30, 3, 1.1, {balance: true})} lang={lang} box={{x: s1.x + 40, y: s1.y + 40, w: s1.w - 80, h: s1.h - 80}} color={G.onDark} align="center" valign="center" what="end screen explainer title" />
				<FitText text={showLabel(sb, 'latest')} spec={t('heading', 800, 30, 24, 1, 1.0)} lang={lang} box={{x: s2.x, y: s2.y - 52, w: s2.w, h: 44}} color={G.onDarkMuted} valign="bottom" what="end screen latest label" />
				<div data-zone="endscreen-video" style={zone(s2)} />
				<div data-zone="endscreen-subscribe" style={{position: 'absolute', left: sub.cx - sub.r, top: sub.cy - sub.r, width: 2 * sub.r, height: 2 * sub.r, borderRadius: sub.r, boxSizing: 'border-box', border: `${OUTLINE}px solid ${G.silver}`, backgroundColor: G.slate}} />
				<FitText text={showLabel(sb, 'subscribe')} spec={t('heading', 800, 28, 24, 1, 1.0)} lang={lang} box={{x: sub.cx - 120, y: sub.cy + sub.r + 10, w: 240, h: 40}} color={G.onDarkMuted} align="center" what="end screen subscribe label" />
			</>
			<HeaderRow ctx={ctx} />
		</>
	);
};
