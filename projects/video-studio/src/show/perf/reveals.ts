/**
 * When each segment's graphics appear (pure; scene-local frames). Items land on the words that name them (the episode
 * engine's cue matcher, src/episode/cues.ts, so storyboards can use onScreen.cues the same way), or are spread over
 * the speech when no word matches. The plan uses the same numbers for Zoo's point gestures and glances, so his eyes and
 * hands always meet the graphic as it arrives.
 */
import type {TimelineWord} from '../../episode/types.ts';
import {findCueMs, revealTimes} from '../../episode/cues.ts';
import {msToFrame} from '../../episode/motion.ts';
import type {ShowScene, ShowSegment} from '../types.ts';
import {list, str} from '../segments.ts';

export type Reveals = {
	card: number; // the main graphic starts entering
	items: number[]; // nodes / rows / bullets, in order
	meter: number | null; // the Rekt Meter needle starts its sweep
};

const f = (ms: number, fps: number) => msToFrame(ms, fps);

export const sceneReveals = (sc: ShowScene, seg: ShowSegment, words: TimelineWord[], speechMs: number, fps: number, lang: string): Reveals => {
	const cues = list(sc, 'cues');
	const times = (items: string[], useCues = true) => revealTimes(items, words, useCues && cues.length ? cues : undefined, {lang, speechMs: Math.max(speechMs, 600)}).map((ms) => f(ms, fps));
	switch (seg) {
		case 'coldOpen':
			return {card: 10, items: [], meter: null};
		case 'headline': {
			const loss = str(sc, 'loss');
			const ms = loss ? findCueMs(words, loss, 0, lang) : null;
			return {card: 4, items: [], meter: sc.rekt ? (ms !== null ? Math.max(12, f(ms, fps) - 2) : 18) : null};
		}
		case 'howItWorked':
			return {card: 4, items: times(list(sc, 'nodes')), meter: null};
		case 'badgerRedFlag':
			return {card: 8, items: [], meter: null};
		case 'zooOneFix': {
			const fix = str(sc, 'fix') ?? '';
			const [at] = times([fix], false);
			const detail = str(sc, 'detail');
			return {card: Math.max(6, (at ?? 10) - 4), items: detail ? [Math.max((at ?? 10) + 14, times([detail], false)[0] ?? 0)] : [], meter: null};
		}
		case 'scamOfTheWeek': {
			const rows = ['how', 'tell', 'fix'].map((k) => str(sc, k)).filter((x): x is string => !!x);
			return {card: 2, items: times(rows, false).map((x) => Math.max(14, x)), meter: null};
		}
		case 'correction': {
			const wrong = str(sc, 'wrong');
			const correct = str(sc, 'correct') ?? '';
			const [c] = times([correct], false);
			return {card: 4, items: wrong ? [12, Math.max(30, c ?? 30)] : [Math.max(12, c ?? 12)], meter: null};
		}
		case 'sources':
			return {card: 2, items: [], meter: null};
		case 'outroEndScreen':
			return {card: 6, items: [], meter: null};
		case 'beat':
			return {card: 0, items: [], meter: null};
		case 'desk': {
			const items = list(sc, 'bullets').length ? list(sc, 'bullets') : list(sc, 'steps');
			return {card: 4, items: items.length ? times(items) : [], meter: null};
		}
	}
};
