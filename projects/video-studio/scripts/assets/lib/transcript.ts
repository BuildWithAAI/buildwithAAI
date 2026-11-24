/**
 * Transcript, chapters and caption cues from the timeline (the voice step's word timings) and the storyboard.
 * Times are absolute episode milliseconds. Without a timeline, the transcript falls back to the storyboard's display
 * text and has no times.
 */
import {displayText, sourceIds, UNSPACED} from './markup.ts';
import type {EpisodeStoryboard, EpisodeTimeline, Lang, StoryboardScene} from './types.ts';
import {truncate} from './util.ts';

export type Paragraph = {sceneId: string; sceneType: string; startMs: number | null; endMs: number | null; text: string; sourceIds: string[]};

export type Chapter = {startMs: number; endMs: number; title: string; sceneIds: string[]};

export type Cue = {startMs: number; endMs: number; text: string};

const joinWords = (words: string[], lang: Lang): string => (UNSPACED.has(lang) ? words.join('') : words.join(' ')).replace(/\s+/g, ' ').trim();

export const paragraphs = (sb: EpisodeStoryboard, tl: EpisodeTimeline | null): Paragraph[] =>
	sb.scenes
		.map((scene, i) => {
			const ts = tl?.scenes[i];
			const text = ts && ts.words.length ? joinWords(ts.words.map((w) => w.text), sb.lang) : displayText(scene.narration);
			return {
				sceneId: scene.id,
				sceneType: scene.type,
				startMs: ts ? ts.startMs : null,
				endMs: ts ? ts.startMs + ts.durationMs : null,
				text,
				sourceIds: sourceIds(scene.narration),
			};
		})
		.filter((p) => p.text.length > 0);

const onScreenString = (scene: StoryboardScene, key: string): string | null => {
	const v = scene.onScreen?.[key];
	return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/** A chapter title for a scene: its on-screen title, else the start of its narration. */
export const sceneTitle = (scene: StoryboardScene): string => {
	const title = onScreenString(scene, 'title');
	if (title) return truncate(title, 70);
	const text = displayText(scene.narration);
	return text ? truncate(text, 48) : scene.type;
};

export type ChapterOptions = {minChapterMs?: number};

/**
 * Chapters from scene boundaries. A scene shorter than minChapterMs (default 10 s, YouTube's minimum and a sensible
 * podcast minimum) joins the chapter before it (the first scene joins the next one instead). The first chapter
 * starts at 0 and each chapter ends where the next starts.
 */
export const chapters = (sb: EpisodeStoryboard, tl: EpisodeTimeline | null, opts: ChapterOptions = {}): Chapter[] => {
	if (!tl) return [];
	const min = opts.minChapterMs ?? 10_000;
	const raw: Chapter[] = sb.scenes.map((scene, i) => ({
		startMs: tl.scenes[i].startMs,
		endMs: tl.scenes[i].startMs + tl.scenes[i].durationMs,
		title: sceneTitle(scene),
		sceneIds: [scene.id],
	}));
	const out: Chapter[] = [];
	let carry: Chapter | null = null; // short leading scenes waiting to join the next chapter
	for (const ch of raw) {
		const cur: Chapter = carry ? {startMs: carry.startMs, endMs: ch.endMs, title: carry.title, sceneIds: [...carry.sceneIds, ...ch.sceneIds]} : ch;
		carry = null;
		const last = out[out.length - 1];
		if (cur.endMs - cur.startMs < min || (last && last.title === cur.title)) {
			if (last) {
				last.endMs = cur.endMs;
				last.sceneIds.push(...cur.sceneIds);
			} else carry = cur;
			continue;
		}
		out.push(cur);
	}
	if (carry) out.push(carry); // everything was short: one chapter
	if (out.length) out[0].startMs = 0;
	for (let i = 0; i < out.length - 1; i++) out[i].endMs = out[i + 1].startMs;
	if (out.length) out[out.length - 1].endMs = Math.max(out[out.length - 1].endMs, tl.totalMs);
	return out;
};

const CUE_MAX_CHARS = 42;
const CUE_MAX_MS = 6000;

/** Caption cues (WebVTT/SRT) from timeline words: at most ~42 characters or 6 s, broken after sentence ends. */
export const cues = (tl: EpisodeTimeline, lang: Lang): Cue[] => {
	const out: Cue[] = [];
	for (const scene of tl.scenes) {
		let words: string[] = [];
		let start = 0;
		let end = 0;
		const flush = () => {
			if (words.length) out.push({startMs: scene.startMs + start, endMs: scene.startMs + end, text: joinWords(words, lang)});
			words = [];
		};
		for (const w of scene.words) {
			const next = joinWords([...words, w.text], lang);
			if (words.length && ([...next].length > CUE_MAX_CHARS || w.endMs - start > CUE_MAX_MS)) flush();
			if (!words.length) start = w.startMs;
			words.push(w.text);
			end = w.endMs;
			if (/[.!?…。！？]["'”’»)]*$/u.test(w.text)) flush();
		}
		flush();
	}
	// never overlap, never zero length
	for (let i = 0; i < out.length; i++) {
		if (i + 1 < out.length && out[i].endMs > out[i + 1].startMs) out[i].endMs = out[i + 1].startMs;
		if (out[i].endMs <= out[i].startMs) out[i].endMs = out[i].startMs + 1;
	}
	return out;
};

const vttTime = (ms: number): string => {
	const t = Math.max(0, Math.round(ms));
	const h = Math.floor(t / 3_600_000);
	const m = Math.floor((t % 3_600_000) / 60_000);
	const s = Math.floor((t % 60_000) / 1000);
	const r = t % 1000;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
};

/** WebVTT. Cue text is escaped (&, <, >) as the format requires. */
export const toVtt = (list: Cue[]): string =>
	`WEBVTT\n\n${list.map((c, i) => `${i + 1}\n${vttTime(c.startMs)} --> ${vttTime(c.endMs)}\n${c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`).join('\n')}`;

export const toSrt = (list: Cue[]): string =>
	list.map((c, i) => `${i + 1}\n${vttTime(c.startMs).replace('.', ',')} --> ${vttTime(c.endMs).replace('.', ',')}\n${c.text.replace(/\r?\n/g, ' ')}\n`).join('\n');
