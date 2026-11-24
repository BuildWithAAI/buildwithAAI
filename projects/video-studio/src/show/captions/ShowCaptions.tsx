/**
 * Burned-in captions from the timeline's words (the voice step's display words: captions show "$4.2M" while Zoo says
 * "four point two million dollars"). Pages of 2-4 words from the episode engine's pager (src/episode/captions/pages.ts),
 * on an off-white plate with the house outline, the spoken word on a slate chip. The band sits below every face and,
 * in Shorts, inside the safe area and left of the action buttons (layout/boxes.ts CAPTION_BAND; tests check it).
 */
import React, {useMemo} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {Format, Lang} from '../types';
import {captionPages, type CaptionPage} from './pages';
import {frameToMs} from '../../episode/motion';
import {UNSPACED} from '../../episode/markup';
import {fontFor} from '../../episode/i18n/fonts';
import {useFit, t} from '../graphics/text';
import {CAPTION_BAND} from '../layout/boxes';
import {G, OUTLINE, R} from '../graphics/theme';

const PAD = {x: 28, y: 12};

export {captionPages};

const spec = (format: Format) => (format === 'vertical' ? t('heading', 900, 62, 44, 2, 1.12, {balance: true}) : t('heading', 900, 50, 36, 2, 1.12, {balance: true}));

const Page: React.FC<{page: CaptionPage; format: Format; lang: Lang; nowMs: number}> = ({page, format, lang, nowMs}) => {
	const band = CAPTION_BAND[format];
	const s = spec(format);
	const fit = useFit(page.text, s, lang, band.w - 2 * PAD.x, band.h - 2 * PAD.y, 'caption');
	const font = fontFor(lang, s.role, s.weight);
	const lh = fit.fontSize * fit.lineHeight;
	const w = Math.ceil(fit.width) + 2 * PAD.x;
	const h = Math.ceil(fit.height) + 2 * PAD.y;
	const x = band.x + (band.w - w) / 2;
	const y = format === 'vertical' ? band.y + (band.h - h) / 2 : band.y + band.h - h;
	const unspaced = UNSPACED.has(lang);
	let active = -1;
	page.words.forEach((wd, i) => {
		if (nowMs >= wd.startMs - 33) active = i;
	});
	let wi = 0;
	return (
		<div data-part="caption" style={{position: 'absolute', left: x, top: y, width: w, height: h}}>
			<div style={{position: 'absolute', inset: 0, backgroundColor: G.card, border: `${OUTLINE}px solid ${G.ink}`, borderRadius: R.l, boxSizing: 'border-box'}} />
			{fit.lines.map((line, li) => {
				const parts = unspaced ? [line] : line.split(' ');
				return (
					<div key={li} style={{position: 'absolute', left: PAD.x, top: PAD.y + li * lh, width: w - 2 * PAD.x, height: lh, lineHeight: `${lh}px`, textAlign: 'center', fontFamily: font.fontFamily, fontWeight: font.fontWeight, fontSize: fit.fontSize, color: G.ink, whiteSpace: 'pre'}}>
						{parts.map((p, k) => {
							const idx = unspaced ? -1 : wi++;
							const on = idx === active;
							return (
								<React.Fragment key={k}>
									<span style={on ? {backgroundColor: G.slate, color: G.onDark, borderRadius: R.s, padding: '0 6px', margin: '0 -6px'} : undefined}>{p}</span>
									{!unspaced && k < parts.length - 1 ? ' ' : ''}
								</React.Fragment>
							);
						})}
					</div>
				);
			})}
		</div>
	);
};

export const ShowCaptions: React.FC<{pages: CaptionPage[]; format: Format; lang: Lang}> = ({pages, format, lang}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const nowMs = frameToMs(frame, fps);
	const page = useMemo(() => pages.find((p) => nowMs >= p.startMs && nowMs < p.endMs) ?? null, [pages, nowMs]);
	if (!page) return null;
	return <Page key={page.startMs} page={page} format={format} lang={lang} nowMs={nowMs} />;
};
