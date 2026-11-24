/**
 * Caption pages for a show render (pure): the episode engine's pager (src/episode/captions/pages.ts: 2-4 words a page,
 * a new page at phrase ends and pauses) run per scene on the words inside the scene's SHOWN window, then offset to
 * composition ms. A page never outlives its scene, so a Short's trimmed outro cannot carry a caption past its cut.
 */
import type {Lang, Timeline} from '../types.ts';
import type {ShowSpan} from '../timing.ts';
import {buildPages, type CaptionPage} from '../../episode/captions/pages.ts';
import {frameToMs, msToFrame} from '../../episode/motion.ts';

export type {CaptionPage};

export const captionPages = (spans: ShowSpan[], tl: Timeline, lang: Lang, fps: number): CaptionPage[] =>
	spans.flatMap((s) => {
		const off = frameToMs(s.from, fps);
		const words = tl.scenes[s.index].words.filter((w) => msToFrame(w.startMs, fps) < s.durationInFrames);
		const end = frameToMs(s.from + s.durationInFrames, fps);
		return buildPages(words, {lang}).map((p) => ({
			...p,
			startMs: p.startMs + off,
			endMs: Math.min(end, p.endMs + off),
			words: p.words.map((w) => ({...w, startMs: w.startMs + off, endMs: w.endMs + off})),
		}));
	});
