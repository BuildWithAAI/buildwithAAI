/**
 * captions.json (Remotion Caption[], usually one word per item with its leading space) -> SRT and WebVTT.
 * Words are grouped into cues of at most 2 lines x 42 characters and 7 seconds, and a cue also ends after a
 * sentence, at a pause over 1 s, or at `pageBreakAfter`. 42 x 2 and 7 s follow common subtitle style guides
 * (e.g. Netflix's English timed-text guide); YouTube sets no limit of its own.
 */
import type {Caption} from './types.ts';
import {isRecord} from './util.ts';

export type Cue = {startMs: number; endMs: number; lines: string[]};

export const CUE_RULES = {maxLineChars: 42, maxLines: 2, maxCueMs: 7000, maxGapMs: 1000} as const;

const MAX_ITEMS = 20_000;

/** Validates a parsed captions.json. Every problem is collected (up to 20). */
export const checkCaptions = (input: unknown): {captions: Caption[]; errors: string[]} => {
	if (!Array.isArray(input)) return {captions: [], errors: ['captions.json must be an array of Remotion captions']};
	if (input.length > MAX_ITEMS) return {captions: [], errors: [`captions.json has ${input.length} items; the limit is ${MAX_ITEMS}`]};
	const errors: string[] = [];
	const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
	input.forEach((c, i) => {
		if (errors.length >= 20) return;
		if (!isRecord(c) || typeof c.text !== 'string' || !num(c.startMs) || !num(c.endMs)) {
			errors.push(`captions[${i}] needs a string "text" and non-negative numbers "startMs" and "endMs"`);
			return;
		}
		if (c.text.length > 200) errors.push(`captions[${i}]: "text" is longer than 200 characters`);
		if (c.endMs < c.startMs) errors.push(`captions[${i}]: "endMs" is before "startMs"`);
		if (c.timestampMs !== null && c.timestampMs !== undefined && !num(c.timestampMs)) errors.push(`captions[${i}]: "timestampMs" must be a number or null`);
		if (c.confidence !== null && c.confidence !== undefined && typeof c.confidence !== 'number') errors.push(`captions[${i}]: "confidence" must be a number or null`);
		if (c.pageBreakAfter !== undefined && typeof c.pageBreakAfter !== 'boolean') errors.push(`captions[${i}]: "pageBreakAfter" must be true or false`);
		const prev = input[i - 1];
		if (i > 0 && isRecord(prev) && num(prev.startMs) && c.startMs < prev.startMs) errors.push(`captions[${i}] starts before captions[${i - 1}]: sort by startMs`);
	});
	if (errors.length) return {captions: [], errors};
	const captions = input.map((c) => ({
		text: c.text as string,
		startMs: c.startMs as number,
		endMs: c.endMs as number,
		timestampMs: typeof c.timestampMs === 'number' ? c.timestampMs : null,
		confidence: typeof c.confidence === 'number' ? c.confidence : null,
		...(c.pageBreakAfter === true ? {pageBreakAfter: true} : {}),
	}));
	return {captions, errors};
};

/** Captions are whitespace-sensitive (Remotion): words carry their own leading space. */
export const captionText = (items: readonly Caption[]): string => items.map((c) => c.text).join('').replace(/\s+/g, ' ').trim();

/** Splits text into at most two lines, as balanced as the word boundaries allow. */
export const wrapLines = (text: string, max: number = CUE_RULES.maxLineChars): string[] => {
	if (text.length <= max) return [text];
	let best: [string, string] | null = null;
	for (let i = text.indexOf(' '); i !== -1; i = text.indexOf(' ', i + 1)) {
		const pair: [string, string] = [text.slice(0, i), text.slice(i + 1)];
		const worst = Math.max(pair[0].length, pair[1].length);
		if (!best || worst < Math.max(best[0].length, best[1].length)) best = pair;
	}
	return best ?? [text];
};

const ENDS_SENTENCE = /[.!?…]["'”’)\]]*$/;

export const toCues = (captions: readonly Caption[]): Cue[] => {
	const groups: Caption[][] = [];
	let current: Caption[] = [];
	const flush = (): void => {
		if (current.length) groups.push(current);
		current = [];
	};
	for (const word of captions) {
		const prev = current[current.length - 1];
		if (prev) {
			const tooLong = captionText([...current, word]).length > CUE_RULES.maxLineChars * CUE_RULES.maxLines;
			const tooSlow = word.endMs - current[0].startMs > CUE_RULES.maxCueMs;
			const pause = word.startMs - prev.endMs > CUE_RULES.maxGapMs;
			if (tooLong || tooSlow || pause || ENDS_SENTENCE.test(prev.text.trim())) flush();
		}
		current.push(word);
		if (word.pageBreakAfter) flush();
	}
	flush();
	const cues = groups
		.map((g) => ({startMs: Math.round(g[0].startMs), endMs: Math.round(g[g.length - 1].endMs), lines: wrapLines(captionText(g))}))
		.filter((c) => c.lines.join('').length > 0);
	cues.forEach((cue, i) => {
		const next = cues[i + 1];
		if (next && cue.endMs > next.startMs) cue.endMs = next.startMs;
		if (cue.endMs <= cue.startMs) cue.endMs = next ? Math.max(cue.startMs + 1, Math.min(cue.startMs + 500, next.startMs)) : cue.startMs + 500;
	});
	return cues;
};

const stamp = (ms: number, separator: ',' | '.'): string => {
	const t = Math.max(0, Math.round(ms));
	const h = String(Math.floor(t / 3_600_000)).padStart(2, '0');
	const m = String(Math.floor((t % 3_600_000) / 60_000)).padStart(2, '0');
	const s = String(Math.floor((t % 60_000) / 1000)).padStart(2, '0');
	return `${h}:${m}:${s}${separator}${String(t % 1000).padStart(3, '0')}`;
};

/** SubRip. Angle brackets are dropped because players read them as formatting tags. */
export const toSrt = (cues: readonly Cue[]): string =>
	cues.map((c, i) => `${i + 1}\n${stamp(c.startMs, ',')} --> ${stamp(c.endMs, ',')}\n${c.lines.map((l) => l.replace(/[<>]/g, '')).join('\n')}\n`).join('\n');

const escVtt = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** WebVTT, with &, < and > escaped as the format requires. */
export const toVtt = (cues: readonly Cue[]): string =>
	`WEBVTT\n\n${cues.map((c) => `${stamp(c.startMs, '.')} --> ${stamp(c.endMs, '.')}\n${c.lines.map(escVtt).join('\n')}\n`).join('\n')}`;

/** The caption text spoken inside a time window (for the spoken-disclosure check). */
export const textBetween = (captions: readonly Caption[], startMs: number, endMs: number): string =>
	captionText(captions.filter((c) => c.startMs >= startMs - 1 && c.startMs < endMs));
