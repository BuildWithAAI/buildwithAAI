/**
 * MOCK timeline (dev only, pure): lets the episode render before the voice step has run. Words are spread by length,
 * the mouth is a simple letter pattern, and there is NO audio. The result is marked `mock: true`, which the Episode
 * shows as a "SILENT PREVIEW" badge: a mock render must never be called lip-synced (PROJECT_INSTRUCTIONS).
 * Durations sit on the 100 ms grid, which is a whole number of frames at 30 fps.
 */
import type {MouthShape} from '../../characters/types';
import type {Storyboard, Timeline, TimelineScene, TimelineWord} from '../types.ts';
import {displayWords, UNSPACED} from '../markup.ts';

export type MockOpts = {fps?: number; leadMs?: number; tailMs?: number};

const ENDS = /[.!?…。！？।॥]$/;
const CLAUSE = /[,;:，、；：]$/;
const up100 = (ms: number) => Math.ceil(ms / 100) * 100;

const LETTER: Array<[RegExp, MouthShape]> = [
	[/[mbpमबपभफ]/, 'mbp'],
	[/[aáàâãäæाआअ]/, 'ah'],
	[/[eéèêëiíìîïyिीइईेैएऐ]/, 'ee'],
	[/[oóòôõöuúùûüwुूउऊोौओऔ]/, 'oh'],
];
const shapeOf = (ch: string): MouthShape => LETTER.find(([re]) => re.test(ch.toLowerCase()))?.[1] ?? 'slightlyOpen';

/** Letter-pattern mouth for one word over n frames, each shape held >= 2 frames. */
const wordMouth = (text: string, n: number): MouthShape[] => {
	const letters = Array.from(text.replace(/[^\p{L}\p{M}]/gu, '')) as string[];
	if (!letters.length || n <= 0) return Array(Math.max(0, n)).fill('slightlyOpen');
	const raw: MouthShape[] = [];
	for (let k = 0; k < n; k++) raw.push(shapeOf(letters[Math.min(letters.length - 1, Math.floor((k / n) * letters.length))]));
	for (let k = 1; k < n; k++) if (raw[k] !== raw[k - 1] && (k + 1 >= n || raw[k + 1] !== raw[k])) raw[k] = raw[k - 1]; // no 1-frame shapes
	return raw;
};

export const mockTimeline = (sb: Storyboard, o: MockOpts = {}): Timeline => {
	const fps = o.fps ?? 30;
	const lead = o.leadMs ?? 200;
	const tail = o.tailMs ?? 500;
	const unspaced = UNSPACED.has(sb.lang);
	let start = 0;
	const scenes: TimelineScene[] = sb.scenes.map((sc) => {
		const words: TimelineWord[] = [];
		let t = lead;
		for (const text of displayWords(sc.narration, sb.lang)) {
			const chars = Array.from(text.replace(/[^\p{L}\p{N}]/gu, '')).length;
			const dur = unspaced ? 90 + 190 * chars : 120 + 55 * chars;
			words.push({text, startMs: t, endMs: t + dur});
			t += dur + (ENDS.test(text) ? 380 : CLAUSE.test(text) ? 200 : 40);
		}
		const speechMs = words.length ? words[words.length - 1].endMs : 0;
		const minMs = Math.max((sc.minDurationSec ?? 0) * 1000, sc.type === 'endscreen' ? 20000 : 0, 1000);
		const durationMs = up100(Math.max(speechMs + tail, minMs));
		const frames = Math.round((durationMs * fps) / 1000);
		const mouth: MouthShape[] = Array(frames).fill('closed');
		words.forEach((w, i) => {
			// 1-frame lead (LP3): the shape shows one frame before its sound
			const f0 = Math.max(0, Math.round((w.startMs * fps) / 1000) - 1);
			const f1 = Math.max(f0 + 1, Math.round((w.endMs * fps) / 1000) - 1);
			wordMouth(w.text, f1 - f0).forEach((m, k) => {
				if (f0 + k < frames) mouth[f0 + k] = m;
			});
			const next = words[i + 1];
			if (next) {
				const g0 = f1;
				const g1 = Math.round((next.startMs * fps) / 1000) - 1;
				if (g1 - g0 > 0 && g1 - g0 < 4) for (let f = g0; f < g1; f++) mouth[f] = 'slightlyOpen'; // short pauses hold a relaxed mouth
			}
		});
		const scene: TimelineScene = {id: sc.id, audio: '', startMs: start, durationMs, speechMs, words, mouth};
		start += durationMs;
		return scene;
	});
	return {
		version: 1,
		slug: sb.slug,
		lang: sb.lang,
		mode: 'native',
		voice: 'mock',
		speed: 1,
		model: {file: 'none (mock timeline)', sha256: ''},
		sampleRate: 24000,
		fps,
		totalMs: start,
		scenes,
		warnings: ['MOCK timeline (src/episode/dev/mockTimeline.ts): silent preview; words spread by length; the mouth is a letter pattern, not lip-sync.'],
		mock: true,
	};
};
