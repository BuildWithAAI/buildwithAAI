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
import {BADGE_AREA, FICTION_CARD, LAYOUTS, LOWER_THIRD, LOWER_THIRD_PAD, lowerThirdX, type Box, type Format, type TextSpec} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import type {FitResult} from '../text/fit';
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

/**
 * The lower-third plate of a scene (landscape only; null without onScreen.lowerThird): its box at the template's x
 * (specs.ts LOWER_THIRD_X) and the fitted name and role. Talk and CTA use it too, to keep their text block above a plate
 * that reaches into their text column.
 */
export const useLowerThird = (
	format: Format,
	lang: Lang,
	sc: StoryboardScene,
): {box: Box; name: string; role: string; nFit: FitResult; rFit: FitResult; spec: NonNullable<(typeof LOWER_THIRD)['landscape']>} | null => {
	const spec = LOWER_THIRD[format];
	const v = sc.onScreen?.lowerThird;
	const [name, role] = Array.isArray(v) ? [v[0] ?? '', v[1] ?? ''] : [typeof v === 'string' ? v : '', ''];
	const nFit = useFit(name, spec?.name ?? FICTION_CARD.landscape, lang);
	const rFit = useFit(role, spec?.role ?? FICTION_CARD.landscape, lang);
	if (!spec || !name) return null;
	const w = Math.max(nFit.width, rFit.width) + LOWER_THIRD_PAD.left + LOWER_THIRD_PAD.right;
	const h = role ? spec.box.h : spec.box.h - 44;
	return {box: {x: lowerThirdX(sc.type), y: spec.box.y + (spec.box.h - h), w, h}, name, role, nFit, rFit, spec};
};

export const LowerThird: React.FC<{format: Format; lang: Lang; sc: StoryboardScene}> = ({format, lang, sc}) => {
	const frame = useCurrentFrame();
	const lt = useLowerThird(format, lang, sc);
	if (!lt) return null;
	const p = inOut(frame, 12, 12 + 135);
	if (p <= 0) return null;
	const {box, spec, nFit, rFit, role} = lt;
	return (
		<div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`}}>
			<div style={{position: 'absolute', inset: 0, backgroundColor: C.slate, borderRadius: R.m}} />
			<div style={{position: 'absolute', left: 18, top: 18, width: 10, height: box.h - 36, backgroundColor: C.teal, borderRadius: R.s}} />
			<Lines fit={nFit} spec={spec.name} lang={lang} color={C.onDark} box={{x: LOWER_THIRD_PAD.left, y: 14, w: spec.name.box.w, h: spec.name.box.h}} />
			{role ? <Lines fit={rFit} spec={spec.role} lang={lang} color={C.onDarkMuted} box={{x: LOWER_THIRD_PAD.left, y: 70, w: spec.role.box.w, h: spec.role.box.h}} /> : null}
		</div>
	);
};

/** Frames (from the start of the episode or Short) during which the fiction card is on screen. */
export const FICTION_SHOW = {from: 4, to: 4 + 150} as const;
const FICTION_PAD_Y = 12;

export const FictionCard: React.FC<{format: Format; sb: Storyboard}> = ({format, sb}) => {
	const frame = useCurrentFrame();
	const spec = FICTION_CARD[format];
	const text = sb.fiction ? (uiLabel(sb, 'fictionDisclaimer') ?? '') : '';
	const fit = useFit(text, spec, sb.lang);
	if (!text) return null;
	const p = inOut(frame, FICTION_SHOW.from, FICTION_SHOW.to);
	if (p <= 0) return null;
	const padX = 18;
	const padY = FICTION_PAD_Y;
	const w = Math.ceil(fit.width) + 2 * padX + 26;
	const h = Math.ceil(fit.height) + 2 * padY;
	const firstLine = fit.fontSize * fit.lineHeight;
	return (
		<div style={{position: 'absolute', left: spec.box.x, top: spec.box.y, width: w, height: h, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`}}>
			<div style={{position: 'absolute', inset: 0, boxSizing: 'border-box', backgroundColor: C.card, border: `${OUTLINE}px solid ${C.ink}`, borderRadius: R.m}} />
			<div style={{position: 'absolute', left: padX, top: Math.round(padY + firstLine / 2 - 6), width: 12, height: 12, backgroundColor: C.teal, borderRadius: R.s}} />
			<Lines fit={fit} spec={spec} lang={sb.lang} color={C.ink} box={{x: padX + 26, y: padY, w: spec.box.w, h: Math.ceil(fit.height)}} />
		</div>
	);
};

const SENTENCE_END = /[.!?…。！？।॥]$/;

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

/**
 * `startFrame`: the scene's first frame in the composition (the fiction card runs on composition frames). When the
 * sources line shares the fiction card's band (vertical: every template's line, in the top band; landscape: the talk
 * scene's top line) and a cue starts while that card is up, the line sits below the card for that whole cue, so the
 * fiction disclaimer is never covered and the line never jumps mid-display. Added 2026-11-24 (engine demo).
 */
export const SourcesCard: React.FC<{format: Format; sb: Storyboard; sc: StoryboardScene; tl: TimelineScene; fps: number; frames: number; startFrame?: number}> = ({
	format,
	sb,
	sc,
	tl,
	fps,
	frames,
	startFrame = 0,
}) => {
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
	const fiction = FICTION_CARD[format];
	const fictionText = sb.fiction ? (uiLabel(sb, 'fictionDisclaimer') ?? '') : '';
	const fictionFit = useFit(fictionText || ' ', fiction, sb.lang);
	if (!cur || !src || !spec) return null;
	const to = Math.min(frames, Math.max(cur.from + 120, cur.claimEnd + 90));
	const p = inOut(frame, cur.from - 6, to);
	if (p <= 0) return null;
	const padX = 16;
	const w = Math.ceil(fit.width) + 2 * padX;
	const h = spec.box.h + 12;
	const x = spec.align === 'right' ? spec.box.x + spec.box.w - w : spec.align === 'center' ? Math.round(spec.box.x + (spec.box.w - w) / 2) : spec.box.x;
	const fictionBottom = fiction.box.y + Math.ceil(fictionFit.height) + 2 * FICTION_PAD_Y;
	// the fiction plate's real width (FictionCard: text + 2 x 18 padding + 26 for the teal mark): a line beside it, not
	// under it (landscape talk/CTA lines sit in the text column, right of a short disclaimer), keeps its own place
	const fictionRight = fiction.box.x + Math.ceil(fictionFit.width) + 2 * 18 + 26;
	const sharesBand = !!fictionText && spec.box.y - 6 < fictionBottom && spec.box.y + spec.box.h + 6 > fiction.box.y && x < fictionRight + 10 && x + w > fiction.box.x - 10;
	const cueStart = startFrame + cur.from - 6;
	const top = sharesBand && cueStart < FICTION_SHOW.to ? fictionBottom + 10 : spec.box.y - 6;
	const clip =
		spec.align === 'right' ? `inset(0 0 0 ${(1 - p) * 100}%)` : spec.align === 'center' ? `inset(0 ${(1 - p) * 50}% 0 ${(1 - p) * 50}%)` : `inset(0 ${(1 - p) * 100}% 0 0)`;
	return (
		<div style={{position: 'absolute', left: x, top, width: w, height: h, clipPath: clip}}>
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
		<div style={{position: 'absolute', right: FRAME_W[format] - area.right, top: area.y, display: 'flex', flexDirection: format === 'vertical' ? 'column' : 'row', alignItems: 'flex-end', gap: 10}}>
			{items.map((t) => (
				<div key={t} style={{backgroundColor: C.ink, color: C.card, fontFamily: f.fontFamily, fontWeight: f.fontWeight, fontSize: size, lineHeight: `${size + 16}px`, padding: '0 16px', borderRadius: R.m, whiteSpace: 'pre'}}>
					{t}
				</div>
			))}
		</div>
	);
};
const FRAME_W: Record<Format, number> = {landscape: 1920, vertical: 1080};
