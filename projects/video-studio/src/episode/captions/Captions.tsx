/**
 * Burned-in captions from timeline.words: 2-4 words per page on a flat off-white plate with the house outline, the
 * spoken word highlighted with a slate chip. Placed in the format's caption band, clear of every face (layout test)
 * and, in Shorts, of the top 10%, the bottom 20% and the button column. Display text comes from the timeline, which
 * carries the {display|spoken} display side, so captions show "$40,000" while ZOO says "forty thousand dollars".
 */
import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import type {Lang} from '../types';
import {C, OUTLINE, R} from '../theme';
import {CAPTION_PAD, CAPTIONS, type Format} from '../layout/specs';
import {placeCaption} from '../layout/faces';
import type {CaptionTrack, TrackPage} from './pages';
import {useFit} from '../text/FitText';
import {fontFor} from '../i18n/fonts';
import {frameToMs} from '../motion';
import {UNSPACED} from '../markup';

export {captionTrack, type CaptionTrack, type TrackPage} from './pages';

const PageView: React.FC<{page: TrackPage; format: Format; lang: Lang; nowMs: number}> = ({page, format, lang, nowMs}) => {
	const spec = CAPTIONS[format];
	const fit = useFit(page.text, {...spec, box: {...spec.box, w: spec.box.w - 2 * CAPTION_PAD.x}}, lang);
	const font = fontFor(lang, spec.role, spec.weight);
	const lh = fit.fontSize * fit.lineHeight;
	const plateW = Math.ceil(fit.width) + 2 * CAPTION_PAD.x;
	const plateH = Math.ceil(fit.height) + 2 * CAPTION_PAD.y;
	// the first caption position clear of every face in the shot (layout/faces.ts)
	const pos = placeCaption(format, plateW, plateH, page.faces);
	const unspaced = UNSPACED.has(lang);
	// active word: the last word whose start has passed
	let active = -1;
	page.words.forEach((w, i) => {
		if (nowMs >= w.startMs - 33) active = i;
	});
	let wi = 0;
	return (
		<div style={{position: 'absolute', left: pos.x, top: pos.y, width: plateW, height: plateH}}>
			<div style={{position: 'absolute', inset: 0, boxSizing: 'border-box', backgroundColor: C.card, border: `${OUTLINE}px solid ${C.ink}`, borderRadius: R.l}} />
			{fit.lines.map((line, li) => {
				const parts = unspaced ? [line] : line.split(' ');
				return (
					<div
						key={li}
						style={{
							position: 'absolute',
							left: CAPTION_PAD.x,
							top: CAPTION_PAD.y + li * lh,
							width: plateW - 2 * CAPTION_PAD.x,
							height: lh,
							lineHeight: `${lh}px`,
							textAlign: 'center',
							fontFamily: font.fontFamily,
							fontWeight: font.fontWeight,
							fontSize: fit.fontSize,
							color: C.ink,
							whiteSpace: 'pre',
						}}
					>
						{parts.map((p, k) => {
							const idx = unspaced ? -1 : wi++;
							const on = idx === active;
							return (
								<React.Fragment key={k}>
									<span style={on ? {backgroundColor: C.slate, color: C.onDark, borderRadius: R.s, padding: '0 6px', margin: '0 -6px'} : undefined}>{p}</span>
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

export const Captions: React.FC<{track: CaptionTrack; format: Format; lang: Lang; fps: number}> = ({track, format, lang, fps}) => {
	const frame = useCurrentFrame();
	const nowMs = frameToMs(frame, fps);
	const page = useMemo(() => track.find((p) => nowMs >= p.startMs && nowMs < p.endMs) ?? null, [track, nowMs]);
	if (!page) return null;
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			<PageView key={`${page.startMs}`} page={page} format={format} lang={lang} nowMs={nowMs} />
		</AbsoluteFill>
	);
};
