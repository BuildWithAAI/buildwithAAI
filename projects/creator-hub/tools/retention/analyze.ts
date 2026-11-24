/**
 * Per-upload analysis (our calculations from YouTube's retention values):
 *  - each scene's retention at entry and exit (interpolated between bucket midpoints), its drop and drop per 10 s
 *    (percentage points of the video's views), its loss rate (% of the viewers still watching, lost per 10 s),
 *    relative retention performance over the scene, and the share of playbacks that ended in it;
 *  - the scene against the channel's drop-off model (dropoff.ts): its loss rate minus what is expected at that
 *    moment of this upload ("excess": > 0 = loses more viewers than expected);
 *  - the channel's typical curve, for retention LEVELS: at each second, the median retention of the OTHER episodes of
 *    the same channel and format (language versions averaged first; the episode itself left out). It is aligned in
 *    absolute time, not as a share of the video: the early drop-off happens in the first seconds whatever the
 *    length, and the 20 s end screen sits at a different share of each video, so each video counts only up to its
 *    end screen;
 *  - the hook windows: retention at 0:05 and 0:30, against the typical curve, and which scenes those windows cover.
 * Uploads that fail a data-quality rule are kept in the output with the reason and are not used in comparisons.
 */
import {BUCKETS, densify, meanOver, nullableValueAt, sumOver, valueAt, type DenseCurve} from './curve.ts';
import {RULES} from './rules.ts';
import {fitSceneModel, type SceneModelResult, type SceneRow} from './scenemodel.ts';
import type {Exclusion, HookMetrics, PullRecord, SceneMetrics, VideoAnalysis} from './types.ts';

export type AnalyzeOptions = {
	now: Date;
	minViews?: number;
	includeStale?: boolean;
	allowUnverifiedDuration?: boolean;
};

export const episodeKeyOf = (r: Pick<PullRecord, 'channel' | 'slug' | 'format' | 'shortId'>): string =>
	`${r.channel}/${r.slug}/${r.format}${r.shortId ? `/${r.shortId}` : ''}`;

const DAY_MS = 86_400_000;
/** Below this retention the log loss rate is meaningless (almost nobody left to lose). */
const LOSS_FLOOR = 0.005;
const sumNullable = (values: (number | null)[]): number | null => {
	const present = values.filter((v): v is number => v !== null);
	return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

type Prepared = {record: PullRecord; dense: DenseCurve | null; analysis: Omit<VideoAnalysis, 'scenes' | 'hook' | 'baselineEpisodes'>};

const prepare = (record: PullRecord, options: AnalyzeOptions): Prepared => {
	const dense = densify(record.curve);
	const exclusions: VideoAnalysis['exclusions'] = [];
	const exclude = (code: Exclusion, detail: string) => exclusions.push({code, detail});
	const fixture = record.fixture === true;
	const ageDays = Math.max(0, (options.now.getTime() - Date.parse(record.pulledAt)) / DAY_MS);
	const minViews = options.minViews ?? RULES.minViews;

	const playbacks = dense ? sumNullable(dense.started) : null;
	const viewCounts = [record.stats?.views ?? null, record.stats?.engagedViews ?? null].filter((v): v is number => v !== null);
	const views = viewCounts.length ? Math.min(...viewCounts) : null;
	const used = playbacks !== null && playbacks > 0 ? playbacks : views;

	if (!dense) exclude('no-curve', 'YouTube returned no retention rows (too few views, or the data is still processing: 48-72 h)');
	else if (dense.presentCount < RULES.minBuckets) exclude('incomplete-curve', `${dense.presentCount} of ${BUCKETS} buckets returned (need ${RULES.minBuckets})`);
	if (used === null) exclude('sample-unknown', 'no view or playback count, so the curve cannot be weighed');
	else if (used < minViews) exclude('low-views', `${used} ${playbacks ? 'playbacks' : 'views'} (need ${minViews})`);
	if (record.join.timeline.mock) exclude('mock-timeline', 'the timeline is a mock (silent preview)');
	if (record.checks.durationMatch === false) exclude('duration-mismatch', `YouTube's duration differs from the timeline by ${Math.round(Math.abs(record.checks.durationDeltaMs ?? 0))} ms: another cut was uploaded`);
	if (record.checks.durationMatch === null && !options.allowUnverifiedDuration) exclude('duration-unverified', 'the video duration could not be compared with the timeline (re-pull with the youtube.readonly scope, or pass --allow-unverified-duration)');
	if (record.checks.formatMatch === false) exclude('format-mismatch', `YouTube counts this video as ${record.stats?.contentType ?? '?'}, but it was pulled as ${record.format === 'short' ? 'a Short' : 'long-form'}`);
	if (!record.join.scenes.length) exclude('no-scenes', 'no scene could be placed on the timeline');
	if (!fixture && ageDays > RULES.staleDays && !options.includeStale) exclude('stale', `pulled ${Math.floor(ageDays)} days ago: run "refresh" (YouTube API Developer Policies III.E.4: re-check every 30 days)`);

	const warnings = [...record.warnings, ...(dense?.issues ?? []), ...record.join.issues.map((i) => `${i.code}: ${i.detail}`)];
	if (record.multiLanguageAudio) warnings.push('this upload carries extra dubbed audio tracks: its curve blends several languages');
	if (record.checks.langMatch === false) warnings.push(`YouTube's default audio language (${record.video?.defaultAudioLanguage}) differs from --lang ${record.lang}`);
	const bucketMs = record.join.totalMs / BUCKETS;
	return {
		record,
		dense,
		analysis: {
			videoId: record.videoId,
			fixture,
			channel: record.channel,
			slug: record.slug,
			lang: record.lang,
			format: record.format,
			shortId: record.shortId,
			episodeKey: episodeKeyOf(record),
			multiLanguageAudio: record.multiLanguageAudio,
			pulledAt: record.pulledAt,
			ageDays,
			window: record.window,
			audience: record.audience,
			totalMs: record.join.totalMs,
			bucketMs,
			usable: exclusions.length === 0,
			exclusions,
			sample: {playbacks, views, used},
			averageRetention: dense ? dense.watch.reduce((a, b) => a + b, 0) / BUCKETS : null,
			presentBuckets: dense?.presentCount ?? 0,
			inSceneModel: false,
			warnings,
		},
	};
};

/**
 * Sampling noise of a scene's loss, in percentage points of the video's views per 10 s (RULES.noiseSe): with n
 * playbacks, n * entry viewers are present, and the number who leave over the span at `ratePer10s` (% of those
 * watching per 10 s) is binomial. Null when the sample or the span is unknown.
 */
export const lossNoisePpPer10s = (n: number | null, entry: number, ratePer10s: number, spanMs: number | null): number | null => {
	if (n === null || !(n > 0) || spanMs === null || !(spanMs > 0)) return null;
	const spanSec = spanMs / 1000;
	const q = 1 - Math.exp((-Math.max(0, ratePer10s) * spanSec) / 1000);
	const present = Math.max(0, Math.min(1, entry));
	return 100 * Math.sqrt((present * q * (1 - q)) / n) * (10 / spanSec);
};

/** Where a video's content ends: the start of its end screen, or its full length. */
const contentEndMs = (p: Prepared): number => {
	const scenes = p.record.join.scenes;
	const last = scenes[scenes.length - 1];
	return last && last.type === 'endscreen' ? last.startMs : p.record.join.totalMs;
};

/** Retention of one upload at an absolute time (ms), from its 100-bucket curve. */
const retentionAt = (p: Prepared, tMs: number): number => valueAt(p.dense!.watch, Math.min(1, Math.max(0, tMs / p.record.join.totalMs)));

export type Baseline = {
	episodes: number;
	/** Median retention of the other episodes at tMs, and how many of them reach that time; null below the minimum. */
	at: (tMs: number) => {value: number; episodes: number} | null;
};

/** The typical curve for one upload: other episodes of the same channel and format, aligned in absolute time. */
const baselineFor = (target: Prepared, pool: readonly Prepared[]): Baseline | null => {
	const byEpisode = new Map<string, Prepared[]>();
	for (const p of pool) {
		if (p.analysis.episodeKey === target.analysis.episodeKey) continue;
		if (p.analysis.channel !== target.analysis.channel || p.analysis.format !== target.analysis.format) continue;
		byEpisode.set(p.analysis.episodeKey, [...(byEpisode.get(p.analysis.episodeKey) ?? []), p]);
	}
	if (byEpisode.size < RULES.baselineMinEpisodes) return null;
	const episodes = [...byEpisode.values()].map((versions) => versions.map((v) => ({v, end: contentEndMs(v)})));
	return {
		episodes: byEpisode.size,
		at: (tMs) => {
			const values: number[] = [];
			for (const versions of episodes) {
				const reach = versions.filter((x) => tMs <= x.end + 1e-6);
				if (reach.length) values.push(reach.reduce((acc, x) => acc + retentionAt(x.v, tMs), 0) / reach.length);
			}
			if (values.length < RULES.baselineMinEpisodes) return null;
			values.sort((a, b) => a - b);
			const mid = Math.floor(values.length / 2);
			return {value: values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2, episodes: values.length};
		},
	};
};

const sceneMetrics = (p: Prepared, baseline: Baseline | null): SceneMetrics[] => {
	const dense = p.dense!;
	const totalMs = p.record.join.totalMs;
	const totalStopped = sumNullable(dense.stopped);
	return p.record.join.scenes.map((sc) => {
		const a = Math.min(1, Math.max(0, sc.startMs / totalMs));
		const b = Math.min(1, Math.max(a, (sc.startMs + sc.durationMs) / totalMs));
		const entry = valueAt(dense.watch, a);
		const exit = valueAt(dense.watch, b);
		const dropPp = (entry - exit) * 100;
		const per10 = sc.durationMs > 0 ? dropPp / (sc.durationMs / 10_000) : 0;
		const rrpEntry = nullableValueAt(dense.relative, a);
		const rrpExit = nullableValueAt(dense.relative, b);
		const stopped = totalStopped && totalStopped > 0 ? sumOver(dense.stopped, a, b) : null;
		let typ: SceneMetrics['typical'] = null;
		const endMs = sc.startMs + sc.durationMs;
		const tEntry = baseline && sc.type !== 'endscreen' ? baseline.at(sc.startMs) : null;
		const tExit = baseline && sc.type !== 'endscreen' ? baseline.at(endMs) : null;
		if (tEntry && tExit) {
			const level: number[] = [];
			for (let i = 0; i <= 8; i++) {
				const t = sc.startMs + (sc.durationMs * i) / 8;
				const typical = baseline!.at(t);
				if (typical) level.push(retentionAt(p, t) - typical.value);
			}
			typ = {entry: tEntry.value, exit: tExit.value, levelPp: (level.reduce((x, y) => x + y, 0) / level.length) * 100, episodes: Math.min(tEntry.episodes, tExit.episodes)};
		}
		// whole buckets inside the scene: [k/100, (k+1)/100) within [a, b)
		const kFirst = Math.ceil(a * BUCKETS - 1e-9);
		const kLast = Math.floor(b * BUCKETS + 1e-9) - 1;
		const inside = kLast - kFirst + 1;
		const resolved = inside >= RULES.minBucketsPerScene;
		const wFirst = resolved ? dense.watch[kFirst]! : 0;
		const wLast = resolved ? dense.watch[kLast]! : 0;
		const lossRate =
			resolved && wFirst > LOSS_FLOOR && wLast > LOSS_FLOOR ? (-1000 * Math.log(wLast / wFirst)) / (((kLast - kFirst) * p.analysis.bucketMs) / 1000) : null;
		const lossSpanMs = lossRate !== null ? (kLast - kFirst) * p.analysis.bucketMs : null;
		return {
			id: sc.id,
			index: sc.index,
			type: sc.type,
			segment: sc.segment,
			segmentSource: sc.segmentSource,
			badger: sc.badger,
			title: sc.title,
			startMs: sc.startMs,
			endMs: sc.startMs + sc.durationMs,
			durationMs: sc.durationMs,
			startRatio: a,
			endRatio: b,
			resolved,
			entry,
			exit,
			dropPp,
			dropPer10sPp: per10,
			lostShare: entry > 0 ? 1 - exit / entry : null,
			rrpMean: meanOver(dense.relative, a, b),
			rrpDelta: rrpEntry !== null && rrpExit !== null ? rrpExit - rrpEntry : null,
			stopShare: stopped !== null && totalStopped ? stopped / totalStopped : null,
			lossRate,
			lossSpanMs,
			eligible: resolved && lossRate !== null && sc.index > 0 && sc.type !== 'endscreen' && sc.type !== 'unknown',
			model: null,
			typical: typ,
		};
	});
};

const hookMetrics = (p: Prepared, scenes: SceneMetrics[], baseline: Baseline | null): HookMetrics => {
	const totalMs = p.record.join.totalMs;
	const at = (sec: number): number | null => (sec * 1000 <= totalMs && p.dense ? valueAt(p.dense.watch, (sec * 1000) / totalMs) : null);
	const typicalAt = (sec: number): number | null => (sec * 1000 <= contentEndMs(p) && baseline ? (baseline.at(sec * 1000)?.value ?? null) : null);
	const r0 = p.dense ? p.dense.watch[0]! : null;
	const r5 = at(5);
	const r30 = at(30);
	const t5 = typicalAt(5);
	const t30 = typicalAt(30);
	const first = [...scenes].sort((x, y) => x.index - y.index)[0];
	const atSec = RULES.hookAtSec[p.record.format];
	return {
		r0,
		r5,
		r30,
		lost5Pp: r0 !== null && r5 !== null ? (r0 - r5) * 100 : null,
		lost30Pp: r0 !== null && r30 !== null ? (r0 - r30) * 100 : null,
		vsTypical5Pp: r5 !== null && t5 !== null ? (r5 - t5) * 100 : null,
		vsTypical30Pp: r30 !== null && t30 !== null ? (r30 - t30) * 100 : null,
		opening: first ? {id: first.id, type: first.type, segment: first.segment, lengthMs: first.durationMs, exit: first.exit} : null,
		outcome: {atSec, value: at(atSec)},
		scenesIn5s: scenes.filter((s) => s.startMs < 5000).map((s) => s.id),
		scenesIn30s: scenes.filter((s) => s.startMs < 30_000).map((s) => s.id),
	};
};

const emptyHook = (format: 'long' | 'short'): HookMetrics => ({
	r0: null,
	r5: null,
	r30: null,
	lost5Pp: null,
	lost30Pp: null,
	vsTypical5Pp: null,
	vsTypical30Pp: null,
	opening: null,
	outcome: {atSec: RULES.hookAtSec[format], value: null},
	scenesIn5s: [],
	scenesIn30s: [],
});

/**
 * Second pass, per channel and format: fit the scene model on every eligible scene, then give each modelled scene its
 * excess over the median template at that moment of its upload.
 */
const applySceneModels = (analyses: VideoAnalysis[]): SceneModelResult[] => {
	const models: SceneModelResult[] = [];
	const groups = new Map<string, VideoAnalysis[]>();
	for (const v of analyses) if (v.usable) groups.set(`${v.channel}|${v.format}`, [...(groups.get(`${v.channel}|${v.format}`) ?? []), v]);
	for (const [key, uploads] of [...groups].sort((x, y) => x[0].localeCompare(y[0]))) {
		const [channel, format] = key.split('|') as [string, 'long' | 'short'];
		const rows: SceneRow[] = uploads.flatMap((v) =>
			v.scenes
				.filter((s) => s.eligible)
				.map((s) => ({
					upload: v.videoId,
					episode: v.episodeKey,
					channel: v.channel,
					sceneId: s.id,
					t: (s.startMs + s.durationMs / 2) / 1000,
					y: s.lossRate!,
					category: s.segment ?? s.type,
					categoryKind: s.segment ? ('segment' as const) : ('type' as const),
					badger: s.badger === true,
					lengthSec: s.durationMs / 1000,
				})),
		);
		const model = fitSceneModel(rows, channel, format);
		if (!model) continue;
		models.push(model);
		for (const v of uploads) {
			for (const s of v.scenes) {
				const expected = model.expected.get(`${v.videoId}|${s.id}`);
				if (expected === undefined || s.lossRate === null) continue;
				const excess = s.lossRate - expected;
				s.model = {
					expectedRate: expected,
					excessRate: excess,
					excessPpPer10s: (excess / 100) * ((s.entry + s.exit) / 2) * 100,
					// the larger of the expected and the seen loss: a conservative noise floor for listing this scene
					sePpPer10s: lossNoisePpPer10s(v.sample.used, s.entry, Math.max(expected, s.lossRate), s.lossSpanMs),
				};
				v.inSceneModel = true;
			}
		}
	}
	return models;
};

export type Analysis = {analyses: VideoAnalysis[]; models: SceneModelResult[]};

/** Analyses every record. Uploads with exclusions get no scene metrics; they are listed with their reasons. */
export const analyzeRecords = (records: readonly PullRecord[], options: AnalyzeOptions): Analysis => {
	const prepared = records.map((r) => prepare(r, options));
	const usable = prepared.filter((p) => p.analysis.usable);
	const analyses = prepared.map((p): VideoAnalysis => {
		if (!p.analysis.usable || !p.dense) return {...p.analysis, baselineEpisodes: 0, scenes: [], hook: emptyHook(p.record.format)};
		const baseline = baselineFor(p, usable);
		const scenes = sceneMetrics(p, baseline);
		return {...p.analysis, baselineEpisodes: baseline?.episodes ?? 0, scenes, hook: hookMetrics(p, scenes, baseline)};
	});
	return {analyses, models: applySceneModels(analyses)};
};
