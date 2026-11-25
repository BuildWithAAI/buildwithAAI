/**
 * Loading and resolving an episode for calculateMetadata (browser side, webpack bundle).
 *  - Storyboards: content/<channel>/<slug>/storyboard.json (en) or storyboard.<lang>.json, bundled with webpack's
 *    require.context at bundle time (every `remotion render` re-bundles, so new storyboards are picked up). Dev fixtures
 *    live in src/episode/dev/fixtures/<slug>/ under the channel name "_dev".
 *  - Timeline: public/generated/<channel>/<slug>/<lang>/timeline.json (the voice step), or props.timelineOverride.
 *    Only the "_dev" channel falls back to a mock timeline when none exists (silent preview, badged).
 *  - Narration: public/generated/<channel>/<slug>/<lang>/narration.wav (one file, one <Audio>).
 *  - Sound (added 2026-11-25): the audio plan (src/episode/audio/plan.ts) is computed here, after validation. A dub needs
 *    the master's storyboard and timeline (moods and the clock follow the master in every language): a missing master
 *    timeline is an error that names the file. With props.audioPlanHash (render.sh passes the audio-plan CLI's hash),
 *    a plan that hashes differently throws: the bundle and the CLI saw different files (critic F1).
 */
import {staticFile} from 'remotion';
import type {Lang, Storyboard, Timeline} from './types';
import type {ChartData} from '../charts/chartData';
import {assertNoErrors, validateProps, validateStoryboard, validateTimeline, type EpisodeInput} from './validate';
import {mockTimeline} from './dev/mockTimeline';
import {chartDataFor, checkChartPlan, planChart, type ChartPlan} from './chart/plan';
import {LAYOUTS, type Format} from './layout/specs';
import {episodeFrames, episodeSpans, shortSpans, spansFrames} from './timing';
import {msToFrame} from './motion';
import {MUSIC, SFX} from '../audio/components/library';
import {planEpisodeAudio, type AudioStem, type EpisodeAudioPlan} from './audio/plan';
import type {BedLevelTable} from './audio/levels';
import bedLevels from './audio/bedLevels.json';

type WebpackContext = {keys(): string[]; (id: string): unknown};
type WebpackRequire = {context(dir: string, deep: boolean, re: RegExp): WebpackContext};

// Both calls must stay literal `require.context(...)` so webpack can resolve them at bundle time.
const CONTENT = (require as unknown as WebpackRequire).context('../../content', true, /^\.\/[^/]+\/[^/]+\/storyboard(\.[a-z]{2}(-[a-z]{2})?)?\.json$/);
const DEV = (require as unknown as WebpackRequire).context('./dev/fixtures', true, /^\.\/[^/]+\/storyboard(\.[a-z]{2}(-[a-z]{2})?)?\.json$/);

export const DEV_CHANNEL = '_dev';
export const FPS = 30;

const fileFor = (lang: Lang) => (lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`);

export const loadStoryboard = (channel: string, slug: string, lang: Lang): Storyboard => {
	const ctx = channel === DEV_CHANNEL ? DEV : CONTENT;
	const key = channel === DEV_CHANNEL ? `./${slug}/${fileFor(lang)}` : `./${channel}/${slug}/${fileFor(lang)}`;
	if (!ctx.keys().includes(key)) {
		const prefix = channel === DEV_CHANNEL ? `./${slug}/` : `./${channel}/${slug}/`;
		const have = ctx
			.keys()
			.filter((k) => k.startsWith(prefix))
			.map((k) => k.slice(prefix.length));
		const where = channel === DEV_CHANNEL ? `src/episode/dev/fixtures/${slug}/${fileFor(lang)}` : `content/${channel}/${slug}/${fileFor(lang)}`;
		throw new Error(`No storyboard at ${where}.${have.length ? ` This episode has: ${have.join(', ')}.` : ' No storyboard exists for this channel/slug.'}`);
	}
	return ctx(key) as Storyboard;
};

export const narrationPath = (channel: string, slug: string, lang: Lang) => `generated/${channel}/${slug}/${lang}/narration.wav`;
const timelinePath = (channel: string, slug: string, lang: Lang) => `generated/${channel}/${slug}/${lang}/timeline.json`;

const fetchJson = async <T,>(path: string, signal?: AbortSignal): Promise<T | null> => {
	const res = await fetch(staticFile(path), {signal});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
	return (await res.json()) as T;
};

export type EpisodeProps = {
	channel: string;
	slug: string;
	lang: Lang;
	shortId?: string;
	captions?: boolean;
	timelineOverride?: Timeline | null;
	/** Added 2026-11-25. Measurement renders only: play just these audio stems, draw nothing (src/episode/tools/render.sh). */
	audioStems?: AudioStem[] | null;
	/** Added 2026-11-25. The audio-plan CLI's hash: the render refuses a plan that differs (src/episode/tools/render.sh). */
	audioPlanHash?: string | null;
	/** Filled by calculateMetadata; never pass it yourself. */
	resolved?: ResolvedEpisode | null;
};

export type ResolvedEpisode = {
	format: Format;
	storyboard: Storyboard;
	timeline: Timeline;
	shortId: string | null;
	narration: string | null; // public/ path of narration.wav, null for a mock timeline (silent)
	charts: Record<string, ChartPlan>; // by scene id
	captions: boolean;
	durationInFrames: number;
	warnings: string[];
	/** Added 2026-11-25: the sound plan (beds, sting, effects); silent for a mock timeline */
	audio: EpisodeAudioPlan;
};

const chartPlans = async (sb: Storyboard, tl: Timeline, spanIndexes: number[], format: Format, label: string, signal?: AbortSignal): Promise<Record<string, ChartPlan>> => {
	const out: Record<string, ChartPlan> = {};
	for (const index of spanIndexes) {
		const sc = sb.scenes[index];
		if (sc.type !== 'chart' || !sc.chart) continue;
		const box = LAYOUTS.chart[format].chart;
		const fileData = sc.chart.dataFile ? await fetchJson<ChartData>(sc.chart.dataFile.replace(/^public\//, ''), signal) : undefined;
		if (sc.chart.dataFile && !fileData) throw new Error(`${label}: scene ${sc.id}: chart data file public/${sc.chart.dataFile} not found`);
		try {
			out[sc.id] = planChart(sc, tl.scenes[index], chartDataFor(sc, box, fileData ?? undefined), box, FPS, sb.lang);
		} catch (err) {
			throw new Error(`${label}: scene ${sc.id}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return out;
};

export const resolveEpisode = async (
	props: EpisodeInput & {timelineOverride?: Timeline | null; masterTimelineOverride?: Timeline | null},
	format: Format,
	signal?: AbortSignal,
): Promise<ResolvedEpisode> => {
	const short = format === 'vertical';
	const label = `${short ? 'EpisodeShort' : 'Episode'} ${String(props.channel)}/${String(props.slug)} (${String(props.lang)})`;
	assertNoErrors(validateProps(props, short), label);
	const channel = props.channel as string;
	const slug = props.slug as string;
	const lang = props.lang as Lang;
	const storyboard = loadStoryboard(channel, slug, lang);
	const shortId = short ? ((props.shortId as string | undefined) ?? storyboard.shorts?.[0]?.id ?? null) : null;
	const warnings = assertNoErrors(validateStoryboard(storyboard, {channel, slug, lang, short, shortId: shortId ?? undefined}), label);

	let timeline = props.timelineOverride ?? (await fetchJson<Timeline>(timelinePath(channel, slug, lang), signal));
	if (!timeline) {
		if (channel !== DEV_CHANNEL) throw new Error(`${label}: no timeline at public/${timelinePath(channel, slug, lang)}. Run the voice step (scripts/voice) for this episode and language first.`);
		timeline = mockTimeline(storyboard, {fps: FPS});
	}
	warnings.push(...assertNoErrors(validateTimeline(timeline, storyboard, FPS, {short, shortId: shortId ?? undefined}), label));

	const spans = short ? shortSpans(storyboard, timeline, shortId as string, FPS) : episodeSpans(storyboard, timeline, FPS);
	const durationInFrames = short ? spansFrames(spans) : episodeFrames(timeline, FPS);

	// charts: data, aggregation for this format's box, reveal plan; every frame laid out and checked here
	const charts: Record<string, ChartPlan> = {};
	for (const span of spans) {
		const sc = storyboard.scenes[span.index];
		if (sc.type !== 'chart' || !sc.chart) continue;
		const box = LAYOUTS.chart[format].chart;
		const fileData = sc.chart.dataFile ? await fetchJson<ChartData>(sc.chart.dataFile.replace(/^public\//, ''), signal) : undefined;
		if (sc.chart.dataFile && !fileData) throw new Error(`${label}: scene ${sc.id}: chart data file public/${sc.chart.dataFile} not found`);
		try {
			const data = chartDataFor(sc, box, fileData ?? undefined);
			const plan = planChart(sc, timeline.scenes[span.index], data, box, FPS, lang);
			checkChartPlan(plan, span.durationInFrames + span.tail, sc.chart.surface ?? 'dark');
			charts[sc.id] = plan;
		} catch (err) {
			throw new Error(`${label}: scene ${sc.id}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	const speechFrames = timeline.scenes.reduce((a, s) => a + msToFrame(s.speechMs, FPS), 0);
	if (!timeline.mock && speechFrames === 0) warnings.push({level: 'warning', where: 'timeline', msg: 'the timeline has no speech'});

	// sound: the master decides moods and the clock in every language, so a dub needs the master's files (critic F14)
	let master: {storyboard: Storyboard; timeline: Timeline} | null = null;
	let masterCharts: Record<string, ChartPlan> | undefined;
	if (storyboard.lang !== storyboard.sourceLang && !timeline.mock) {
		const msb = loadStoryboard(channel, slug, storyboard.sourceLang);
		const mtl = props.masterTimelineOverride ?? (await fetchJson<Timeline>(timelinePath(channel, slug, storyboard.sourceLang), signal));
		if (!mtl)
			throw new Error(
				`${label}: the ${lang} render needs the ${storyboard.sourceLang} master timeline at public/${timelinePath(channel, slug, storyboard.sourceLang)} (moods and the music clock follow the master in every language). Voice the master first, or unpack it with this job.`,
			);
		master = {storyboard: msb, timeline: mtl};
		if (timeline.mode === 'fit-to-master') masterCharts = await chartPlans(msb, mtl, msb.scenes.map((_, i) => i), format, label, signal);
	}
	let audio: EpisodeAudioPlan;
	try {
		audio = planEpisodeAudio({format, storyboard, timeline, shortId, master, charts, masterCharts, lib: {music: MUSIC, sfx: SFX, levels: bedLevels as unknown as BedLevelTable}});
	} catch (err) {
		throw new Error(`${label}: sound: ${err instanceof Error ? err.message : String(err)}`);
	}
	const wantHash = (props as {audioPlanHash?: unknown}).audioPlanHash;
	if (typeof wantHash === 'string' && wantHash && wantHash !== audio.hash)
		throw new Error(
			`${label}: the audio plan this bundle computes (${audio.hash.slice(0, 12)}) is not the one the audio-plan CLI wrote (${wantHash.slice(0, 12)}): the bundle is older or newer than the storyboard, timeline or code on disk. Re-bundle after the voice step and plan again (src/episode/tools/render.sh does both in order).`,
		);
	for (const m of audio.warnings) warnings.push({level: 'warning', where: 'sound', msg: m});
	for (const w of warnings) console.warn(`[episode] ${label}: ${w.where}: ${w.msg}`);
	return {
		format,
		storyboard,
		timeline,
		shortId,
		// the voice step records the continuous track as timeline.narration (scripts/voice/timeline-additions.ts)
		narration: timeline.mock ? null : ((timeline as Timeline & {narration?: string}).narration ?? narrationPath(channel, slug, lang)),
		charts,
		captions: typeof props.captions === 'boolean' ? props.captions : short,
		durationInFrames,
		warnings: warnings.map((w) => `${w.where}: ${w.msg}`),
		audio,
	};
};
