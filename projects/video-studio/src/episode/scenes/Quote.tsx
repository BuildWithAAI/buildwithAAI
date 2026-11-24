/**
 * Quote: a kinetic quote on a card. Each word appears as ZOO says it (matched to the timeline words; spread evenly if
 * the narration does not read the quote), with a teal opening mark, then the attribution and the source line.
 * The layout of the full quote is fixed from the first frame, so nothing reflows while words arrive.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C} from '../theme';
import {LAYOUTS, type Box} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import {fontFor} from '../i18n/fonts';
import {CharacterLayer, Card, entry, SceneBg, useDirection, type SceneCtx} from './parts';
import {BadgerInsert, inInsert} from './Insert';
import {str} from '../validate';
import {sourceIds, UNSPACED} from '../markup';

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
	const dir = useDirection(ctx, {zooView: 'front', badgerPlace, badgerInsert: vertical});
	const quote = str(ctx.sc, 'quote') ?? '';
	const attribution = str(ctx.sc, 'attribution') ?? '';
	const source = quoteSource(ctx);
	const qFit = useFit(quote, L.quote, ctx.lang);
	const aFit = useFit(attribution ? `— ${attribution}` : '', L.attribution, ctx.lang);
	const sFit = useFit(source, L.source, ctx.lang);
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;

	const unspaced = UNSPACED.has(ctx.lang);
	const font = fontFor(ctx.lang, L.quote.role, L.quote.weight);
	const lh = qFit.fontSize * L.quote.lineHeight;
	const last = dir.reveals.length ? dir.reveals[dir.reveals.length - 1] : 0;
	const after = entry(frame, last + 8, 10);
	const mark = fontFor(ctx.lang, 'heading', 900);
	let w = 0; // running word index across lines
	const cardIn = entry(frame, 0, 10);
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			<div style={{position: 'absolute', inset: 0, transform: `translateY(${(1 - cardIn) * 24}px)`, clipPath: `inset(${(1 - cardIn) * 100}% 0 0 0)`}}>
				<Card box={L.card} />
				<div
					style={{
						position: 'absolute',
						left: L.mark.x,
						top: L.mark.y,
						fontFamily: mark.fontFamily,
						fontWeight: 900,
						fontSize: L.mark.size,
						lineHeight: `${L.mark.size}px`,
						height: Math.round(L.mark.size * 0.62),
						overflow: 'hidden',
						color: C.teal,
					}}
				>
					{'“'}
				</div>
				{qFit.lines.map((line, i) => {
					const parts = unspaced ? Array.from(line) : line.split(' ');
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: L.quote.box.x,
								top: L.quote.box.y + i * lh,
								width: L.quote.box.w,
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
						<Lines fit={aFit} spec={L.attribution} lang={ctx.lang} color={C.ink} />
					</div>
				) : null}
				{source ? (
					<div style={{position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - entry(frame, last + 14, 10)) * 100}% 0 0)`}}>
						<Lines fit={sFit} spec={L.source} lang={ctx.lang} color={C.inkMuted} box={{...L.source.box} as Box} />
					</div>
				) : null}
			</div>
		</SceneBg>
	);
};
