/**
 * Quote: a kinetic quote on a card. Each word appears as ZOO says it (matched to the timeline words; spread evenly if
 * the narration does not read the quote), with a teal opening mark, then the attribution and the source line.
 * The layout of the full quote is fixed from the first frame, so nothing reflows while words arrive.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C} from '../theme';
import {FRAME, LAYOUTS, type Box} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import {fontFor} from '../i18n/fonts';
import {CharacterLayer, Card, entry, SceneBg, useDirection, type SceneCtx} from './parts';
import {sceneCast} from './direction';
import {BadgerInsert, inInsert} from './Insert';
import {str} from '../validate';
import {sourceIds, UNSPACED} from '../markup';
import {quoteBlock} from '../layout/blocks';
import {badgerFace} from '../layout/faces';

export const domainOf = (url: string): string => {
	const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
	return m ? m[1].replace(/^www\./, '') : url;
};

/** The source line: onScreen.source, else the first cited source as "title · domain". */
export const quoteSource = (ctx: SceneCtx): string => {
	const own = str(ctx.sc, 'source');
	if (own) return own;
	const id = sourceIds(ctx.sc.narration)[0];
	const s = ctx.sb.sources.find((x) => x.id === id);
	return s ? `${s.title} · ${domainOf(s.url)}` : '';
};

export const QuoteScene: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const frame = useCurrentFrame();
	const L = LAYOUTS.quote[ctx.format];
	const vertical = ctx.format === 'vertical';
	const badgerPlace = ctx.sc.badger?.present ? L.badger : null;
	const dir = useDirection(ctx, sceneCast(ctx.sc, ctx.format));
	const quote = str(ctx.sc, 'quote') ?? '';
	const attribution = str(ctx.sc, 'attribution') ?? '';
	const source = quoteSource(ctx);
	// with Badger in the shot (landscape, beside ZOO), the card and its text narrow so the card ends 16 px before his head
	const narrow = badgerPlace && !vertical ? Math.max(0, L.card.x + L.card.w - (badgerFace(badgerPlace).x - 16)) : 0;
	const qSpec = narrow ? {...L.quote, box: {...L.quote.box, w: L.quote.box.w - narrow}} : L.quote;
	const aSpec = narrow ? {...L.attribution, box: {...L.attribution.box, w: L.attribution.box.w - narrow}} : L.attribution;
	const sSpec = narrow ? {...L.source, box: {...L.source.box, w: L.source.box.w - narrow}} : L.source;
	const qFit = useFit(quote, qSpec, ctx.lang);
	const aFit = useFit(attribution ? `\u2014 ${attribution}` : '', aSpec, ctx.lang);
	const sFit = useFit(source, sSpec, ctx.lang);
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;

	const g = quoteBlock(L, {quote: qFit.height, attribution: attribution ? aFit.height : 0, source: source ? sFit.height : 0});
	if (!g.fits) throw new Error(`quote ${ctx.sc.id}: the quote card needs ${g.cardH}px; the column has ${L.column.bottom - L.column.top}px. Shorten the quote.`);
	const card: Box = {x: L.card.x, y: g.cardY, w: L.card.w - narrow, h: g.cardH};
	const unspaced = UNSPACED.has(ctx.lang);
	const font = fontFor(ctx.lang, L.quote.role, L.quote.weight);
	const lh = qFit.fontSize * qFit.lineHeight;
	const last = dir.reveals.length ? dir.reveals[dir.reveals.length - 1] : 0;
	const after = entry(frame, last + 8, 10);
	const mark = fontFor(ctx.lang, 'heading', 900);
	let w = 0; // running word index across lines
	const cardIn = entry(frame, 0, 12);
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			<div style={{position: 'absolute', left: card.x, top: card.y, width: card.w, height: card.h, clipPath: `inset(0 0 ${(1 - cardIn) * 100}% 0)`}}>
				<Card box={{x: 0, y: 0, w: card.w, h: card.h}} />
			</div>
			<div style={{position: 'absolute', inset: 0, clipPath: `inset(0 0 ${Math.max(0, FRAME[ctx.format].height - (card.y + card.h * cardIn))}px 0)`}}>
				<div
					style={{
						position: 'absolute',
						left: L.quote.box.x - 4,
						top: g.markY,
						fontFamily: mark.fontFamily,
						fontWeight: 900,
						fontSize: L.markSize,
						lineHeight: `${L.markSize}px`,
						height: Math.round(L.markSize * 0.62),
						overflow: 'hidden',
						color: C.teal,
					}}
				>
					{'\u201C'}
				</div>
				{qFit.lines.map((line, i) => {
					const parts = unspaced ? Array.from(line) : line.split(' ');
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: L.quote.box.x,
								top: g.quoteY + i * lh,
								width: qSpec.box.w,
								height: lh,
								lineHeight: `${lh}px`,
								fontFamily: font.fontFamily,
								fontWeight: font.fontWeight,
								fontSize: qFit.fontSize,
								color: C.ink,
								whiteSpace: 'pre',
							}}
						>
							{parts.map((word, k) => {
								if (unspaced && /^\s$/.test(word)) return <span key={k}> </span>; // a real space in mixed text: no reveal slot
								const at = dir.reveals[w++] ?? 0;
								const p = entry(frame, at, 6);
								return (
									<span key={k} style={{display: 'inline-block', visibility: p > 0 ? 'visible' : 'hidden', transform: `translateY(${(1 - p) * 14}px)`}}>
										{word}
										{!unspaced && k < parts.length - 1 ? ' ' : ''}
									</span>
								);
							})}
						</div>
					);
				})}
				{attribution ? (
					<div style={{position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - after) * 100}% 0 0)`}}>
						<Lines fit={aFit} spec={aSpec} lang={ctx.lang} color={C.ink} box={{...aSpec.box, y: g.attrY, h: Math.ceil(aFit.height)}} />
					</div>
				) : null}
				{source ? (
					<div style={{position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - entry(frame, last + 14, 10)) * 100}% 0 0)`}}>
						<Lines fit={sFit} spec={sSpec} lang={ctx.lang} color={C.inkMuted} box={{...sSpec.box, y: g.srcY, h: Math.ceil(sFit.height)}} />
					</div>
				) : null}
			</div>
		</SceneBg>
	);
};
