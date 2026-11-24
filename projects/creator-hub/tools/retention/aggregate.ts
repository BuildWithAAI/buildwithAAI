/**
 * Comparisons across uploads (our calculations). Shorts and long-form are always analysed separately.
 *
 * Independent unit = the EPISODE (channel/slug/format[/short]): its language versions share a script, so they are
 * never counted as separate evidence.
 *
 * Scene-level factors come from the scene model (scenemodel.ts), fitted per format: each template (show segment, or
 * template type when the scene has no segment) against the MEDIAN template, and Badger on screen vs not among scenes
 * of the same template, all adjusted for the upload's level and the channel's drop-off at each moment, with standard
 * errors clustered by episode. Outcome: loss rate, % of the viewers still watching who leave per 10 s.
 *
 * Episode-level factors: hook length (openings under 3 s vs the rest, Welch's t, and the slope of retention on
 * opening length) on retention at 0:30 (long) or 0:05 (Shorts), centred within each channel; language (each dubbed
 * version minus the English version of the same episode).
 *
 * Every test's p-value goes through one Benjamini-Hochberg adjustment. Status:
 *   insufficient-data    fewer episodes than RULES.minEpisodes (or minSlopeEpisodes), or not identifiable
 *   no-clear-difference  the 95% interval includes 0, or the effect is below the practical size (or: the reference)
 *   suggestive           interval excludes 0 and the effect is practical, but q > RULES.fdr (could be chance)
 *   supported            all three gates pass; only these become recommendations
 */
import {RULES} from './rules.ts';
import {segmentOrder} from './segments.ts';
import type {SceneModelResult} from './scenemodel.ts';
import {benjaminiHochberg, mean, median, oneSampleT, olsSlope, welchT, type TResult} from './stats.ts';
import {SCENE_TYPES, type Format, type SceneMetrics, type VideoAnalysis} from './types.ts';

export type ComparisonStatus = 'insufficient-data' | 'no-clear-difference' | 'suggestive' | 'supported';
export type ComparisonFamily = 'type' | 'segment' | 'badger' | 'hook-short' | 'hook-slope' | 'language-average' | 'language-hook';

export type Comparison = {
	id: string;
	family: ComparisonFamily;
	format: Format;
	/** Scene-level comparisons are per channel; episode-level ones pool channels (centred within each). */
	channel: string | null;
	group: string;
	label: string;
	outcome: string;
	unit: '%/10s' | 'pp' | 'pp/s';
	/** Which direction is good for the GROUP: a lower excess loss rate is good; higher retention is good. */
	goodWhen: 'negative' | 'positive';
	design: 'scene-model' | 'two-group' | 'slope' | 'paired-by-episode';
	n: {episodes: number; scenes: number | null; group: number | null; rest: number | null};
	estimate: number | null;
	ci95: [number, number] | null;
	p: number | null;
	q: number | null;
	standardized: number | null; // d_z (mean / SD over episodes), Hedges' g for two groups, r² for a slope
	/**
	 * Two-group: the ADJUSTED estimate as a share of the rest group's mean (estimate / rest mean), so it restates the
	 * number it is printed next to. The raw ratio of the group means mixes channels and is kept in details only.
	 */
	relative: number | null;
	/** The 95% interval of `relative` (ci95 / rest mean). */
	relativeCi95: [number, number] | null;
	practical: number;
	details: Record<string, number | string | null>;
	status: ComparisonStatus;
	reason: string;
	/** The effect was not confirmed by the flexible drop-off fit, so it is capped at "suggestive". */
	momentConfounded?: boolean;
};

export type GroupRow = {
	key: string;
	scenes: number;
	episodes: number;
	medianLengthSec: number | null;
	meanDropPer10sPp: number | null; // pp of the video's views lost per 10 s (raw)
	meanLossRate: number | null; // % of the viewers still watching, lost per 10 s (raw)
	meanExcessRate: number | null; // the same beyond the drop-off model's expectation
	meanRrp: number | null;
	meanStopSharePer10s: number | null;
};

export type ChannelTemplates = {
	channel: string;
	uploads: number;
	episodes: number;
	model: {reference: string; scenes: number; episodes: number; tauSec: number; notes: string[]} | null;
	types: GroupRow[];
	segments: GroupRow[];
	badger: GroupRow[];
};

export type HookBucketRow = {bucket: string; episodes: number; uploads: number; meanOutcomePp: number | null; meanLost5Pp: number | null; medianLengthSec: number | null};
export type LanguageRow = {lang: string; uploads: number; episodes: number; meanAverageRetentionPp: number | null; meanHookOutcomePp: number | null; blended: number};

export type FormatSummary = {
	format: Format;
	usableUploads: number;
	episodes: number;
	channels: Record<string, number>; // usable uploads per channel
	withBaseline: number;
	hookAtSec: number;
	/** Scene tables per channel (templates are compared within a channel). */
	templates: ChannelTemplates[];
	hookBuckets: HookBucketRow[];
	languages: LanguageRow[];
	endscreen: {uploads: number; medianStayShare: number | null; medianLengthSec: number | null} | null;
};

export type Aggregates = {formats: FormatSummary[]; comparisons: Comparison[]};

const FORMATS: Format[] = ['long', 'short'];
const SOURCE_LANG = 'en';

const byEpisode = (videos: readonly VideoAnalysis[]): Map<string, VideoAnalysis[]> => {
	const map = new Map<string, VideoAnalysis[]>();
	for (const v of videos) map.set(v.episodeKey, [...(map.get(v.episodeKey) ?? []), v]);
	return map;
};

const round = (x: number | null, digits = 2): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** digits) / 10 ** digits);

const classify = (
	result: TResult | null,
	episodes: number,
	needed: number,
	practical: number,
): {status: ComparisonStatus; reason: string} => {
	if (episodes < needed || !result) return {status: 'insufficient-data', reason: `insufficient data: ${episodes} episode${episodes === 1 ? '' : 's'} (need ${needed})`};
	const [lo, hi] = result.ci95;
	if (lo <= 0 && hi >= 0) return {status: 'no-clear-difference', reason: 'the 95% interval includes no difference'};
	if (Math.abs(result.estimate) < practical) return {status: 'no-clear-difference', reason: `the effect is below the practical size (${practical})`};
	return {status: 'suggestive', reason: 'pending the false-discovery check'};
};

const SCENE_OUTCOME = 'loss rate vs the median template at the same moment of the same upload (% of the viewers still watching, per 10 s)';

const formatLabel = (f: Format): string => (f === 'long' ? 'long-form' : 'Shorts');

/** Caps a moment-confounded effect at "suggestive" and says why. */
const confoundCap = (
	verdict: {status: ComparisonStatus; reason: string},
	confounded: boolean,
	orderVaries: boolean,
	moments: [number, number] | null,
): {status: ComparisonStatus; reason: string; capped: boolean} => {
	if (!confounded || verdict.status !== 'suggestive') return {...verdict, capped: false};
	const where = moments ? ` (between ${Math.round(moments[0])} s and ${Math.round(moments[1])} s)` : '';
	return {
		status: 'suggestive',
		reason: orderVaries
			? `not confirmed when the drop-off curve is allowed to bend: the loss may belong to that moment of the video${where}. Move it earlier or later in a few episodes to tell`
			: `it always comes in the same place in the episode${where}, so its effect cannot be told apart from that moment. Change its order in a few episodes to tell`,
		capped: true,
	};
};

const sceneComparisons = (videos: readonly VideoAnalysis[], format: Format, models: readonly SceneModelResult[]): Comparison[] => {
	const out: Comparison[] = [];
	const base = {format, outcome: SCENE_OUTCOME, unit: '%/10s' as const, goodWhen: 'negative' as const, design: 'scene-model' as const, q: null, relative: null, relativeCi95: null, practical: RULES.practical.sceneRatePct};
	for (const channel of [...new Set(videos.map((v) => v.channel))].sort()) {
		const inChannel = videos.filter((v) => v.channel === channel);
		const model = models.find((m) => m.channel === channel && m.format === format) ?? null;
		if (!model) {
			// not enough data to fit: list what exists, so the report shows why nothing is judged
			const eligible = inChannel.flatMap((v) => v.scenes.filter((s) => s.eligible).map((s) => ({v, s})));
			if (!eligible.length) continue;
			const episodes = new Set(eligible.map((x) => x.v.episodeKey)).size;
			const keys = new Map<string, 'type' | 'segment'>();
			for (const {s} of eligible) keys.set(s.segment ?? s.type, s.segment ? 'segment' : 'type');
			const reason = `insufficient data: the scene model needs ${RULES.minEpisodes} episodes of ${channel} (${formatLabel(format)}) with 2+ measurable scenes each; it has ${episodes}`;
			for (const [key, kind] of keys) {
				const n = new Set(eligible.filter((x) => (x.s.segment ?? x.s.type) === key).map((x) => x.v.episodeKey)).size;
				out.push({...base, id: `${kind}:${key}:${channel}:${format}`, family: kind, channel, group: key, label: `${key} vs the median template`, n: {episodes: n, scenes: null, group: null, rest: null}, estimate: null, ci95: null, p: null, standardized: null, details: {}, status: 'insufficient-data', reason});
			}
			out.push({...base, id: `badger:badger:${channel}:${format}`, family: 'badger', channel, group: 'badger', label: 'Badger on screen vs not, same template', n: {episodes, scenes: null, group: null, rest: null}, estimate: null, ci95: null, p: null, standardized: null, details: {}, status: 'insufficient-data', reason});
			continue;
		}
		for (const c of model.categories) {
			const verdict = c.isReference
				? {status: 'no-clear-difference' as const, reason: 'the median template: the others are measured against it', capped: false}
				: confoundCap(classify(c.result, c.episodes, RULES.minEpisodes, RULES.practical.sceneRatePct), c.momentConfounded, c.orderVaries, c.momentsSec);
			out.push({
				...base,
				id: `${c.kind}:${c.category}:${channel}:${format}`,
				family: c.kind,
				channel,
				group: c.category,
				label: `${c.category} vs the median template (${model.reference})`,
				n: {episodes: c.episodes, scenes: c.scenes, group: c.scenes, rest: model.scenes - c.scenes},
				estimate: c.isReference ? 0 : (c.result?.estimate ?? null),
				ci95: c.result?.ci95 ?? null,
				p: c.result?.p ?? null,
				standardized: null,
				details: {
					reference: model.reference,
					groupMedianLengthSec: round(c.medianLengthSec, 1),
					earliestSec: round(c.momentsSec[0], 1),
					latestSec: round(c.momentsSec[1], 1),
					flexibleEstimate: round(c.sensitivity?.estimate ?? null),
					flexibleLow: round(c.sensitivity?.ci95[0] ?? null),
					flexibleHigh: round(c.sensitivity?.ci95[1] ?? null),
					orderVaries: c.orderVaries ? 'yes' : 'no',
					momentConfounded: c.momentConfounded ? 'yes' : 'no',
				},
				status: verdict.status,
				reason: verdict.reason,
				momentConfounded: verdict.capped,
			});
		}
		const b = model.badger;
		const verdict = b
			? confoundCap(classify(b.result, b.episodes, RULES.minEpisodes, RULES.practical.sceneRatePct), b.momentConfounded, true, null)
			: {status: 'insufficient-data' as const, reason: 'insufficient data: Badger is never both on and off screen in scenes of the same template', capped: false};
		out.push({
			...base,
			id: `badger:badger:${channel}:${format}`,
			family: 'badger',
			channel,
			group: 'badger',
			label: 'Badger on screen vs not, among scenes of the same template',
			n: {episodes: b?.episodes ?? 0, scenes: b?.scenes ?? 0, group: b?.on ?? 0, rest: b?.off ?? 0},
			estimate: b?.result?.estimate ?? null,
			ci95: b?.result?.ci95 ?? null,
			p: b?.result?.p ?? null,
			standardized: null,
			details: {templates: b?.categories ?? 0, flexibleEstimate: round(b?.sensitivity?.estimate ?? null)},
			status: verdict.status,
			reason: verdict.reason,
			momentConfounded: verdict.capped,
		});
	}
	return out;
};

type EpisodePoint = {key: string; channel: string; lengthSec: number; lengthCentred: number; centred: number; raw: number; uploads: number};

/** Hook outcome per episode, centred within channel (and format): removes channel-level differences. */
const hookPoints = (videos: readonly VideoAnalysis[]): EpisodePoint[] => {
	const withOutcome = videos.filter((v) => v.hook.outcome.value !== null && v.hook.opening !== null);
	const channelMean = new Map<string, number>();
	for (const channel of new Set(withOutcome.map((v) => v.channel))) {
		channelMean.set(channel, mean(withOutcome.filter((v) => v.channel === channel).map((v) => v.hook.outcome.value! * 100)) as number);
	}
	const lengthMean = new Map<string, number>();
	for (const channel of channelMean.keys()) {
		lengthMean.set(channel, mean(withOutcome.filter((v) => v.channel === channel).map((v) => v.hook.opening!.lengthMs / 1000)) as number);
	}
	return [...byEpisode(withOutcome)].map(([key, versions]) => ({
		key,
		channel: versions[0]!.channel,
		lengthSec: mean(versions.map((v) => v.hook.opening!.lengthMs / 1000)) as number,
		centred: mean(versions.map((v) => v.hook.outcome.value! * 100 - channelMean.get(v.channel)!)) as number,
		raw: mean(versions.map((v) => v.hook.outcome.value! * 100)) as number,
		uploads: versions.length,
		lengthCentred: (mean(versions.map((v) => v.hook.opening!.lengthMs / 1000)) as number) - lengthMean.get(versions[0]!.channel)!,
	}));
};

const hookComparisons = (videos: readonly VideoAnalysis[], format: Format): Comparison[] => {
	const atSec = RULES.hookAtSec[format];
	const points = hookPoints(videos);
	const short = points.filter((p) => p.lengthSec < RULES.shortHookSec);
	const rest = points.filter((p) => p.lengthSec >= RULES.shortHookSec);
	const welch = welchT(short.map((p) => p.centred), rest.map((p) => p.centred));
	const enough = Math.min(short.length, rest.length);
	const verdict = classify(welch, enough, RULES.minEpisodes, RULES.practical.hookPp);
	const rawShort = mean(short.map((p) => p.raw));
	const rawRest = mean(rest.map((p) => p.raw));
	// relative to the longer openings' mean, from the channel-adjusted estimate (not from the raw means, which mix channels)
	const base = rawRest !== null && rawRest > 0 ? rawRest : null;
	const two: Comparison = {
		id: `hook-short:<${RULES.shortHookSec}s:${format}`,
		family: 'hook-short',
		format,
		channel: null,
		group: `<${RULES.shortHookSec}s`,
		label: `openings under ${RULES.shortHookSec} s vs ${RULES.shortHookSec} s or longer`,
		outcome: `retention at 0:${String(atSec).padStart(2, '0')}, centred within each channel`,
		unit: 'pp',
		goodWhen: 'positive',
		design: 'two-group',
		n: {episodes: points.length, scenes: null, group: short.length, rest: rest.length},
		estimate: welch ? welch.estimate : null,
		ci95: welch ? welch.ci95 : null,
		p: welch ? welch.p : null,
		q: null,
		standardized: welch ? welch.g : null,
		relative: welch && base !== null ? welch.estimate / base : null,
		relativeCi95: welch && base !== null ? [welch.ci95[0] / base, welch.ci95[1] / base] : null,
		practical: RULES.practical.hookPp,
		details: {
			groupMeanPp: round(rawShort, 1),
			restMeanPp: round(rawRest, 1),
			// raw: the plain difference of the group means, channels mixed (for transparency, never the headline)
			rawDiffPp: rawShort !== null && rawRest !== null ? round(rawShort - rawRest, 2) : null,
			rawRelative: rawShort !== null && base !== null ? round(rawShort / base - 1, 4) : null,
			groupMedianLengthSec: round(median(short.map((p) => p.lengthSec)), 1),
			restMedianLengthSec: round(median(rest.map((p) => p.lengthSec)), 1),
		},
		...verdict,
		reason: enough < RULES.minEpisodes ? `insufficient data: ${short.length} episodes under ${RULES.shortHookSec} s and ${rest.length} at or over (need ${RULES.minEpisodes} each)` : verdict.reason,
	};
	const fit = olsSlope(points.map((p) => p.lengthCentred), points.map((p) => p.centred));
	const slopeVerdict = classify(fit, points.length, RULES.minSlopeEpisodes, RULES.practical.hookSlopePpPerSec);
	const lengths = points.map((p) => p.lengthSec);
	const slope: Comparison = {
		id: `hook-slope:length:${format}`,
		family: 'hook-slope',
		format,
		channel: null,
		group: 'length',
		label: 'retention vs opening-scene length (per extra second)',
		outcome: `retention at 0:${String(atSec).padStart(2, '0')} per extra second of opening, within each channel`,
		unit: 'pp/s',
		goodWhen: 'positive',
		design: 'slope',
		n: {episodes: points.length, scenes: null, group: null, rest: null},
		estimate: fit ? fit.estimate : null,
		ci95: fit ? fit.ci95 : null,
		p: fit ? fit.p : null,
		q: null,
		standardized: fit ? fit.r2 : null,
		relative: null,
		relativeCi95: null,
		practical: RULES.practical.hookSlopePpPerSec,
		details: {
			minLengthSec: round(lengths.length ? Math.min(...lengths) : null, 1),
			maxLengthSec: round(lengths.length ? Math.max(...lengths) : null, 1),
			medianLengthSec: round(median(lengths), 1),
		},
		...slopeVerdict,
	};
	return [two, slope];
};

const languageComparisons = (videos: readonly VideoAnalysis[], format: Format): Comparison[] => {
	const single = videos.filter((v) => !v.multiLanguageAudio);
	const langs = [...new Set(single.map((v) => v.lang))].filter((l) => l !== SOURCE_LANG).sort();
	const out: Comparison[] = [];
	for (const lang of langs) {
		const avgDiffs: number[] = [];
		const hookDiffs: number[] = [];
		for (const [, versions] of byEpisode(single)) {
			const base = versions.filter((v) => v.lang === SOURCE_LANG);
			const dub = versions.filter((v) => v.lang === lang);
			if (!base.length || !dub.length) continue;
			const avg = (list: VideoAnalysis[]) => mean(list.map((v) => v.averageRetention!)) as number;
			avgDiffs.push((avg(dub) - avg(base)) * 100);
			const hb = base.map((v) => v.hook.outcome.value).filter((x): x is number => x !== null);
			const hd = dub.map((v) => v.hook.outcome.value).filter((x): x is number => x !== null);
			if (hb.length && hd.length) hookDiffs.push(((mean(hd) as number) - (mean(hb) as number)) * 100);
		}
		for (const [family, diffs, outcome] of [
			['language-average', avgDiffs, 'average retention over the whole video'],
			['language-hook', hookDiffs, `retention at 0:${String(RULES.hookAtSec[format]).padStart(2, '0')}`],
		] as const) {
			const result = oneSampleT(diffs);
			out.push({
				id: `${family}:${lang}:${format}`,
				family,
				format,
				channel: null,
				group: lang,
				label: `${lang} version minus the ${SOURCE_LANG} version of the same episode`,
				outcome,
				unit: 'pp',
				goodWhen: 'positive',
				design: 'paired-by-episode',
				n: {episodes: diffs.length, scenes: null, group: null, rest: null},
				estimate: result ? result.estimate : null,
				ci95: result ? result.ci95 : null,
				p: result ? result.p : null,
				q: null,
				standardized: result ? result.dz : null,
				relative: null,
				relativeCi95: null,
				practical: RULES.practical.languagePp,
				details: {pairs: diffs.length},
				...classify(result, diffs.length, RULES.minEpisodes, RULES.practical.languagePp),
			});
		}
	}
	return out;
};

const groupRow = (key: string, scenes: SceneMetrics[], episodes: number): GroupRow => ({
	key,
	scenes: scenes.length,
	episodes,
	medianLengthSec: round(median(scenes.map((s) => s.durationMs / 1000)), 1),
	meanDropPer10sPp: round(mean(scenes.map((s) => s.dropPer10sPp))),
	meanLossRate: round(mean(scenes.filter((s) => s.lossRate !== null).map((s) => s.lossRate!))),
	meanExcessRate: round(mean(scenes.filter((s) => s.model).map((s) => s.model!.excessRate))),
	meanRrp: round(mean(scenes.filter((s) => s.rrpMean !== null).map((s) => s.rrpMean!)), 3),
	meanStopSharePer10s: round(mean(scenes.filter((s) => s.stopShare !== null).map((s) => (s.stopShare! / s.durationMs) * 10_000)), 4),
});

const rowsBy = (videos: readonly VideoAnalysis[], keyOf: (s: SceneMetrics) => string | null, order: (k: string) => number): GroupRow[] => {
	const scenes = new Map<string, SceneMetrics[]>();
	const episodes = new Map<string, Set<string>>();
	for (const v of videos) {
		for (const s of v.scenes.filter((x) => x.resolved)) {
			const k = keyOf(s);
			if (k === null) continue;
			scenes.set(k, [...(scenes.get(k) ?? []), s]);
			episodes.set(k, (episodes.get(k) ?? new Set()).add(v.episodeKey));
		}
	}
	return [...scenes.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((k) => groupRow(k, scenes.get(k)!, episodes.get(k)!.size));
};

const typeOrder = (t: string): number => {
	const i = (SCENE_TYPES as readonly string[]).indexOf(t);
	return i === -1 ? SCENE_TYPES.length : i;
};

const bucketLabel = (sec: number): string => {
	const edges = RULES.hookBucketsSec;
	if (sec < edges[0]!) return `under ${edges[0]} s`;
	for (let i = 1; i < edges.length; i++) if (sec < edges[i]!) return `${edges[i - 1]}-${edges[i]} s`;
	return `${edges[edges.length - 1]} s or more`;
};

const summarise = (videos: readonly VideoAnalysis[], format: Format, models: readonly SceneModelResult[]): FormatSummary => {
	const channels: Record<string, number> = {};
	for (const v of videos) channels[v.channel] = (channels[v.channel] ?? 0) + 1;
	const buckets = new Map<string, VideoAnalysis[]>();
	for (const v of videos) {
		if (!v.hook.opening || v.hook.outcome.value === null) continue; // as in the comparisons: only uploads with a value at the outcome time
		const label = bucketLabel(v.hook.opening.lengthMs / 1000);
		buckets.set(label, [...(buckets.get(label) ?? []), v]);
	}
	const bucketOrder = [`under ${RULES.hookBucketsSec[0]} s`, ...RULES.hookBucketsSec.slice(1).map((e, i) => `${RULES.hookBucketsSec[i]}-${e} s`), `${RULES.hookBucketsSec[RULES.hookBucketsSec.length - 1]} s or more`];
	const ends = videos.flatMap((v) => v.scenes.filter((s) => s.type === 'endscreen' && s.entry > 0));
	const langs = [...new Set(videos.map((v) => v.lang))].sort((a, b) => (a === SOURCE_LANG ? -1 : b === SOURCE_LANG ? 1 : a.localeCompare(b)));
	return {
		format,
		usableUploads: videos.length,
		episodes: new Set(videos.map((v) => v.episodeKey)).size,
		channels,
		withBaseline: videos.filter((v) => v.baselineEpisodes > 0).length,
		hookAtSec: RULES.hookAtSec[format],
		templates: Object.keys(channels)
			.sort()
			.map((channel) => {
				const list = videos.filter((v) => v.channel === channel);
				const model = models.find((m) => m.channel === channel && m.format === format);
				return {
					channel,
					uploads: list.length,
					episodes: new Set(list.map((v) => v.episodeKey)).size,
					model: model ? {reference: model.reference, scenes: model.scenes, episodes: model.episodes, tauSec: model.tauSec, notes: model.notes} : null,
					types: rowsBy(list, (s) => s.type, typeOrder),
					segments: rowsBy(list, (s) => s.segment, segmentOrder),
					badger: rowsBy(list, (s) => (s.badger === null ? null : s.badger ? 'Badger on screen' : 'no Badger'), (k) => (k === 'Badger on screen' ? 0 : 1)),
				};
			}),
		hookBuckets: bucketOrder
			.filter((b) => buckets.has(b))
			.map((b) => {
				const list = buckets.get(b)!;
				const outcomes = list.map((v) => v.hook.outcome.value).filter((x): x is number => x !== null);
				return {
					bucket: b,
					episodes: new Set(list.map((v) => v.episodeKey)).size,
					uploads: list.length,
					meanOutcomePp: round(outcomes.length ? (mean(outcomes) as number) * 100 : null, 1),
					meanLost5Pp: round(mean(list.map((v) => v.hook.lost5Pp).filter((x): x is number => x !== null)), 1),
					medianLengthSec: round(median(list.map((v) => v.hook.opening!.lengthMs / 1000)), 1),
				};
			}),
		languages: langs.map((lang) => {
			const list = videos.filter((v) => v.lang === lang);
			const hooks = list.map((v) => v.hook.outcome.value).filter((x): x is number => x !== null);
			return {
				lang,
				uploads: list.length,
				episodes: new Set(list.map((v) => v.episodeKey)).size,
				meanAverageRetentionPp: round((mean(list.map((v) => v.averageRetention ?? 0)) ?? 0) * 100, 1),
				meanHookOutcomePp: round(hooks.length ? (mean(hooks) as number) * 100 : null, 1),
				blended: list.filter((v) => v.multiLanguageAudio).length,
			};
		}),
		endscreen: ends.length ? {uploads: ends.length, medianStayShare: round(median(ends.map((s) => s.exit / s.entry)), 3), medianLengthSec: round(median(ends.map((s) => s.durationMs / 1000)), 1)} : null,
	};
};

export const aggregate = (analyses: readonly VideoAnalysis[], models: readonly SceneModelResult[] = []): Aggregates => {
	const formats: FormatSummary[] = [];
	const comparisons: Comparison[] = [];
	for (const format of FORMATS) {
		const videos = analyses.filter((v) => v.usable && v.format === format);
		if (!videos.length) continue;
		formats.push(summarise(videos, format, models));
		comparisons.push(...sceneComparisons(videos, format, models));
		comparisons.push(...hookComparisons(videos, format));
		comparisons.push(...languageComparisons(videos, format));
	}
	// one false-discovery adjustment over every test that produced a p-value
	const tested = comparisons.filter((c) => c.p !== null);
	const q = benjaminiHochberg(tested.map((c) => c.p!));
	tested.forEach((c, i) => {
		c.q = q[i]!;
		if (c.status === 'suggestive' && !c.momentConfounded) {
			if (c.q <= RULES.fdr) {
				c.status = 'supported';
				c.reason = `95% interval excludes no difference, effect at least ${c.practical}, q = ${c.q.toFixed(3)} (≤ ${RULES.fdr})`;
			} else {
				c.reason = `95% interval excludes no difference, but q = ${c.q.toFixed(3)} > ${RULES.fdr}: with ${tested.length} comparisons this could be chance`;
			}
		}
	});
	return {formats, comparisons};
};
