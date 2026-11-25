/**
 * The Episode's and the EpisodeShort's sound plan (pure TypeScript: it runs in calculateMetadata, in Node tools and in
 * tests, so all three read exactly what the render plays). planEpisodeAudio() turns a storyboard and the voice
 * step's timeline into plain JSON: which bed plays where (one clock), how it changes, the duck, the brand sting, every
 * sound effect, the windows that must stay voice-free and the phrases the gate protects. Rules: docs/EPISODE_ENGINE.md
 * ("Sound"); numbers: constants.ts. The plan's hash binds the render and the gate to one plan (critic F1).
 *
 * Who decides what:
 *  - the MASTER storyboard and timeline (sourceLang) decide the moods by scene (the region map) and the clock offset, so
 *    every language plays the same music under the same scene (critic F14: a dub's plan never depends on which files
 *    happen to exist; a non-master render without the master timeline is an error);
 *  - the voice that PLAYS (this render's timeline) decides every position: the bed changes (in its voice-free windows),
 *    the duck (its words), every voice check of an effect;
 *  - the PICTURE decides the events an effect lands on (reveals, the CTA press, transitions): this storyboard's picture,
 *    or the master's for an audio track fitted to the master video (timeline.mode 'fit-to-master').
 */
import type {Lang, SceneType, Storyboard, StoryboardScene, Timeline, TimelineScene} from '../types.ts';
import type {Format} from '../layout/specs.ts';
import type {ChartPlan} from '../chart/plan.ts';
import {episodeSpans, shortSpans, silentEdges, SLIDE_PUSH, transitionProgress, type SceneSpan} from '../timing.ts';
import {directScene, sceneCast} from '../scenes/direction.ts';
import {normWord} from '../cues.ts';
import {DuckCurve, mergeSpans, type FadeCurve, type Rest, type Span} from '../../audio/core/envelope.ts';
import {cue as sfxCue, type SfxManifest} from '../../audio/core/sfx.ts';
import {peakBudgetTrimDb, placeStinger, resolveCue, type MusicManifest} from '../../audio/core/music.ts';
import {hash32} from '../../audio/core/variation.ts';
import {
	BAR_FRAMES,
	BEAT_HOLD_FRAMES,
	BEAT_LEAD_FRAMES,
	CLOCK,
	DUCK,
	END_FADE_FRAMES,
	END_SCREEN,
	FPS,
	GATE,
	HOLD_PAUSE_MAX_SEC,
	LOOP_FRAMES,
	LOOP_SEC,
	MIN_CHANGE_SPACING_FRAMES,
	MIN_REGION_FRAMES,
	MUSIC_OUT,
	OPENING_FADE,
	PHRASE_FRAMES,
	REST_FLOOR_DB,
	SAMPLE_RATE,
	SAMPLES_PER_FRAME,
	SFX_LEVELS,
	SFX_RULES,
	SFX_SOUNDS,
	STING,
	WHOOSH_TAIL_FRAMES,
	WORD_PAD_END_SEC,
	XFADE,
} from './constants.ts';
import {harmonicClashes, STORY_BEDS, underscoreOf, type Mood, type StoryBed} from './moods.ts';
import {bedLufsOver, bedTrimDb, worstPhraseMargin, type BedLevelTable, type PhraseBed} from './levels.ts';
import {planHash} from './hash.ts';
import {EN_STING_TAGLINE} from '../i18n/ui.ts';

export type AudioStem = 'voice' | 'music' | 'sfx';
export const AUDIO_STEMS: readonly AudioStem[] = ['voice', 'music', 'sfx'];

/** Listening variants for the owner's A/B clips (tools only; a delivery render never uses one, and its hash differs). */
export type PlanVariant = {
	/** 'gaps' (the rule), 'onFrame' (every item on its reveal frame, 3 dB down on a word) or 'none' */
	sfx?: 'gaps' | 'onFrame' | 'none';
	releaseMs?: number;
	/** false: the opening bed starts at full (ducked) level on frame 0 instead of fading in over the first sentence */
	openingFade?: boolean;
	/** force the sting on (or off) */
	sting?: boolean;
	offsetPhrase?: number;
	/** every story scene in this mood (gate calibration: the louder beds too) */
	mood?: StoryBed;
};

export type PlanInput = {
	format: Format;
	storyboard: Storyboard;
	timeline: Timeline;
	shortId?: string | null;
	/** the master (sourceLang) storyboard and timeline; required unless this storyboard is the master */
	master?: {storyboard: Storyboard; timeline: Timeline} | null;
	/** this render's chart plans by scene id (calculateMetadata's) */
	charts: Record<string, ChartPlan>;
	/** the master's chart plans (picture events of an audio track fitted to the master video) */
	masterCharts?: Record<string, ChartPlan>;
	lib: {music: MusicManifest; sfx: SfxManifest; levels: BedLevelTable};
	variant?: PlanVariant | null;
};

export type PlanBed = {
	key: string;
	cue: string;
	file: string;
	mood: Mood;
	/** the bed's Sequence: first frame and length */
	from: number;
	durationInFrames: number;
	/** loop position at `from`: (clock offset + from / fps) mod 64 s, as a sample and in seconds */
	startAtSample: number;
	startAtSec: number;
	levelDb: number;
	fadeInFrames: number;
	fadeInCurve: FadeCurve;
	fadeOutFrames: number;
	fadeOutCurve: FadeCurve;
	/** absolute seconds; floorDb = a dip, not silence */
	rests: Rest[];
	why: string;
};

export type ChangeKind = 'crossfade' | 'breath' | 'out' | 'in' | 'opening-fade' | 'end-fade' | 'music-up' | 'music-out' | 'music-back' | 'sting-rest';

export type PlanChange = {
	kind: ChangeKind;
	/** frames [from, to) */
	from: number;
	to: number;
	fromCue: string | null;
	toCue: string | null;
	/** the voice-free window it had to fit, when it is a scene change */
	window: [number, number] | null;
	note: string;
};

export type PlanSfx = {
	id: string;
	file: string;
	at: number;
	from: number;
	durationInFrames: number;
	gainDb: number;
	label: string;
	scene: string;
	event: string;
	eventFrame: number;
	targetLufs: number;
	overVoice: boolean;
};

export type DroppedSfx = {scene: string; event: string; frame: number; why: string};

export type PlanScene = {
	id: string;
	type: SceneType;
	from: number;
	frames: number;
	firstVoiced: number;
	soundEnd: number;
	transition: string;
	transitionFrames: number;
	preroll: number;
	reactionAt: number;
};

export type EpisodeAudioPlan = {
	version: 1;
	format: Format;
	fps: number;
	sampleRate: number;
	channel: string;
	slug: string;
	lang: Lang;
	shortId: string | null;
	durationInFrames: number;
	/** a mock timeline: no music and no effects (the SILENT PREVIEW badge stays true) */
	silent: boolean;
	master: {lang: Lang; mode: 'self' | 'native' | 'fit-to-master'};
	variant: PlanVariant | null;
	/** scene id -> mood, decided on the master */
	regionMap: Record<string, Mood>;
	regions: Array<{mood: Mood; cue: string | null; from: number; to: number; scenes: string[]; loops: number}>;
	clock: {offsetPhrase: number; offsetSec: number; offsetSamples: number; source: 'override' | 'estimate' | 'fallback' | 'variant'; candidates: Array<{k: number; worstMarginLu: number; atSec: number}>};
	duck: {split: boolean; crossoversHz: number[]; depthsDb: number[]; attackMs: number; releaseMs: number; lookaheadMs: number; minGapMs: number};
	/** where Zoo speaks (word start to end + 60 ms), composition seconds: the gate's speech mask */
	words: Span[];
	/** spans the duck holds on top of the words, with why */
	virtual: Array<Span & {why: string}>;
	/** the duck's input: words and virtual spans, sorted */
	speech: Span[];
	beds: PlanBed[];
	stingers: Array<{id: string; file: string; from: number; downbeat: number; durationInFrames: number; levelDb: number; why: string}>;
	sfx: PlanSfx[];
	droppedSfx: DroppedSfx[];
	changes: PlanChange[];
	/** frame windows the voice stem must be silent in (crossfades, bed fades, the sting slot, every transition) */
	voiceFree: Array<{from: number; to: number; why: string}>;
	/** phrases with a stricter gate: the first second of speech, a spoken disclosure */
	protect: Array<{start: number; end: number; why: 'hook' | 'disclosure'}>;
	scenes: PlanScene[];
	picture: {forceCut: string[]; sting: {from: number; durationInFrames: number; tagline: string | null} | null};
	gate: typeof GATE & {phone: boolean};
	warnings: string[];
	hash: string;
};

// ------------------------------------------------------------------------------------------------ small helpers

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const r3 = (x: number): number => Math.round(x * 1e3) / 1e3;
const sec = (frame: number): number => frame / FPS;
const fMs = (frames: number): number => r3((frames * 1000) / FPS);
const mod = (a: number, m: number): number => ((a % m) + m) % m;

const isStory = (m: Mood): m is StoryBed => (STORY_BEDS as readonly string[]).includes(m);
/** The bed a mood plays (the end screen plays resolve-underscore under its outro line). */
const cueOf = (m: Mood): string | null => (isStory(m) ? underscoreOf(m) : m === 'end' ? END_SCREEN.under : null);

const sentenceEnd = /[.!?…。！？।]$/;

// ------------------------------------------------------------------------------------------------ the voice that plays

type VScene = {
	id: string;
	index: number;
	type: SceneType;
	sc: StoryboardScene;
	tl: TimelineScene;
	span: SceneSpan;
	from: number;
	frames: number;
	/** words in composition seconds (start, end), cut at the scene's window end in a Short */
	words: Array<{start: number; end: number; text: string}>;
	firstVoiced: number;
	soundEnd: number;
};

const voiceScenes = (sb: Storyboard, tl: Timeline, spans: SceneSpan[]): VScene[] =>
	spans.map((s) => {
		const sc = sb.scenes[s.index];
		const ts = tl.scenes[s.index];
		const until = sec(s.from + s.durationInFrames);
		const words: VScene['words'] = [];
		for (const w of ts.words) {
			if (!(w.endMs > w.startMs)) continue;
			const start = sec(s.from) + w.startMs / 1000;
			if (start >= until) continue;
			words.push({start, end: Math.min(until, sec(s.from) + w.endMs / 1000), text: w.text});
		}
		const edges = silentEdges(ts, s.durationInFrames);
		const speaks = edges.lead < s.durationInFrames || words.length > 0;
		let firstVoiced = s.from + s.durationInFrames;
		let soundEnd = s.from;
		if (speaks) {
			const mouthFirst = edges.lead < s.durationInFrames ? s.from + edges.lead : Infinity;
			const mouthEnd = edges.lead < s.durationInFrames ? s.from + s.durationInFrames - edges.tail : -Infinity;
			const wordFirst = words.length ? Math.floor(words[0].start * FPS + 1e-9) : Infinity;
			const wordEnd = words.length ? Math.ceil((words[words.length - 1].end + WORD_PAD_END_SEC) * FPS - 1e-9) : -Infinity;
			firstVoiced = Math.min(mouthFirst, wordFirst);
			soundEnd = Math.min(s.from + s.durationInFrames, Math.max(mouthEnd, wordEnd));
		}
		return {id: s.id, index: s.index, type: sc.type, sc, tl: ts, span: s, from: s.from, frames: s.durationInFrames, words, firstVoiced, soundEnd};
	});

/** Frames where Zoo is heard: an open mouth, or a word (one frame before its start to its end + 60 ms). */
const voicedMask = (scenes: VScene[], total: number): Uint8Array => {
	const m = new Uint8Array(total);
	for (const s of scenes) {
		const mouth = Array.isArray(s.tl.mouth) ? s.tl.mouth : [];
		for (let i = 0; i < Math.min(mouth.length, s.frames); i++) if (mouth[i] !== 'closed' && s.from + i < total) m[s.from + i] = 1;
		for (const w of s.words) {
			const a = Math.max(0, Math.floor((w.start - 1 / FPS) * FPS));
			const b = Math.min(total, Math.ceil((w.end + WORD_PAD_END_SEC) * FPS));
			for (let f = a; f < b; f++) m[f] = 1;
		}
	}
	return m;
};

/** The voice-free window [W0, W1) between scene a and the next scene b (one guard frame each side). */
const windowBetween = (a: VScene, b: VScene): [number, number] => {
	const w0 = a.soundEnd + XFADE.guardFrames;
	// a silent incoming scene changes the bed at its picture cut, not at its end
	const w1 = Math.min(b.firstVoiced - XFADE.guardFrames, b.from + 12);
	return [w0, Math.max(w0, w1)];
};

// ------------------------------------------------------------------------------------------------ the picture

type PicEvents = {
	id: string;
	from: number;
	frames: number;
	transition: SceneSpan['transition'];
	transitionFrames: number;
	preroll: number;
	reveals: number[];
	press: number | null;
	rugDone: number | null;
	turn: number | null;
	reactionAt: number;
};

const pictureEvents = (sb: Storyboard, tl: Timeline, spans: SceneSpan[], format: Format, charts: Record<string, ChartPlan>): Map<string, PicEvents> => {
	const out = new Map<string, PicEvents>();
	for (const s of spans) {
		const sc = sb.scenes[s.index];
		const chart = charts[sc.id];
		const d = directScene({sc, tl: tl.scenes[s.index], format, lang: sb.lang, fps: FPS, frames: s.durationInFrames, seed: `${sb.slug}:${sc.id}:${format}`, chart, ...sceneCast(sc, format)});
		const rugDone = chart?.rugDone ?? null;
		const turn = rugDone !== null ? Math.min(s.durationInFrames - 20, rugDone + 16) : null; // direction.ts: the deadpan turn after the rug
		out.set(sc.id, {
			id: sc.id,
			from: s.from,
			frames: s.durationInFrames,
			transition: s.transition,
			transitionFrames: s.transitionFrames,
			preroll: s.preroll,
			reveals: sc.type === 'talk' || sc.type === 'steps' ? d.reveals : [],
			press: d.press,
			rugDone,
			turn,
			reactionAt: d.reactionAt,
		});
	}
	return out;
};

/** The frame (0-based within a T-frame transition) where its motion is fastest (critic F8: not the midpoint). */
export const motionPeakFrame = (kind: 'wipe' | 'slide', frames: number): number => {
	let best = 0;
	let bestV = -Infinity;
	for (let k = 0; k < frames; k++) {
		// frame k of a T-frame transition shows t = k + 1 (timing.ts)
		const p0 = k === 0 ? 0 : transitionProgress(kind, k, frames);
		const p1 = transitionProgress(kind, k + 1, frames);
		const v = kind === 'wipe' ? p1 - p0 : (p1 - p0) * SLIDE_PUSH * transitionProgress('fade', k + 1, frames);
		if (v > bestV + 1e-12) {
			bestV = v;
			best = k;
		}
	}
	return best;
};

// ------------------------------------------------------------------------------------------------ moods by act (master)

type Run = {mood: Mood; first: number; last: number; explicit: boolean};

/**
 * The region map, decided on the master's own timeline (critic F4: by act, not by template). One story mood for the
 * whole episode (curious, or the hook's `bed`); it changes only where a scene sets `bed`, and every later scene
 * inherits it. A default opening region shorter than 8 bars joins the next one; a region the writer set is kept
 * (with a warning when short); a change less than 60 s after the previous one moves to the next scene boundary that
 * allows it, or is skipped. The end screen is always its own region (its own music, exempt from the spacing rule).
 */
export const regionMapFor = (sb: Storyboard, tl: Timeline, warnings: string[]): {map: Record<string, Mood>; runs: Array<Run & {from: number; to: number}>} => {
	const spans = episodeSpans(sb, tl, FPS);
	const moods: Array<{mood: Mood; explicit: boolean}> = [];
	let current: Mood = sb.scenes[0]?.bed ?? 'curious';
	sb.scenes.forEach((sc) => {
		if (sc.type === 'endscreen') moods.push({mood: sc.bed === 'none' ? 'none' : 'end', explicit: true});
		else if (sc.bed) {
			current = sc.bed;
			moods.push({mood: current, explicit: true});
		} else moods.push({mood: current, explicit: false});
	});
	const from = (i: number) => spans[i].from;
	const to = (i: number) => spans[i].from + spans[i].durationInFrames;
	let runs: Run[] = [];
	moods.forEach((m, i) => {
		const last = runs[runs.length - 1];
		if (last && last.mood === m.mood && m.mood !== 'end') last.last = i;
		else runs.push({mood: m.mood, first: i, last: i, explicit: m.explicit});
	});
	const remerge = () => {
		const out: Run[] = [];
		for (const r of runs) {
			const l = out[out.length - 1];
			if (l && l.mood === r.mood && r.mood !== 'end') l.last = r.last;
			else out.push({...r});
		}
		runs = out;
	};
	// a default opening shorter than 8 bars opens in the next region's mood instead
	if (runs.length > 1 && !runs[0].explicit && isStory(runs[0].mood) && isStory(runs[1].mood) && to(runs[0].last) - from(runs[0].first) < MIN_REGION_FRAMES) {
		runs[1] = {...runs[1], first: runs[0].first};
		runs.shift();
	}
	for (const r of runs)
		if (isStory(r.mood) && r.explicit && to(r.last) - from(r.first) < MIN_REGION_FRAMES)
			warnings.push(`music: the ${r.mood} region from scene ${sb.scenes[r.first].id} lasts ${((to(r.last) - from(r.first)) / FPS).toFixed(1)} s, under 8 bars (25.6 s); kept because the storyboard sets it`);
	// at most one change a minute (the end screen is exempt)
	let lastChange: number | null = null;
	for (let i = 1; i < runs.length; i++) {
		const r = runs[i];
		if (r.mood === 'end') continue;
		if (lastChange !== null && from(r.first) - lastChange < MIN_CHANGE_SPACING_FRAMES) {
			let k = r.first + 1;
			while (k <= r.last && from(k) - lastChange < MIN_CHANGE_SPACING_FRAMES) k++;
			if (k <= r.last) {
				warnings.push(`music: the change to ${r.mood} at scene ${sb.scenes[r.first].id} comes ${((from(r.first) - lastChange) / FPS).toFixed(1)} s after the previous change; it moves to scene ${sb.scenes[k].id} (at most one change a minute)`);
				runs[i - 1].last = k - 1;
				r.first = k;
			} else {
				warnings.push(`music: the change to ${r.mood} at scene ${sb.scenes[r.first].id} comes ${((from(r.first) - lastChange) / FPS).toFixed(1)} s after the previous change and is skipped (at most one change a minute)`);
				runs[i - 1].last = r.last;
				runs.splice(i, 1);
				remerge();
				i = 0;
				lastChange = null;
				continue;
			}
		}
		lastChange = from(r.first);
	}
	remerge();
	const map: Record<string, Mood> = {};
	for (const r of runs) for (let i = r.first; i <= r.last; i++) map[sb.scenes[i].id] = r.mood;
	return {map, runs: runs.map((r) => ({...r, from: from(r.first), to: to(r.last)}))};
};

// ------------------------------------------------------------------------------------------------ the clock

/** Speech phrases (word spans merged across gaps under 0.25 s, at least 0.4 s long): the gate's phrases. */
const phrasesOf = (words: Span[]): Span[] => mergeSpans(words, 0.25).filter((p) => p.end - p.start >= 0.4);

/** The seeded order of the 5 clock offsets: the loop's base section (k 0 or 1) first (critic F5), then the rest. */
export const offsetOrder = (seedKey: string): number[] => {
	const h = hash32(seedKey);
	const base = h % 2 === 0 ? [0, 1] : [1, 0];
	const rest = [2, 3, 4];
	const rot = h % 3;
	return [...base, ...rest.slice(rot), ...rest.slice(0, rot)];
};

// ------------------------------------------------------------------------------------------------ the plan

export const planEpisodeAudio = (input: PlanInput): EpisodeAudioPlan => {
	const {format, storyboard: sb, timeline: tl, lib} = input;
	const variant = input.variant ?? null;
	const short = format === 'vertical';
	const shortId = short ? (input.shortId ?? sb.shorts?.[0]?.id ?? null) : null;
	if (short && !shortId) throw new Error('EpisodeShort audio plan: the storyboard has no shorts');
	const warnings: string[] = [];
	const isMaster = sb.lang === sb.sourceLang;
	const master = isMaster ? {storyboard: sb, timeline: tl} : (input.master ?? null);
	const masterMode: EpisodeAudioPlan['master']['mode'] = isMaster ? 'self' : tl.mode === 'fit-to-master' ? 'fit-to-master' : 'native';
	const spansOwn0 = short ? shortSpans(sb, tl, shortId as string, FPS) : episodeSpans(sb, tl, FPS);
	const total = spansOwn0.length ? spansOwn0[spansOwn0.length - 1].from + spansOwn0[spansOwn0.length - 1].durationInFrames : 1;
	const durationInFrames = short ? total : Math.max(1, Math.round((tl.totalMs * FPS) / 1000));
	const base = {
		version: 1 as const,
		format,
		fps: FPS,
		sampleRate: SAMPLE_RATE,
		channel: sb.channel,
		slug: sb.slug,
		lang: sb.lang,
		shortId,
		durationInFrames,
		master: {lang: sb.sourceLang, mode: masterMode},
		variant,
		duck: {
			split: DUCK.split,
			crossoversHz: [700, 5000],
			depthsDb: [...DUCK.depthsDb],
			attackMs: DUCK.attackMs,
			releaseMs: variant?.releaseMs ?? DUCK.releaseMs,
			lookaheadMs: DUCK.attackMs,
			minGapMs: DUCK.minGapMs,
		},
		gate: {...GATE, phone: short},
	};
	if (tl.mock) {
		const silent: EpisodeAudioPlan = {
			...base,
			silent: true,
			regionMap: {},
			regions: [],
			clock: {offsetPhrase: 0, offsetSec: 0, offsetSamples: 0, source: 'fallback', candidates: []},
			words: [],
			virtual: [],
			speech: [],
			beds: [],
			stingers: [],
			sfx: [],
			droppedSfx: [],
			changes: [],
			voiceFree: [],
			protect: [],
			scenes: [],
			picture: {forceCut: [], sting: null},
			warnings: ['mock timeline: a silent preview, no music and no effects'],
			hash: '',
		};
		return {...silent, hash: planHash(silent as unknown as Record<string, unknown>)};
	}
	if (!master) throw new Error(`the ${sb.lang} audio plan needs the ${sb.sourceLang} master storyboard and timeline (moods and the clock follow the master in every language)`);
	if (master.timeline.mock) throw new Error(`the ${sb.sourceLang} master timeline is a mock: voice the master first (moods and the clock follow it)`);
	const msb = master.storyboard;
	const mtl = master.timeline;
	if (!isMaster) {
		const ids = sb.scenes.map((x) => x.id).join(',');
		if (ids !== msb.scenes.map((x) => x.id).join(',')) throw new Error(`the ${sb.lang} storyboard's scenes (${ids}) differ from the master's: the music follows the master by scene id`);
		const fields = (x: Storyboard) =>
			JSON.stringify({offset: x.music?.offset ?? null, sting: x.music?.sting ?? null, beds: x.scenes.map((s) => s.bed ?? null), shorts: (x.shorts ?? []).map((s) => s.bed ?? null)});
		if (fields(sb) !== fields(msb)) warnings.push(`music: the ${sb.lang} storyboard's bed, music or shorts[].bed fields differ from storyboard.json; the music follows storyboard.json`);
	}

	// ---- moods (master) and the region map
	const region = regionMapFor(msb, mtl, warnings);
	const masterShort = short ? (msb.shorts ?? []).find((x) => x.id === shortId) : undefined;
	let shortMood: Mood | null = null;
	if (short) {
		const own = shortSpans(sb, tl, shortId as string, FPS);
		if (masterShort?.bed) shortMood = masterShort.bed;
		else {
			const tally = new Map<Mood, {frames: number; first: number}>();
			own.forEach((s, k) => {
				const m = region.map[s.id] ?? 'curious';
				if (m === 'end') return;
				const t = tally.get(m) ?? {frames: 0, first: k};
				t.frames += s.durationInFrames;
				tally.set(m, t);
			});
			const best = [...tally.entries()].sort((a, b) => b[1].frames - a[1].frames || a[1].first - b[1].first)[0];
			shortMood = best ? best[0] : 'curious';
		}
	}
	if (variant?.mood) for (const id of Object.keys(region.map)) if (region.map[id] !== 'end' && region.map[id] !== 'none') region.map[id] = variant.mood;
	if (variant?.mood && short) shortMood = variant.mood;
	const moodOfScene = (id: string): Mood => (short ? (shortMood as Mood) : (region.map[id] ?? 'curious'));

	// ---- the brand sting (Episode, opt-in, off by default: critic F6)
	const stingOn = !short && (variant?.sting ?? msb.music?.sting === 'after-hook');
	const forceCut = new Set<string>();
	const vs0 = voiceScenes(sb, tl, spansOwn0);
	let sting: {scene: VScene; next: VScene; from: number; rest: Rest} | null = null;
	if (stingOn && vs0.length >= 2) {
		const fiction = !!msb.fiction;
		// in a fiction episode, never before the first story beat after the fiction card
		let si = 0;
		if (fiction) while (si < vs0.length - 2 && vs0[si].soundEnd < STING.fictionCardFrames) si++;
		const S = vs0[si];
		const N = vs0[si + 1];
		const picS = pictureEvents(sb, tl, [S.span], format, input.charts).get(S.id) as PicEvents;
		const start = Math.max(STING.minStartFrame, fiction ? STING.fictionCardFrames : 0, S.from + picS.reactionAt + STING.afterReactionFrames, S.soundEnd + 15);
		const end = start + STING.frames;
		if (end + STING.guardFrames > N.from) {
			const needSec = Math.ceil(((end + STING.guardFrames - S.from) / FPS) * 10) / 10;
			throw new Error(`music.sting: the slot after scene ${S.id} needs ${(end + STING.guardFrames - N.from) / FPS} s more; set minDurationSec: ${needSec} on ${S.id} (the jingle is 4.5 s and starts 1 s after Badger's reaction)`);
		}
		// no more than 4 s without narration in the first 12 s
		const firstEnd = STING.firstSec;
		const spoken = mergeSpans(
			vs0.flatMap((v) => v.words.map((w) => ({start: w.start, end: w.end + WORD_PAD_END_SEC}))),
			0.35,
		).reduce((a, s) => a + Math.max(0, Math.min(firstEnd, s.end) - Math.min(firstEnd, s.start)), 0);
		const silentSec = firstEnd - Math.min(firstEnd, spoken);
		if (start < firstEnd * FPS && silentSec > STING.maxSilentSecInFirst)
			throw new Error(`music.sting: with the sting at ${(start / FPS).toFixed(1)} s the first ${firstEnd} s hold ${silentSec.toFixed(1)} s without narration (at most ${STING.maxSilentSecInFirst}): drop the sting or place more story before it`);
		const nextW1 = Math.min(N.firstVoiced - XFADE.guardFrames, N.from + 12);
		forceCut.add(N.id);
		sting = {scene: S, next: N, from: start, rest: {start: r6(sec(S.soundEnd + 15)), end: r6(sec(nextW1) - STING.fadeInMs / 1000), fadeOutMs: STING.fadeOutMs, fadeInMs: STING.fadeInMs, floorDb: REST_FLOOR_DB}};
	}
	const spansOwn = forceCut.size ? episodeSpans(sb, tl, FPS, 'landscape', {forceCut}) : spansOwn0;
	const vs = voiceScenes(sb, tl, spansOwn);
	const voiced = voicedMask(vs, durationInFrames);

	// ---- the picture that the effects land on
	const fit = masterMode === 'fit-to-master';
	const picSb = fit ? msb : sb;
	const picTl = fit ? mtl : tl;
	const picSpans = short ? shortSpans(picSb, picTl, shortId as string, FPS) : episodeSpans(picSb, picTl, FPS, 'landscape', {forceCut});
	const pic = pictureEvents(picSb, picTl, picSpans, format, fit ? (input.masterCharts ?? {}) : input.charts);
	if (fit) for (const v of vs) if (pic.get(v.id) && pic.get(v.id)?.from !== v.from) warnings.push(`audio track: scene ${v.id} starts on frame ${v.from}, the master picture's on ${pic.get(v.id)?.from}: re-run the voice step with --fit-to`);

	// ---- the clock (critics F5, F10, F11): all beds on one clock, offset by a 4-bar phrase
	const seedKey = short ? `${sb.channel}/${sb.slug}/${shortId}` : `${sb.channel}/${sb.slug}`;
	const masterPhrases = (): PhraseBed[] => {
		const mspans = short ? shortSpans(msb, mtl, shortId as string, FPS) : episodeSpans(msb, mtl, FPS);
		const mvs = voiceScenes(msb, mtl, mspans);
		const out: PhraseBed[] = [];
		for (const p of phrasesOf(mvs.flatMap((v) => v.words.map((w) => ({start: w.start, end: w.end + WORD_PAD_END_SEC}))))) {
			const at = mvs.find((v) => p.start >= sec(v.from) && p.start < sec(v.from + v.frames)) ?? mvs[mvs.length - 1];
			const cue = cueOf(short ? (shortMood as Mood) : (region.map[at.id] ?? 'curious'));
			out.push({start: p.start, end: p.end, cue, levelDb: cue ? bedTrimDb(lib.levels, cue) : 0});
		}
		return out;
	};
	const voiceLufs = mtl.loudness?.integratedLufs ?? -14;
	const phrasesM = masterPhrases();
	const candidates = offsetOrder(seedKey).map((k) => {
		const m = worstPhraseMargin(lib.levels, phrasesM, k * CLOCK.phraseSec, voiceLufs);
		return {k, worstMarginLu: Number.isFinite(m.marginLu) ? r3(m.marginLu) : 99, atSec: r3(m.at)};
	});
	let clockSource: EpisodeAudioPlan['clock']['source'] = 'estimate';
	let k = candidates.find((c) => c.worstMarginLu >= CLOCK.estimateLineLu)?.k;
	const override = msb.music?.offset;
	if (variant?.offsetPhrase !== undefined) {
		k = variant.offsetPhrase;
		clockSource = 'variant';
	} else if (override !== undefined && !short) {
		k = override;
		clockSource = 'override';
	} else if (k === undefined) {
		const best = [...candidates].sort((a, b) => b.worstMarginLu - a.worstMarginLu)[0];
		k = best.k;
		clockSource = 'fallback';
		warnings.push(`music: no clock offset gives an estimated worst phrase ${CLOCK.estimateLineLu} LU under the voice; using phrase ${k} (${best.worstMarginLu} LU at ${best.atSec} s). The gate measures the render`);
	}
	const offsetSec = (k as number) * CLOCK.phraseSec;
	const offsetSamples = Math.round(offsetSec * SAMPLE_RATE);
	const startAt = (frame: number): number => mod(offsetSamples + frame * SAMPLES_PER_FRAME, LOOP_SEC * SAMPLE_RATE);

	// ---- runs of one bed in THIS composition, and the windows they change in
	const changes: PlanChange[] = [];
	const voiceFree: EpisodeAudioPlan['voiceFree'] = [];
	type CRun = {mood: Mood; cue: string | null; first: number; last: number};
	let cruns: CRun[] = [];
	vs.forEach((v, i) => {
		const m = moodOfScene(v.id);
		const c = cueOf(m);
		const last = cruns[cruns.length - 1];
		// the end screen continues a resolve bed without a change (the same file)
		if (last && last.cue === c && (last.mood === m || (c !== null && (last.mood === 'end' || m === 'end')))) {
			last.last = i;
			if (m === 'end') last.mood = 'end';
		} else cruns.push({mood: m, cue: c, first: i, last: i});
	});
	// a change needs a voice-free window of at least 9 frames; else it moves to the next scene boundary with room (or merges)
	type Boundary = {at: number; w: [number, number]; L: number};
	const boundaries: Array<Boundary | null> = [null];
	for (let r = 1; r < cruns.length; r++) {
		let found: Boundary | null = null;
		for (let i = cruns[r].first; i <= cruns[r].last && !found; i++) {
			const w = windowBetween(vs[i - 1], vs[i]);
			const L = Math.min(XFADE.maxFrames, w[1] - w[0]);
			if (L >= XFADE.minFrames) found = {at: i, w, L};
			else if (i === cruns[r].first) warnings.push(`music: only ${Math.max(0, w[1] - w[0])} voice-free frames before scene ${vs[i].id}; the ${cruns[r - 1].mood} bed continues to the next boundary with room`);
		}
		if (!found) {
			warnings.push(`music: no voice-free window of ${XFADE.minFrames} frames in the ${cruns[r].mood} region (scenes ${vs[cruns[r].first].id}-${vs[cruns[r].last].id}); it merges into the ${cruns[r - 1].mood} region`);
			cruns[r - 1].last = cruns[r].last;
			cruns.splice(r, 1);
			r--;
			continue;
		}
		if (found.at > cruns[r].first) {
			cruns[r - 1].last = found.at - 1;
			cruns[r].first = found.at;
		}
		boundaries[r] = found;
	}
	// merge neighbours that now play the same bed
	{
		const out: CRun[] = [];
		const outB: Array<Boundary | null> = [];
		cruns.forEach((c, i) => {
			const l = out[out.length - 1];
			if (l && l.cue === c.cue) {
				l.last = c.last;
				if (c.mood === 'end') l.mood = 'end';
			} else {
				out.push({...c});
				outB.push(boundaries[i]);
			}
		});
		cruns = out;
		boundaries.splice(0, boundaries.length, ...outB);
	}

	// ---- beds
	type Seg = Omit<PlanBed, 'key' | 'startAtSample' | 'startAtSec' | 'file'> & {to: number};
	const segs: Seg[] = [];
	const segOfRun: Array<Seg | null> = [];
	const firstSentenceEnd = (): number => {
		const v = vs.find((x) => x.words.length) ?? vs[0];
		const sents = (v.tl as TimelineScene & {sentences?: Array<{startMs: number; endMs: number}>}).sentences;
		if (sents?.length && v.words.length) return sec(v.from) + sents[0].endMs / 1000;
		for (let i = 0; i < v.words.length; i++) {
			const w = v.words[i];
			if (sentenceEnd.test(w.text) || (v.words[i + 1] && v.words[i + 1].start - w.end >= 0.25)) return w.end;
		}
		return v.words.length ? v.words[v.words.length - 1].end : sec(v.from);
	};
	for (let r = 0; r < cruns.length; r++) {
		const run = cruns[r];
		if (!run.cue) {
			segOfRun.push(null);
			continue;
		}
		const b = boundaries[r];
		const seg: Seg = {cue: run.cue, mood: run.mood, from: 0, to: durationInFrames, durationInFrames: 0, levelDb: bedTrimDb(lib.levels, run.cue), fadeInFrames: 0, fadeInCurve: 'raisedCosine', fadeOutFrames: 0, fadeOutCurve: 'raisedCosine', rests: [], why: ''};
		if (r === 0) {
			// the opening: in from silence over the first sentence, at least 1 s (critic F5), unless a variant asks otherwise
			const fadeMs = variant?.openingFade === false ? 50 : Math.min(OPENING_FADE.maxMs, Math.max(OPENING_FADE.minMs, Math.round(firstSentenceEnd() * 1000)));
			seg.from = 0;
			seg.fadeInFrames = Math.max(1, Math.round((fadeMs * FPS) / 1000));
			seg.why = `opens the ${short ? 'Short' : 'episode'}, fading in over the first sentence`;
			changes.push({kind: 'opening-fade', from: 0, to: seg.fadeInFrames, fromCue: null, toCue: run.cue, window: null, note: `${run.cue} fades in from silence over ${(seg.fadeInFrames / FPS).toFixed(2)} s, under the first sentence`});
		} else if (b) {
			const prev = cruns[r - 1];
			const w1 = b.w[1];
			if (!prev.cue) {
				seg.from = w1 - b.L;
				seg.fadeInFrames = b.L;
				seg.why = `enters before scene ${vs[b.at].id}`;
				changes.push({kind: 'in', from: w1 - b.L, to: w1, fromCue: null, toCue: run.cue, window: b.w, note: `${run.cue} fades in before scene ${vs[b.at].id}`});
			} else {
				const clash = harmonicClashes(prev.cue, run.cue, w1 - b.L, w1, offsetSec);
				const q = clash.length ? Math.round(b.L / 4) : 0;
				seg.from = w1 - b.L + q;
				seg.fadeInFrames = b.L - q;
				seg.fadeInCurve = 'equalPower';
				seg.why = `${prev.mood} to ${run.mood} at scene ${vs[b.at].id}`;
				changes.push({
					kind: clash.length ? 'breath' : 'crossfade',
					from: w1 - b.L,
					to: w1,
					fromCue: prev.cue,
					toCue: run.cue,
					window: b.w,
					note: clash.length
						? `staggered ${b.L} f crossfade (the out-going bed over the first ${b.L - q} f, the in-coming over the last ${b.L - q} f): the bars clash (${clash.length} semitone pair${clash.length > 1 ? 's' : ''}); a short breath, listen to it`
						: `equal-power crossfade over ${b.L} f`,
				});
			}
			voiceFree.push({from: w1 - b.L, to: w1, why: `bed change before scene ${vs[b.at].id}`});
		}
		segs.push(seg);
		segOfRun.push(seg);
	}
	// fade-outs: into the next run, or at the end
	for (let r = 0; r < cruns.length; r++) {
		const seg = segOfRun[r];
		if (!seg) continue;
		const next = cruns[r + 1];
		const b = boundaries[r + 1];
		if (next && b) {
			const w1 = b.w[1];
			if (!next.cue) {
				seg.to = w1;
				seg.fadeOutFrames = b.L;
				changes.push({kind: 'out', from: w1 - b.L, to: w1, fromCue: seg.cue, toCue: null, window: b.w, note: `${seg.cue} fades out before scene ${vs[b.at].id} (no music)`});
				voiceFree.push({from: w1 - b.L, to: w1, why: `bed fade-out before scene ${vs[b.at].id}`});
			} else {
				const clash = harmonicClashes(seg.cue, next.cue, w1 - b.L, w1, offsetSec);
				const q = clash.length ? Math.round(b.L / 4) : 0;
				seg.to = w1 - q;
				seg.fadeOutFrames = b.L - q;
				seg.fadeOutCurve = 'equalPower';
			}
		}
	}

	// ---- the end screen's music-up and the last fade (critic F7), or the final fade without an end screen
	const lastRun = cruns[cruns.length - 1];
	const lastSeg = segOfRun[segOfRun.length - 1];
	const endScene = !short ? vs.find((v) => v.type === 'endscreen') : undefined;
	const words: Span[] = vs.flatMap((v) => v.words.map((w) => ({start: r6(w.start), end: r6(w.end + WORD_PAD_END_SEC)})));

	// ---- virtual duck spans (critic F3): bed changes, rest fade-ins, scene pauses under 3 s, reaction beats
	const virtual: EpisodeAudioPlan['virtual'] = [];
	const addVirtual = (a: number, b: number, why: string) => {
		if (b > a) virtual.push({start: r6(a), end: r6(b), why});
	};
	for (const c of changes) if (c.window) addVirtual(sec(c.window[0] - 2), sec(c.window[1]), `held through the bed change (${c.kind}) at frame ${c.from}`);
	for (let i = 1; i < vs.length; i++) {
		const a = vs[i - 1];
		const b = vs[i];
		const lastWord = a.words[a.words.length - 1];
		const nextWord = b.words[0];
		if (!lastWord || !nextWord) continue;
		const gap = nextWord.start - (lastWord.end + WORD_PAD_END_SEC);
		if (gap < HOLD_PAUSE_MAX_SEC) addVirtual(lastWord.end, nextWord.start, `the ${gap.toFixed(2)} s pause between scenes ${a.id} and ${b.id} stays ducked`);
	}
	for (const v of vs) {
		const p = pic.get(v.id);
		if (!p) continue;
		const beatStart = p.from + p.reactionAt - BEAT_LEAD_FRAMES;
		const beatEnd = p.from + Math.max(p.reactionAt + BEAT_HOLD_FRAMES, p.turn !== null ? p.turn + 10 : 0);
		const lastWord = v.words[v.words.length - 1];
		const from = lastWord ? Math.min(lastWord.end, sec(beatStart)) : sec(beatStart);
		if (v.type !== 'endscreen' || (lastWord && sec(beatEnd) > lastWord.end)) addVirtual(from, sec(beatEnd), `${v.id}: held through Badger's reaction and Zoo's beat (frames ${beatStart}-${beatEnd})`);
	}
	if (sting) addVirtual(sting.rest.end, sting.rest.end + sting.rest.fadeInMs / 1000, 'the bed comes back from the sting ducked');
	const speechNow = () => mergeSpans([...words, ...virtual.map((v) => ({start: v.start, end: v.end}))], 0).map((s) => ({start: r6(s.start), end: r6(s.end)}));
	let duckCurve = new DuckCurve(speechNow(), {attackMs: base.duck.attackMs, releaseMs: base.duck.releaseMs, minGapMs: base.duck.minGapMs});

	if (endScene && lastRun.mood === 'end' && lastSeg) {
		// music up once the duck has released after the outro line, on a bar line; then the last fade ends on the last frame
		const lastWord = endScene.words[endScene.words.length - 1];
		let s0 = lastWord ? Math.ceil(lastWord.end * FPS) : endScene.from;
		while (s0 < durationInFrames && duckCurve.at(sec(s0)) > 0) s0++;
		s0 = Math.max(s0, lastSeg.from + lastSeg.fadeInFrames);
		const e = Math.ceil((s0 + END_SCREEN.upFrames) / BAR_FRAMES) * BAR_FRAMES;
		const upStart = e - END_SCREEN.upFrames;
		if (e + END_SCREEN.finalFadeFrames <= durationInFrames) {
			const clash = harmonicClashes(lastSeg.cue, END_SCREEN.under, upStart, e, offsetSec); // the motif version shares its underscore's harmony
			const q = clash.length ? Math.round(END_SCREEN.upFrames / 4) : 0;
			lastSeg.to = e - q;
			lastSeg.fadeOutFrames = END_SCREEN.upFrames - q;
			lastSeg.fadeOutCurve = 'equalPower';
			const up: Seg = {
				cue: END_SCREEN.up,
				mood: 'end',
				from: upStart + q,
				to: durationInFrames,
				durationInFrames: 0,
				levelDb: END_SCREEN.liftDb,
				fadeInFrames: END_SCREEN.upFrames - q,
				fadeInCurve: 'equalPower',
				fadeOutFrames: END_SCREEN.finalFadeFrames,
				fadeOutCurve: 'raisedCosine',
				rests: [],
				why: 'end screen: the music comes up to the motif version after the outro line, then fades on the last frame',
			};
			segs.push(up);
			changes.push({kind: 'music-up', from: upStart, to: e, fromCue: lastSeg.cue, toCue: END_SCREEN.up, window: null, note: `music up +${END_SCREEN.liftDb} dB to ${END_SCREEN.up} (major motif), ending on the bar line at frame ${e}, after the duck released at frame ${s0}`});
			changes.push({kind: 'end-fade', from: durationInFrames - END_SCREEN.finalFadeFrames, to: durationInFrames, fromCue: END_SCREEN.up, toCue: null, window: null, note: `fades over the last ${(END_SCREEN.finalFadeFrames / FPS).toFixed(1)} s, ending on the last frame`});
			voiceFree.push({from: upStart, to: e, why: 'end-screen music-up'});
			voiceFree.push({from: durationInFrames - END_SCREEN.finalFadeFrames, to: durationInFrames, why: 'last fade'});
		} else {
			warnings.push('music: the end screen is too short for the music-up after the outro line; the bed fades out on the last frame');
			lastSeg.to = durationInFrames;
			lastSeg.fadeOutFrames = END_SCREEN.finalFadeFrames;
			changes.push({kind: 'end-fade', from: durationInFrames - END_SCREEN.finalFadeFrames, to: durationInFrames, fromCue: lastSeg.cue, toCue: null, window: null, note: 'fades out on the last frame'});
		}
	} else if (lastSeg && lastSeg.to >= durationInFrames) {
		// no end-screen music: fade over the final voice-free tail (Shorts: 12 frames or fewer, so the loop restart is clean)
		const tailFree = durationInFrames - vs[vs.length - 1].soundEnd;
		const n = Math.max(2, Math.min(short ? END_FADE_FRAMES.short : END_FADE_FRAMES.episode, tailFree - 1));
		lastSeg.to = durationInFrames;
		lastSeg.fadeOutFrames = n;
		changes.push({kind: 'end-fade', from: durationInFrames - n, to: durationInFrames, fromCue: lastSeg.cue, toCue: null, window: null, note: `fades out over the last ${n} frames`});
		voiceFree.push({from: durationInFrames - n, to: durationInFrames, why: 'last fade'});
	}

	// ---- the sting's rest (and its jingle)
	const stingers: EpisodeAudioPlan['stingers'] = [];
	if (sting) {
		const p = placeStinger(resolveCue(lib.music, STING.cue), sting.from, FPS);
		stingers.push({id: p.cue.id, file: p.cue.file, from: p.from, downbeat: p.downbeat, durationInFrames: p.durationInFrames, levelDb: r3(peakBudgetTrimDb(p.cue)), why: `brand sting after scene ${sting.scene.id}`});
		const at = segs.find((s) => s.from <= sting!.from && s.to > sting!.from);
		if (at) at.rests.push(sting.rest);
		changes.push({kind: 'sting-rest', from: sting.scene.soundEnd, to: Math.round(sting.rest.end * FPS + (sting.rest.fadeInMs * FPS) / 1000), fromCue: at?.cue ?? null, toCue: at?.cue ?? null, window: null, note: `the bed dips ${REST_FLOOR_DB} dB for the sting (frames ${sting.from}-${sting.from + STING.frames}) and comes back ducked for scene ${sting.next.id}`});
		voiceFree.push({from: sting.from, to: sting.from + STING.frames, why: 'brand sting'});
	}

	// ---- music out after 2 loops of one region (critic F20)
	for (let r = 0; r < cruns.length; r++) {
		const seg = segOfRun[r];
		const run = cruns[r];
		if (!seg || !isStory(run.mood)) continue;
		let full = seg.from + seg.fadeInFrames;
		for (let guard = 0; guard < 20; guard++) {
			const runEnd = seg.to - seg.fadeOutFrames;
			if (runEnd - full <= MUSIC_OUT.afterFrames) break;
			let made = false;
			for (let i = run.first + 1; i <= run.last && !made; i++) {
				if (vs[i].from < full + MUSIC_OUT.afterFrames) continue;
				const w = windowBetween(vs[i - 1], vs[i]);
				const L = Math.min(XFADE.maxFrames, w[1] - w[0]);
				if (L < XFADE.minFrames) continue;
				const restAt = w[1];
				const earliest = Math.max(vs[i].from + vs[i].frames, restAt + MUSIC_OUT.minFrames);
				// re-enter only with at least 8 bars of the region left; otherwise rest into the next act's change
				if (Math.ceil(earliest / PHRASE_FRAMES) * PHRASE_FRAMES + MIN_REGION_FRAMES > runEnd) {
					if (runEnd - restAt < MUSIC_OUT.minFrames) continue;
					seg.rests.push({start: r6(sec(restAt)), end: r6(sec(seg.to)), fadeOutMs: fMs(L), fadeInMs: 0, floorDb: REST_FLOOR_DB});
					changes.push({kind: 'music-out', from: restAt - L, to: restAt, fromCue: seg.cue, toCue: seg.cue, window: w, note: `after ${((restAt - full) / LOOP_FRAMES).toFixed(1)} loops the bed rests (${REST_FLOOR_DB} dB) from scene ${vs[i].id} until the next bed`});
					voiceFree.push({from: restAt - L, to: restAt, why: `music-out before scene ${vs[i].id}`});
					made = true;
					full = runEnd;
					break;
				}
				for (let P = Math.ceil(earliest / PHRASE_FRAMES) * PHRASE_FRAMES; P + MIN_REGION_FRAMES <= runEnd; P += PHRASE_FRAMES) {
					let ducked = true;
					for (let f = P - MUSIC_OUT.fadeInFrames; f <= P && ducked; f += 2) if (duckCurve.at(sec(f)) < 0.999) ducked = false;
					if (!ducked) continue;
					const back = P - MUSIC_OUT.fadeInFrames;
					seg.rests.push({start: r6(sec(restAt)), end: r6(sec(back)), fadeOutMs: fMs(L), fadeInMs: fMs(MUSIC_OUT.fadeInFrames), floorDb: REST_FLOOR_DB});
					changes.push({kind: 'music-out', from: restAt - L, to: restAt, fromCue: seg.cue, toCue: seg.cue, window: w, note: `after ${((restAt - full) / LOOP_FRAMES).toFixed(1)} loops the bed rests (${REST_FLOOR_DB} dB) from scene ${vs[i].id}`});
					changes.push({kind: 'music-back', from: back, to: P, fromCue: seg.cue, toCue: seg.cue, window: null, note: `the bed re-enters on the phrase start at frame ${P}, under the duck`});
					voiceFree.push({from: restAt - L, to: restAt, why: `music-out before scene ${vs[i].id}`});
					addVirtual(sec(back - 2), sec(P), 'the bed re-enters ducked');
					full = P;
					made = true;
					break;
				}
			}
			if (!made) break;
		}
	}
	duckCurve = new DuckCurve(speechNow(), {attackMs: base.duck.attackMs, releaseMs: base.duck.releaseMs, minGapMs: base.duck.minGapMs});

	// ---- the beds as played
	const beds: PlanBed[] = segs
		.filter((s) => s.to > s.from)
		.sort((a, b) => a.from - b.from)
		.map((s, i) => {
			const cueEntry = resolveCue(lib.music, s.cue);
			const startAtSample = startAt(s.from);
			const len = s.to - s.from;
			return {
				key: `b${i + 1}`,
				cue: s.cue,
				file: cueEntry.file,
				mood: s.mood,
				from: s.from,
				durationInFrames: len,
				startAtSample,
				startAtSec: r6(startAtSample / SAMPLE_RATE),
				levelDb: s.levelDb,
				fadeInFrames: Math.min(s.fadeInFrames, len),
				fadeInCurve: s.fadeInCurve,
				fadeOutFrames: Math.min(s.fadeOutFrames, len),
				fadeOutCurve: s.fadeOutCurve,
				rests: s.rests.map((x) => ({...x})),
				why: s.why,
			};
		});
	const bedsAt = (frame: number) => beds.filter((b) => frame >= b.from && frame < b.from + b.durationInFrames);

	// ---- sound effects (critics F2, F8, F9, F19)
	const sfxMode = variant?.sfx ?? 'gaps';
	const candidates2: PlanSfx[] = [];
	const dropped: DroppedSfx[] = [];
	const quietFrom = (f: number, hold: number) => {
		if (f < 0) return false;
		for (let k2 = 0; k2 < hold; k2++) if (f + k2 < voiced.length && voiced[f + k2]) return false;
		return true;
	};
	const findGap = (target: number, order: number[]): number | null => {
		for (const d of order) if (quietFrom(target + d, SFX_RULES.gapHoldFrames)) return target + d;
		return null;
	};
	const gapOrder = [0, 1, -1, 2, 3, 4].filter((d) => d >= -SFX_RULES.earliestFrames && d <= SFX_RULES.latestFrames);
	const overVoice = (from: number, len: number) => {
		for (let f = Math.max(0, from); f < Math.min(voiced.length, from + len); f++) if (voiced[f]) return true;
		return false;
	};
	const place = (ref: string, at: number, sc: VScene, event: string, eventFrame: number, targetLufs: number, index = 0): PlanSfx => {
		const probe = sfxCue(lib.sfx, ref, at, {scene: sc.id, index});
		const entry = lib.sfx.sounds.find((x) => x.id === probe.id);
		if (!entry) throw new Error(`no SFX ${probe.id}`);
		const placed = entry.loudness.lufs200Max + entry.suggestedGainDb;
		const extra = Math.min(0, targetLufs - placed);
		const c = sfxCue(lib.sfx, ref, at, {scene: sc.id, index, gainDb: extra, label: event});
		return {...c, gainDb: r3(c.gainDb), scene: sc.id, event, eventFrame, targetLufs: r3(Math.min(placed, targetLufs)), overVoice: overVoice(c.from, Math.min(c.durationInFrames, 5))};
	};
	const bedLevelAt = (frame: number): number | null => {
		let best: number | null = null;
		for (const b of bedsAt(frame)) {
			const ducked = duckCurve.at(sec(frame)) >= 0.5;
			const l = bedLufsOver(lib.levels, b.cue, sec(frame) - 0.8, sec(frame) + 0.8, offsetSec, ducked);
			if (l !== null && (best === null || l + b.levelDb > best)) best = l + b.levelDb;
		}
		return best;
	};
	if (sfxMode !== 'none') {
		vs.forEach((v, i) => {
			const p = pic.get(v.id);
			if (!p) return;
			const opts = v.sc.sfx ?? {};
			const picSc = picSb.scenes.find((x) => x.id === v.id) ?? v.sc;
			// the entrance: a wipe's short whoosh (unless sfx.transition is false), a slide's soft air only on request
			if (i > 0 && p.transitionFrames > 0 && (p.transition === 'wipe' || p.transition === 'slide')) {
				const want = p.transition === 'wipe' ? (picSc.sfx?.transition ?? opts.transition) !== false : (picSc.sfx?.transition ?? opts.transition) === true;
				const t0 = p.from - p.preroll;
				const passBy = t0 + motionPeakFrame(p.transition, p.transitionFrames);
				if (!want) dropped.push({scene: v.id, event: `transition:${p.transition}`, frame: passBy, why: p.transition === 'slide' ? 'a slide has no whoosh unless the scene sets sfx.transition' : 'sfx.transition is false'});
				else {
					const level = bedLevelAt(passBy);
					if (level === null) dropped.push({scene: v.id, event: `transition:${p.transition}`, frame: passBy, why: 'no music under it: a whoosh alone in silence is too exposed'});
					else {
						const cap = p.transition === 'wipe' ? SFX_LEVELS.wipeMaxLufs : SFX_LEVELS.slideMaxLufs;
						const c = place(p.transition === 'wipe' ? SFX_SOUNDS.wipe : SFX_SOUNDS.slide, passBy, v, `transition:${p.transition}`, passBy, Math.min(cap, level + SFX_LEVELS.overBedMaxLu));
						const tail = WHOOSH_TAIL_FRAMES[c.id] ?? 12;
						if (passBy + tail > v.firstVoiced) dropped.push({scene: v.id, event: `transition:${p.transition}`, frame: passBy, why: `its tail (${tail} f to -20 dB) would reach the first word at frame ${v.firstVoiced}`});
						else candidates2.push(c);
					}
				}
			}
			// list items: a soft pitch-stable pop, only in a gap in the speech
			if (p.reveals.length) {
				if (opts.items === false) dropped.push({scene: v.id, event: 'items', frame: p.from, why: 'sfx.items is false'});
				else
					p.reveals.forEach((rv, idx) => {
						const target = p.from + rv + 1;
						const at = sfxMode === 'onFrame' ? target : findGap(target, gapOrder);
						if (at === null) dropped.push({scene: v.id, event: `item:${idx + 1}`, frame: target, why: 'Zoo speaks there: no 4-frame gap within 1 frame before or 4 after the reveal'});
						else {
							const onWord = sfxMode === 'onFrame' && !quietFrom(at, SFX_RULES.gapHoldFrames);
							candidates2.push(place(SFX_SOUNDS.item, at, v, `item:${idx + 1}`, target, SFX_LEVELS.itemLufs - (onWord ? 3 : 0), idx));
						}
					});
			}
			// accents: the CTA press (a click, only in a gap), the rug candle (only when the scene asks: sfx.accent)
			if (v.type === 'cta' && p.press !== null) {
				const target = p.from + p.press + 3;
				if (opts.accent === false) dropped.push({scene: v.id, event: 'press', frame: target, why: 'sfx.accent is false'});
				else {
					const at = findGap(target, [0, 1, -1]);
					if (at === null) dropped.push({scene: v.id, event: 'press', frame: target, why: 'the press lands on a word: no click'});
					else candidates2.push(place(SFX_SOUNDS.press, at, v, 'press', target, 0));
				}
			}
			if (v.type === 'chart' && p.rugDone !== null) {
				const target = p.from + p.rugDone;
				if (opts.accent !== true) dropped.push({scene: v.id, event: 'rug', frame: target, why: 'the rug plays silent unless the scene sets sfx.accent (the pause, Badger and Zoo carry it)'});
				else {
					const at = findGap(target, gapOrder);
					if (at === null) dropped.push({scene: v.id, event: 'rug', frame: target, why: 'Zoo speaks there'});
					else candidates2.push(place(SFX_SOUNDS.rug, at, v, 'rug', target, SFX_LEVELS.accentLufs));
				}
			}
		});
	}
	// a spoken disclosure is protected: nothing within 0.5 s of it (critic F19); the first second of speech too (F5)
	const protect: EpisodeAudioPlan['protect'] = [];
	const firstWord = words[0];
	if (firstWord) protect.push({start: firstWord.start, end: r6(firstWord.start + 1), why: 'hook'});
	if ((sb.offers ?? []).length) {
		for (const v of vs) {
			if (v.type !== 'cta') continue;
			const d = typeof v.sc.onScreen?.disclosure === 'string' ? v.sc.onScreen.disclosure : '';
			if (!d) continue;
			const target = normWord(d.replace(/\s+/g, ''));
			let concat = '';
			const owner: number[] = [];
			v.words.forEach((w, wi) => {
				const n = normWord(w.text);
				concat += n;
				for (let c = 0; c < n.length; c++) owner.push(wi);
			});
			const at = target ? concat.indexOf(target) : -1;
			const span = at >= 0 ? {start: v.words[owner[at]].start, end: v.words[owner[at + target.length - 1]].end} : v.words.length ? {start: v.words[0].start, end: v.words[v.words.length - 1].end} : null;
			if (at < 0) warnings.push(`disclosure: the CTA's disclosure words were not found in scene ${v.id}'s timeline; its whole speech is protected`);
			if (span) protect.push({start: r6(span.start), end: r6(span.end + WORD_PAD_END_SEC), why: 'disclosure'});
		}
	}
	const sfx: PlanSfx[] = [];
	const perScene = new Map<string, number>();
	for (const c of candidates2.sort((a, b) => a.at - b.at || a.from - b.from)) {
		const a0 = sec(c.from);
		const a1 = sec(c.from + c.durationInFrames);
		const hit = protect.find((p) => p.why === 'disclosure' && a0 < p.end + SFX_RULES.protectSec && a1 > p.start - SFX_RULES.protectSec);
		if (hit) {
			dropped.push({scene: c.scene, event: c.event, frame: c.at, why: 'within 0.5 s of the spoken disclosure'});
			continue;
		}
		const prev = sfx[sfx.length - 1];
		if (prev && c.at - prev.at < SFX_RULES.minSpacingFrames) {
			dropped.push({scene: c.scene, event: c.event, frame: c.at, why: `${c.at - prev.at} frames after the previous effect (at least ${SFX_RULES.minSpacingFrames})`});
			continue;
		}
		const in10 = sfx.filter((x) => x.at > c.at - 10 * FPS).length;
		const in60 = sfx.filter((x) => x.at > c.at - 60 * FPS).length;
		if (in10 >= SFX_RULES.per10s || in60 >= SFX_RULES.perMinute || (perScene.get(c.scene) ?? 0) >= SFX_RULES.perScene) {
			dropped.push({scene: c.scene, event: c.event, frame: c.at, why: in10 >= SFX_RULES.per10s ? `already ${SFX_RULES.per10s} effects in 10 s` : in60 >= SFX_RULES.perMinute ? `already ${SFX_RULES.perMinute} effects in a minute` : `already ${SFX_RULES.perScene} in this scene`});
			continue;
		}
		sfx.push(c);
		perScene.set(c.scene, (perScene.get(c.scene) ?? 0) + 1);
	}

	// ---- every transition stays voice-free (critic F13), measured by the gate
	for (const v of vs) {
		if (v.span.transitionFrames > 0) voiceFree.push({from: v.from - v.span.preroll, to: v.from - v.span.preroll + v.span.transitionFrames, why: `${v.span.transition} into scene ${v.id}`});
	}

	const regions = cruns.map((c, r) => {
		const seg = segOfRun[r];
		const from = seg ? seg.from : vs[c.first].from;
		const to = seg ? seg.to : vs[c.last].from + vs[c.last].frames;
		return {mood: c.mood, cue: c.cue, from, to, scenes: vs.slice(c.first, c.last + 1).map((v) => v.id), loops: r3((to - from) / LOOP_FRAMES)};
	});
	const plan: EpisodeAudioPlan = {
		...base,
		silent: false,
		regionMap: short ? Object.fromEntries(vs.map((v) => [v.id, shortMood as Mood])) : region.map,
		regions,
		clock: {offsetPhrase: k as number, offsetSec: r6(offsetSec), offsetSamples, source: clockSource, candidates},
		words,
		virtual: virtual.sort((a, b) => a.start - b.start),
		speech: speechNow(),
		beds,
		stingers,
		sfx,
		droppedSfx: dropped.sort((a, b) => a.frame - b.frame),
		changes: changes.sort((a, b) => a.from - b.from),
		voiceFree: voiceFree.filter((w) => w.to > w.from).sort((a, b) => a.from - b.from),
		protect,
		scenes: vs.map((v) => ({
			id: v.id,
			type: v.type,
			from: v.from,
			frames: v.frames,
			firstVoiced: v.firstVoiced,
			soundEnd: v.soundEnd,
			transition: v.span.transition,
			transitionFrames: v.span.transitionFrames,
			preroll: v.span.preroll,
			reactionAt: (pic.get(v.id)?.reactionAt ?? 0) + (pic.get(v.id)?.from ?? v.from),
		})),
		picture: {forceCut: [...forceCut], sting: sting ? {from: sting.from, durationInFrames: STING.frames, tagline: sb.music?.stingTagline?.trim() || (sb.lang === 'en' ? EN_STING_TAGLINE : null)} : null},
		warnings,
		hash: '',
	};
	return {...plan, hash: planHash(plan as unknown as Record<string, unknown>)};
};

/** The gain law of one planned bed exactly as <MusicBed> builds it (for tests, cue sheets and the gate's probe). */
export const bedDuckSpec = (plan: EpisodeAudioPlan) => ({
	speech: plan.speech,
	split: plan.duck.split,
	depthsDb: plan.duck.depthsDb as [number, number, number],
	attackMs: plan.duck.attackMs,
	releaseMs: plan.duck.releaseMs,
	minGapMs: plan.duck.minGapMs,
});
