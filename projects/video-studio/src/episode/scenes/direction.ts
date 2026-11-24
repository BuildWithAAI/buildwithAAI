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
	/** The scene's key visual beats [from, to): an insert never covers them (and Badger's reaction never hides them). */
	beats: Beat[];
	speechEnd: number;
};

/** A key visual beat of a scene, as a half-open frame window. A soft beat is kept clear only when there is room. */
export type Beat = {from: number; to: number; what: string; soft?: boolean};

/**
 * Badger's insert shot in Shorts (a hard cut to Badger alone). Fixed 2026-11-24 (review): it used to cut 10 f before
 * Badger's reaction, which in a chart scene is 2 f BEFORE the rug candle completes and in a CTA 1-7 f before the
 * button press, so the narrated payoff played over the dog. Now it comes after the scene's key beat, lasts about 1.5 s,
 * and cuts back to the main shot for at least 1 s when the scene has room (else it holds to the end of the scene).
 */
export const INSERT = {
	lead: 10, // frames from the cut to Badger's reaction
	len: 45, // about 1.5 s of Badger, then back to the main shot
	minLen: 24, // a reaction needs an action and an 8-15 f hold (MO17): shorter than this, no insert
	backMin: 30, // the main shot comes back for at least 1 s, or the insert holds to the cut
} as const;

/**
 * Where the insert goes: the first window at or after `desired` whose first INSERT.minLen frames cover no key beat; it
 * ends after INSERT.len frames or at the next key beat. With no later beat and less than INSERT.backMin frames left
 * after it, it holds to the end of the scene (and under the next scene's transition). Soft beats (ZOO's turn to camera
 * after the rug) are kept clear when that still leaves room; otherwise only the hard beats are. null: no room for a
 * readable reaction after the key beats.
 */
export const placeInsert = (desired: number, frames: number, beats: Beat[]): {from: number; to: number} | null => {
	const hard = beats.filter((b) => !b.soft);
	return placeAfter(desired, frames, beats) ?? (hard.length < beats.length ? placeAfter(desired, frames, hard) : null);
};

const placeAfter = (desired: number, frames: number, beats: Beat[]): {from: number; to: number} | null => {
	let from = Math.max(0, Math.round(desired));
	for (;;) {
		const hit = beats.find((b) => from < b.to && b.from < from + INSERT.minLen);
		if (!hit) break;
		from = hit.to;
	}
	if (from + INSERT.minLen > frames) return null;
	const next = Math.min(Infinity, ...beats.filter((b) => b.from >= from + INSERT.minLen).map((b) => b.from));
	const to = Math.min(from + INSERT.len, next);
	if (next === Infinity && frames - to < INSERT.backMin) return {from, to: frames + 1000};
	return {from, to};
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
	const beats: Beat[] = [];
	let insertAt: number | null = null; // where an insert would like to start (null: before the default reaction beat)
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
			beats.push({from: 0, to: land + 18, what: 'title lands, ZOO reacts'});
			break;
		}
		case 'talk': {
			const bullets = list(sc, 'bullets');
			reveals = toFrames(revealTimes(bullets, tl.words, list(sc, 'cues').length ? list(sc, 'cues') : undefined, {lang, speechMs: tl.speechMs, firstMinMs: 500}));
			reveals.forEach((f, i) => {
				const point = canPoint && (i === 0 || (i === bullets.length - 1 && bullets.length >= 3));
				if (point) gestures.push({frame: f, hold: 42});
				else glances.push(landscape ? {frame: Math.max(0, f - 2), lookX: 0.65, lookY: 0.1, hold: 16} : {frame: Math.max(0, f - 2), lookX: 0, lookY: -0.75, hold: 14});
				beats.push({from: f - 2, to: f + 12, what: `bullet ${i + 1} appears`});
			});
			break;
		}
		case 'steps': {
			const steps = list(sc, 'steps');
			reveals = toFrames(revealTimes(steps, tl.words, list(sc, 'cues').length ? list(sc, 'cues') : undefined, {lang, speechMs: tl.speechMs, firstMinMs: 500}));
			reveals.forEach((f, i) => {
				glances.push(landscape ? {frame: Math.max(0, f - 2), lookX: -0.7, lookY: 0.15, hold: 16} : {frame: Math.max(0, f - 2), lookX: 0, lookY: -0.75, hold: 14});
				beats.push({from: f - 2, to: f + 12, what: `step ${i + 1} appears`});
			});
			break;
		}
		case 'quote': {
			reveals = quoteWordFrames(str(sc, 'quote'), tl, lang, fps);
			const last = reveals.length ? reveals[reveals.length - 1] : 30;
			if (landscape) glances.push({frame: 4, lookX: -0.55, lookY: 0.05, hold: Math.max(10, last + 14 - 4)});
			browBeats.push(Math.min(frames - 34, last + 20));
			// the quote builds word by word, then its attribution and source draw on (Quote.tsx: last + 8 .. last + 24)
			beats.push({from: (reveals[0] ?? 0) - 2, to: last + 24, what: 'the quote builds, attribution and source appear'});
			break;
		}
		case 'chart': {
			const p = d.chart;
			const turn = p?.rugDone !== null && p?.rugDone !== undefined ? Math.min(frames - 20, p.rugDone + 16) : null;
			if (d.zooView === 'front') {
				// landscape: he watches the chart (eyes on it), points as the pump completes, then darts to camera for the
				// deadpan beat after the rug (MO17), with the expression swap hidden in that blink
				const watchEnd = turn ?? frames;
				glances.push(landscape ? {frame: 2, lookX: 0.6, lookY: 0, hold: Math.max(4, watchEnd - 4)} : {frame: 2, lookX: 0, lookY: -0.6, hold: Math.max(4, watchEnd - 4)});
				if (canPoint && p?.pumpDone !== null && p?.pumpDone !== undefined) gestures.push({frame: p.pumpDone, hold: 40});
				if (turn !== null) {
					if (expression !== 'neutral') {
						startExpression = 'neutral';
						changes.push({frame: turn, expression});
					} else changes.push({frame: turn}); // a blink with the gaze shift (LP7)
				}
			} else {
				// 3/4 (Shorts): he watches the chart above him, then turns to camera on a blink and looks into the lens
				glances.push({frame: 2, lookX: 0, lookY: -0.6, hold: Math.max(4, (turn ?? frames) - 4)});
				if (turn !== null) changes.push({frame: turn, view: 'front', expression});
			}
			if (turn !== null && p?.rugDone !== null && p?.rugDone !== undefined) {
				longBlinks.push(Math.min(frames - 20, turn + 30));
				reactionAt = Math.min(frames - 20, p.rugDone + 8);
				// key beats: the rug candle forms and the finished chart holds (the callout flips to the drop), then ZOO's
				// turn to camera; Badger's insert comes after both (Shorts)
				const rug = p.rugFrames ?? 12;
				const hold = p.rugHold ?? 18;
				beats.push({from: p.rugDone - rug, to: p.rugDone + hold, what: 'the rug candle forms and holds'});
				beats.push({from: turn - 2, to: turn + 10, what: "ZOO's turn to camera", soft: true});
				insertAt = p.rugDone + hold;
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
			// the button press (Cta.tsx: scale down over 3 f, back over 7 f, fill turns dark)
			beats.push({from: press - 6, to: press + 12, what: 'the button press'});
			insertAt = press + 12;
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
	// insert shot (vertical): after the scene's key beats (an explicit badgerCue still decides when he reacts, unless
	// that would cover a beat), Badger's reaction INSERT.lead frames after the cut
	let insert: Direction['insert'] = null;
	if (badgerOn && d.badgerInsert) insert = placeInsert(bc || insertAt === null ? reactionAt - INSERT.lead : insertAt, frames, beats);
	const badger =
		badgerOn && (insert || !d.badgerInsert)
			? scheduleBadger({fps, frames, seed: `${seed}:badger`, reaction: sc.badger?.reaction ?? 'neutral', at: insert ? insert.from + INSERT.lead : reactionAt, place: d.badgerPlace as BadgerPlace})
			: null;
	return {zoo, badger, reveals, reactionAt: insert ? insert.from + INSERT.lead : reactionAt, press, insert, beats, speechEnd};
};
