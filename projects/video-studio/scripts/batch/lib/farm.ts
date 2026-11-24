/**
 * A render-farm request draft per episode (docs/RENDER_FARM.md, scripts/farm/request.ts): every English render of
 * the episode (long-form and its Shorts) as parallel jobs, written to the publish kit's media paths so the decrypted
 * files land where the kit and the uploader look for them, plus its dubs.
 *
 * Dubs go up as multi-language audio tracks on the English video (a Studio step), so each must line up with the
 * English picture: its voice entry is fitted to the English timeline ("fitTo": "en", scripts/voice/build.py
 * --fit-to en; the farm voices it after the English master), and an audio-only job per video exports the dub's full
 * mix as WAV (media/dubs/<lang>/<render>.wav). Pushing a request starts the farm and publishes its storyboards, so the
 * batch only writes the draft; the weekly session copies it to render-requests/ once every claim gate passes (the
 * farm's validate and plan refuse it otherwise).
 */
import type {BatchConfig, PlanItem} from './types.ts';

export const ZOO_VOICE = 'im_nicola';

export type FarmVoice = {channel: string; slug: string; lang: string; voice: typeof ZOO_VOICE; fitTo?: 'en'};
export type FarmJob = {composition: string; kind: 'video' | 'audio'; output: string; props: Record<string, string>};

export type FarmRequest = {
	id: string;
	entry: string;
	encrypt: true;
	retentionDays: number;
	voice: FarmVoice[];
	jobs: FarmJob[];
};

/** Farm ids are lowercase: "batch-2026-w49-ai1". */
export const farmRequestId = (week: string, itemId: string): string => `batch-${week}-${itemId}`.toLowerCase();

/** Where a dub's audio track lands next to the kit's media: media/dubs/<lang>/<long|short-n>.wav. */
export const dubTrackPath = (kitDir: string, lang: string, renderId: string): string => `${kitDir}/media/dubs/${lang}/${renderId}.wav`;

export const farmRequest = (config: BatchConfig, week: string, long: PlanItem, shorts: PlanItem[]): FarmRequest => {
	const channel = config.channels.find((c) => c.channel === long.channel);
	const format = channel?.formats[long.format];
	const base = {channel: long.channel, slug: long.slug};
	const longComp = format?.composition ?? 'Episode';
	const shortComp = format?.shortComposition ?? 'EpisodeShort';
	const dubs = long.languages.dubs;
	return {
		id: farmRequestId(week, long.id),
		entry: format?.entry ?? 'src/episode/index.ts',
		encrypt: true,
		retentionDays: 7,
		voice: [{...base, lang: 'en', voice: ZOO_VOICE}, ...dubs.map((lang): FarmVoice => ({...base, lang, voice: ZOO_VOICE, fitTo: 'en'}))],
		jobs: [
			{composition: longComp, kind: 'video', output: long.paths.render, props: {...base, lang: 'en'}},
			...shorts.map((s) => ({composition: shortComp, kind: 'video' as const, output: s.paths.render, props: {...base, lang: 'en', shortId: s.renderId}})),
			...dubs.flatMap((lang) => [
				{composition: longComp, kind: 'audio' as const, output: dubTrackPath(long.paths.kitDir, lang, 'long'), props: {...base, lang}},
				...shorts.map((s) => ({composition: shortComp, kind: 'audio' as const, output: dubTrackPath(long.paths.kitDir, lang, s.renderId), props: {...base, lang, shortId: s.renderId}})),
			]),
		],
	};
};
