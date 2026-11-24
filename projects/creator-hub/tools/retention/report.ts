/**
 * report.md (for the owner, readable on a phone) and report.json (for the dashboard and the storyboard writer).
 *
 * YouTube API Developer Policies III.E.4.h: derived figures must be clearly marked as not from YouTube. Every report
 * starts with that disclosure, and column headers say which numbers are YouTube's and which are our calculations.
 * III.E.4.f: historical data must be shown in its context of time, so every upload shows its pull date and window.
 */
import type {Aggregates, Comparison, FormatSummary, GroupRow} from './aggregate.ts';
import {lossNoisePpPer10s} from './analyze.ts';
import type {Recommendation} from './recommend.ts';
import {RULES} from './rules.ts';
import type {Format, SceneMetrics, VideoAnalysis} from './types.ts';

export const DISCLOSURE =
	'YouTube values in this report (audience watch ratio, relative retention performance, started and stopped watching, views) come from the ' +
	'YouTube Analytics API. Everything else (drops, rates per 10 s, typical curves, comparisons, recommendations) is our own calculation from ' +
	'those values: it is not from YouTube and is not a YouTube metric.';

/** Official pages the API contract and the policy rules were checked against (read 2026-11-24). */
export const SOURCES = [
	{title: 'YouTube Analytics API: channel reports, audience retention', url: 'https://developers.google.com/youtube/analytics/channel_reports#audience-retention-reports', updated: '2026-11-12'},
	{title: 'Dimensions: elapsedVideoTimeRatio, audienceType', url: 'https://developers.google.com/youtube/analytics/dimensions#elapsedVideoTimeRatio', updated: '2026-11-12'},
	{title: 'Metrics: audienceWatchRatio, relativeRetentionPerformance, startedWatching, stoppedWatching, totalSegmentImpressions', url: 'https://developers.google.com/youtube/analytics/metrics#Audience_Retention_Metrics', updated: '2026-11-16'},
	{title: 'reports.query reference (one video per retention query; scopes)', url: 'https://developers.google.com/youtube/analytics/reference/reports/query', updated: '2026-11-12'},
	{title: 'Data model: freshness (48-72 h), anonymization, quota', url: 'https://developers.google.com/youtube/analytics/data_model', updated: '2026-11-12'},
	{title: 'YouTube API Services Developer Policies III.E.4 (storage, deletion, derived metrics)', url: 'https://developers.google.com/youtube/terms/developer-policies', updated: '2026-11-06'},
	{title: 'Additional policies for derived metrics and data storage', url: 'https://developers.google.com/youtube/terms/derived-metrics-policy', updated: '2026-09-14'},
];

export type ReportInput = {
	generatedAt: Date;
	analyses: VideoAnalysis[];
	aggregates: Aggregates;
	recommendations: Recommendation[];
	options: {minViews: number; includeStale: boolean; allowUnverifiedDuration: boolean};
	policy: {derivedMetrics: string; date: string} | null;
};

export type ReportJson = {
	version: 1;
	kind: 'retention-report';
	generatedAt: string;
	synthetic: 'all' | 'some' | 'none';
	disclosure: string;
	policy: ReportInput['policy'];
	summary: {
		uploads: number;
		usable: number;
		excluded: number;
		recommendations: number;
		worthWatching: number;
		comparisons: number;
		formats: {format: Format; usableUploads: number; episodes: number; withBaseline: number}[];
	};
	recommendations: Recommendation[];
	comparisons: Comparison[];
	formats: FormatSummary[];
	uploads: VideoAnalysis[];
	rules: typeof RULES;
	sources: typeof SOURCES;
};

const syntheticOf = (analyses: readonly VideoAnalysis[]): ReportJson['synthetic'] => {
	const fixtures = analyses.filter((a) => a.fixture).length;
	return fixtures === 0 ? 'none' : fixtures === analyses.length ? 'all' : 'some';
};

export const buildReportJson = (input: ReportInput): ReportJson => ({
	version: 1,
	kind: 'retention-report',
	generatedAt: input.generatedAt.toISOString(),
	synthetic: syntheticOf(input.analyses),
	disclosure: DISCLOSURE,
	policy: input.policy,
	summary: {
		uploads: input.analyses.length,
		usable: input.analyses.filter((a) => a.usable).length,
		excluded: input.analyses.filter((a) => !a.usable).length,
		recommendations: input.recommendations.length,
		worthWatching: input.aggregates.comparisons.filter((c) => c.status === 'suggestive').length,
		comparisons: input.aggregates.comparisons.length,
		formats: input.aggregates.formats.map((f) => ({format: f.format, usableUploads: f.usableUploads, episodes: f.episodes, withBaseline: f.withBaseline})),
	},
	recommendations: input.recommendations,
	comparisons: input.aggregates.comparisons,
	formats: input.aggregates.formats,
	uploads: input.analyses,
	rules: RULES,
	sources: SOURCES,
});

/* ------------------------------------------------------------------ markdown */

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const signed = (x: number | null, digits = 1, unit = ''): string => (x === null || !Number.isFinite(x) ? 'n/a' : `${x >= 0 ? '+' : '-'}${Math.abs(x).toFixed(digits)}${unit}`);
const plain = (x: number | null, digits = 1, unit = ''): string => (x === null || !Number.isFinite(x) ? 'n/a' : `${x.toFixed(digits)}${unit}`);
const time = (ms: number): string => {
	const s = Math.round(ms / 100) / 10;
	const m = Math.floor(s / 60);
	const rest = s - m * 60;
	return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
};
const formatName = (f: Format): string => (f === 'long' ? 'long-form' : 'Shorts');
const at = (sec: number): string => `0:${String(sec).padStart(2, '0')}`;
const statusText: Record<Comparison['status'], string> = {
	'insufficient-data': 'insufficient data',
	'no-clear-difference': 'no clear difference',
	suggestive: 'worth watching',
	supported: '**supported**',
};
const estimateText = (c: Comparison | undefined): string => {
	if (!c || c.estimate === null || c.ci95 === null) return 'n/a';
	const digits = c.unit === '%/10s' || c.unit === 'pp/s' ? 2 : 1;
	return `${signed(c.estimate, digits)} (${signed(c.ci95[0], digits)} to ${signed(c.ci95[1], digits)})`;
};

const uploadName = (v: VideoAnalysis): string => `${v.channel}/${v.slug} · ${v.lang} · ${formatName(v.format)}${v.shortId ? ` ${v.shortId}` : ''}`;

const sceneLabel = (s: SceneMetrics): string => {
	const parts = [s.id, s.segment ? `${s.segment}${s.segmentSource === 'inferred' ? ' (inferred)' : ''}` : null, s.type].filter(Boolean).join(' · ');
	return s.title ? `${parts} "${s.title}"` : parts;
};

/**
 * A scene's loss to rank by, and its sampling standard error (both pp of views per 10 s): the loss beyond the drop-off
 * model's expectation when the upload has a model, else the raw loss per 10 s.
 */
export const dropScore = (v: VideoAnalysis, s: SceneMetrics, modelled: boolean): {score: number | null; se: number | null} => {
	if (modelled) return s.model ? {score: s.model.excessPpPer10s, se: s.model.sePpPer10s} : {score: null, se: null};
	const seen = s.lostShare !== null ? Math.max(0, Math.min(1, s.lostShare)) : null;
	const rate = seen !== null && s.durationMs > 0 ? (-1000 * Math.log(Math.max(1e-9, 1 - seen))) / (s.durationMs / 1000) : 0;
	return {score: s.dropPer10sPp, se: lossNoisePpPer10s(v.sample.used, s.entry, rate, s.durationMs)};
};

/** Above sampling noise: more than RULES.noiseSe standard errors. Unknown noise never passes. */
const beyondNoise = (d: {score: number | null; se: number | null}): boolean => d.score !== null && d.se !== null && d.score > RULES.noiseSe * d.se;

const ranked = (v: VideoAnalysis) => {
	const candidates = v.scenes.filter((s) => s.resolved && s.type !== 'endscreen');
	const modelled = candidates.some((s) => s.model);
	return candidates
		.map((s) => ({s, ...dropScore(v, s, modelled)}))
		.filter((d) => (d.score ?? 0) > 0)
		.sort((a, b) => b.score! - a.score!);
};

/**
 * The scenes where the most viewers left: by loss beyond the drop-off model's expectation when the upload has one,
 * else by raw loss per 10 s, and only when that loss is more than RULES.noiseSe standard errors of sampling noise for
 * the upload's playback count. Openings are included here (they are judged separately in the comparisons).
 */
export const topDrops = (v: VideoAnalysis, count = 3): SceneMetrics[] =>
	ranked(v)
		.filter(beyondNoise)
		.slice(0, count)
		.map((d) => d.s);

/** Scenes that lost more than expected, but not by more than sampling noise: counted, never named as a drop. */
export const dropsWithinNoise = (v: VideoAnalysis): {s: SceneMetrics; score: number; se: number | null}[] =>
	ranked(v)
		.filter((d) => !beyondNoise(d))
		.map((d) => ({s: d.s, score: d.score!, se: d.se}));

/** Rewatch spots: retention rose by at least RULES.rewatchPp AND by more than RULES.noiseSe Poisson standard errors. */
export const rewatchSpots = (v: VideoAnalysis): SceneMetrics[] => {
	const n = v.sample.used;
	if (!n || n <= 0) return [];
	return v.scenes.filter((s) => {
		if (!s.resolved) return false;
		const rise = -s.dropPp;
		const se = 100 * Math.sqrt((Math.max(0, s.entry) + Math.max(0, s.exit)) / n);
		return rise >= RULES.rewatchPp && rise > RULES.noiseSe * se;
	});
};

const uploadSection = (v: VideoAnalysis): string[] => {
	const lines = [`### ${uploadName(v)} · \`${v.videoId}\``, ''];
	const sample = v.sample.playbacks !== null && v.sample.playbacks > 0 ? `${v.sample.playbacks.toLocaleString('en-US')} playbacks` : `${(v.sample.views ?? 0).toLocaleString('en-US')} views`;
	const hookAt = v.hook.outcome.atSec;
	const typicalHook = hookAt === 30 ? v.hook.vsTypical30Pp : v.hook.vsTypical5Pp;
	lines.push(
		`Pulled ${v.pulledAt.slice(0, 10)} (YouTube data ${v.window.startDate} to ${v.window.endDate}, ${v.audience === 'all' ? 'all audiences' : v.audience.toLowerCase()} views); ${sample}; ` +
			`average retention ${pct(v.averageRetention)}; at ${at(hookAt)}: ${pct(v.hook.outcome.value)}` +
			(typicalHook !== null ? ` (${signed(typicalHook, 1, ' pp')} vs typical)` : '') +
			(v.baselineEpisodes ? '' : '; no channel baseline yet') +
			'.',
		'',
	);
	const drops = topDrops(v);
	const modelled = v.scenes.some((s) => s.model);
	const noise = dropsWithinNoise(v);
	if (drops.length) {
		lines.push(
			`| Scene | Time | Retention in → out (YouTube) | Lost per 10 s | More than expected, per 10 s | Sampling noise (${RULES.noiseSe} SE) | Playbacks ended here |`,
			'| --- | --- | --- | --- | --- | --- | --- |',
		);
		for (const s of drops) {
			const se = dropScore(v, s, modelled).se;
			lines.push(
				`| ${cell(sceneLabel(s))} | ${time(s.startMs)}-${time(s.endMs)} | ${pct(s.entry)} → ${pct(s.exit)} | ${plain(s.dropPer10sPp, 1, ' pp')} | ${s.model ? signed(s.model.excessPpPer10s, 1, ' pp') : 'n/a (no model yet)'} | ${se === null ? 'n/a' : `±${(RULES.noiseSe * se).toFixed(1)} pp`} | ${s.stopShare === null ? 'n/a' : pct(s.stopShare)} |`,
			);
		}
	} else {
		lines.push(`No scene lost viewers ${modelled ? 'faster than expected' : 'fast enough'} beyond sampling noise.`);
	}
	if (noise.length) {
		const top = noise[0]!;
		lines.push(
			'',
			`${noise.length} other scene${noise.length === 1 ? '' : 's'} lost ${modelled ? 'more than expected' : 'viewers'} but within sampling noise for ${sample} (largest: ${top.s.id} ${top.s.segment ?? top.s.type}, ${signed(top.score, 1, ' pp')} per 10 s, noise ${top.se === null ? 'unknown' : `±${(RULES.noiseSe * top.se).toFixed(1)} pp`}); not named as drops.`,
		);
	}
	const rewatch = rewatchSpots(v);
	if (rewatch.length) lines.push('', `Rewatch spots (retention rose beyond sampling noise): ${rewatch.map((s) => `${s.id} ${s.type} (${signed(-s.dropPp, 1, ' pp')})`).join(', ')}.`);
	const unresolved = v.scenes.filter((s) => !s.resolved).length;
	if (unresolved) lines.push('', `${unresolved} scene${unresolved === 1 ? ' is' : 's are'} shorter than ${RULES.minBucketsPerScene} curve buckets (${plain((RULES.minBucketsPerScene * v.bucketMs) / 1000, 1)} s here) and not measured on its own.`);
	lines.push('');
	return lines;
};

const OPENING_KEYS = new Set(['hook', 'ColdOpen']);
const END_KEYS = new Set(['endscreen', 'OutroEndScreen']);

const statusCell = (c: Comparison | undefined, key?: string): string => {
	if (!c && key && OPENING_KEYS.has(key)) return 'see the opening-scene section';
	if (!c && key && END_KEYS.has(key)) return 'not compared (everyone leaves at the end)';
	if (!c) return 'not compared';
	if (c.details.isReference === 'yes' || c.reason.startsWith('the median template')) return 'reference (median template)';
	if (c.status === 'insufficient-data') return `insufficient data (${c.n.episodes}/${RULES.minEpisodes} episodes)`;
	if (c.status === 'suggestive' && c.momentConfounded) return 'worth watching (tied to its moment)';
	return statusText[c.status];
};

const groupTable = (title: string, rows: GroupRow[], comparisons: Map<string, Comparison>, idOf: (key: string) => string): string[] => {
	if (!rows.length) return [];
	const lines = [
		`| ${title} | Scenes | Episodes | Median length | Lost per 10 s (pp of views) | Loss rate (% of those watching, per 10 s) | Vs the median template (95% CI) | Status |`,
		'| --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	for (const r of rows) {
		const c = comparisons.get(idOf(r.key));
		lines.push(
			`| ${cell(r.key)} | ${r.scenes} | ${r.episodes} | ${plain(r.medianLengthSec, 1, ' s')} | ${plain(r.meanDropPer10sPp, 2, ' pp')} | ${plain(r.meanLossRate, 2, '%')} | ${estimateText(c)} | ${statusCell(c, r.key)} |`,
		);
	}
	return [...lines, ''];
};

const formatSections = (f: FormatSummary, comparisons: Comparison[]): string[] => {
	const byId = new Map(comparisons.filter((c) => c.format === f.format).map((c) => [c.id, c]));
	const name = formatName(f.format);
	const lines: string[] = [];
	for (const t of f.templates) {
		lines.push(`## Templates: ${t.channel} (${name})`, '');
		lines.push(
			t.model
				? `Scene model: ${t.model.scenes} scenes from ${t.model.episodes} episodes; effects are against the median template (${t.model.reference}), at the same moment of the same upload, in % of the viewers still watching per 10 s (positive = loses more). Openings are judged in the opening-scene section, end screens not at all.${t.model.notes.length ? ` Note: ${t.model.notes.join('; ')}.` : ''}`
				: `Not enough data for the scene model yet (it needs ${RULES.minEpisodes} episodes of this channel with 2+ measurable scenes each; there ${t.episodes === 1 ? 'is' : 'are'} ${t.episodes}). The averages below are descriptive only.`,
			'',
		);
		// a channel whose scenes are judged by segment (the show) gets the segment table only
		const typeJudged = comparisons.some((c) => c.family === 'type' && c.channel === t.channel && c.format === f.format);
		if (typeJudged || !t.segments.length) lines.push(...groupTable('Template type', t.types, byId, (k) => `type:${k}:${t.channel}:${f.format}`));
		if (t.segments.length) lines.push(...groupTable('Show segment', t.segments, byId, (k) => `segment:${k}:${t.channel}:${f.format}`));
		if (t.badger.length) {
			const c = byId.get(`badger:badger:${t.channel}:${f.format}`);
			lines.push(
				`Badger on screen vs not, among scenes of the same template (% of those watching per 10 s, positive = loses more): ${estimateText(c)}; ${c ? `${statusCell(c)}${c.status === 'insufficient-data' ? `: ${c.reason.replace(/^insufficient data: /, '')}` : ''}` : 'not compared'}.`,
				'',
			);
		}
	}
	if (f.endscreen) {
		lines.push(`End screens (${name}): ${f.endscreen.uploads} uploads, median ${plain(f.endscreen.medianLengthSec, 1, ' s')}; of the viewers who reach the end screen, a median ${pct(f.endscreen.medianStayShare)} stay to the last frame. End screens are not compared with other scenes (everyone leaves at the end).`, '');
	}
	lines.push(`## Opening scene (${name})`, '', `Hook outcome: YouTube's retention value at ${at(f.hookAtSec)}.`, '');
	if (f.hookBuckets.length) {
		lines.push(`| Opening length | Episodes | Uploads | Median length | Retention at ${at(f.hookAtSec)} | Lost in the first 5 s |`, '| --- | --- | --- | --- | --- | --- |');
		for (const b of f.hookBuckets) lines.push(`| ${b.bucket} | ${b.episodes} | ${b.uploads} | ${plain(b.medianLengthSec, 1, ' s')} | ${plain(b.meanOutcomePp, 1, '%')} | ${plain(b.meanLost5Pp, 1, ' pp')} |`);
		lines.push('');
	}
	const two = byId.get(`hook-short:<${RULES.shortHookSec}s:${f.format}`);
	const slope = byId.get(`hook-slope:length:${f.format}`);
	if (two) lines.push(`- Under ${RULES.shortHookSec} s minus ${RULES.shortHookSec} s or longer, centred within channel: ${estimateText(two)} pp; ${statusText[two.status]} (${two.n.group ?? 0} vs ${two.n.rest ?? 0} episodes).`);
	if (slope) lines.push(`- Per extra second of opening: ${estimateText(slope)} pp; ${statusText[slope.status]} (${slope.n.episodes} episodes).`);
	lines.push('');
	if (f.languages.length > 1 || f.languages.some((l) => l.lang !== 'en')) {
		lines.push(`## Languages (${name})`, '', '| Language | Uploads | Episodes | Average retention | Retention at ' + at(f.hookAtSec) + ' | Blended (extra audio tracks) |', '| --- | --- | --- | --- | --- | --- |');
		for (const l of f.languages) lines.push(`| ${l.lang} | ${l.uploads} | ${l.episodes} | ${plain(l.meanAverageRetentionPp, 1, '%')} | ${plain(l.meanHookOutcomePp, 1, '%')} | ${l.blended} |`);
		lines.push('');
		for (const c of comparisons.filter((x) => x.format === f.format && (x.family === 'language-average' || x.family === 'language-hook'))) {
			lines.push(`- ${c.group} minus en, ${c.outcome}: ${estimateText(c)} pp; ${statusText[c.status]} (${c.n.episodes} episode pairs).`);
		}
		lines.push('', 'Language groups differ in audience as well as in voice, and YouTube may auto-dub the English upload, so a language difference is a prompt to review the dub, not proof of its cause.', '');
	}
	return lines;
};

export const renderReportMarkdown = (input: ReportInput): string => {
	const {analyses, aggregates, recommendations} = input;
	const synthetic = syntheticOf(analyses);
	const usable = analyses.filter((a) => a.usable);
	const lines: string[] = ['# Retention report: where viewers leave, scene by scene', ''];
	if (synthetic !== 'none') {
		lines.push(
			synthetic === 'all'
				? '> **Synthetic data.** Every upload in this report is a generated fixture (tests or the demo). Nothing here describes a real video.'
				: '> **Mixed data.** Some uploads in this report are generated fixtures, not real videos. They are marked "fixture" below.',
			'',
		);
	}
	const windows = usable.map((a) => a.window);
	const from = windows.map((w) => w.startDate).sort()[0];
	const to = windows.map((w) => w.endDate).sort().slice(-1)[0];
	lines.push(
		`Generated ${input.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC from ${analyses.length} pulled upload${analyses.length === 1 ? '' : 's'} (${usable.length} usable)` +
			(from && to ? `; YouTube data from ${from} to ${to}` : '') +
			'.',
		'',
		`**About these numbers.** ${DISCLOSURE}`,
		'',
		'## Summary',
		'',
	);
	for (const f of aggregates.formats) {
		const channels = Object.entries(f.channels).map(([c, n]) => `${c} ${n}`).join(', ');
		lines.push(`- ${formatName(f.format)}: ${f.usableUploads} usable upload${f.usableUploads === 1 ? '' : 's'} from ${f.episodes} episode${f.episodes === 1 ? '' : 's'} (${channels}); ${f.withBaseline} with a channel baseline (needs ${RULES.baselineMinEpisodes} other episodes of the same channel and format).`);
	}
	if (!aggregates.formats.length) lines.push('- No usable upload yet.');
	const suggestive = aggregates.comparisons.filter((c) => c.status === 'suggestive');
	const insufficient = aggregates.comparisons.filter((c) => c.status === 'insufficient-data').length;
	lines.push(
		`- ${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'}, ${suggestive.length} worth watching, ${insufficient} comparison${insufficient === 1 ? '' : 's'} with insufficient data, ${aggregates.comparisons.length - recommendations.length - suggestive.length - insufficient} with no clear difference.`,
	);
	const excluded = analyses.filter((a) => !a.usable);
	if (excluded.length) lines.push(`- ${excluded.length} upload${excluded.length === 1 ? '' : 's'} excluded (see Data quality).`);
	lines.push('', '## Recommendations', '');
	if (!recommendations.length) {
		lines.push(
			`None yet. A recommendation needs ${RULES.minEpisodes} or more independent episodes, a 95% interval that excludes no difference, an effect of practical size, and a false-discovery q of ${RULES.fdr} or less. Nothing passed all of these, so no template change is recommended.`,
			'',
		);
	}
	recommendations.forEach((r, i) => {
		lines.push(`### ${i + 1}. ${r.title}`, '', `**Try:** ${r.action}`, '', `**Why:** ${r.evidence}`, '');
		if (r.suggestedRule) lines.push(`**Rule to test** (a proposal; it needs your OK before the storyboard writer uses it): \`${JSON.stringify(r.suggestedRule)}\``, '');
		lines.push(r.recheck, '');
	});
	if (suggestive.length) {
		lines.push('## Worth watching (not yet actionable)', '', 'These passed the interval and size checks, but either could be chance among this many comparisons, or cannot yet be told apart from the moment of the video they sit at.', '');
		for (const c of suggestive) lines.push(`- ${c.label} (${formatName(c.format)}${c.channel ? `, ${c.channel}` : ''}): ${estimateText(c)} ${c.unit}; q = ${c.q?.toFixed(3)}; ${c.n.episodes} episodes. ${c.reason[0]!.toUpperCase()}${c.reason.slice(1)}.`);
		lines.push('');
	}
	lines.push(
		'## Where viewers leave, per upload',
		'',
		`The scenes of each upload that lost the most viewers beyond what the scene model expects at that moment (the raw loss when the channel does not have enough data yet), listed only when that loss is more than ${RULES.noiseSe} standard errors of sampling noise for the upload's playback count. One upload is one observation, not a rule.`,
		'',
	);
	const recent = [...usable].sort((a, b) => b.pulledAt.localeCompare(a.pulledAt) || a.videoId.localeCompare(b.videoId));
	for (const v of recent.slice(0, 25)) lines.push(...uploadSection(v));
	if (recent.length > 25) lines.push(`${recent.length - 25} more uploads are in report.json.`, '');
	for (const f of aggregates.formats) lines.push(...formatSections(f, aggregates.comparisons));

	lines.push('## Data quality', '');
	if (excluded.length) {
		lines.push('| Upload | Video | Excluded because |', '| --- | --- | --- |');
		for (const v of excluded) lines.push(`| ${cell(uploadName(v))}${v.fixture ? ' (fixture)' : ''} | \`${v.videoId}\` | ${cell(v.exclusions.map((e) => `${e.code}: ${e.detail}`).join('; '))} |`);
		lines.push('');
	} else {
		lines.push('No upload was excluded.', '');
	}
	const audiences = [...new Set(usable.map((a) => a.audience))];
	if (audiences.length > 1) lines.push(`Pulls use different audiences (${audiences.join(', ')}): ad viewers behave differently from organic ones, so pull every upload with the same --audience.`, '');
	const warned = analyses.filter((a) => a.warnings.length);
	for (const v of warned) lines.push(`- \`${v.videoId}\` (${uploadName(v)}): ${v.warnings.map(cell).join('; ')}`);
	if (warned.length) lines.push('');
	if (input.options.includeStale) lines.push(`Uploads pulled more than ${RULES.staleDays} days ago are included (--include-stale); refresh them soon.`, '');
	if (input.options.allowUnverifiedDuration) lines.push('Uploads whose duration could not be checked against the timeline are included (--allow-unverified-duration).', '');

	lines.push(
		'## Method',
		'',
		`- **Curve.** YouTube returns 100 buckets per video; each value is placed at its bucket's midpoint and joined linearly. A scene's retention "in" and "out" are read at its start and end (start ms / video length). A scene shorter than ${RULES.minBucketsPerScene} buckets is not measured on its own.`,
		`- **Lost per 10 s** = (in - out) × 100 / (scene length / 10 s), in percentage points of the video's views. **Loss rate** = the share of the viewers still watching who left, per 10 s (-1000 × ln(out / in) / seconds), which is comparable early and late in a video.`,
		`- **Expected at that moment.** Viewers leave fastest in the first seconds whatever the content. Per channel and format, a smooth drop-off curve (two fading exponentials in absolute time) is fitted robustly to every scene's loss rate, and each upload's own level is its MEDIAN scene, so one very bad scene does not make the others look good. "Beyond expected" = loss rate - curve - upload level. Openings (judged in the hook section) and end screens are left out.`,
		`- **Typical curve** (retention levels, e.g. at 0:30): at each second, the median retention of at least ${RULES.baselineMinEpisodes} other episodes of the same channel and format (language versions averaged first; the episode itself left out), aligned in absolute time and cut at each video's end screen.`,
		`- **Independent unit = episode.** Language versions share a script, so they count once. Template types and segments: the mean "beyond expected" per episode, then a t interval over episodes. Badger: a regression within scenes of the same template and segment, with standard errors clustered by episode.`,
		`- **Gates.** Uploads need ${RULES.minViews}+ playbacks (or views), ${RULES.minBuckets}+ of 100 buckets, a duration within max(${RULES.durationTolerance.ms / 1000} s, ${RULES.durationTolerance.fraction * 100}%) of the timeline, and a pull at most ${RULES.staleDays} days old. Comparisons need ${RULES.minEpisodes}+ episodes per side (${RULES.minSlopeEpisodes} for a slope), a 95% t interval excluding 0, a practical effect (${RULES.practical.sceneRatePct}% of those watching per 10 s for scenes, ${RULES.practical.hookPp} pp for hooks, ${RULES.practical.hookSlopePpPerSec} pp per second of opening, ${RULES.practical.languagePp} pp for languages) and a Benjamini-Hochberg q of ${RULES.fdr} or less across all ${aggregates.comparisons.length} comparisons.`,
		`- **Sampling noise, per upload.** With n playbacks, the viewers a scene loses are binomial: standard error 100 × sqrt(share watching × q × (1 - q) / n) pp of views over the scene, scaled per 10 s (q: the larger of the expected and the seen loss). A per-upload drop is named only above ${RULES.noiseSe} standard errors, and a rewatch spot only when its rise is at least ${RULES.rewatchPp} pp and above ${RULES.noiseSe} Poisson standard errors (100 × sqrt((in + out) / n)). This is a floor: real curves are noisier.`,
		`- **Openings, relative.** The hook comparison's headline is the within-channel difference in pp. A relative figure, when given, is that same difference divided by the longer openings' mean, with its interval; the raw group means mix channels and are shown only as context.`,
		'- **What this cannot show.** Correlation in past uploads, not cause: a template that sits next to a strong topic can look better than it is, and a segment that always sits at the same moment cannot be fully separated from that moment. The drop-off model and the per-upload level reduce this but do not remove it. Re-test every rule.',
		'',
		'Sources (read 2026-11-24):',
		'',
		...SOURCES.map((s) => `- ${s.title}: ${s.url} (page updated ${s.updated})`),
		'',
	);
	return `${lines.join('\n')}\n`;
};
