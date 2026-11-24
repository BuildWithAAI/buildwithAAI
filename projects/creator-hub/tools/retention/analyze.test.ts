import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {analyzeRecords, episodeKeyOf} from './analyze.ts';
import type {CurvePoint, PullRecord, SceneSnapshot} from './types.ts';

const NOW = new Date('2026-11-24T12:00:00Z');
const close = (actual: number | null, expected: number, tol = 1e-6) => assert.ok(actual !== null && Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

type Spec = {
	videoId?: string;
	slug?: string;
	lang?: string;
	format?: 'long' | 'short';
	scenes: [string, string, number][]; // id, type, durationMs
	watch?: (k: number) => number; // bucket 0..99
	views?: number;
	started?: boolean;
	stopped?: (k: number) => number;
	fixture?: boolean;
	pulledAt?: string;
	patch?: (r: PullRecord) => void;
};

/** A pull record with an exact, hand-made curve. */
const record = (spec: Spec): PullRecord => {
	let at = 0;
	const scenes: SceneSnapshot[] = spec.scenes.map(([id, type, durationMs], index) => {
		const s: SceneSnapshot = {id, index, type, segment: null, segmentSource: null, badger: index % 2 === 0, title: null, startMs: at, durationMs, speechMs: null};
		at += durationMs;
		return s;
	});
	const watch = spec.watch ?? ((k: number) => 1 - 0.004 * k);
	const curve: CurvePoint[] = Array.from({length: 100}, (_, k) => ({
		ratio: (k + 1) / 100,
		watch: watch(k),
		relative: 0.5,
		started: spec.started === false ? null : k === 0 ? (spec.views ?? 1000) : 0,
		stopped: spec.stopped ? spec.stopped(k) : null,
		impressions: null,
	}));
	const r: PullRecord = {
		version: 1,
		kind: 'retention-pull',
		fixture: spec.fixture ?? true,
		videoId: spec.videoId ?? 'SYNtest0001',
		account: null,
		channel: 'zoora-ai',
		slug: spec.slug ?? 'fixture-a',
		lang: spec.lang ?? 'en',
		format: spec.format ?? 'long',
		shortId: spec.format === 'short' ? 'short1' : null,
		multiLanguageAudio: false,
		pulledAt: spec.pulledAt ?? '2026-11-24T00:00:00Z',
		window: {startDate: '2026-10-01', endDate: '2026-11-23'},
		audience: 'all',
		metrics: ['audienceWatchRatio', 'relativeRetentionPerformance', 'startedWatching', 'stoppedWatching'],
		curve,
		stats: {views: spec.views ?? 1000, engagedViews: spec.views ?? 1000, averageViewDurationSec: null, averageViewPercentage: null, contentType: spec.format === 'short' ? 'SHORTS' : 'VIDEO_ON_DEMAND'},
		video: {durationSec: Math.round(at / 1000), publishedAt: '2026-10-01T00:00:00Z', defaultAudioLanguage: spec.lang ?? 'en', fetchedAt: '2026-11-24T00:00:00Z'},
		join: {format: spec.format ?? 'long', shortId: spec.format === 'short' ? 'short1' : null, renderer: 'episode', totalMs: at, fps: 30, scenes, timeline: {path: 'x', sha256: 'x', mode: 'native', mock: false, lang: 'en'}, storyboard: {path: null, sha256: null}, issues: []},
		checks: {durationMatch: true, durationDeltaMs: 0, langMatch: true, formatMatch: true},
		warnings: [],
	};
	spec.patch?.(r);
	return r;
};

const HUNDRED = [['s01', 'hook', 10_000], ['s02', 'talk', 20_000], ['s03', 'chart', 1500], ['s04', 'steps', 48_500], ['s05', 'endscreen', 20_000]] as [string, string, number][];

describe('scene metrics on an exact curve', () => {
	const [v] = analyzeRecords([record({scenes: HUNDRED, stopped: (k) => (k === 99 ? 600 : k >= 10 && k < 30 ? 10 : 0)})], {now: NOW}).analyses;
	it('reads retention in and out between bucket midpoints', () => {
		const s02 = v!.scenes[1]!;
		close(s02.entry, 1 - 0.004 * 9.5);
		close(s02.exit, 1 - 0.004 * 29.5);
		close(s02.dropPp, 8);
		close(s02.dropPer10sPp, 4);
		close(s02.lostShare, 1 - (1 - 0.004 * 29.5) / (1 - 0.004 * 9.5));
	});
	it('measures the loss rate between the first and last WHOLE buckets inside the scene', () => {
		const s02 = v!.scenes[1]!;
		// whole buckets 10..29 (1 s each): -1000 ln(w29 / w10) / 19 s
		close(s02.lossRate, (-1000 * Math.log((1 - 0.004 * 29) / (1 - 0.004 * 10))) / 19);
		assert.equal(s02.resolved, true);
		assert.equal(s02.eligible, true);
	});
	it('a scene with fewer than 2 whole buckets is not measured on its own', () => {
		const s03 = v!.scenes[2]!;
		assert.equal(s03.resolved, false);
		assert.equal(s03.lossRate, null);
		assert.equal(s03.eligible, false);
	});
	it('the opening scene and the end screen never enter scene comparisons', () => {
		assert.equal(v!.scenes[0]!.eligible, false);
		assert.equal(v!.scenes[4]!.eligible, false);
		assert.equal(v!.scenes[3]!.eligible, true);
	});
	it('share of playbacks that ended in a scene (stoppedWatching)', () => {
		// 200 of the 800 stops are in buckets 10..29 (scene s02), 600 in the last bucket
		close(v!.scenes[1]!.stopShare, 200 / 800);
	});
	it('hook windows: retention at 0:05 and 0:30, lost in the first seconds', () => {
		close(v!.hook.r0, 1);
		close(v!.hook.r5, 1 - 0.004 * 4.5);
		close(v!.hook.r30, 1 - 0.004 * 29.5);
		close(v!.hook.lost5Pp, 0.4 * 4.5);
		assert.deepEqual(v!.hook.scenesIn5s, ['s01']);
		assert.deepEqual(v!.hook.scenesIn30s, ['s01', 's02']);
		assert.equal(v!.hook.outcome.atSec, 30);
		assert.equal(v!.hook.opening!.lengthMs, 10_000);
	});
	it('playbacks come from startedWatching when YouTube gave it', () => {
		assert.equal(v!.sample.playbacks, 1000);
		assert.equal(v!.sample.used, 1000);
	});
});

describe('very short videos and Shorts', () => {
	it('a 4 s Short has no 0:05 or 0:30 value; its hook outcome is at 0:05', () => {
		const [v] = analyzeRecords([record({format: 'short', scenes: [['s01', 'hook', 1500], ['s02', 'talk', 2500]]})], {now: NOW}).analyses;
		assert.equal(v!.usable, true);
		assert.equal(v!.hook.r5, null);
		assert.equal(v!.hook.r30, null);
		assert.deepEqual(v!.hook.outcome, {atSec: 5, value: null});
		assert.equal(v!.scenes[1]!.resolved, true, '2.5 s of a 4 s video is 62 buckets');
	});
	it('values above 1 (loops) are kept and give a negative drop', () => {
		const [v] = analyzeRecords([record({format: 'short', scenes: [['s01', 'hook', 5000], ['s02', 'talk', 10_000], ['s03', 'steps', 10_000]], watch: (k) => (k < 60 ? 1 - 0.003 * k : 0.82 + 0.004 * (k - 60))})], {now: NOW}).analyses;
		const last = v!.scenes[2]!;
		assert.ok(last.dropPp < 0, 'retention rose in the last scene');
		assert.ok(last.lossRate! < 0);
	});
});

describe('exclusions', () => {
	const reasons = (r: PullRecord, options = {}) => analyzeRecords([r], {now: NOW, ...options}).analyses[0]!.exclusions.map((e) => e.code);
	it('too few views', () => {
		assert.deepEqual(reasons(record({scenes: HUNDRED, views: 40})), ['low-views']);
		assert.deepEqual(reasons(record({scenes: HUNDRED, views: 40}), {minViews: 10}), []);
	});
	it('no rows, or too many missing buckets', () => {
		assert.ok(reasons(record({scenes: HUNDRED, patch: (r) => (r.curve = [])})).includes('no-curve'));
		assert.deepEqual(reasons(record({scenes: HUNDRED, patch: (r) => (r.curve = r.curve.slice(0, 80))})), ['incomplete-curve']);
		assert.deepEqual(reasons(record({scenes: HUNDRED, patch: (r) => (r.curve = r.curve.filter((_, i) => i % 20 !== 0))})), [], '95 of 100 is enough');
	});
	it('a duration that differs from the timeline (another cut was uploaded)', () => {
		assert.deepEqual(reasons(record({scenes: HUNDRED, patch: (r) => (r.checks = {...r.checks, durationMatch: false, durationDeltaMs: 9000})})), ['duration-mismatch']);
	});
	it('an unverified duration, unless allowed', () => {
		const r = record({scenes: HUNDRED, patch: (x) => (x.checks = {...x.checks, durationMatch: null, durationDeltaMs: null})});
		assert.deepEqual(reasons(r), ['duration-unverified']);
		assert.deepEqual(reasons(r, {allowUnverifiedDuration: true}), []);
	});
	it('a Short pulled as long-form (or the reverse)', () => {
		assert.deepEqual(reasons(record({scenes: HUNDRED, patch: (r) => (r.checks = {...r.checks, formatMatch: false})})), ['format-mismatch']);
	});
	it('a mock timeline', () => {
		assert.deepEqual(reasons(record({scenes: HUNDRED, patch: (r) => (r.join.timeline.mock = true)})), ['mock-timeline']);
	});
	it('a real pull older than 30 days is stale (Developer Policies III.E.4); fixtures never are', () => {
		const old = {scenes: HUNDRED, pulledAt: '2026-10-01T00:00:00Z'};
		assert.deepEqual(reasons(record({...old, fixture: false})), ['stale']);
		assert.deepEqual(reasons(record({...old, fixture: false}), {includeStale: true}), []);
		assert.deepEqual(reasons(record({...old, fixture: true})), []);
	});
	it('falls back to the smaller of views and engaged views without startedWatching', () => {
		const r = record({scenes: HUNDRED, started: false, patch: (x) => (x.stats = {...x.stats!, views: 900, engagedViews: 700})});
		const v = analyzeRecords([r], {now: NOW}).analyses[0]!;
		assert.equal(v.sample.playbacks, null);
		assert.equal(v.sample.used, 700);
	});
});

describe('typical curve (levels)', () => {
	const ep = (n: number, lang = 'en') => record({videoId: `SYNtyp${lang === 'en' ? 'E' : 'S'}${String(n).padStart(4, '0')}`, slug: `fixture-${n}`, lang, scenes: HUNDRED, watch: (k) => 1 - (0.003 + n * 0.0002) * k});
	it('needs 3 OTHER episodes of the same channel and format', () => {
		const three = analyzeRecords([ep(1), ep(2), ep(3)], {now: NOW}).analyses;
		assert.ok(three.every((v) => v.baselineEpisodes === 0));
		const four = analyzeRecords([ep(1), ep(2), ep(3), ep(4)], {now: NOW}).analyses;
		assert.ok(four.every((v) => v.baselineEpisodes === 3));
		assert.ok(four[0]!.hook.vsTypical30Pp! > 0, 'episode 1 declines slowest, so it is above the typical curve');
	});
	it('language versions of one episode are not "other episodes"', () => {
		const list = analyzeRecords([ep(1), ep(1, 'es'), ep(2), ep(3)], {now: NOW}).analyses;
		assert.ok(list.every((v) => v.baselineEpisodes < 3), 'episode 1 (en + es) counts once');
		assert.equal(episodeKeyOf({channel: 'zoora-ai', slug: 'x', format: 'short', shortId: 'daily'}), 'zoora-ai/x/short/daily');
	});
});
