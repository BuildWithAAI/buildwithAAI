/**
 * Card building blocks for the segment scenes: a card (with a slate header strip only when the scene has its own
 * title: the segment's name is already in the header row's tag), a label pill, and the header row (segment tag +
 * the persistent DEVELOPING badge, placed away from the on-camera face).
 */
import React from 'react';
import type {Lang} from '../types';
import {Card, CardHeader, DevelopingBadge, SegmentTag, type Box} from '../graphics/parts';
import {G, OUTLINE, R} from '../graphics/theme';
import {useFit} from '../graphics/text';
import {fontFor} from '../../episode/i18n/fonts';
import {headerSlots} from '../layout/boxes';
import {SEGMENT_SPECS} from '../segments';
import {showLabel} from '../ui';
import {developingOf} from '../validate';
import {formatAsOf} from '../sources';
import type {SceneCtx} from './common';

export const headerH = (format: 'landscape' | 'vertical') => (format === 'landscape' ? 84 : 72);

/** A card; with `title`, a slate header strip on top. Children are positioned in frame px. */
export const PanelCard: React.FC<{box: Box; title?: string | null; lang: Lang; format: 'landscape' | 'vertical'; children?: React.ReactNode}> = ({box, title, lang, format, children}) => (
	<>
		<Card box={box} />
		{title ? (
			<>
				<CardHeader text={title} box={{x: box.x + OUTLINE, y: box.y + OUTLINE, w: box.w - 2 * OUTLINE, h: headerH(format) - OUTLINE}} lang={lang} />
				<div style={{position: 'absolute', left: box.x, top: box.y + headerH(format) - 1, width: box.w, height: OUTLINE, backgroundColor: G.ink}} />
			</>
		) : null}
		{children}
	</>
);

/** Space the header strip takes inside a PanelCard (0 without a title). */
export const headerSpace = (title: string | null | undefined, format: 'landscape' | 'vertical') => (title ? headerH(format) : 0);

/** A small pill: near-black fill with off-white text (labels such as "We said", or the per-story DEVELOPING). */
export const Pill: React.FC<{text: string; x: number; y: number; lang: Lang; h?: number; maxW?: number; tone?: 'ink' | 'slate' | 'light'; letterSpacing?: number}> = ({
	text,
	x,
	y,
	lang,
	h = 48,
	maxW = 600,
	tone = 'ink',
	letterSpacing = 0.04,
}) => {
	const fit = useFit(text, {role: 'heading', weight: 900, maxSize: Math.round(h * 0.54), minSize: 24, maxLines: 1, lineHeight: 1, letterSpacing}, lang, maxW - 36, h, 'label pill');
	const font = fontFor(lang, 'heading', 900);
	const w = Math.ceil(fit.width + fit.fontSize * letterSpacing * Array.from(fit.text).length) + 36;
	const bg = tone === 'ink' ? G.ink : tone === 'slate' ? G.slate : G.card;
	const fg = tone === 'light' ? G.ink : G.onDark;
	const inner = h - (tone === 'light' ? 2 * OUTLINE : 0);
	return (
		<div style={{position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: R.m, backgroundColor: bg, boxSizing: 'border-box', border: tone === 'light' ? `${OUTLINE}px solid ${G.ink}` : undefined}}>
			<div style={{position: 'absolute', left: tone === 'light' ? 18 - OUTLINE : 18, top: 0, height: inner, lineHeight: `${inner}px`, fontFamily: font.fontFamily, fontWeight: font.fontWeight, fontSize: fit.fontSize, letterSpacing: `${letterSpacing}em`, color: fg, whiteSpace: 'pre'}}>
				{fit.lines[0]}
			</div>
		</div>
	);
};

/** The header row: the segment's recurring name (entering when the segment starts) and the DEVELOPING badge. */
export const HeaderRow: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const shot = ctx.plan.scenes[ctx.k].shot;
	const slots = headerSlots(ctx.format, shot);
	const key = SEGMENT_SPECS[ctx.seg].tag;
	const dev = developingOf(ctx.sb);
	return (
		<>
			{key ? <SegmentTag label={showLabel(ctx.sb, key)} x={slots.tag.x} y={slots.tag.y} lang={ctx.lang} at={ctx.segmentStart ? 2 : -100} maxW={slots.tag.maxW} /> : null}
			{dev ? (
				<DevelopingBadge
					label={dev.label ?? showLabel(ctx.sb, 'developing')}
					asOf={dev.asOf ? `${showLabel(ctx.sb, 'asOf')} ${formatAsOf(dev.asOf, ctx.lang)}` : null}
					right={slots.badge.right}
					y={slots.badge.y}
					lang={ctx.lang}
				/>
			) : null}
		</>
	);
};
