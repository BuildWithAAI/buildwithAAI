/**
 * Scene direction (pure): from a storyboard scene and its timeline, when each item appears, when ZOO points or glances,
 * when expressions change (on blinks), and when Badger reacts. One function per template; scenes call directScene().
 */
import type {Expression} from '../../characters/types';
import type {Lang, StoryboardScene, TimelineScene} from '../types.ts';
import type {Format, BadgerPlace} from '../layout/specs.ts';
import type {ChartPlan} from '../chart/plan.ts';
import {findCueMs, normWord, revealTimes} from '../cues.ts';
import {msToFrame} from '../motion.ts';
import {UNSPACED} from '../markup.ts';
import {scheduleZoo, type Gesture, type Glance, type ZooChange, type ZooSchedule} from '../perf/zoo.ts';
import {defaultReactionFrame, scheduleBadger, type BadgerSchedule} from '../perf/badger.ts';

export type DirectionInput = {
	sc: StoryboardScene;
	tl: TimelineScene;
	format: Format;
	lang: Lang;
	fps: number;
	frames: number;
	seed: string;
	zooView: 'front' | 'threeQuarter' | 'side' | 'back';
	badgerPlace: BadgerPlace | null; // null: Badger not in this scene
	badgerInsert: boolean; // Badger reacts in an insert shot (vertical) instead of sharing the frame
	chart?: ChartPlan;
};

export type Direction = {
	zoo: ZooSchedule | null;
	badger: BadgerSchedule | null;
	reveals: number[]; // item reveal frames (bullets, steps, quote words)
	reactionAt: number;
	press: number | null; // CTA button press frame
	insert: {from: number; to: number} | null; // vertical Badger insert window [from, to)
	speechEnd: number;
};

const list = (sc: StoryboardScene, k: string): string[] => (Array.isArray(sc.onScreen?.[k]) ? (sc.onScreen?.[k] as string[]) : []);
const str = (sc: StoryboardScene, k: string): string => (typeof sc.onScreen?.[k] === 'string' ? (sc.onScreen?.[k] as string) : '');

/** Quote words matched in order against the narration words; unmatched words take their neighbour's time. */
export const quoteWordFrames = (quote: string, tl: TimelineScene, lang: Lang, fps: number): number[] => {
	const qs = UNSPACED.has(lang) ? Array.from(quote.replace(/\s+/g, '')) : quote.split(/\s+/).filter(Boolean);
	const words = tl.words;
	const out: Array<number | null> = [];
	let j = 0;
	for (const q of qs) {
		const n = normWord(q);
		let hit: number | null = null;
		for (let k = j; k < Math.min(words.length, j + 6); k++) {
			const w = normWord(words[k].text);
			if (n && w && (w === n || (UNSPACED.has(lang) ? w.includes(n) : w.startsWith(n) || n.startsWith(w)))) {
				hit = k;
				break;
			}
		}
		if (hit !== null) {
			out.push(msToFrame(words[hit].startMs, fps));
			j = UNSPACED.has(lang) ? hit : hit + 1;
		} else out.push(null);
	}
	const matched = out.filter((x) => x !== null).length;
	if (matched < qs.length * 0.5) {
		// the narration does not read the quote: reveal it word by word over the first 60% of the speech
		const end = Math.max(30, msToFrame(tl.speechMs * 0.6, fps));
		return qs.map((_, i) => Math.round(8 + ((end - 8) * i) / Math.max(1, qs.length)));
	}
	for (let i = 0; i < out.length; i++) if (out[i] === null) out[i] = i > 0 ? (out[i - 1] as number) : 6;
	for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i] as number, out[i - 1] as number);
	return out as number[];
};

export const directScene = (d: DirectionInput): Direction => {
	const {sc, tl, format, lang, fps, frames, seed} = d;
	const speechEnd = msToFrame(tl.speechMs, fps);
	const zooOn = sc.zoo?.present !== false;
	const expression: Expression = sc.zoo?.expression ?? 'neutral';
	const gestures: Gesture[] = [];
	const glances: Glance[] = [];
	const changes: ZooChange[] = [];
	const browBeats: number[] = [];
	const longBlinks: number[] = [];
	let reveals: number[] = [];
	let press: number | null = null;
	let reactionAt = defaultReactionFrame(frames, speechEnd);
	let baseLook: {lookX: number; lookY: number} | undefined;
	let startExpression: Expression = expression;
	const landscape = format === 'landscape';
	const canPoint = landscape && d.zooView === 'front' && sc.zoo?.pose !== 'stand';

	const toFrames = (ms: number[]) => ms.map((x) => msToFrame(x, fps));
	switch (sc.type) {
		case 'hook': {
			// the title lands in the first ~20 f; ZOO reacts right after: a brow lift, or a swap to the storyboard expression
			const land = 18;
			if (expression !== 'neutral') {
				startExpression = 'neutral';
				changes.push({frame: land + 10, expression});
			} else browBeats.push(land + 4);
			break;
		}
		case 'talk': {
			const bullets = list(sc, 'bullets');
			reveals = toFrames(revealTimes(bullets, tl.words, list(sc, 'cues').length ? list(sc, 'cues') : undefined, {lang, speechMs: tl.speechMs, firstMinMs: 500}));
			reveals.forEach((f, i) => {
				const point = canPoint && (i === 0 || (i === bullets.length - 1 && bullets.length >= 3));
				if (point) gestures.push({frame: f, hold: 42});
				else glances.push(landscape ? {frame: Math.max(0, f - 2), lookX: 0.65, lookY: 0.1, hold: 16} : {frame: Math.max(0, f - 2), lookX: 0, lookY: -0.75, hold: 14});
			});
			break;
		}
		case 'steps': {
			const steps = list(sc, 'steps');
			reveals = toFrames(revealTimes(steps, tl.words, list(sc, 'cues').length ? list(sc, 'cues') : undefined, {lang, speechMs: tl.speechMs, firstMinMs: 500}));
			for (const f of reveals) glances.push(landscape ? {frame: Math.max(0, f - 2), lookX: -0.7, lookY: 0.15, hold: 16} : {frame: Math.max(0, f - 2), lookX: 0, lookY: -0.75, hold: 14});
			break;
		}
		case 'quote': {
			reveals = quoteWordFrames(str(sc, 'quote'), tl, lang, fps);
			const last = reveals.length ? reveals[reveals.length - 1] : 30;
			if (landscape) glances.push({frame: 4, lookX: -0.55, lookY: 0.05, hold: Math.max(10, last + 14 - 4)});
			browBeats.push(Math.min(frames - 34, last + 20));
			break;
		}
		case 'chart': {
			const p = d.chart;
			baseLook = d.zooView === 'front' ? {lookX: landscape ? 0.6 : 0, lookY: landscape ? 0 : -0.6} : undefined;
			if (p?.rugDone !== null && p?.rugDone !== undefined) {
				// MO17 reaction beat: the rug completes, ZOO holds, then turns to camera (swap on a blink) for a deadpan beat
				const turn = Math.min(frames - 20, p.rugDone + 16);
				if (d.zooView !== 'front') changes.push({frame: turn, view: 'front', expression});
				else if (expression !== 'neutral') changes.push({frame: turn, expression});
				if (expression !== 'neutral' && d.zooView === 'front') startExpression = 'neutral';
				longBlinks.push(Math.min(frames - 20, turn + 30));
				reactionAt = Math.min(frames - 20, p.rugDone + 8);
			}
			break;
		}
		case 'cta': {
			const cue = list(sc, 'cues')[0] ?? str(sc, 'button') ?? '';
			const ms = cue ? findCueMs(tl.words, cue, 0, lang) : null;
			const subscribeMs = ms ?? findCueMs(tl.words, 'subscribe', 0, lang);
			press = subscribeMs !== null ? msToFrame(subscribeMs, fps) : Math.round(Math.max(speechEnd, 40) * 0.5);
			if (canPoint) gestures.push({frame: Math.max(14, press - 6), hold: 30});
			else glances.push({frame: Math.max(0, press - 8), lookX: landscape ? 0.6 : 0, lookY: landscape ? 0 : -0.7, hold: 20});
			break;
		}
		case 'endscreen': {
			// 20 s of moving hold: a glance at the slots, a brow lift, a long deadpan blink
			if (landscape) glances.push({frame: 54, lookX: 0.6, lookY: -0.1, hold: 46});
			browBeats.push(Math.min(frames - 40, 200));
			longBlinks.push(Math.min(frames - 30, 330));
			reactionAt = Math.min(frames - 30, 40);
			break;
		}
	}
	// onScreen.badgerCue: an explicit word for Badger's reaction
	const bc = str(sc, 'badgerCue');
	if (bc) {
		const ms = findCueMs(tl.words, bc, 0, lang);
		if (ms !== null) reactionAt = msToFrame(ms, fps);
	}
	reactionAt = Math.max(6, Math.min(reactionAt, frames - 12));
	const zoo = zooOn
		? scheduleZoo({
				fps,
				frames,
				seed: `${seed}:zoo`,
				words: tl.words,
				mouth: tl.mouth,
				expression: startExpression,
				view: d.zooView,
				gestures,
				glances,
				changes,
				browBeats,
				longBlinks,
				baseLook,
			})
		: null;
	const badgerOn = !!sc.badger?.present && !!d.badgerPlace;
	// insert shot (vertical): cut to Badger 10 f before his reaction, hold 1.5-2.5 s (to the end when that is close)
	let insert: Direction['insert'] = null;
	if (badgerOn && d.badgerInsert) {
		const len = Math.max(45, Math.min(75, frames - reactionAt + 10));
		const from = Math.max(0, Math.min(reactionAt - 10, frames - len));
		insert = {from, to: from + len >= frames - 6 ? frames + 1000 : from + len};
	}
	const badger = badgerOn
		? scheduleBadger({fps, frames, seed: `${seed}:badger`, reaction: sc.badger?.reaction ?? 'neutral', at: insert ? insert.from + 10 : reactionAt, place: d.badgerPlace as BadgerPlace})
		: null;
	return {zoo, badger, reveals, reactionAt, press, insert, speechEnd};
};
