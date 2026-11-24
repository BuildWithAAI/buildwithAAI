/**
 * Loading and resolving an episode for calculateMetadata (browser side, webpack bundle).
 *  - Storyboards: content/<channel>/<slug>/storyboard.json (en) or storyboard.<lang>.json, bundled with webpack's
 *    require.context at bundle time (every `remotion render` re-bundles, so new storyboards are picked up). Dev fixtures
 *    live in src/episode/dev/fixtures/<slug>/ under the channel name "_dev".
 *  - Timeline: public/generated/<channel>/<slug>/<lang>/timeline.json (the voice step), or props.timelineOverride.
 *    Only the "_dev" channel falls back to a mock timeline when none exists (silent preview, badged).
 *  - Narration: public/generated/<channel>/<slug>/<lang>/narration.wav (one file, one <Audio>).
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
};

export const resolveEpisode = async (props: EpisodeInput & {timelineOverride?: Timeline | null}, format: Format, signal?: AbortSignal): Promise<ResolvedEpisode> => {
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
	for (const w of warnings) console.warn(`[episode] ${label}: ${w.where}: ${w.msg}`);
	return {
		format,
		storyboard,
		timeline,
		shortId,
		narration: timeline.mock ? null : narrationPath(channel, slug, lang),
		charts,
		captions: typeof props.captions === 'boolean' ? props.captions : short,
		durationInFrames,
		warnings: warnings.map((w) => `${w.where}: ${w.msg}`),
	};
};
