/**
 * Zoo's lines (pure): a scene's timeline words split into sentences. Badger's beats land after a line, so a line is
 * the unit of comic timing: Zoo says it, Badger answers it with a look.
 */
import type {TimelineWord} from '../../episode/types.ts';
import {findCueMs} from '../../episode/cues.ts';

const LINE_END = /[.!?…。！？।॥]["'”’)\]]*$/;

export type Line = {first: number; last: number; startMs: number; endMs: number};

export const splitLines = (words: TimelineWord[]): Line[] => {
	const out: Line[] = [];
	let first = 0;
	words.forEach((w, i) => {
		if (LINE_END.test(w.text) || i === words.length - 1) {
			out.push({first, last: i, startMs: words[first].startMs, endMs: w.endMs});
			first = i + 1;
		}
	});
	return out;
};

/**
 * End (scene ms) of the line a beat follows: 'end' = the last line; a number = that line (clamped to the last);
 * a cue word = the line containing its first match. Null when the scene has no words (a silent beat scene).
 */
export const lineEndMs = (words: TimelineWord[], after: 'end' | number | string | undefined, lang: string): number | null => {
	const lines = splitLines(words);
	if (!lines.length) return null;
	if (after === undefined || after === 'end') return lines[lines.length - 1].endMs;
	if (typeof after === 'number') return lines[Math.max(0, Math.min(lines.length - 1, Math.floor(after)))].endMs;
	const ms = findCueMs(words, after, 0, lang);
	if (ms === null) return lines[lines.length - 1].endMs;
	const idx = words.findIndex((w) => w.startMs === ms);
	const line = lines.find((l) => idx >= l.first && idx <= l.last) ?? lines[lines.length - 1];
	return line.endMs;
};
