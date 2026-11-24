/**
 * Sources: every outlet the video cites, in order of first citation, with its date ("published", or "accessed" when
 * only that is known) and the article title. More sources than fit are shown in pages over the scene.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {boxesOf, CardIn, SceneStage, type SceneCtx} from './common';
import {HeaderRow, PanelCard} from './cards';
import {str} from '../segments';
import {FitText, t} from '../graphics/text';
import {G} from '../graphics/theme';
import {citedSourceIds, sourceRow} from '../sources';
import {showLabel} from '../ui';

export const sourcesPerPage = (format: 'landscape' | 'vertical'): number => (format === 'landscape' ? 6 : 4);

export const Sources: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const {sb, sc, lang, format} = ctx;
	const frame = useCurrentFrame();
	const card = boxesOf(ctx).card!;
	const r = ctx.plan.scenes[ctx.k].reveals;
	const land = format === 'landscape';
	const pad = land ? 52 : 26;
	const byId = new Map(sb.sources.map((s) => [s.id, s]));
	const rows = citedSourceIds(sb)
		.map((id) => byId.get(id))
		.filter((s): s is NonNullable<typeof s> => !!s)
		.map((s) => sourceRow(s, lang));
	const per = sourcesPerPage(format);
	const pages = Math.max(1, Math.ceil(rows.length / per));
	const pageLen = Math.max(1, Math.floor(ctx.span.durationInFrames / pages));
	const page = Math.min(pages - 1, Math.floor(frame / pageLen));
	const shown = rows.slice(page * per, page * per + per);
	const footH = 48;
	const title = str(sc, 'title');
	const head = title ? (land ? 84 : 72) : 0;
	const avail = card.h - head - 2 * pad - footH;
	const rowH = Math.min(land ? 118 : 96, avail / Math.max(shown.length, land ? 4 : 3));
	const top = card.y + head + pad + Math.max(0, (avail - rowH * shown.length) / 2);
	const accessed = showLabel(sb, 'accessed');
	return (
		<>
			<SceneStage ctx={ctx} />
			<CardIn ctx={ctx} box={card} at={r.card}>
				<PanelCard box={card} title={title} lang={lang} format={format}>
					{shown.map((row, i) => {
						const y = top + i * rowH;
						const date = row.dateKind === 'accessed' ? `${accessed} ${row.date}` : row.date;
						const rule = i > 0 ? <div style={{position: 'absolute', left: card.x + pad, top: y - 2, width: card.w - 2 * pad, height: 3, backgroundColor: G.silver}} /> : null;
						if (land)
							return (
								<React.Fragment key={row.id}>
									{rule}
									<FitText text={row.publisher} spec={t('heading', 900, 44, 28, 1, 1.0, {ellipsis: true})} lang={lang} box={{x: card.x + pad, y, w: 470, h: rowH}} color={G.ink} valign="center" what="source publisher" />
									<FitText text={date} spec={t('body', 600, 34, 24, 1, 1.0)} lang={lang} box={{x: card.x + pad + 490, y, w: 360, h: rowH}} color={G.inkMuted} valign="center" what="source date" />
									<FitText text={row.title} spec={t('body', 600, 34, 24, 2, 1.1, {ellipsis: true})} lang={lang} box={{x: card.x + pad + 870, y, w: card.w - 2 * pad - 870, h: rowH}} color={G.ink} valign="center" what="source title" />
								</React.Fragment>
							);
						return (
							<React.Fragment key={row.id}>
								{rule}
								<FitText text={`${row.publisher} · ${date}`} spec={t('heading', 900, 32, 24, 1, 1.0, {ellipsis: true})} lang={lang} box={{x: card.x + pad, y: y + 8, w: card.w - 2 * pad, h: rowH * 0.46}} color={G.ink} valign="center" what="source publisher" />
								<FitText text={row.title} spec={t('body', 600, 28, 24, 1, 1.0, {ellipsis: true})} lang={lang} box={{x: card.x + pad, y: y + rowH * 0.5, w: card.w - 2 * pad, h: rowH * 0.42}} color={G.inkMuted} valign="center" what="source title" />
							</React.Fragment>
						);
					})}
					<FitText
						text={pages > 1 ? `${showLabel(sb, 'linksBelow')} · ${page + 1}/${pages}` : showLabel(sb, 'linksBelow')}
						spec={t('body', 700, 30, 24, 1, 1.0)}
						lang={lang}
						box={{x: card.x + pad, y: card.y + card.h - pad - footH + 8, w: card.w - 2 * pad, h: footH - 8}}
						color={G.inkMuted}
						align="right"
						valign="center"
						what="sources footer"
					/>
				</PanelCard>
			</CardIn>
			<HeaderRow ctx={ctx} />
		</>
	);
};
