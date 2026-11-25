/**
 * Episode sound tests (src/episode/audio): bed selection by act, the clock, crossfades that avoid every voiced word,
 * the duck held through reactions and changes, effect caps and placement, the clean opening, the end screen, the
 * sting, Shorts, dubs (native and fitted to the master) and the plan's determinism.
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/tests/run.ts
 * Timelines: the dev fixtures' mock timelines with `mock` cleared (words, mouth and pauses at Kokoro's pacing), and the
 * real _engine-demo voice output when public/generated has it (gitignored; those tests skip without it).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Storyboard, StoryboardScene, Timeline} from '../types.ts';
import {mockTimeline} from '../dev/mockTimeline.ts';
import {motionPeakFrame, offsetOrder, planEpisodeAudio, regionMapFor, type EpisodeAudioPlan, type PlanInput} from '../audio/plan.ts';
import {audioLibrary, chartPlansFor, planInputFromDisk, STUDIO, timelinePath} from '../node/audioInputs.ts';
import * as K from '../audio/constants.ts';
import {harmonicClashes, HARMONY, loopBarAt} from '../audio/moods.ts';
import {bedLoopLufs, bedLufsOver, bedTrimDb, worstPhraseMargin, type BedLevelTable} from '../audio/levels.ts';
import {canonicalJson, planHash, sha256Hex} from '../audio/hash.ts';
import {cueSheet} from '../audio/cueSheet.ts';
import {DuckCurve} from '../../audio/core/envelope.ts';
import {planBed} from '../../audio/core/bed.ts';
import {parseWav} from '../../audio/core/wav.ts';
import {validateProps, validateStoryboard} from '../validate.ts';
import {sceneCast} from '../scenes/direction.ts';
import {LAYOUTS} from '../layout/specs.ts';
import {episodeSpans, transitionProgress} from '../timing.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'dev', 'fixtures');
const LIB = audioLibrary();
const FPS = 30;
const fix = (slug: string, lang = 'en'): Storyboard => JSON.parse(readFileSync(join(FIX, slug, lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`), 'utf8')) as Storyboard;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** A voiced-looking timeline: the mock's words, mouth and pauses, not flagged as a mock (so the plan has sound). */
const voiced = (sb: Storyboard): Timeline => ({...mockTimeline(sb, {fps: FPS}), mock: false});
const plan = (sb: Storyboard, tl: Timeline, o: Partial<PlanInput> = {}): EpisodeAudioPlan =>
	planEpisodeAudio({format: 'landscape', storyboard: sb, timeline: tl, charts: chartPlansFor(sb, tl, o.format ?? 'landscape'), lib: LIB, ...o});
const words = (p: EpisodeAudioPlan) => p.words;
/** A bed's per-band gain law, exactly as <MusicBed> builds it from the plan. */
const bedLaw = (p: EpisodeAudioPlan, b: EpisodeAudioPlan['beds'][number]) =>
	planBed({
		start: b.from / FPS,
		end: (b.from + b.durationInFrames) / FPS,
		duck: {speech: p.speech, split: true, depthsDb: p.duck.depthsDb as [number, number, number], attackMs: p.duck.attackMs, releaseMs: p.duck.releaseMs, minGapMs: p.duck.minGapMs},
		rests: b.rests,
		fadeInMs: (b.fadeInFrames * 1000) / FPS,
		fadeOutMs: (b.fadeOutFrames * 1000) / FPS,
		fadeCurve: b.fadeInCurve,
		fadeOutCurve: b.fadeOutCurve,
	}).gain;
const duckOf = (p: EpisodeAudioPlan) => new DuckCurve(p.speech, {attackMs: p.duck.attackMs, releaseMs: p.duck.releaseMs, minGapMs: p.duck.minGapMs});
const REAL = ['en', 'es', 'pt-br'].filter((l) => existsSync(timelinePath('zoora-ai', '_engine-demo', l as 'en')));
const realPlan = (lang: string, short?: string) => planEpisodeAudio(planInputFromDisk({channel: 'zoora-ai', slug: '_engine-demo', lang: lang as 'en', format: short ? 'vertical' : 'landscape', shortId: short ?? null, lib: LIB}));

/** Move a timeline scene's words and mouth by `ms` (positive: later), keeping its length. */
const shiftScene = (s: Timeline['scenes'][number], ms: number) => {
	for (const w of s.words) {
		w.startMs += ms;
		w.endMs += ms;
	}
	const n = Math.round((Math.abs(ms) * FPS) / 1000);
	s.mouth = ms >= 0 ? [...Array(n).fill('closed'), ...s.mouth.slice(0, s.mouth.length - n)] : [...s.mouth.slice(n), ...Array(n).fill('closed')];
	s.speechMs = s.words.length ? s.words[s.words.length - 1].endMs : 0;
};

/** The demo storyboard with a bed marker on every content scene, so every boundary is a bed change. */
const everyBoundaryChanges = (sb: Storyboard): Storyboard => {
	const s = clone(sb);
	const cycle = ['curious', 'tension', 'resolve', 'ominous'] as const;
	let k = 0;
	for (const sc of s.scenes) if (sc.type !== 'endscreen') sc.bed = cycle[k++ % cycle.length];
	return s;
};

/** A synthetic long episode: `n` talk scenes of a few sentences each, explicit beds where asked. */
const longEpisode = (n: number, beds: Record<number, StoryboardScene['bed']> = {}, sentences = 3): Storyboard => {
	const base = fix('engine-demo');
	const scenes: StoryboardScene[] = [];
	const line = 'The price moves fast when nobody checks the wallet behind the call.';
	for (let i = 0; i < n; i++)
		scenes.push({id: `s${String(i + 1).padStart(3, '0')}`, type: i === 0 ? 'hook' : 'talk', narration: Array(sentences).fill(line).join(' '), onScreen: i === 0 ? {title: 'A long story'} : {title: 'Point'}, badger: {present: i % 3 === 0}, ...(beds[i] ? {bed: beds[i]} : {})});
	scenes.push({id: 'end', type: 'endscreen', narration: 'Next time: the other side of the trade.', onScreen: {title: 'Next'}, badger: {present: true, reaction: 'lookUp'}, minDurationSec: 20});
	return {...base, slug: 'long-fixture', scenes, shorts: [{id: 'short1', sceneIds: [scenes[0].id, scenes[1].id], title: 'x'}], music: undefined};
};

// ------------------------------------------------------------------------------------------------ bed selection

test('sound: every story bed sits at the same loudness under the voice (louder beds trimmed, never raised)', () => {
	const t = LIB.levels as BedLevelTable;
	for (const mood of ['curious', 'tension', 'ominous', 'resolve'] as const) {
		const cue = `bed-story-${mood}-underscore`;
		const trim = bedTrimDb(t, cue);
		assert.ok(trim <= 0 && trim >= -K.BED_UNDER_VOICE.maxCutDb, `${cue} trim ${trim}`);
		const under = (bedLoopLufs(t, cue, true) as number) + trim;
		assert.ok(under <= K.BED_UNDER_VOICE.targetDuckedLufs + 0.06, `${cue} sits at ${under.toFixed(2)} LUFS under the voice`);
		// the curious bed is the reference; the others come down to it within 0.1 dB
		assert.ok(Math.abs(under - K.BED_UNDER_VOICE.targetDuckedLufs) <= 0.1 || trim === 0, `${cue}: ${under.toFixed(2)}`);
	}
	assert.equal(bedTrimDb(t, 'bed-story-curious-underscore'), 0);
	assert.ok(bedTrimDb(t, 'bed-story-tension-underscore') <= -2, 'the tension underscore is the loudest under the duck');
	assert.equal(bedTrimDb(t, 'no-such-bed'), 0);
	// the plan carries the trim on every bed under speech, and the end screen's music-up stays relative to the file
	const sb = everyBoundaryChanges(fix('engine-demo'));
	const p = plan(sb, voiced(sb));
	for (const b of p.beds) {
		if (b.cue === K.END_SCREEN.up) assert.equal(b.levelDb, K.END_SCREEN.liftDb);
		else assert.equal(b.levelDb, bedTrimDb(t, b.cue), b.cue);
	}
	// the clock's estimate counts the trim: a trimmed tension phrase reads as quiet as an untrimmed curious one
	const ph = [{start: 0, end: 4, cue: 'bed-story-tension-underscore'}];
	const raw = worstPhraseMargin(t, ph, 0, -14).marginLu;
	const trimmed = worstPhraseMargin(t, [{...ph[0], levelDb: bedTrimDb(t, ph[0].cue)}], 0, -14).marginLu;
	assert.ok(Math.abs(trimmed - raw + bedTrimDb(t, ph[0].cue)) < 1e-9);
});

test('sound: moods follow acts, not templates: one bed for the whole story unless a scene sets one', () => {
	const sb = fix('engine-demo');
	const tl = voiced(sb);
	const warnings: string[] = [];
	const r = regionMapFor(sb, tl, warnings);
	for (const sc of sb.scenes) assert.equal(r.map[sc.id], sc.type === 'endscreen' ? 'end' : 'curious', sc.id); // charts and steps do not switch to tension or resolve
	// the hook's bed sets the episode's mood; a marker changes it from its scene on, and later scenes inherit
	const s2 = clone(sb);
	s2.scenes[0].bed = 'tension';
	assert.equal(regionMapFor(s2, tl, []).map.s02, 'tension');
	const long = longEpisode(16, {0: 'curious', 8: 'ominous'});
	const lr = regionMapFor(long, voiced(long), []);
	assert.equal(lr.map.s008, 'curious');
	assert.equal(lr.map.s009, 'ominous');
	assert.equal(lr.map.s016, 'ominous'); // inherited
	assert.equal(lr.map.end, 'end');
	// a silent end screen
	const s3 = clone(sb);
	s3.scenes[6].bed = 'none';
	assert.equal(regionMapFor(s3, tl, []).map.s07, 'none');
});

test('sound: a default opening shorter than 8 bars opens in the next region; a short region the writer set is kept, with a warning', () => {
	const sb = clone(fix('engine-demo'));
	sb.scenes[1].bed = 'tension'; // s02 sets tension; the hook (no bed) lasts a few seconds
	const tl = voiced(sb);
	assert.equal(regionMapFor(sb, tl, []).map.s01, 'tension');
	const sb2 = clone(sb);
	sb2.scenes[0].bed = 'curious'; // now the short opening is the writer's
	const w: string[] = [];
	assert.equal(regionMapFor(sb2, voiced(sb2), w).map.s01, 'curious');
	assert.ok(w.some((x) => /under 8 bars/.test(x)), w.join('\n'));
});

test('sound: a 10-minute episode changes its bed at most once a minute, and no default region is under 25.6 s', () => {
	// markers every few scenes, some much closer than a minute apart
	const sb = longEpisode(48, {0: 'curious', 3: 'tension', 5: 'resolve', 14: 'ominous', 15: 'curious', 30: 'tension', 31: 'resolve', 40: 'curious'});
	const tl = voiced(sb);
	assert.ok(tl.totalMs > 9 * 60_000, `${tl.totalMs} ms`);
	const p = plan(sb, tl);
	const moodChanges = p.changes.filter((c) => ['crossfade', 'breath', 'in', 'out'].includes(c.kind) && c.toCue !== K.END_SCREEN.under);
	for (let i = 1; i < moodChanges.length; i++) assert.ok(moodChanges[i].from - moodChanges[i - 1].from >= K.MIN_CHANGE_SPACING_FRAMES - K.XFADE.maxFrames, `changes at ${moodChanges[i - 1].from} and ${moodChanges[i].from}`);
	assert.ok(moodChanges.length <= Math.ceil(tl.totalMs / 60_000), `${moodChanges.length} changes`);
	const explicitStarts = new Set(sb.scenes.filter((s) => s.bed).map((s) => s.id));
	for (const r of p.regions)
		if (r.mood !== 'end' && r.to - r.from < K.MIN_REGION_FRAMES) assert.ok(explicitStarts.has(r.scenes[0]), `default region ${r.mood} ${r.scenes[0]} is ${(r.to - r.from) / FPS} s`);
	assert.ok(p.warnings.some((x) => /at most one change a minute/.test(x)));
});

// ------------------------------------------------------------------------------------------------ the clock

test('sound: every bed sits on one clock (a 4-bar phrase offset, the base section first, the same in every language)', () => {
	for (const key of ['zoora-ai/a', 'zoora-ai/b', 'x/y/short1']) {
		const o = offsetOrder(key);
		assert.deepEqual([...o].sort(), [0, 1, 2, 3, 4]);
		assert.deepEqual([...o.slice(0, 2)].sort(), [0, 1]);
		assert.deepEqual(offsetOrder(key), o); // stable for a slug
	}
	const en = fix('engine-demo');
	const es = fix('engine-demo', 'es');
	const enTl = voiced(everyBoundaryChanges(en));
	const pe = plan(everyBoundaryChanges(en), enTl);
	const ps = plan(everyBoundaryChanges(es), voiced(everyBoundaryChanges(es)), {master: {storyboard: everyBoundaryChanges(en), timeline: enTl}});
	assert.equal(pe.clock.offsetPhrase, ps.clock.offsetPhrase);
	assert.ok([0, 12.8, 25.6, 38.4, 51.2].includes(pe.clock.offsetSec));
	for (const p of [pe, ps]) {
		for (const b of p.beds) assert.equal(b.startAtSample, (p.clock.offsetSamples + b.from * K.SAMPLES_PER_FRAME) % (K.LOOP_SEC * K.SAMPLE_RATE), b.key);
		// at every sample of every crossfade both beds read the same loop position: (offset + t) mod 64 s
		for (const c of p.changes.filter((x) => x.kind === 'crossfade' || x.kind === 'breath')) {
			const active = p.beds.filter((b) => b.from < c.to && b.from + b.durationInFrames > c.from);
			assert.ok(active.length >= 2, `crossfade at ${c.from}`);
			for (let s = c.from * K.SAMPLES_PER_FRAME; s < c.to * K.SAMPLES_PER_FRAME; s += 97)
				for (const b of active)
					if (s >= b.from * K.SAMPLES_PER_FRAME && s < (b.from + b.durationInFrames) * K.SAMPLES_PER_FRAME)
						assert.equal((b.startAtSample + s - b.from * K.SAMPLES_PER_FRAME) % 3072000, (p.clock.offsetSamples + s) % 3072000);
		}
	}
	// an explicit offset wins
	const o = clone(en);
	o.music = {offset: 3};
	assert.equal(plan(o, voiced(o)).clock.offsetPhrase, 3);
});

test('sound: the clock offset is chosen by the estimated voice-over-bed margin of the worst phrase', () => {
	const table = LIB.levels as BedLevelTable;
	// resolve's quiet base section and loud later sections (critic F10: 3.9 LU apart after the duck)
	const quiet = bedLufsOver(table, 'bed-story-resolve-underscore', 0, 12.8, 0, true) as number;
	const loud = bedLufsOver(table, 'bed-story-resolve-underscore', 0, 12.8, 25.6, true) as number;
	assert.ok(quiet < loud - 3, `${quiet} vs ${loud}`);
	const p = plan(fix('engine-demo'), voiced(fix('engine-demo')));
	assert.equal(p.clock.candidates.length, 5);
	const chosen = p.clock.candidates.find((c) => c.k === p.clock.offsetPhrase);
	assert.ok(chosen && (chosen.worstMarginLu >= K.CLOCK.estimateLineLu || p.clock.source !== 'estimate'));
	// the first candidate in the seeded order that clears the line wins
	const first = p.clock.candidates.find((c) => c.worstMarginLu >= K.CLOCK.estimateLineLu);
	if (first) assert.equal(p.clock.offsetPhrase, first.k);
});

// ------------------------------------------------------------------------------------------------ crossfades

const assertChangesVoiceFree = (p: EpisodeAudioPlan, label: string) => {
	for (const c of p.changes.filter((x) => x.window)) {
		const [w0, w1] = c.window as [number, number];
		assert.ok(c.from >= w0 && c.to <= w1, `${label}: ${c.kind} [${c.from}, ${c.to}) outside its window [${w0}, ${w1})`);
		assert.ok(c.to - c.from >= K.XFADE.minFrames && c.to - c.from <= K.XFADE.maxFrames, `${label}: ${c.kind} is ${c.to - c.from} f`);
		for (const w of words(p)) {
			// the word itself (its end without the duck's 60 ms pad), 2 frames either side
			const a = Math.floor(w.start * FPS) - 2;
			const b = Math.ceil((w.end - K.WORD_PAD_END_SEC) * FPS) + 2;
			assert.ok(c.to <= a || c.from >= b, `${label}: ${c.kind} [${c.from}, ${c.to}) touches a word at frames ${a}-${b}`);
		}
	}
	// every transition is in the voice-free list the gate measures on the audio; its frames come from the mouth track
	// (timing.ts), where the sound is: the timeline's word ends can run past it (Kokoro's phrase-final phone)
	for (const s of p.scenes) {
		if (!(s.transitionFrames > 0)) continue;
		const v = p.voiceFree.find((x) => x.from === s.from - s.preroll && x.to === s.from - s.preroll + s.transitionFrames);
		assert.ok(v, `${label}: transition into ${s.id}`);
		const prev = p.scenes[p.scenes.indexOf(s) - 1];
		assert.ok(v.from >= prev.from && v.to <= s.firstVoiced, `${label}: transition into ${s.id} [${v.from}, ${v.to}) runs into the voice (first voiced frame ${s.firstVoiced})`);
	}
	// every other voice-free window (bed changes and fades) also stays clear of the words themselves
	for (const v of p.voiceFree.filter((x) => !/^(fade|slide|wipe) into/.test(x.why)))
		for (const w of words(p)) assert.ok(v.to <= Math.floor(w.start * FPS) || v.from >= Math.ceil((w.end - K.WORD_PAD_END_SEC) * FPS), `${label}: voice-free window ${v.why} [${v.from}, ${v.to}) has a word`);
};

test('sound: every bed change lies in the voice-free window between two scenes, never on a word (fixtures in 5 languages and a long episode)', () => {
	const mark = (sb: Storyboard) => {
		const x = clone(sb);
		x.scenes[0].bed = 'curious';
		x.scenes[3].bed = 'tension';
		return x;
	};
	for (const lang of ['en', 'es', 'pt-br', 'hi', 'zh']) {
		const en = mark(fix('engine-demo'));
		const sb = lang === 'en' ? en : mark(fix('engine-demo', lang));
		const enTl = voiced(en);
		const p = lang === 'en' ? plan(en, enTl) : plan(sb, voiced(sb), {master: {storyboard: en, timeline: enTl}});
		assert.ok(p.changes.filter((c) => c.window).length >= 2, `${lang}: ${p.changes.length} changes`);
		assertChangesVoiceFree(p, lang);
	}
	const long = longEpisode(40, {0: 'curious', 6: 'tension', 12: 'resolve', 18: 'ominous', 24: 'curious', 30: 'resolve', 36: 'tension'});
	const pl = plan(long, voiced(long));
	assert.ok(pl.changes.filter((c) => c.window).length >= 6, `${pl.changes.length} changes`);
	assertChangesVoiceFree(pl, 'long');
});

test('sound: the real demo voice (when built): bed changes, fades and transitions are voice-free', {skip: REAL.length ? false : 'public/generated/zoora-ai/_engine-demo has no voice output'}, () => {
	for (const lang of REAL) {
		assertChangesVoiceFree(realPlan(lang), `${lang} Episode`);
		assertChangesVoiceFree(realPlan(lang, 'short1'), `${lang} short1`);
	}
});

test('sound: crossfade shapes: a full equal-power overlap, or a staggered one when the two bars clash; all inside 9-, 12- and 18-frame windows', () => {
	const beds = Object.keys(HARMONY);
	// window fixtures: two talk scenes whose silence between them is exactly W frames after the guards
	for (const W of [9, 12, 18])
		for (const a of beds)
			for (const b of beds) {
				if (a === b) continue;
				const L = Math.min(K.XFADE.maxFrames, W);
				const clash = harmonicClashes(a, b, 100 - L, 100, 0).length > 0;
				const q = clash ? Math.round(L / 4) : 0;
				// the out-going fade [w1 - L, w1 - q) and the in-coming [w1 - L + q, w1) both stay inside [w0, w1)
				const w1 = 100;
				const w0 = w1 - W;
				assert.ok(w1 - L >= w0 && w1 - q <= w1 && w1 - L + q >= w0, `${a} -> ${b} in ${W} f`);
			}
	// equal power: in^2 + out^2 = 1 at every sample of a full overlap
	const sb = longEpisode(40, {0: 'curious', 6: 'tension', 12: 'curious', 18: 'ominous', 24: 'tension', 30: 'resolve', 36: 'curious'});
	const p = plan(sb, voiced(sb));
	let full = 0;
	for (const c of p.changes.filter((x) => x.kind === 'crossfade')) {
		full++;
		const out = p.beds.find((b) => b.from + b.durationInFrames === c.to) as EpisodeAudioPlan['beds'][number];
		const inn = p.beds.find((b) => b.from === c.from) as EpisodeAudioPlan['beds'][number];
		const go = bedLaw(p, out);
		const gi = bedLaw(p, inn);
		for (let s = c.from * K.SAMPLES_PER_FRAME; s < c.to * K.SAMPLES_PER_FRAME; s += 53) {
			const t = s / K.SAMPLE_RATE;
			const x = go.amplitude(t) ** 2 + gi.amplitude(t) ** 2;
			assert.ok(Math.abs(x - 1) < 1e-9, `crossfade at ${c.from}: in^2 + out^2 = ${x}`);
		}
	}
	const staggered = p.changes.filter((x) => x.kind === 'breath');
	assert.ok(full >= 1 && staggered.length >= 1, `${full} full, ${staggered.length} staggered`);
	for (const c of staggered) assert.match(c.note, /semitone/);
	// the score: curious has no B natural under speech, tension's A chord has its C#; D minor against D major clashes
	assert.ok(HARMONY['bed-story-curious-underscore'].every((bar) => !bar.includes(11)));
	assert.ok(harmonicClashes('bed-story-tension-underscore', 'bed-story-resolve-underscore', 0, 10, 0).length > 0);
	assert.equal(loopBarAt(0, 12.8), 4);
	assert.equal(loopBarAt(96, 0), 1);
});

test('sound: with too little silence at a boundary the bed keeps playing to the next boundary with room (a fitted dub)', () => {
	const sb = clone(fix('engine-demo'));
	sb.scenes[0].bed = 'curious';
	sb.scenes[2].bed = 'tension';
	sb.music = {offset: 0};
	const t = voiced(sb);
	// squeeze the silence before s03: its first word starts on its first frame, s02's last word ends near its last
	shiftScene(t.scenes[2], -t.scenes[2].words[0].startMs);
	const s2 = t.scenes[1];
	shiftScene(s2, s2.durationMs - 60 - s2.words[s2.words.length - 1].endMs);
	const p = plan(sb, t, {master: null});
	assert.ok(p.warnings.some((w) => /voice-free frames before scene s03/.test(w)), p.warnings.join('\n'));
	assert.ok(!p.changes.some((c) => c.window && c.toCue === 'bed-story-tension-underscore' && c.window[1] < p.scenes[2].from + 5));
	assertChangesVoiceFree(p, 'squeezed');
});

// ------------------------------------------------------------------------------------------------ the duck

test('sound: the duck holds through every reaction beat and every bed change (no swell on a joke), also in a padded chart scene', () => {
	const sb = clone(fix('engine-demo'));
	sb.scenes[2].minDurationSec = 12; // the chart scene padded: a long deadpan pause after the rug
	sb.scenes[3].bed = 'resolve';
	const p = plan(sb, voiced(sb));
	const d = duckOf(p);
	const maxRiseDb = (a: number, b: number) => {
		let lo = Infinity;
		let hi = -Infinity;
		for (let f = a; f <= b; f += 0.25) {
			const g = -12 * d.at(f / FPS);
			lo = Math.min(lo, g);
			hi = Math.max(hi, g);
		}
		return hi - lo;
	};
	for (const s of p.scenes) {
		const rise = maxRiseDb(s.reactionAt - K.BEAT_LEAD_FRAMES, s.reactionAt + K.BEAT_HOLD_FRAMES);
		assert.ok(rise <= 2, `${s.id}: the mid band moves ${rise.toFixed(1)} dB around Badger's reaction at ${s.reactionAt}`);
	}
	for (const c of p.changes.filter((x) => x.window)) assert.ok(maxRiseDb(c.from, c.to) <= 2, `${c.kind} at ${c.from}`);
	// pauses under 2 s inside the speech stay down; the duck follows the words of the voice that plays
	assert.equal(p.duck.minGapMs, K.DUCK.minGapMs);
	for (const w of words(p)) assert.equal(d.at((w.start + w.end) / 2), 1);
});

test('sound: the duck follows the language that plays (the English duck under Spanish words is the mistake it prevents)', () => {
	const en = fix('engine-demo');
	const es = fix('engine-demo', 'es');
	const enTl = voiced(en);
	const pEn = plan(en, enTl);
	const pEs = plan(es, voiced(es), {master: {storyboard: en, timeline: enTl}});
	const covered = (p: EpisodeAudioPlan, ws: EpisodeAudioPlan['words']) => {
		const d = duckOf(p);
		return ws.filter((w) => 12 * d.at((w.start + w.end) / 2) >= 10).length / ws.length;
	};
	assert.equal(covered(pEs, pEs.words), 1);
	assert.ok(covered(pEn, pEs.words) < 1, `the English duck covers ${covered(pEn, pEs.words)} of the Spanish words`);
	if (REAL.includes('es')) {
		const realEn = realPlan('en');
		const realEs = realPlan('es');
		assert.equal(covered(realEs, realEs.words), 1);
		assert.ok(covered(realEn, realEs.words) < 0.9, `the real English duck covers ${covered(realEn, realEs.words)} of the real Spanish words`);
	}
});

// ------------------------------------------------------------------------------------------------ the opening

test('sound: the opening is clean: the bed fades in from silence over the first sentence (at least 1 s), no effect in the opening scene', () => {
	for (const p of [plan(fix('engine-demo'), voiced(fix('engine-demo'))), ...REAL.map((l) => realPlan(l)), ...REAL.map((l) => realPlan(l, 'short1'))]) {
		const first = p.beds[0];
		assert.equal(first.from, 0);
		assert.ok(first.fadeInFrames >= K.OPENING_FADE.minMs / (1000 / FPS), `${first.fadeInFrames} f`);
		assert.equal(first.fadeInCurve, 'raisedCosine');
		const g = bedLaw(p, first);
		assert.equal(g.amplitude(0), 0);
		assert.ok(g.amplitude(0.15) < 0.03); // under the first word, the bed is still nearly silent
		const s0 = p.scenes[0];
		assert.ok(!p.sfx.some((c) => c.at >= s0.from && c.at < s0.from + s0.frames));
		assert.ok(p.protect.some((x) => x.why === 'hook'));
	}
});

// ------------------------------------------------------------------------------------------------ effects

test('sound: list items get a soft pitch-stable pop only in a gap of Zoo\'s speech, near the reveal; nothing for a cut, a fade, the rug or a slide by default', () => {
	// give every reveal a pause: one bullet per sentence, a long pause before each
	const sb = clone(fix('engine-demo'));
	const talk = sb.scenes[1];
	talk.narration = 'Here is the game. ... First, you buy early. ... Then you post the call. ... Then they buy. ... And you sell.';
	talk.onScreen = {...talk.onScreen, bullets: ['Buy early', 'Post the call', 'They buy', 'You sell'], cues: ['first', 'then', 'then', 'and']};
	const tl = voiced(sb);
	const p = plan(sb, tl);
	const items = p.sfx.filter((c) => c.event.startsWith('item'));
	for (const c of items) {
		assert.ok(c.id.startsWith('pop_') && !c.id.startsWith('pop_rise'), c.id);
		assert.ok(c.at - c.eventFrame >= -K.SFX_RULES.earliestFrames && c.at - c.eventFrame <= K.SFX_RULES.latestFrames, `${c.event} ${c.at - c.eventFrame} f from its reveal`);
		assert.equal(c.overVoice, false);
		assert.ok(c.targetLufs <= K.SFX_LEVELS.itemLufs + 1e-9);
	}
	for (const d of p.droppedSfx.filter((x) => x.event.startsWith('item'))) assert.match(d.why, /Zoo speaks/);
	// the demo's continuous narration: no gap near any reveal, so no pop (the picture still reveals)
	for (const lang of REAL) assert.equal(realPlan(lang).sfx.filter((c) => c.event.startsWith('item')).length, 0);
	// no effect for a cut or a fade; a slide only on request; the rug stays silent unless asked
	assert.ok(!p.sfx.some((c) => /transition:(cut|fade|slide)/.test(c.event)));
	const rug = p.droppedSfx.find((x) => x.event === 'rug');
	assert.ok(rug && /sfx.accent/.test(rug.why));
	const chart = p.scenes.find((s) => s.type === 'chart') as EpisodeAudioPlan['scenes'][number];
	const cp = chartPlansFor(sb, tl, 'landscape')[chart.id];
	const turn = Math.min(chart.frames - 20, (cp.rugDone as number) + 16);
	assert.ok(!p.sfx.some((c) => c.at >= chart.from + (cp.rugDone as number) - 2 && c.at <= chart.from + turn + 10), 'nothing on the rug or the deadpan turn');
});

test('sound: effect caps (3 in 10 s, 6 a minute, 6 frames apart) hold on a dense episode', () => {
	const sb = longEpisode(30);
	for (const sc of sb.scenes.slice(1, -1)) {
		sc.narration = 'One. ... Two. ... Three. ... Four.';
		sc.onScreen = {title: 'List', bullets: ['One', 'Two', 'Three', 'Four'], cues: ['one', 'two', 'three', 'four']};
		sc.transitionIn = 'wipe';
	}
	const p = plan(sb, voiced(sb));
	assert.ok(p.sfx.length > 5, `${p.sfx.length} effects`);
	const at = p.sfx.map((c) => c.at).sort((a, b) => a - b);
	for (let i = 0; i < at.length; i++) {
		if (i) assert.ok(at[i] - at[i - 1] >= K.SFX_RULES.minSpacingFrames);
		assert.ok(at.filter((x) => x > at[i] - 10 * FPS && x <= at[i]).length <= K.SFX_RULES.per10s, `10 s window ending ${at[i]}`);
		assert.ok(at.filter((x) => x > at[i] - 60 * FPS && x <= at[i]).length <= K.SFX_RULES.perMinute, `60 s window ending ${at[i]}`);
	}
	assert.ok(p.droppedSfx.some((d) => /in 10 s|in a minute/.test(d.why)));
});

test('sound: a wipe\'s whoosh passes by on the frame its edge moves fastest, at most 6 LU over the bed, and never reaches the first word', () => {
	for (const T of [12, 15, 18]) {
		// the critically damped wipe moves fastest at its start, not its midpoint (critic F8)
		const k = motionPeakFrame('wipe', T);
		const speed = (j: number) => transitionProgress('wipe', j + 1, T) - (j === 0 ? 0 : transitionProgress('wipe', j, T));
		for (let j = 0; j < T; j++) assert.ok(speed(j) <= speed(k) + 1e-12);
		assert.ok(k < T / 2);
		assert.ok(motionPeakFrame('slide', T) > k); // the slide's visible push peaks later, under its fade
	}
	const sb = clone(fix('engine-demo'));
	sb.scenes[3].transitionIn = 'wipe';
	sb.scenes[4].transitionIn = 'slide';
	sb.scenes[4].sfx = {transition: true};
	const tl = voiced(sb);
	const p = plan(sb, tl);
	const spans = episodeSpans(sb, tl, FPS);
	for (const c of p.sfx.filter((x) => x.event.startsWith('transition'))) {
		const s = spans.find((x) => x.id === c.scene) as (typeof spans)[number];
		const kind = c.event === 'transition:wipe' ? 'wipe' : 'slide';
		assert.ok(Math.abs(c.at - (s.from - s.preroll + motionPeakFrame(kind, s.transitionFrames))) <= 1, `${c.event} at ${c.at}`);
		const bed = p.beds.find((b) => c.at >= b.from && c.at < b.from + b.durationInFrames) as EpisodeAudioPlan['beds'][number];
		const level = bedLufsOver(LIB.levels, bed.cue, c.at / FPS - 0.8, c.at / FPS + 0.8, p.clock.offsetSec, true) as number;
		assert.ok(c.targetLufs <= level + K.SFX_LEVELS.overBedMaxLu + 1e-6, `${c.event}: ${c.targetLufs} LUFS over a ${level.toFixed(1)} LUFS bed`);
		assert.ok(c.targetLufs <= (kind === 'wipe' ? K.SFX_LEVELS.wipeMaxLufs : K.SFX_LEVELS.slideMaxLufs) + 1e-9);
		if (kind === 'slide') assert.equal(c.id, K.SFX_SOUNDS.slide);
		const scene = p.scenes.find((x) => x.id === c.scene) as EpisodeAudioPlan['scenes'][number];
		assert.ok(c.at + (K.WHOOSH_TAIL_FRAMES[c.id] ?? 99) <= scene.firstVoiced);
	}
	assert.ok(p.sfx.some((c) => c.event === 'transition:wipe'));
});

test('sound: the whoosh tails the planner uses are measured from the delivered WAVs', () => {
	for (const [id, tail] of Object.entries(K.WHOOSH_TAIL_FRAMES)) {
		const e = LIB.sfx.sounds.find((s) => s.id === id);
		assert.ok(e, id);
		const buf = readFileSync(join(STUDIO, 'public', e.file));
		const wav = parseWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
		const n = wav.channels[0].length;
		const frames = Math.ceil(n / K.SAMPLES_PER_FRAME);
		const pk = Array.from({length: frames}, (_, f) => {
			let m = 0;
			for (const ch of wav.channels) for (let i = f * K.SAMPLES_PER_FRAME; i < Math.min(n, (f + 1) * K.SAMPLES_PER_FRAME); i++) m = Math.max(m, Math.abs(ch[i]));
			return m;
		});
		const top = Math.max(...pk);
		let k = e.syncFrame30;
		while (k < frames && pk.slice(k).some((v) => v > top * 0.1)) k++;
		assert.equal(k - e.syncFrame30, tail, id);
	}
});

test('sound: nothing within 0.5 s of a spoken disclosure, and the disclosure is a protected phrase', () => {
	const sb = fix('engine-demo-offer');
	const tl = voiced(sb);
	const p = plan(sb, tl);
	const d = p.protect.find((x) => x.why === 'disclosure');
	assert.ok(d, 'the disclosure is found in the CTA words');
	const cta = tl.scenes.find((s) => s.id === 's02') as Timeline['scenes'][number];
	const w = cta.words.find((x) => /built/i.test(x.text)) as {startMs: number};
	assert.ok(Math.abs(d.start - (cta.startMs + w.startMs) / 1000) < 0.4, `${d.start}`);
	for (const c of p.sfx) assert.ok((c.from + c.durationInFrames) / FPS <= d.start - 0.5 || c.from / FPS >= d.end + 0.5);
});

// ------------------------------------------------------------------------------------------------ end screen and sting

test('sound: the end screen: the music comes up after the duck has released, on a bar line, rising monotonically, and ends on the last frame', () => {
	for (const p of [plan(fix('engine-demo'), voiced(fix('engine-demo'))), ...REAL.map((l) => realPlan(l))]) {
		const up = p.changes.find((c) => c.kind === 'music-up');
		assert.ok(up, 'a music-up');
		assert.equal(up.to % K.BAR_FRAMES, 0);
		assert.equal(up.to - up.from, K.END_SCREEN.upFrames);
		const d = duckOf(p);
		for (let f = up.from; f < up.to; f++) assert.equal(d.at(f / FPS), 0, `the duck is still releasing at ${f}`);
		const under = p.beds.find((b) => b.from + b.durationInFrames === up.to) as EpisodeAudioPlan['beds'][number];
		const motif = p.beds.find((b) => b.cue === K.END_SCREEN.up) as EpisodeAudioPlan['beds'][number];
		assert.equal(motif.levelDb, K.END_SCREEN.liftDb);
		assert.equal(motif.fadeInCurve, 'equalPower');
		// total power through the music-up (each bed at its level): never dips
		const gu = bedLaw(p, under);
		const gm = bedLaw(p, motif);
		let prev = -Infinity;
		for (let s = up.from * K.SAMPLES_PER_FRAME; s <= up.to * K.SAMPLES_PER_FRAME; s += 160) {
			const t = s / K.SAMPLE_RATE;
			const pw: number = gu.gain(t, 1) ** 2 + (10 ** (motif.levelDb / 20) * gm.gain(t, 1)) ** 2;
			assert.ok(pw >= prev - 1e-9, `the music-up dips at ${t}`);
			prev = pw;
		}
		assert.equal(motif.from + motif.durationInFrames, p.durationInFrames);
		assert.equal(motif.fadeOutFrames, K.END_SCREEN.finalFadeFrames);
		// Zoora AI's own major motif closes the episode (not the show's D minor end-screen cue)
		assert.ok(!p.beds.some((b) => b.cue.startsWith('endscreen')));
	}
});

test('sound: the brand sting is off by default; on request it waits for Badger, keeps the first 12 s narrated, and the next scene cuts in', () => {
	const sb = clone(fix('engine-demo'));
	assert.equal(plan(sb, voiced(sb)).stingers.length, 0);
	sb.fiction = false;
	sb.music = {sting: 'after-hook'};
	// no room in the hook: the error names the minDurationSec it needs
	assert.throws(() => plan(sb, voiced(sb)), /set minDurationSec: [\d.]+ on s01/);
	// a padded hook: the slot after Badger's reaction; but the first 12 s would hold too little narration
	sb.scenes[0].minDurationSec = 12.5;
	assert.throws(() => plan(sb, voiced(sb)), /without narration/);
	// a longer story before it is fine
	sb.scenes[0].narration = 'You post one chart. Ten thousand strangers buy your coin within the hour. Then they ask who you are. Then they ask again, louder. Then the price stops moving and everybody looks at you.';
	sb.scenes[0].minDurationSec = 22;
	const p = plan(sb, voiced(sb));
	assert.equal(p.stingers.length, 1);
	const st = p.stingers[0];
	const hook = p.scenes[0];
	assert.ok(st.downbeat >= K.STING.minStartFrame && st.downbeat >= hook.reactionAt + K.STING.afterReactionFrames);
	assert.ok(st.downbeat + K.STING.frames + K.STING.guardFrames <= p.scenes[1].from);
	assert.deepEqual(p.picture.forceCut, [p.scenes[1].id]);
	assert.equal(p.scenes[1].transition, 'cut');
	const rest = p.beds[0].rests[0];
	assert.equal(rest.floorDb, K.REST_FLOOR_DB);
	assert.ok(p.voiceFree.some((v) => v.why === 'brand sting'));
	// never in a Short
	const sh = plan(sb, voiced(sb), {format: 'vertical', shortId: 'short1'});
	assert.equal(sh.stingers.length, 0);
});

// ------------------------------------------------------------------------------------------------ Shorts and dubs

test('sound: a Short plays one bed from frame 0 (its own choice or shorts[].bed), ducked from its own windows, out over at most 12 frames', () => {
	const sb = clone(fix('engine-demo'));
	const tl = voiced(sb);
	const p = plan(sb, tl, {format: 'vertical', shortId: 'short1'});
	assert.equal(new Set(p.beds.map((b) => b.cue)).size, 1);
	assert.equal(p.beds[0].from, 0);
	assert.equal(p.beds[0].from + p.beds[0].durationInFrames, p.durationInFrames);
	assert.ok(p.beds[0].fadeOutFrames <= K.END_FADE_FRAMES.short);
	assert.equal(p.stingers.length, 0);
	assert.ok(!p.beds.some((b) => b.cue === K.END_SCREEN.up));
	// words: each scene's words at its new frame, cut at its window end
	const spans = p.scenes;
	for (const w of p.words) assert.ok(spans.some((s) => w.start >= s.from / FPS - 1e-6 && w.start < (s.from + s.frames) / FPS), `${w.start}`);
	const sb2 = clone(sb);
	(sb2.shorts as NonNullable<Storyboard['shorts']>)[0].bed = 'ominous';
	assert.equal(plan(sb2, voiced(sb2), {format: 'vertical', shortId: 'short1'}).beds[0].cue, 'bed-story-ominous-underscore');
	// the Short's clock is its own, from its base section first
	assert.ok([0, 1, 2, 3, 4].includes(p.clock.offsetPhrase));
});

test('sound: a dub plays the master\'s moods and clock at its own times, and refuses to plan without the master', () => {
	const en = everyBoundaryChanges(fix('engine-demo'));
	const es = everyBoundaryChanges(fix('engine-demo', 'es'));
	const enTl = voiced(en);
	const esTl = voiced(es);
	assert.throws(() => plan(es, esTl), /needs the en master storyboard and timeline/);
	const a = plan(es, esTl, {master: {storyboard: en, timeline: enTl}});
	const b = plan(clone(es), clone(esTl), {master: {storyboard: clone(en), timeline: clone(enTl)}});
	assert.deepEqual(a, b); // the same inputs, the same plan, whatever else exists
	assert.deepEqual(a.regionMap, plan(en, enTl).regionMap);
	assert.equal(a.clock.offsetPhrase, plan(en, enTl).clock.offsetPhrase);
	// a dub whose music fields differ is warned that the music follows storyboard.json
	const es2 = clone(es);
	es2.scenes[1].bed = 'ominous';
	assert.ok(plan(es2, esTl, {master: {storyboard: en, timeline: enTl}}).warnings.some((w) => /follows storyboard.json/.test(w)));
});

test('sound: an audio track fitted to the master video: effects on the master picture, every voice check on the dub', () => {
	const en = clone(fix('engine-demo'));
	en.scenes[3].transitionIn = 'wipe';
	const es = clone(fix('engine-demo', 'es'));
	es.scenes[3].transitionIn = 'wipe';
	const enTl = voiced(en);
	// the master's s03 speaks to near its end (the wipe runs inside s04's lead) and s04 starts speaking 0.5 s in
	shiftScene(enTl.scenes[2], enTl.scenes[2].durationMs - 120 - enTl.scenes[2].words[enTl.scenes[2].words.length - 1].endMs);
	shiftScene(enTl.scenes[3], 300);
	const pEn = plan(en, enTl);
	const whooshEn = pEn.sfx.find((c) => c.event === 'transition:wipe');
	assert.ok(whooshEn, 'the master has a whoosh into s04');
	// the dub fitted to the master: same scene times, its own words; its s04 speaks right away (a shortened pause)
	const esTl = voiced(es);
	const fit: Timeline = {...clone(esTl), mode: 'fit-to-master', masterLang: 'en', totalMs: enTl.totalMs};
	fit.scenes = fit.scenes.map((s, i) => ({...s, startMs: enTl.scenes[i].startMs, durationMs: enTl.scenes[i].durationMs, mouth: s.mouth.slice(0, enTl.scenes[i].mouth.length)}));
	for (const [i, s] of fit.scenes.entries()) {
		const room = enTl.scenes[i].durationMs - 200;
		s.words = s.words.filter((w) => w.endMs <= room);
		s.speechMs = s.words.length ? s.words[s.words.length - 1].endMs : 0;
		while (s.mouth.length < enTl.scenes[i].mouth.length) s.mouth.push('closed');
	}
	shiftScene(fit.scenes[3], -fit.scenes[3].words[0].startMs);
	const charts = chartPlansFor(en, enTl, 'landscape');
	const p = planEpisodeAudio({format: 'landscape', storyboard: es, timeline: fit, master: {storyboard: en, timeline: enTl}, charts: chartPlansFor(es, fit, 'landscape'), masterCharts: charts, lib: LIB});
	assert.equal(p.master.mode, 'fit-to-master');
	assert.ok(!p.sfx.some((c) => c.event === 'transition:wipe'), 'the whoosh would reach the dub\'s first word: dropped');
	assert.ok(p.droppedSfx.some((d) => d.event === 'transition:wipe' && /first word/.test(d.why)));
	// the duck follows the dub's words
	const d = duckOf(p);
	for (const w of p.words) assert.equal(d.at((w.start + w.end) / 2), 1);
});

// ------------------------------------------------------------------------------------------------ the rest

test('sound: a region that runs past 2 loops rests for a scene and 8 bars, then re-enters on a phrase start under the duck', () => {
	const sb = longEpisode(40, {0: 'curious'}, 4);
	const p = plan(sb, voiced(sb));
	const out = p.changes.filter((c) => c.kind === 'music-out');
	const back = p.changes.filter((c) => c.kind === 'music-back');
	assert.ok(out.length >= 1 && back.length === out.length, `${out.length} rests`);
	const d = duckOf(p);
	for (let i = 0; i < out.length; i++) {
		assert.ok(back[i].to - out[i].to >= K.MUSIC_OUT.minFrames, 'rests at least 8 bars');
		assert.equal(back[i].to % K.PHRASE_FRAMES, 0);
		for (let f = back[i].from; f <= back[i].to; f += 3) assert.ok(d.at(f / FPS) > 0.99, 'the bed comes back under the duck');
	}
	const bed = p.beds.find((b) => b.rests.length) as EpisodeAudioPlan['beds'][number];
	for (const r of bed.rests) assert.equal(r.floorDb, K.REST_FLOOR_DB); // a dip, not silence
	assert.match(cueSheet(p), /music rests/);
});

test('sound: a mock timeline plans silence (the SILENT PREVIEW stays true)', () => {
	const sb = fix('engine-demo');
	const p = plan(sb, mockTimeline(sb, {fps: FPS}));
	assert.equal(p.silent, true);
	assert.equal(p.beds.length + p.sfx.length + p.stingers.length, 0);
});

test('sound: plans are deterministic plain JSON with a hash; every cue exists; the bed level table matches the delivered beds', () => {
	const sb = everyBoundaryChanges(fix('engine-demo'));
	const tl = voiced(sb);
	const a = plan(sb, tl);
	const b = plan(clone(sb), clone(tl));
	assert.deepEqual(a, b);
	assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
	assert.equal(a.hash, planHash(a as unknown as Record<string, unknown>));
	assert.match(a.hash, /^[0-9a-f]{64}$/);
	const c = clone(sb);
	c.scenes[1].bed = 'ominous';
	assert.notEqual(plan(c, voiced(c)).hash, a.hash);
	for (const bed of a.beds) assert.ok(LIB.music.cues.some((x) => x.id === bed.cue && x.file === bed.file));
	for (const s of a.sfx) assert.ok(LIB.sfx.sounds.some((x) => x.id === s.id && x.file === s.file));
	for (const [id, t] of Object.entries((LIB.levels as BedLevelTable).beds)) {
		const sha = createHash('sha256').update(readFileSync(join(STUDIO, 'public', t.file))).digest('hex');
		assert.equal(sha, t.sha256, `${id} changed: re-run src/episode/tools/bed_levels.py (and check moods.ts HARMONY against the score)`);
	}
	// the hash is SHA-256 of canonical JSON (keys sorted), the same in Node and the render
	for (const s of ['', 'abc', 'é€', canonicalJson({b: 1, a: [2, {d: 3, c: 4}]})]) assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'));
	assert.equal(canonicalJson({b: 1, a: [2, {d: 3, c: 4}]}), '{"a":[2,{"c":4,"d":3}],"b":1}');
});

test('sound: validation of the new fields and props', () => {
	const ctx = {channel: '_dev', slug: 'engine-demo', lang: 'en' as const, short: false};
	const errs = (sb: Storyboard) => validateStoryboard(sb, ctx).filter((i) => i.level === 'error').map((i) => i.msg);
	const warns = (sb: Storyboard) => validateStoryboard(sb, ctx).filter((i) => i.level === 'warning').map((i) => i.msg);
	const sb = clone(fix('engine-demo'));
	assert.deepEqual(errs(sb), []);
	const bad = clone(sb);
	(bad.scenes[1] as {bed?: string}).bed = 'happy';
	assert.ok(errs(bad).some((m) => /bed must be one of/.test(m)));
	const end = clone(sb);
	end.scenes[6].bed = 'tension';
	assert.ok(errs(end).some((m) => /end screen plays its own music/.test(m)));
	end.scenes[6].bed = 'none';
	assert.deepEqual(errs(end), []);
	const hookNone = clone(sb);
	hookNone.scenes[0].bed = 'none';
	assert.ok(warns(hookNone).some((m) => /opens without music/.test(m)));
	const sfx = clone(sb);
	(sfx.scenes[1] as {sfx?: unknown}).sfx = {transition: 'yes'};
	assert.ok(errs(sfx).some((m) => /sfx must be an object of booleans/.test(m)));
	const music = clone(sb);
	(music as {music?: unknown}).music = {offset: 7, sting: 'always'};
	assert.ok(errs(music).some((m) => /offset must be/.test(m)));
	assert.ok(errs(music).some((m) => /sting must be/.test(m)));
	const stingNoHook = clone(sb);
	stingNoHook.music = {sting: 'after-hook'};
	stingNoHook.scenes[0].type = 'talk';
	assert.ok(errs(stingNoHook).some((m) => /needs a hook/.test(m)));
	const es = clone(fix('engine-demo', 'es'));
	es.music = {sting: 'after-hook'};
	assert.ok(validateStoryboard(es, {...ctx, lang: 'es'}).some((i) => i.level === 'error' && /stingTagline is required/.test(i.msg)));
	const shorts = clone(sb);
	(shorts.shorts as Array<{bed?: string}>)[0].bed = 'loud';
	assert.ok(errs(shorts).some((m) => /shorts "short1"/.test(m) || /bed must be one of/.test(m)));
	const props = (p: Record<string, unknown>) => validateProps({channel: 'zoora-ai', slug: 'x', lang: 'en', ...p}, false).filter((i) => i.level === 'error');
	assert.deepEqual(props({audioStems: ['voice']}), []);
	assert.equal(props({audioStems: ['voice', 'voice']}).length, 1);
	assert.equal(props({audioStems: ['bass']}).length, 1);
	assert.equal(props({audioStems: []}).length, 1);
	assert.equal(props({audioPlanHash: 'abc'}).length, 1);
	assert.deepEqual(props({audioPlanHash: 'a'.repeat(64)}), []);
});

test('sound: the planner sees the reaction beats the scenes draw (one shared cast per template)', () => {
	const sb = fix('engine-demo');
	const chart = sb.scenes[2];
	const land = sceneCast(chart, 'landscape');
	assert.equal(land.badgerInsert, false);
	assert.equal(land.badgerPlace, (LAYOUTS.chart.landscape.pair as NonNullable<typeof LAYOUTS.chart.landscape.pair>).badger);
	const vert = sceneCast(chart, 'vertical');
	assert.equal(vert.badgerInsert, true);
	assert.equal(vert.zooView, 'threeQuarter');
	assert.equal(sceneCast(sb.scenes[1], 'vertical').badgerInsert, true);
	assert.equal(sceneCast({...sb.scenes[1], badger: {present: false}}, 'landscape').badgerPlace, null);
});
