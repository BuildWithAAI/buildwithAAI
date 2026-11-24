/**
 * Headline: the incident title, a DEVELOPING label when the story is still developing, and the Rekt Meter: a flat
 * gauge of the reported loss with "reported by <outlet>" (never averaged; a second outlet's different figure is shown
 * beside it). Landscape: Zoo on the right, the card on the left. Vertical: both hosts at the desk, the card on top.
 */
import React from 'react';
import {boxesOf, CardIn, SceneSource, SceneStage, type SceneCtx} from './common';
import {HeaderRow, Pill} from './cards';
import {str} from '../segments';
import {Card} from '../graphics/parts';
import {FitText, t, useFit} from '../graphics/text';
import {G} from '../graphics/theme';
import {RektMeter} from '../graphics/RektMeter';
import {publisherOf} from '../sources';
import {showLabel} from '../ui';
import {developingOf} from '../validate';

export const Headline: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const {sc, sb, lang, format} = ctx;
	const card = boxesOf(ctx).card!;
	const r = ctx.plan.scenes[ctx.k].reveals;
	const land = format === 'landscape';
	const pad = land ? 40 : 28;
	const dev = str(sc, 'developing');
	// in a Short the persistent DEVELOPING badge already sits right above the card
	const showDev = !!dev && !(format === 'vertical' && developingOf(sb));
	const rekt = sc.rekt;
	const bySource = new Map(sb.sources.map((s) => [s.id, s]));
	const pub = (id: string) => {
		const s = bySource.get(id);
		return s ? publisherOf(s) : id;
	};
	const titleSpec = land ? t('heading', 900, rekt ? 62 : 80, 40, 3, 1.08, {balance: true}) : t('heading', 900, 48, 32, 2, 1.08, {balance: true});
	let y = card.y + pad;
	const devY = y;
	if (showDev) y += (land ? 52 : 48) + (land ? 22 : 14);
	const maxTitleH = rekt ? (land ? 236 : 112) : card.y + card.h - pad - y;
	// the title takes only the lines it needs; the meter gets the rest of the card
	const fitted = useFit(str(sc, 'title') ?? '', titleSpec, lang, card.w - 2 * pad, maxTitleH, `${sc.id} headline title`);
	const titleH = rekt ? Math.ceil(fitted.height) : maxTitleH;
	const titleBox = {x: card.x + pad, y, w: card.w - 2 * pad, h: titleH};
	y += titleH + (land ? 28 : 12);
	const meterBox = {x: card.x + pad, y, w: card.w - 2 * pad, h: card.y + card.h - pad - y};
	return (
		<>
			<SceneStage ctx={ctx} />
			<CardIn ctx={ctx} box={card} at={r.card}>
				<Card box={card} />
				{showDev ? <Pill text={dev as string} x={card.x + pad} y={devY} lang={lang} h={land ? 52 : 48} letterSpacing={0.06} /> : null}
				<FitText
					text={str(sc, 'title') ?? ''}
					spec={titleSpec}
					lang={lang}
					box={titleBox}
					color={G.ink}
					valign={rekt ? 'top' : 'center'}
					what={`${sc.id} headline title`}
				/>
				{rekt ? (
					<RektMeter
						box={meterBox}
						layout="side"
						main={{usd: rekt.usd, display: str(sc, 'loss') ?? '', publisher: pub(rekt.source)}}
						alt={rekt.alt ? {usd: rekt.alt.usd, display: str(sc, 'lossAlt') ?? '', publisher: pub(rekt.alt.source)} : null}
						start={r.meter ?? r.card + 12}
						lang={lang}
						labels={{reportedBy: showLabel(sb, 'reportedBy'), alsoReported: showLabel(sb, 'alsoReported'), logScale: showLabel(sb, 'logScale')}}
					/>
				) : null}
			</CardIn>
			<SceneSource ctx={ctx} />
			<HeaderRow ctx={ctx} />
		</>
	);
};
