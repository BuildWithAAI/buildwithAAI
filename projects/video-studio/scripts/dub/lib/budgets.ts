/**
 * On-screen length budgets per template field (pure). A dubbed string must fit the box the episode engine gives it:
 * the engine shrinks text to a floor size and then wraps while the box height allows, and fails the render if it still
 * does not fit (src/episode/text/fit.ts). This module estimates that limit without fonts:
 *
 *   capacity (em) = box width / floor size × lines that fit at the floor × 0.92 (wrap slack)
 *   text width (em) = Σ per-character widths: Latin by font role (measured 2026-11-24 from the bundled Anton,
 *                     Montserrat and Inter WOFFs: display 0.42, heading 0.55 / caps 0.65, body 0.49 / caps 0.60),
 *                     Devanagari 0.43 (Noto Sans Devanagari 600-900), CJK 1.0, spaces 0.27.
 *
 * Box geometry is a snapshot of src/episode/layout/specs.ts (LAYOUTS, LOWER_THIRD, FICTION_CARD); the dub tests
 * compare it with the live specs, so a layout change shows up there. The render's own fit check stays final.
 */
import type {Lang, SceneType} from '../../../src/episode/types.ts';
import {isCjk, isDevanagari} from '../../claims/lib/text.ts';

export type Role = 'display' | 'heading' | 'body';
export type FitBox = {w: number; h: number; min: number; lh: number; role: Role; upper?: boolean};
export type FieldSpec = {landscape?: FitBox; vertical?: FitBox; label: string};

const b = (w: number, h: number, min: number, lh: number, role: Role, upper?: boolean): FitBox => ({w, h, min, lh, role, ...(upper ? {upper} : {})});

/** `<sceneType>.<field>`, `lowerThird.0|1`, `ui.<key>`. */
export const FIELD_SPECS: Record<string, FieldSpec> = {
	'hook.kicker': {label: 'hook kicker', landscape: b(760, 64, 28, 1.0, 'heading'), vertical: b(972, 60, 26, 1.0, 'heading')},
	'hook.title': {label: 'hook title (display font, capitals)', landscape: b(860, 560, 72, 1.02, 'display', true), vertical: b(972, 400, 70, 1.02, 'display', true)},
	'hook.subtitle': {label: 'hook subtitle (landscape only)', landscape: b(800, 150, 30, 1.3, 'body')},
	'talk.title': {label: 'talk title', landscape: b(814, 140, 40, 1.1, 'heading'), vertical: b(972, 130, 36, 1.1, 'heading')},
	'talk.bullets': {label: 'talk bullet', landscape: b(718, 160, 32, 1.18, 'heading'), vertical: b(888, 110, 30, 1.16, 'heading')},
	'steps.title': {label: 'steps title', landscape: b(900, 150, 40, 1.1, 'heading'), vertical: b(972, 130, 36, 1.1, 'heading')},
	'steps.steps': {label: 'numbered step', landscape: b(792, 150, 32, 1.16, 'heading'), vertical: b(890, 100, 28, 1.16, 'heading')},
	'quote.quote': {label: 'quote', landscape: b(888, 440, 34, 1.14, 'heading'), vertical: b(884, 320, 30, 1.14, 'heading')},
	'quote.attribution': {label: 'quote attribution', landscape: b(888, 92, 26, 1.2, 'body'), vertical: b(884, 84, 26, 1.2, 'body')},
	'quote.source': {label: 'quote source line', landscape: b(888, 80, 24, 1.3, 'body'), vertical: b(884, 72, 24, 1.3, 'body')},
	'cta.title': {label: 'CTA title', landscape: b(608, 300, 40, 1.1, 'heading'), vertical: b(972, 220, 40, 1.1, 'heading')},
	'cta.button': {label: 'CTA button (capitals, one line)', landscape: b(568, 112, 30, 1.0, 'heading', true), vertical: b(700, 110, 30, 1.0, 'heading', true)},
	'cta.disclosure': {label: 'CTA disclosure', landscape: b(608, 200, 26, 1.25, 'body'), vertical: b(920, 150, 26, 1.25, 'body')},
	'endscreen.title': {label: 'end-screen outro line', landscape: b(900, 250, 44, 1.1, 'heading'), vertical: b(972, 420, 48, 1.1, 'heading')},
	'chart.label': {label: 'chart chip', landscape: b(900, 56, 24, 1.0, 'body'), vertical: b(928, 50, 24, 1.0, 'body')},
	'lowerThird.0': {label: 'lower-third name (landscape only)', landscape: b(580, 52, 30, 1.0, 'heading')},
	'lowerThird.1': {label: 'lower-third role (landscape only)', landscape: b(580, 38, 24, 1.0, 'body')},
	'ui.fictionDisclaimer': {label: 'fiction card', landscape: b(1100, 64, 24, 1.15, 'body'), vertical: b(760, 64, 24, 1.15, 'body')},
	'ui.illustrative': {label: 'chart chip', landscape: b(900, 56, 24, 1.0, 'body'), vertical: b(928, 50, 24, 1.0, 'body')},
	'ui.subscribe': {label: 'CTA button (capitals, one line)', landscape: b(568, 112, 30, 1.0, 'heading', true), vertical: b(700, 110, 30, 1.0, 'heading', true)},
	'ui.watchNext': {label: 'end-screen slot heading (landscape only)', landscape: b(736, 48, 28, 1.0, 'heading')},
	'ui.subscribeSlot': {label: 'end-screen subscribe label (landscape only)', landscape: b(280, 44, 24, 1.0, 'heading')},
};

/** Line-height factor per script (src/episode/i18n/fonts.ts lineFactor). */
export const lineFactor = (lang: Lang): number => (lang === 'hi' ? 1.16 : lang === 'zh' || lang === 'ja' ? 1.1 : 1);

const ROLE_EM: Record<Role, {lower: number; upper: number}> = {display: {lower: 0.42, upper: 0.42}, heading: {lower: 0.55, upper: 0.65}, body: {lower: 0.49, upper: 0.6}};

const charEm = (ch: string, box: FitBox): number => {
	if (/[​-‍﻿]/.test(ch) || /\p{M}/u.test(ch) && !isDevanagari(ch)) return 0;
	if (/\s/.test(ch)) return 0.27;
	if (isCjk(ch)) return 1.0;
	if (isDevanagari(ch)) return 0.43;
	const f = ROLE_EM[box.role];
	if (/\p{Lu}/u.test(ch) || (box.upper && /\p{L}/u.test(ch))) return f.upper;
	if (/\p{N}/u.test(ch)) return f.lower + 0.04;
	if (/[\p{P}\p{S}]/u.test(ch)) return 0.32;
	return f.lower;
};

export const textEm = (text: string, box: FitBox): number => {
	let w = 0;
	for (const ch of text.replace(/\s+/g, ' ').trim()) w += charEm(ch, box);
	return w;
};

export const linesAtFloor = (box: FitBox, lang: Lang): number => Math.max(1, Math.floor((box.h + 0.5) / (box.min * box.lh * lineFactor(lang))));
export const capacityEm = (box: FitBox, lang: Lang): number => (box.w / box.min) * linesAtFloor(box, lang) * 0.92;

/** An approximate character budget for a translator (CJK characters count as about two Latin ones). */
export const hardMaxChars = (box: FitBox, lang: Lang): number => {
	const avg = lang === 'zh' || lang === 'ja' ? 1.0 : lang === 'hi' ? 0.45 : box.upper ? ROLE_EM[box.role].upper : ROLE_EM[box.role].lower * 0.85 + ROLE_EM[box.role].upper * 0.15 + 0.01;
	return Math.floor(capacityEm(box, lang) / avg);
};

/** The spec of an onScreen field of a scene type, or null when the engine has no box for it (cues, pair, unknown keys). */
export const specFor = (sceneType: SceneType, field: string, index?: number): FieldSpec | null => {
	if (field === 'lowerThird') return FIELD_SPECS[`lowerThird.${index ?? 0}`] ?? null;
	return FIELD_SPECS[`${sceneType}.${field}`] ?? null;
};

export type FitCheck = {format: 'landscape' | 'vertical'; fits: boolean; usedEm: number; capacityEm: number; maxChars: number};

/** Estimated fit of a text in a field, per format. `vertical` only when the scene is part of a Short. */
export const checkFit = (text: string, spec: FieldSpec, lang: Lang, vertical: boolean): FitCheck[] => {
	const out: FitCheck[] = [];
	for (const format of ['landscape', 'vertical'] as const) {
		const box = spec[format];
		if (!box || (format === 'vertical' && !vertical)) continue;
		const usedEm = textEm(text, box);
		const cap = capacityEm(box, lang);
		out.push({format, fits: usedEm <= cap, usedEm, capacityEm: cap, maxChars: hardMaxChars(box, lang)});
	}
	return out;
};

/** Length in "speech units" for the narration ratio: Han counts 3, kana 2, everything else 1 (spaces excluded). */
export const speechLength = (text: string): number => {
	let n = 0;
	for (const ch of text) {
		if (/\s/.test(ch)) continue;
		if (/\p{Script=Han}/u.test(ch)) n += 3;
		else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) n += 2;
		else if (/\p{M}/u.test(ch) && !isDevanagari(ch)) continue;
		else n += 1;
	}
	return n;
};

/** Width in em for the on-screen ratio (a neutral heading box). */
export const screenLength = (text: string): number => textEm(text, {w: 1000, h: 100, min: 40, lh: 1.1, role: 'heading'});

export const YOUTUBE_TITLE_MAX = 100;
export const THUMB_MAX_WORDS = 4;
export const THUMB_MAX_UNSPACED = 10;
