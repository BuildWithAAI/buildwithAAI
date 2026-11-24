/**
 * Loads and validates one episode's publishing inputs:
 *   content/<channel>/<slug>/episode.json    required, the schema in README.md (EpisodeFile in types.ts)
 *   content/<channel>/<slug>/captions.json   optional, Remotion Caption[]
 *   content/<channel>/channel.json           optional, {displayName, handle}
 *   public/generated/<channel>/<slug>/<lang>/timeline.json   optional, the voice step's measured scene times
 * Every problem is collected and reported at once; nothing is guessed.
 */
import {join} from 'node:path';
import {checkCaptions} from './captions.ts';
import {LIMITS, youtubeTagsLength} from './limits.ts';
import {OFFER_ID} from './offers.ts';
import {timesFromEpisode, timesFromTimeline} from './timing.ts';
import type {Caption, ChannelInfo, Decision, Episode, EpisodeSceneFile, Short, TimelineInput} from './types.ts';
import {InputError, isRecord, readJsonFile} from './util.ts';

export const NAME = /^_?[a-z0-9][a-z0-9-]{0,63}$/; // channel and slug; a leading "_" marks examples
const SCENE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const SHORT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const LANG = /^[a-z]{2}(?:-[a-z]{2})?$/;
const HASHTAG = /^#?[\p{L}\p{N}_]{1,50}$/u;
const COMPOSITION = /^[A-Za-z0-9-]{1,80}$/;
const ENTRY = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}\.(?:tsx?|jsx?|mjs)$/;

/** The episode engine (src/episode/index.ts) and its Thumbnail still (src/thumbnails). 3 = YouTube Test & Compare. */
export const DEFAULT_RENDER = {entry: 'src/episode/index.ts', composition: 'Episode', thumbnailComposition: 'Thumbnail', thumbnails: 3} as const;

/** Studio default (facts doc 2026-11-23, "Made for kids"): adult tech and crypto content is not made for kids. */
export const DEFAULT_MADE_FOR_KIDS: Decision = {
	value: false,
	reason:
		'Not made for kids (studio default): crypto and AI security for adults (scams, wallets, trading risk), in a restrained adult cartoon style with no nursery palette, toys, simple songs or games. Animated characters are a COPPA factor but not decisive on their own.',
};

/** Facts doc 2026-11-23, "AI text-to-speech narration of a fictional cartoon host": no label for clearly animated content. */
export const DEFAULT_SYNTHETIC_MEDIA: Decision = {
	value: false,
	reason:
		'No AI label needed (studio default): the video is clearly animated 2D vector art, narrated by a generic synthetic voice for a fictional host. YouTube\'s GenAI disclosure (Help 14328491) covers realistic content and exempts animation. Set true if it uses photorealistic AI images or video, AI-altered real footage, a realistic AI scene of a real event or place, or a voice that resembles a real, identifiable person.',
};

export type EpisodeInputs = {
	episode: unknown;
	channel: string;
	slug: string;
	captions?: unknown; // parsed captions.json, if any
	timeline?: unknown; // parsed timeline.json, if any
	channelInfo?: unknown; // parsed channel.json, if any
};

const text = (value: unknown, where: string, max: number, problems: string[], required = true): string | null => {
	if (value === undefined && !required) return null;
	if (typeof value !== 'string' || !value.trim()) {
		problems.push(`${where} must be a non-empty string`);
		return null;
	}
	if (value.trim().length > max) problems.push(`${where} must be at most ${max} characters (it has ${value.trim().length})`);
	return value.trim().replace(/\s+/g, ' ');
};

const strings = (value: unknown, where: string, maxItems: number, problems: string[]): string[] => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
		problems.push(`${where} must be a list of strings`);
		return [];
	}
	if (value.length > maxItems) problems.push(`${where} has ${value.length} items; at most ${maxItems}`);
	return value.map((v) => (v as string).trim());
};

const decision = (value: unknown, where: string, problems: string[]): Decision | null => {
	if (value === undefined) return null;
	if (!isRecord(value) || typeof value.value !== 'boolean' || typeof value.reason !== 'string' || value.reason.trim().length < 10) {
		problems.push(`${where} must be {"value": true|false, "reason": "<why, at least 10 characters>"}`);
		return null;
	}
	return {value: value.value, reason: value.reason.trim()};
};

const noAngles = (value: string | null, where: string, problems: string[]): void => {
	if (value && /[<>]/.test(value)) problems.push(`${where} must not contain "<" or ">" (YouTube rejects them)`);
};

export const parseChannelInfo = (raw: unknown, channel: string): ChannelInfo => {
	if (!isRecord(raw)) return {displayName: channel, handle: null};
	const displayName = typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : channel;
	const handle = typeof raw.handle === 'string' && /^@[A-Za-z0-9._-]{3,30}$/.test(raw.handle.trim()) ? raw.handle.trim() : null;
	return {displayName, handle};
};

const parseTimeline = (raw: unknown): TimelineInput | null => {
	if (!isRecord(raw) || typeof raw.totalMs !== 'number' || !Array.isArray(raw.scenes)) return null;
	const scenes = raw.scenes.filter(
		(s): s is {id: string; startMs: number; durationMs: number} => isRecord(s) && typeof s.id === 'string' && typeof s.startMs === 'number' && typeof s.durationMs === 'number',
	);
	if (scenes.length !== raw.scenes.length) return null;
	return {totalMs: raw.totalMs, scenes, mock: raw.mock === true};
};

/** Validates episode.json (plus the optional files) into an Episode. Throws InputError listing every problem. */
export const parseEpisode = (inputs: EpisodeInputs): Episode => {
	const raw = inputs.episode;
	if (!isRecord(raw)) throw new InputError('episode.json must be a JSON object');
	const p: string[] = [];
	const notes: string[] = [];

	if (raw.version !== 1) p.push('"version" must be 1');
	if (raw.channel !== inputs.channel) p.push(`"channel" must be "${inputs.channel}" (the folder name)`);
	if (raw.slug !== inputs.slug) p.push(`"slug" must be "${inputs.slug}" (the folder name)`);
	let lang = 'en';
	if (typeof raw.lang === 'string' && LANG.test(raw.lang)) lang = raw.lang;
	else if (raw.lang !== undefined) p.push('"lang" must be a language code such as "en" or "pt-br"');

	const titleOptions = strings(raw.titleOptions, '"titleOptions"', 5, p);
	if (titleOptions.length === 0) p.push('"titleOptions" needs at least one title');
	titleOptions.forEach((t, i) => {
		if (!t) p.push(`titleOptions[${i}] is empty`);
		if (t.length > LIMITS.youtubeTitleChars) p.push(`titleOptions[${i}] is ${t.length} characters; YouTube allows ${LIMITS.youtubeTitleChars}`);
		noAngles(t, `titleOptions[${i}]`, p);
	});
	const chosen = raw.title === undefined ? (titleOptions[0] ?? '') : text(raw.title, '"title"', LIMITS.youtubeTitleChars, p);
	if (chosen && titleOptions.length && !titleOptions.includes(chosen)) p.push('"title" must be one of "titleOptions"');

	const summary = text(raw.summary, '"summary"', 600, p) ?? '';
	const cta = text(raw.cta, '"cta"', 200, p) ?? '';
	noAngles(summary, '"summary"', p);
	noAngles(cta, '"cta"', p);

	let youtubeVideoId: string | null = null;
	if (raw.youtubeVideoId !== undefined && raw.youtubeVideoId !== null) {
		if (typeof raw.youtubeVideoId === 'string' && YOUTUBE_ID.test(raw.youtubeVideoId)) youtubeVideoId = raw.youtubeVideoId;
		else p.push('"youtubeVideoId" must be null or an 11-character YouTube video id');
	}

	// offers (ids only; the registry supplies names and disclosures)
	const offers = strings(raw.offers, '"offers"', 10, p);
	offers.forEach((id, i) => {
		if (!OFFER_ID.test(id)) p.push(`offers[${i}] "${id}" is not an offer id (2-40 characters: a-z, 0-9, "-")`);
	});
	if (new Set(offers).size !== offers.length) p.push('"offers" lists the same id twice');

	// scenes
	const sceneFiles: EpisodeSceneFile[] = [];
	if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) p.push('"scenes" must be a non-empty list');
	else if (raw.scenes.length > 200) p.push('"scenes" has more than 200 items');
	else
		raw.scenes.forEach((s, i) => {
			const where = `scenes[${i}]`;
			if (!isRecord(s) || typeof s.id !== 'string' || !SCENE_ID.test(s.id)) {
				p.push(`${where} needs an "id" (letters, digits, "_" or "-", up to 32 characters)`);
				return;
			}
			if (sceneFiles.some((f) => f.id === s.id)) p.push(`${where}: duplicate id "${s.id}"`);
			const chapter = s.chapter === undefined ? undefined : (text(s.chapter, `${where}.chapter`, 100, p) ?? undefined);
			noAngles(chapter ?? null, `${where}.chapter`, p);
			if (s.durationSec !== undefined && !(typeof s.durationSec === 'number' && Number.isFinite(s.durationSec) && s.durationSec > 0 && s.durationSec <= 3600)) {
				p.push(`${where}.durationSec must be a number of seconds above 0`);
			}
			if (s.start !== undefined && typeof s.start !== 'string' && typeof s.start !== 'number') p.push(`${where}.start must be seconds or a time like "1:05"`);
			const sceneOffers = strings(s.offers, `${where}.offers`, 10, p);
			for (const id of sceneOffers) if (!offers.includes(id)) p.push(`${where}.offers: "${id}" is not in the episode's "offers"`);
			sceneFiles.push({
				id: s.id,
				...(chapter ? {chapter} : {}),
				...(typeof s.durationSec === 'number' ? {durationSec: s.durationSec} : {}),
				...(typeof s.start === 'string' || typeof s.start === 'number' ? {start: s.start} : {}),
				offers: sceneOffers,
			});
		});

	// times: measured timeline when it covers every scene, else episode.json
	let times = sceneFiles.map((s) => ({id: s.id, startSec: 0, endSec: 0}));
	let totalSec = 0;
	let timing: Episode['timing'] = 'episode';
	const timeline = inputs.timeline === undefined || inputs.timeline === null ? null : parseTimeline(inputs.timeline);
	if (inputs.timeline !== undefined && inputs.timeline !== null && !timeline) notes.push('timeline.json was ignored: it is not a valid timeline (totalMs and scenes[].id/startMs/durationMs)');
	const fromTimeline = timeline && sceneFiles.length ? timesFromTimeline(sceneFiles, timeline) : null;
	if (fromTimeline && 'times' in fromTimeline) {
		times = fromTimeline.times;
		totalSec = fromTimeline.totalSec;
		timing = 'timeline';
		notes.push('Scene times come from the voice step\'s timeline.json (measured narration).');
	} else if (sceneFiles.length) {
		if (fromTimeline && 'reason' in fromTimeline) notes.push(`timeline.json was not used because ${fromTimeline.reason}.`);
		const fromEpisode = timesFromEpisode(sceneFiles);
		p.push(...fromEpisode.errors);
		times = fromEpisode.times;
		totalSec = fromEpisode.totalSec;
		notes.push('Scene times come from episode.json. If they were estimated before the voice step, re-run the kit after it so chapters match the final video.');
	}
	const scenes = sceneFiles.map((s, i) => ({id: s.id, chapter: s.chapter ?? null, offers: s.offers ?? [], startSec: times[i].startSec, endSec: times[i].endSec}));

	// shorts
	const shorts: Short[] = [];
	if (!Array.isArray(raw.shortCuts) || raw.shortCuts.length === 0) p.push('"shortCuts" must list at least one Short (each episode also produces vertical clips)');
	else if (raw.shortCuts.length > 10) p.push('"shortCuts" has more than 10 items');
	else
		raw.shortCuts.forEach((c, i) => {
			const where = `shortCuts[${i}]`;
			if (!isRecord(c)) {
				p.push(`${where} must be an object`);
				return;
			}
			const title = text(c.title, `${where}.title`, LIMITS.youtubeTitleChars, p);
			noAngles(title, `${where}.title`, p);
			const hook = c.hook === undefined ? title : text(c.hook, `${where}.hook`, 200, p);
			noAngles(hook, `${where}.hook`, p);
			let id = `short-${i + 1}`;
			if (typeof c.id === 'string' && SHORT_ID.test(c.id)) id = c.id;
			else if (c.id !== undefined) p.push(`${where}.id must be letters, digits, "_" or "-"`);
			if (shorts.some((s) => s.id === id)) p.push(`${where}: duplicate id "${id}"`);
			const from = scenes.findIndex((s) => s.id === c.from);
			const to = scenes.findIndex((s) => s.id === c.to);
			if (from === -1) p.push(`${where}.from "${String(c.from)}" is not a scene id`);
			if (to === -1) p.push(`${where}.to "${String(c.to)}" is not a scene id`);
			if (from !== -1 && to !== -1 && to < from) p.push(`${where}: "to" (${String(c.to)}) comes before "from" (${String(c.from)})`);
			if (!title || from === -1 || to === -1 || to < from) return;
			const range = scenes.slice(from, to + 1);
			shorts.push({
				n: i + 1,
				id,
				title,
				hook: hook ?? title,
				sceneIds: range.map((s) => s.id),
				startSec: range[0].startSec,
				endSec: range[range.length - 1].endSec,
				offers: [...new Set(range.flatMap((s) => s.offers))],
			});
		});

	// sources, hashtags, tags, disclosures
	const sources: {title: string; url: string}[] = [];
	if (raw.sources !== undefined && !Array.isArray(raw.sources)) p.push('"sources" must be a list');
	const rawSources: unknown[] = Array.isArray(raw.sources) ? raw.sources : [];
	if (rawSources.length > 30) p.push('"sources" has more than 30 items');
	rawSources.forEach((s, i) => {
		const where = `sources[${i}]`;
		if (!isRecord(s)) return void p.push(`${where} must be {"title", "url"}`);
		const title = text(s.title, `${where}.title`, 200, p);
		noAngles(title, `${where}.title`, p);
		let url = '';
		try {
			const u = new URL(String(s.url));
			if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password) url = u.href;
		} catch {
			// reported below
		}
		if (!url) p.push(`${where}.url must be an http(s) URL without credentials`);
		if (title && url) sources.push({title, url});
	});

	const hashtags = strings(raw.hashtags, '"hashtags"', 10, p).map((h, i) => {
		if (!HASHTAG.test(h)) p.push(`hashtags[${i}] "${h}" must be one word of letters, digits or "_" (with or without "#")`);
		return h.replace(/^#/, '');
	});
	const tags = strings(raw.tags, '"tags"', 40, p);
	tags.forEach((t, i) => {
		if (!t || /[,<>]/.test(t)) p.push(`tags[${i}] must be non-empty and must not contain "," "<" or ">"`);
	});
	if (youtubeTagsLength(tags) > LIMITS.youtubeTagsChars) p.push(`"tags" use ${youtubeTagsLength(tags)} of YouTube's ${LIMITS.youtubeTagsChars} characters (commas and the quotes around tags with spaces count)`);
	const disclosures = strings(raw.disclosures, '"disclosures"', 10, p).filter(Boolean);
	disclosures.forEach((d, i) => noAngles(d, `disclosures[${i}]`, p));

	// settings
	const madeForKids = decision(raw.madeForKids, '"madeForKids"', p);
	const containsSyntheticMedia = decision(raw.containsSyntheticMedia, '"containsSyntheticMedia"', p);
	const paidPromotion = decision(raw.paidPromotion, '"paidPromotion"', p);
	if (paidPromotion && !paidPromotion.value && offers.length) p.push('"paidPromotion" cannot be false while the episode lists offers');

	// render
	if (raw.render !== undefined && !isRecord(raw.render)) p.push('"render" must be an object');
	const r: Record<string, unknown> = isRecord(raw.render) ? raw.render : {};
	const pick = (key: string, re: RegExp, fallback: string | null): string | null => {
		if (r[key] === undefined || r[key] === null) return fallback;
		if (typeof r[key] === 'string' && re.test(r[key] as string)) return r[key] as string;
		p.push(`render.${key} is not valid`);
		return fallback;
	};
	const render = {
		entry: pick('entry', ENTRY, DEFAULT_RENDER.entry) as string,
		composition: pick('composition', COMPOSITION, DEFAULT_RENDER.composition) as string,
		shortComposition: pick('shortComposition', COMPOSITION, null),
		thumbnailComposition: pick('thumbnailComposition', COMPOSITION, DEFAULT_RENDER.thumbnailComposition) as string,
		thumbnails: DEFAULT_RENDER.thumbnails as number,
	};
	if (r.thumbnails !== undefined) {
		if (r.thumbnails === 1 || r.thumbnails === 2 || r.thumbnails === 3) render.thumbnails = r.thumbnails;
		else p.push('render.thumbnails must be 1, 2 or 3 (YouTube Test & Compare takes up to 3)');
	}

	// captions
	let captions: Caption[] | null = null;
	if (inputs.captions !== undefined && inputs.captions !== null) {
		const checked = checkCaptions(inputs.captions);
		if (checked.errors.length) p.push(...checked.errors.map((e) => `captions.json: ${e}`));
		else captions = checked.captions;
	}

	if (p.length) throw new InputError(`episode.json has ${p.length} problem${p.length === 1 ? '' : 's'}:\n  ${p.join('\n  ')}`);
	return {
		channel: inputs.channel,
		slug: inputs.slug,
		lang,
		title: chosen ?? '',
		titleOptions,
		summary,
		youtubeVideoId,
		scenes,
		totalSec,
		timing,
		sources,
		offers,
		hashtags,
		tags,
		cta,
		disclosures,
		madeForKids: madeForKids ? {...madeForKids, defaulted: false} : {...DEFAULT_MADE_FOR_KIDS, defaulted: true},
		containsSyntheticMedia: containsSyntheticMedia ? {...containsSyntheticMedia, defaulted: false} : {...DEFAULT_SYNTHETIC_MEDIA, defaulted: true},
		paidPromotion,
		shorts,
		render,
		captions,
		channelInfo: parseChannelInfo(inputs.channelInfo, inputs.channel),
		notes,
	};
};

export type EpisodePaths = {dir: string; episode: string; captions: string; channel: string; timeline: string};

export const episodePaths = (projectRoot: string, channel: string, slug: string, lang = 'en'): EpisodePaths => {
	const dir = join(projectRoot, 'content', channel, slug);
	return {
		dir,
		episode: join(dir, 'episode.json'),
		captions: join(dir, 'captions.json'),
		channel: join(projectRoot, 'content', channel, 'channel.json'),
		timeline: join(projectRoot, 'public', 'generated', channel, slug, lang, 'timeline.json'),
	};
};

/** Reads episode.json and its optional companions from disk, then validates them. */
export const loadEpisode = (projectRoot: string, channel: string, slug: string, opts: {captions?: string | null; timeline?: string | null} = {}): Episode => {
	if (!NAME.test(channel) || !NAME.test(slug)) throw new InputError(`expected <channel>/<slug> in lowercase a-z, 0-9 and "-" (a leading "_" is allowed), got "${channel}/${slug}"`);
	const paths = episodePaths(projectRoot, channel, slug);
	const episode = readJsonFile(paths.episode, 'episode file');
	if (episode === null) throw new InputError(`no episode.json at ${paths.episode}`);
	const lang = isRecord(episode) && typeof episode.lang === 'string' && LANG.test(episode.lang) ? episode.lang : 'en';
	const captionsPath = opts.captions ?? paths.captions;
	const timelinePath = opts.timeline ?? episodePaths(projectRoot, channel, slug, lang).timeline;
	const captions = readJsonFile(captionsPath, 'captions file');
	if (opts.captions && captions === null) throw new InputError(`captions file not found: ${opts.captions}`);
	const timeline = readJsonFile(timelinePath, 'timeline');
	if (opts.timeline && timeline === null) throw new InputError(`timeline file not found: ${opts.timeline}`);
	return parseEpisode({episode, channel, slug, captions, timeline, channelInfo: readJsonFile(paths.channel, 'channel file')});
};
