/**
 * Overlays drawn above the scenes:
 *  - LowerThird: name strap (onScreen.lowerThird = "Name" or ["Name", "Role"]) for the first 4.5 s of a scene (landscape).
 *  - FictionCard: required when storyboard.fiction is true; the first 5 s of the episode and of every Short.
 *  - SourcesCard: "Source: title · domain" when a cited claim is spoken (StoryboardScene.showSources).
 *  - ReviewBadges: SILENT PREVIEW (mock timeline) and MACHINE TRANSLATION (unreviewed dub) markers for the owner.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import type {Lang, Storyboard, StoryboardScene, TimelineScene} from '../types';
import {C, OUTLINE, R} from '../theme';
import {BADGE_AREA, FICTION_CARD, LAYOUTS, LOWER_THIRD, type Format, type TextSpec} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import {fontFor} from '../i18n/fonts';
import {uiLabel} from '../i18n/ui';
import {entry} from './parts';
import {displayText, sourceOffsets} from '../markup';
import {wordIndexAtOffset} from '../cues';
import {msToFrame, track, EASE} from '../motion';
import {showsSources} from '../validate';
import {domainOf} from './Quote';

/** In-and-out envelope for overlays: decelerate in over 10 f, ease out over 8 f. */
const inOut = (f: number, from: number, to: number) => (f < from || f >= to ? 0 : Math.min(entry(f, from, 10), track(f, [[to - 8, 1], [to, 0]], EASE.inOut)));

export const LowerThird: React.FC<{format: Format; lang: Lang; sc: StoryboardScene}> = ({format, lang, sc}) => {
	const frame = useCurrentFrame();
	const spec = LOWER_THIRD[format];
	const v = sc.onScreen?.lowerThird;
	const [name, role] = Array.isArray(v) ? [v[0] ?? '', v[1] ?? ''] : [typeof v === 'string' ? v : '', ''];
	const nFit = useFit(name, spec?.name ?? FICTION_CARD.landscape, lang);
	const rFit = useFit(role, spec?.role ?? FICTION_CARD.landscape, lang);
	if (!spec || !name) return null;
	const p = inOut(frame, 12, 12 + 135);
	if (p <= 0) return null;
	const w = Math.max(nFit.width, rFit.width) + 40 + 40 + 12;
	const h = role ? spec.box.h : spec.box.h - 44;
	return (
		<div style={{position: 'absolute', left: spec.box.x, top: spec.box.y + (spec.box.h - h), width: w, height: h, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`}}>
			<div style={{position: 'absolute', inset: 0, backgroundColor: C.slate, borderRadius: R.m}} />
			<div style={{position: 'absolute', left: 18, top: 18, width: 10, height: h - 36, backgroundColor: C.teal, borderRadius: R.s}} />
			<Lines fit={nFit} spec={spec.name} lang={lang} color={C.onDark} box={{x: 40 + 12, y: 14, w: spec.name.box.w, h: spec.name.box.h}} />
			{role ? <Lines fit={rFit} spec={spec.role} lang={lang} color={C.onDarkMuted} box={{x: 40 + 12, y: 70, w: spec.role.box.w, h: spec.role.box.h}} /> : null}
		</div>
	);
};

export const FictionCard: React.FC<{format: Format; sb: Storyboard}> = ({format, sb}) => {
	const frame = useCurrentFrame();
	const spec = FICTION_CARD[format];
	const text = sb.fiction ? (uiLabel(sb, 'fictionDisclaimer') ?? '') : '';
	const fit = useFit(text, spec, sb.lang);
	if (!text) return null;
	const p = inOut(frame, 4, 4 + 150);
	if (p <= 0) return null;
	const padX = 18;
	const padY = 12;
	const w = Math.ceil(fit.width) + 2 * padX + 26;
	const h = Math.ceil(fit.height) + 2 * padY;
	const firstLine = fit.fontSize * spec.lineHeight;
	return (
		<div style={{position: 'absolute', left: spec.box.x, top: spec.box.y, width: w, height: h, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`}}>
			<div style={{position: 'absolute', inset: 0, boxSizing: 'border-box', backgroundColor: C.card, border: `${OUTLINE}px solid ${C.ink}`, borderRadius: R.m}} />
			<div style={{position: 'absolute', left: padX, top: Math.round(padY + firstLine / 2 - 6), width: 12, height: 12, backgroundColor: C.teal, borderRadius: R.s}} />
			<Lines fit={fit} spec={spec} lang={sb.lang} color={C.ink} box={{x: padX + 26, y: padY, w: spec.box.w, h: Math.ceil(fit.height)}} />
		</div>
	);
};

const SENTENCE_END = /[.!?…。！？]$/;

/**
 * When each cited source is spoken: from the first word of the sentence that carries the claim to the word that ends
 * it (the [src:id] tag sits right after the claim).
 */
export const sourceCues = (sc: StoryboardScene, tl: TimelineScene, fps: number): Array<{id: string; from: number; claimEnd: number}> => {
	const display = displayText(sc.narration);
	return sourceOffsets(sc.narration).map(({id, offset}) => {
		const wi = wordIndexAtOffset(tl.words, display, offset);
		if (wi < 0) return {id, from: 0, claimEnd: 0};
		let first = wi;
		while (first > 0 && !SENTENCE_END.test(tl.words[first - 1].text)) first--;
		return {id, from: msToFrame(tl.words[first].startMs, fps), claimEnd: msToFrame(tl.words[wi].endMs, fps)};
	});
};

/** Where a scene type puts its sources line (null: none, e.g. the quote shows its own source). */
const sourcesSpec = (type: StoryboardScene['type'], format: Format): TextSpec | null => {
	const l = (LAYOUTS as unknown as Record<string, Record<Format, {sources?: TextSpec}>>)[type]?.[format];
	return l?.sources ?? null;
};

export const SourcesCard: React.FC<{format: Format; sb: Storyboard; sc: StoryboardScene; tl: TimelineScene; fps: number; frames: number}> = ({format, sb, sc, tl, fps, frames}) => {
	const frame = useCurrentFrame();
	const spec = sourcesSpec(sc.type, format);
	const on = !!spec && showsSources(sc);
	const cues = on ? sourceCues(sc, tl, fps) : [];
	// the most recent cited claim whose sentence has started; held until 3 s after the claim (at least 4 s)
	const cur = [...cues].reverse().find((c) => frame >= c.from - 6);
	const src = cur ? sb.sources.find((x) => x.id === cur.id) : undefined;
	const label = uiLabel(sb, 'sources') ?? '';
	const text = src ? `${label ? `${label}: ` : ''}${src.title} · ${domainOf(src.url)}` : '';
	const fit = useFit(text || ' ', spec ?? FICTION_CARD[format], sb.lang);
	if (!cur || !src || !spec) return null;
	const to = Math.min(frames, Math.max(cur.from + 120, cur.claimEnd + 90));
	const p = inOut(frame, cur.from - 6, to);
	if (p <= 0) return null;
	const padX = 16;
	const w = Math.ceil(fit.width) + 2 * padX;
	const h = spec.box.h + 12;
	const x = spec.align === 'right' ? spec.box.x + spec.box.w - w : spec.box.x;
	return (
		<div style={{position: 'absolute', left: x, top: spec.box.y - 6, width: w, height: h, clipPath: spec.align === 'right' ? `inset(0 0 0 ${(1 - p) * 100}%)` : `inset(0 ${(1 - p) * 100}% 0 0)`}}>
			<div style={{position: 'absolute', inset: 0, backgroundColor: C.card, borderRadius: R.s, border: `2px solid ${C.ink}`, boxSizing: 'border-box'}} />
			<Lines fit={fit} spec={{...spec, align: 'left'}} lang={sb.lang} color={C.ink} box={{x: padX, y: 6, w: spec.box.w, h: spec.box.h}} />
		</div>
	);
};

/** Owner-facing markers (English on purpose). Never publish a render that shows one. */
export const ReviewBadges: React.FC<{format: Format; mock: boolean; machine: boolean}> = ({format, mock, machine}) => {
	const area = BADGE_AREA[format];
	const items = [mock ? 'SILENT PREVIEW · mock timing · not lip-synced' : null, machine ? 'MACHINE TRANSLATION · needs native review' : null].filter((x): x is string => !!x);
	if (!items.length) return null;
	const f = fontFor('en', 'body', 800);
	const size = format === 'vertical' ? 24 : 26;
	return (
		<div style={{position: 'absolute', right: FRAME_W[format] - area.right, top: area.y, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10}}>
			{items.map((t) => (
				<div key={t} style={{backgroundColor: C.ink, color: C.card, fontFamily: f.fontFamily, fontWeight: f.fontWeight, fontSize: size, lineHeight: `${size + 16}px`, padding: '0 16px', borderRadius: R.m, whiteSpace: 'pre'}}>
					{t}
				</div>
			))}
		</div>
	);
};
const FRAME_W: Record<Format, number> = {landscape: 1920, vertical: 1080};
