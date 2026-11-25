/**
 * Node side of the episode audio plan (tools and tests only, never the bundle): reads from disk exactly what
 * calculateMetadata reads in the render (src/episode/load.ts), so the audio-plan CLI computes the same plan and the
 * same hash the render does:
 *  - the storyboard (content/<channel>/<slug>/storyboard[.<lang>].json; dev fixtures under src/episode/dev/fixtures for
 *    the "_dev" channel), the voice step's timeline (public/generated/<channel>/<slug>/<lang>/timeline.json; "_dev" falls
 *    back to a mock, which plans silence), and for a dub the master's storyboard and timeline (required);
 *  - the chart plans (src/charts, pure), the music and SFX manifests, and the bed level table.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Lang, Storyboard, Timeline} from '../types.ts';
import type {ChartData} from '../../charts/chartData.ts';
import {chartDataFor, planChart, type ChartPlan} from '../chart/plan.ts';
import {LAYOUTS, type Format} from '../layout/specs.ts';
import {mockTimeline} from '../dev/mockTimeline.ts';
import {asManifest} from '../../../scripts/audio/sfx/sfx.ts';
import {parseManifest} from '../../../scripts/audio/music/manifest.ts';
import type {BedLevelTable} from '../audio/levels.ts';
import type {PlanInput} from '../audio/plan.ts';

export const STUDIO = fileURLToPath(new URL('../../../', import.meta.url));
export const DEV_CHANNEL = '_dev';
const FPS = 30;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const storyboardFile = (lang: Lang) => (lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`);

export const storyboardPath = (channel: string, slug: string, lang: Lang): string =>
	channel === DEV_CHANNEL ? join(STUDIO, 'src', 'episode', 'dev', 'fixtures', slug, storyboardFile(lang)) : join(STUDIO, 'content', channel, slug, storyboardFile(lang));
export const timelinePath = (channel: string, slug: string, lang: Lang): string => join(STUDIO, 'public', 'generated', channel, slug, lang, 'timeline.json');

export const loadStoryboardFile = (channel: string, slug: string, lang: Lang): Storyboard => {
	const p = storyboardPath(channel, slug, lang);
	if (!existsSync(p)) throw new Error(`no storyboard at ${p}`);
	return readJson<Storyboard>(p);
};

/** The timeline the render would use: the voice step's, or (only for "_dev") a mock. */
export const loadTimelineFile = (channel: string, slug: string, lang: Lang, sb: Storyboard): Timeline => {
	const p = timelinePath(channel, slug, lang);
	if (existsSync(p)) return readJson<Timeline>(p);
	if (channel === DEV_CHANNEL) return mockTimeline(sb, {fps: FPS});
	throw new Error(`no timeline at ${p}: run the voice step (scripts/voice) for ${lang} first`);
};

/** Chart plans by scene id for one format, as resolveEpisode computes them. */
export const chartPlansFor = (sb: Storyboard, tl: Timeline, format: Format): Record<string, ChartPlan> => {
	const out: Record<string, ChartPlan> = {};
	sb.scenes.forEach((sc, i) => {
		if (sc.type !== 'chart' || !sc.chart) return;
		const box = LAYOUTS.chart[format].chart;
		const fileData = sc.chart.dataFile ? readJson<ChartData>(join(STUDIO, 'public', sc.chart.dataFile.replace(/^public\//, ''))) : undefined;
		out[sc.id] = planChart(sc, tl.scenes[i], chartDataFor(sc, box, fileData), box, FPS, sb.lang);
	});
	return out;
};

export const audioLibrary = (): PlanInput['lib'] => ({
	music: parseManifest(readJson(join(STUDIO, 'public', 'audio', 'music', 'manifest.json'))),
	sfx: asManifest(readJson(join(STUDIO, 'public', 'audio', 'sfx', 'manifest.json'))),
	levels: readJson<BedLevelTable>(join(STUDIO, 'src', 'episode', 'audio', 'bedLevels.json')),
});

/** Everything planEpisodeAudio needs for one render, from disk. */
export const planInputFromDisk = (o: {channel: string; slug: string; lang: Lang; format: Format; shortId?: string | null; lib?: PlanInput['lib']}): PlanInput => {
	const sb = loadStoryboardFile(o.channel, o.slug, o.lang);
	const tl = loadTimelineFile(o.channel, o.slug, o.lang, sb);
	const shortId = o.format === 'vertical' ? (o.shortId ?? sb.shorts?.[0]?.id ?? null) : null;
	let master: PlanInput['master'] = null;
	let masterCharts: Record<string, ChartPlan> | undefined;
	if (sb.lang !== sb.sourceLang && !tl.mock) {
		const msb = loadStoryboardFile(o.channel, o.slug, sb.sourceLang);
		const mp = timelinePath(o.channel, o.slug, sb.sourceLang);
		if (!existsSync(mp)) throw new Error(`the ${o.lang} render needs the ${sb.sourceLang} master timeline at ${mp} (moods and the clock follow the master in every language)`);
		const mtl = readJson<Timeline>(mp);
		master = {storyboard: msb, timeline: mtl};
		if (tl.mode === 'fit-to-master') masterCharts = chartPlansFor(msb, mtl, o.format);
	}
	return {format: o.format, storyboard: sb, timeline: tl, shortId, master, charts: chartPlansFor(sb, tl, o.format), masterCharts, lib: o.lib ?? audioLibrary()};
};
