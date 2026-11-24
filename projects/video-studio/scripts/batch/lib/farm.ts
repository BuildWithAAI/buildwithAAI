/**
 * A render-farm request draft per episode (docs/RENDER_FARM.md, scripts/farm/request.ts): the English voice and every
 * English render of the episode (long-form and its Shorts) as parallel jobs, written to the publish kit's media
 * paths so the decrypted files land where the kit and the uploader look for them.
 *
 * Dubs are not in it on purpose: the farm voices each language natively, while a multi-language audio track must
 * line up with the English picture (voice step --fit-to en, run locally). Pushing a request starts the farm, so the
 * batch only writes the draft; the weekly session copies it to render-requests/ once the claim gates pass.
 */
import type {BatchConfig, PlanItem} from './types.ts';

export const ZOO_VOICE = 'im_nicola';

export type FarmRequest = {
	id: string;
	entry: string;
	encrypt: true;
	retentionDays: number;
	voice: Array<{channel: string; slug: string; lang: 'en'; voice: typeof ZOO_VOICE}>;
	jobs: Array<{composition: string; kind: 'video'; output: string; props: Record<string, string>}>;
};

/** Farm ids are lowercase: "batch-2026-w49-ai1". */
export const farmRequestId = (week: string, itemId: string): string => `batch-${week}-${itemId}`.toLowerCase();

export const farmRequest = (config: BatchConfig, week: string, long: PlanItem, shorts: PlanItem[]): FarmRequest => {
	const channel = config.channels.find((c) => c.channel === long.channel);
	const format = channel?.formats[long.format];
	const base = {channel: long.channel, slug: long.slug, lang: 'en'};
	return {
		id: farmRequestId(week, long.id),
		entry: format?.entry ?? 'src/episode/index.ts',
		encrypt: true,
		retentionDays: 7,
		voice: [{channel: long.channel, slug: long.slug, lang: 'en', voice: ZOO_VOICE}],
		jobs: [
			{composition: format?.composition ?? 'Episode', kind: 'video', output: long.paths.render, props: base},
			...shorts.map((s) => ({composition: format?.shortComposition ?? 'EpisodeShort', kind: 'video' as const, output: s.paths.render, props: {...base, shortId: s.renderId}})),
		],
	};
};
