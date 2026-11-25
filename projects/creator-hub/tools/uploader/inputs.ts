/**
 * Everything one upload is built from, read and checked before anything is planned:
 * - kit.json: the publish kit (PublishKit, creator-hub/src/types.ts) written by video-studio/scripts/publish-kit.
 *   Title and description, settings (made for kids, synthetic media, paid promotion), captions, renders, checks.
 *   A Short's title and description come from the kit's shorts-<n>.txt (its documented per-Short file).
 * - the rendered file (hashed with SHA-256), the thumbnail and caption files (hashed), the storyboard (version and
 *   hash): the approval record binds all of them.
 * - channels.json (this folder): category, language, playlists and the pinned channel id per channel.
 * - an optional upload spec (--spec): localizations, extra caption languages, tags, category or playlist overrides.
 *   Nobody else checks the spec's text, so its tags and translations go through the en/es/pt income-claim rules
 *   (claims.ts), and every offer link a translation keeps needs its owner-approved disclosure in that language next to
 *   it (disclosures.ts). Both are refusals.
 * - the episode's episode.json when present (tags, language).
 * Paths in the kit, the spec and approval records are relative to projects/video-studio unless absolute.
 */
import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PublishKit} from '../../src/types.ts';
import {COVERED_LANGUAGES, findClaims} from './claims.ts';
import {DAILY_LIMITS, LANGUAGE_TAGS, LIMITS} from './contracts.ts';
import {loadApprovedDisclosures, localizedDisclosureProblems} from './disclosures.ts';
import {bcp47, fileStamp, type FileStamp, hashFile, isRecord, num, readJson, type Reason, sha256Hex, sniffImage, str, UsageError, utf8Bytes, videoMimeType, youtubeTagsLength} from './util.ts';

export type {PublishKit};

/** projects/video-studio, when the kit is not inside it. */
export const DEFAULT_VIDEO_STUDIO = fileURLToPath(new URL('../../../video-studio/', import.meta.url));
export const DEFAULT_CHANNELS_FILE = fileURLToPath(new URL('./channels.json', import.meta.url));

const SLUG = /^[a-z0-9_][a-z0-9-]{0,80}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const CATEGORY_ID = /^\d{1,3}$/;
const RENDER_ID = /^(long|short-\d{1,2})$/;

/* ------------------------------------------------------------------ channels.json */

export type ChannelConfig = {
	/** Pins the YouTube channel (UC...) this slug uploads to. null: the channel saved by "auth --channel <slug>" is used. */
	youtubeChannelId: string | null;
	/** snippet.categoryId. Required before any upload: an owner decision (list them with "cli.ts categories"). */
	categoryId: string | null;
	/** Language of titles, descriptions and the main audio (pipeline code or BCP-47). */
	defaultLanguage: string;
	/** Playlist each kind of upload is added to; null skips the playlist step. */
	playlists: {long: string | null; short: string | null};
};

export type ChannelsConfig = {
	version: 1;
	dailyLimits: {defaultUnits: number; uploadCalls: number};
	maxUnitsPerRun: number;
	minLeadMinutes: number;
	approvalMaxDays: number;
	channels: Record<string, ChannelConfig>;
};

const intIn = (value: unknown, min: number, max: number): number | null => {
	const n = num(value);
	return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export const parseChannels = (data: unknown, source: string): ChannelsConfig => {
	const problems: Reason[] = [];
	const bad = (message: string) => problems.push({code: 'channels-invalid', message: `${source}: ${message}`});
	if (!isRecord(data) || data.version !== 1) throw new UsageError([{code: 'channels-invalid', message: `${source}: expected {"version": 1, ...}`}]);
	const limits = isRecord(data.dailyLimits) ? data.dailyLimits : {};
	const defaultUnits = limits.defaultUnits === undefined ? DAILY_LIMITS.defaultUnits : intIn(limits.defaultUnits, 1, 10_000_000);
	const uploadCalls = limits.uploadCalls === undefined ? DAILY_LIMITS.uploadCalls : intIn(limits.uploadCalls, 1, 100_000);
	if (defaultUnits === null) bad('dailyLimits.defaultUnits must be a whole number of at least 1');
	if (uploadCalls === null) bad('dailyLimits.uploadCalls must be a whole number of at least 1');
	const maxUnitsPerRun = data.maxUnitsPerRun === undefined ? 3000 : intIn(data.maxUnitsPerRun, 1, 10_000_000);
	if (maxUnitsPerRun === null) bad('maxUnitsPerRun must be a whole number of at least 1');
	const minLeadMinutes = data.minLeadMinutes === undefined ? 60 : intIn(data.minLeadMinutes, 5, 7 * 24 * 60);
	if (minLeadMinutes === null) bad('minLeadMinutes must be a whole number from 5 to 10080');
	const approvalMaxDays = data.approvalMaxDays === undefined ? 30 : intIn(data.approvalMaxDays, 1, 90);
	if (approvalMaxDays === null) bad('approvalMaxDays must be a whole number from 1 to 90');
	const channels: Record<string, ChannelConfig> = {};
	if (!isRecord(data.channels)) bad('"channels" must be an object keyed by channel slug');
	for (const [slug, raw] of Object.entries(isRecord(data.channels) ? data.channels : {})) {
		if (!SLUG.test(slug) || !isRecord(raw)) {
			bad(`channel "${slug}" must be an object under a lowercase slug`);
			continue;
		}
		const id = raw.youtubeChannelId ?? null;
		if (id !== null && (typeof id !== 'string' || !CHANNEL_ID.test(id))) bad(`${slug}.youtubeChannelId must be null or a channel id like UC + 22 characters`);
		const category = raw.categoryId ?? null;
		if (category !== null && (typeof category !== 'string' || !CATEGORY_ID.test(category))) bad(`${slug}.categoryId must be null or a numeric string such as "28"`);
		const language = str(raw.defaultLanguage) ?? 'en';
		if (!bcp47(language, LANGUAGE_TAGS)) bad(`${slug}.defaultLanguage "${language}" is not a language code`);
		const playlists = isRecord(raw.playlists) ? raw.playlists : {};
		const playlist = (kind: 'long' | 'short'): string | null => {
			const value = playlists[kind] ?? null;
			if (value !== null && (typeof value !== 'string' || !PLAYLIST_ID.test(value))) bad(`${slug}.playlists.${kind} must be null or a playlist id`);
			return typeof value === 'string' ? value : null;
		};
		channels[slug] = {
			youtubeChannelId: typeof id === 'string' ? id : null,
			categoryId: typeof category === 'string' ? category : null,
			defaultLanguage: language,
			playlists: {long: playlist('long'), short: playlist('short')},
		};
	}
	// one YouTube channel per slug: two slugs pinned to one id would send both slugs' uploads to that channel
	const pinnedBy = new Map<string, string>();
	for (const [slug, config] of Object.entries(channels)) {
		const id = config.youtubeChannelId;
		if (id === null) continue;
		const other = pinnedBy.get(id);
		if (other) bad(`${slug}.youtubeChannelId ${id} is already pinned to "${other}": each channel id belongs to one slug`);
		else pinnedBy.set(id, slug);
	}
	if (problems.length) throw new UsageError(problems);
	return {
		version: 1,
		dailyLimits: {defaultUnits: defaultUnits ?? DAILY_LIMITS.defaultUnits, uploadCalls: uploadCalls ?? DAILY_LIMITS.uploadCalls},
		maxUnitsPerRun: maxUnitsPerRun ?? 3000,
		minLeadMinutes: minLeadMinutes ?? 60,
		approvalMaxDays: approvalMaxDays ?? 30,
		channels,
	};
};

export const loadChannels = (path: string): ChannelsConfig => parseChannels(readJson(path, 'Channel settings (channels.json)'), path);

/* ------------------------------------------------------------------ upload spec */

export type SpecCaption = {language: string; name?: string; file: string};
export type UploadSpec = {
	version: 1;
	categoryId?: string;
	defaultLanguage?: string;
	audioLanguage?: string;
	tags?: string[];
	playlistId?: string | null;
	notifySubscribers?: boolean;
	embeddable?: boolean;
	license?: 'youtube' | 'creativeCommon';
	publicStatsViewable?: boolean;
	localizations?: Record<string, {title: string; description: string}>;
	captions?: SpecCaption[];
	thumbnail?: string | null;
};

/** Keys that look like settings but must never come from a spec, with the reason shown to the owner. */
const FORBIDDEN_SPEC_KEYS: Record<string, string> = {
	privacyStatus: 'uploads are always private; the owner publishes, or schedules with publishAt in the approval record',
	privacy: 'uploads are always private; the owner publishes, or schedules with publishAt in the approval record',
	status: 'status fields come from kit.json and the approval record',
	publishAt: 'the publish time comes from the approval record (approve --publish-at)',
	madeForKids: 'made-for-kids comes from kit.json settings (episode.json madeForKids in the publish kit)',
	selfDeclaredMadeForKids: 'made-for-kids comes from kit.json settings (episode.json madeForKids in the publish kit)',
	containsSyntheticMedia: 'the altered/synthetic media flag comes from kit.json settings',
	paidPromotion: 'paid promotion is set in YouTube Studio (the API field is not documented consistently; see README)',
	paidProductPlacementDetails: 'paid promotion is set in YouTube Studio (the API field is not documented consistently; see README)',
	title: 'the title comes from the publish kit (kit.json or shorts-<n>.txt)',
	description: 'the description comes from the publish kit (kit.json or shorts-<n>.txt)',
};
const SPEC_KEYS = new Set(['version', 'categoryId', 'defaultLanguage', 'audioLanguage', 'tags', 'playlistId', 'notifySubscribers', 'embeddable', 'license', 'publicStatsViewable', 'localizations', 'captions', 'thumbnail']);

export const parseSpec = (data: unknown, source: string): UploadSpec => {
	const problems: Reason[] = [];
	const bad = (message: string) => problems.push({code: 'spec-invalid', message: `${source}: ${message}`});
	if (!isRecord(data) || data.version !== 1) throw new UsageError([{code: 'spec-invalid', message: `${source}: expected an upload spec {"version": 1, ...}`}]);
	for (const key of Object.keys(data)) {
		if (FORBIDDEN_SPEC_KEYS[key]) bad(`"${key}" cannot be set here: ${FORBIDDEN_SPEC_KEYS[key]}.`);
		else if (!SPEC_KEYS.has(key)) bad(`unknown key "${key}".`);
	}
	const spec: UploadSpec = {version: 1};
	if (data.categoryId !== undefined) {
		if (typeof data.categoryId !== 'string' || !CATEGORY_ID.test(data.categoryId)) bad('categoryId must be a numeric string such as "28".');
		else spec.categoryId = data.categoryId;
	}
	for (const key of ['defaultLanguage', 'audioLanguage'] as const) {
		if (data[key] === undefined) continue;
		const value = data[key];
		if (typeof value !== 'string' || !bcp47(value, LANGUAGE_TAGS)) bad(`${key} must be a language code such as "en" or "pt-BR".`);
		else spec[key] = value;
	}
	if (data.tags !== undefined) {
		if (!Array.isArray(data.tags) || !data.tags.every((t) => typeof t === 'string')) bad('tags must be a list of strings.');
		else spec.tags = data.tags as string[];
	}
	if (data.playlistId !== undefined) {
		if (data.playlistId !== null && (typeof data.playlistId !== 'string' || !PLAYLIST_ID.test(data.playlistId))) bad('playlistId must be a playlist id or null (no playlist).');
		else spec.playlistId = data.playlistId as string | null;
	}
	for (const key of ['notifySubscribers', 'embeddable', 'publicStatsViewable'] as const) {
		if (data[key] === undefined) continue;
		if (typeof data[key] !== 'boolean') bad(`${key} must be true or false.`);
		else spec[key] = data[key] as boolean;
	}
	if (data.license !== undefined) {
		if (data.license !== 'youtube' && data.license !== 'creativeCommon') bad('license must be "youtube" or "creativeCommon".');
		else spec.license = data.license;
	}
	if (data.localizations !== undefined) {
		if (!isRecord(data.localizations)) bad('localizations must be an object keyed by language code.');
		else {
			const out: Record<string, {title: string; description: string}> = {};
			for (const [lang, value] of Object.entries(data.localizations)) {
				if (!isRecord(value) || typeof value.title !== 'string' || typeof value.description !== 'string') bad(`localizations.${lang} needs a "title" and a "description" string.`);
				else out[lang] = {title: value.title, description: value.description};
			}
			spec.localizations = out;
		}
	}
	if (data.captions !== undefined) {
		if (!Array.isArray(data.captions)) bad('captions must be a list of {language, name?, file}.');
		else {
			spec.captions = [];
			data.captions.forEach((c, i) => {
				if (!isRecord(c) || typeof c.language !== 'string' || typeof c.file !== 'string' || (c.name !== undefined && typeof c.name !== 'string')) {
					bad(`captions[${i}] needs "language" and "file" strings (and an optional "name").`);
				} else spec.captions?.push({language: c.language, file: c.file, ...(typeof c.name === 'string' ? {name: c.name} : {})});
			});
		}
	}
	if (data.thumbnail !== undefined) {
		if (data.thumbnail !== null && typeof data.thumbnail !== 'string') bad('thumbnail must be a file path or null (no custom thumbnail).');
		else spec.thumbnail = data.thumbnail as string | null;
	}
	if (problems.length) throw new UsageError(problems);
	return spec;
};

/* ------------------------------------------------------------------ kit.json */

const KIT_PLATFORMS = ['youtube', 'shorts', 'tiktok', 'reels', 'x', 'instagram'] as const;

/** Validates the parts of kit.json the uploader uses; anything else in the kit is passed through untouched. */
export const parseKit = (data: unknown, source: string): PublishKit => {
	const problems: string[] = [];
	if (!isRecord(data) || data.version !== 1) throw new UsageError([{code: 'kit-invalid', message: `${source} is not a publish kit (version 1).`}]);
	if (typeof data.channel !== 'string' || !SLUG.test(data.channel)) problems.push('channel');
	if (typeof data.slug !== 'string' || !SLUG.test(data.slug)) problems.push('slug');
	if (typeof data.title !== 'string') problems.push('title');
	const posts = isRecord(data.posts) ? data.posts : null;
	if (!posts || !KIT_PLATFORMS.every((p) => isRecord(posts[p]) && typeof (posts[p] as Record<string, unknown>).text === 'string')) problems.push('posts');
	const captions = isRecord(data.captions) ? data.captions : null;
	if (!captions || !(captions.srt === null || typeof captions.srt === 'string')) problems.push('captions');
	if (!Array.isArray(data.renders) || !data.renders.every((r) => isRecord(r) && typeof r.id === 'string' && typeof r.output === 'string' && ['long', 'short', 'thumbnail'].includes(String(r.kind)))) problems.push('renders');
	const settings = isRecord(data.settings) ? data.settings : null;
	if (!settings || typeof settings.madeForKids !== 'boolean' || typeof settings.containsSyntheticMedia !== 'boolean' || typeof settings.paidPromotion !== 'boolean' || !Array.isArray(settings.reasons)) problems.push('settings');
	if (!Array.isArray(data.checks) || !data.checks.every((c) => isRecord(c) && typeof c.id === 'string' && typeof c.ok === 'boolean')) problems.push('checks');
	if (problems.length) throw new UsageError([{code: 'kit-invalid', message: `${source}: missing or malformed ${problems.join(', ')} (see PublishKit in creator-hub/src/types.ts).`}]);
	return data as PublishKit;
};

/** kit.json is written to <video-studio>/out/publish/<channel>/<slug>/kit.json; use that root when the kit lives there. */
export const findVideoStudioRoot = (kitPath: string, override: string | null): string => {
	if (override) return resolve(override);
	const match = /^(.*)[\\/]out[\\/]publish[\\/][^\\/]+[\\/][^\\/]+[\\/]kit\.json$/.exec(resolve(kitPath));
	return match ? match[1] : resolve(DEFAULT_VIDEO_STUDIO);
};

/** Parses the publish kit's shorts-<n>.txt: "=== Short n of N ... ===", "TITLE (...):", title, "", "DESCRIPTION (...):", description. */
export const parseShortFile = (text: string, source: string): {title: string; description: string} => {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const titleAt = lines.findIndex((l) => /^TITLE \(\d+\/\d+ characters\):$/.test(l));
	const descAt = lines.findIndex((l) => /^DESCRIPTION \(\d+\/\d+ bytes\):$/.test(l));
	if (!/^=== Short \d+ of \d+: /.test(lines[0] ?? '') || titleAt !== 1 || descAt < 3 || lines[descAt - 1] !== '') {
		throw new UsageError([{code: 'short-file-invalid', message: `${source} is not in the publish kit's shorts-<n>.txt format.`}]);
	}
	const title = lines.slice(titleAt + 1, descAt - 1).join('\n');
	const description = lines.slice(descAt + 1).join('\n').replace(/\n+$/, '');
	return {title, description};
};

/* ------------------------------------------------------------------ gathered inputs */

export type FileFact = {path: string; rel: string; bytes: number; sha256: string};
export type VideoInput = FileFact & {mimeType: string; stamp: FileStamp};
export type ThumbnailInput = FileFact & {mimeType: 'image/png' | 'image/jpeg'; width: number; height: number; content: Buffer};
export type CaptionInput = {language: string; name: string; source: 'kit' | 'file'; rel: string | null; bytes: number; sha256: string; content: Buffer};
export type StoryboardInput = FileFact & {version: number};

export type UploadInputs = {
	root: string;
	kitPath: string;
	kit: PublishKit;
	channel: string;
	slug: string;
	render: {id: string; kind: 'long' | 'short'};
	channelConfig: ChannelConfig;
	config: ChannelsConfig;
	video: VideoInput;
	thumbnail: ThumbnailInput | null;
	captions: CaptionInput[];
	storyboard: StoryboardInput;
	spec: {rel: string; sha256: string; data: UploadSpec} | null;
	title: string;
	description: string;
	tags: string[];
	categoryId: string;
	defaultLanguage: string;
	audioLanguage: string;
	localizations: Record<string, {title: string; description: string}>;
	playlistId: string | null;
	extras: {notifySubscribers?: boolean; embeddable?: boolean; license?: 'youtube' | 'creativeCommon'; publicStatsViewable?: boolean};
	/** Failing publish-kit checks: the uploader refuses while any check fails. */
	kitFailures: Reason[];
	warnings: string[];
};

export type GatherOptions = {
	kitPath: string;
	videoStudioRoot: string | null;
	channels: ChannelsConfig;
	renderId: string;
	/** Upload this file instead of the kit's render output (absolute, or relative to the video-studio root). */
	video?: string | null;
	/** undefined: spec or kit default; null: no custom thumbnail; string: this image. */
	thumbnail?: string | null;
	spec?: string | null;
	storyboard?: string | null;
};

/** Absolute path for a path written relative to projects/video-studio. */
export const fromRoot = (root: string, path: string): string => (isAbsolute(path) ? path : join(root, path));
/** Path as stored in records: relative to projects/video-studio when inside it, else absolute. */
export const toRootRel = (root: string, path: string): string => {
	const rel = relative(root, path);
	return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split('\\').join('/') : path;
};

const titleProblems = (title: string, where: string): string[] => [
	...(title.trim() ? [] : [`${where}: the title is empty`]),
	...(title.length > LIMITS.titleChars ? [`${where}: the title has ${title.length} characters (YouTube allows ${LIMITS.titleChars})`] : []),
	...(/[<>]/.test(title) ? [`${where}: the title contains "<" or ">", which YouTube rejects`] : []),
];
const descriptionProblems = (text: string, where: string): string[] => [
	...(utf8Bytes(text) > LIMITS.descriptionBytes ? [`${where}: the description is ${utf8Bytes(text)} bytes (YouTube allows ${LIMITS.descriptionBytes})`] : []),
	...(/[<>]/.test(text) ? [`${where}: the description contains "<" or ">", which YouTube rejects`] : []),
];

/** http(s) URLs in a text, without trailing punctuation. */
export const urlsIn = (text: string): string[] => [...text.matchAll(/https?:\/\/[^\s<>"]+/g)].map((m) => m[0].replace(/[.,;:!?)\]]+$/, ''));

/** SubRip check: plain UTF-8 (YouTube Help 2734698) with at least one timed cue. */
export const srtProblems = (content: Buffer, where: string): string[] => {
	let text: string;
	try {
		text = new TextDecoder('utf-8', {fatal: true}).decode(content);
	} catch {
		return [`${where} is not UTF-8 (YouTube needs SRT files in plain UTF-8)`];
	}
	return /\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(text) ? [] : [`${where} has no timed cues (expected SRT lines like "00:00:01,000 --> 00:00:03,500")`];
};

export const gatherInputs = async (opts: GatherOptions): Promise<UploadInputs> => {
	const kitPath = resolve(opts.kitPath);
	const kit = parseKit(readJson(kitPath, 'Publish kit (kit.json)'), kitPath);
	const root = findVideoStudioRoot(kitPath, opts.videoStudioRoot);
	const kitDir = dirname(kitPath);
	const problems: string[] = [];
	const warnings: string[] = [];

	const channelConfig = opts.channels.channels[kit.channel];
	if (!channelConfig) throw new UsageError([{code: 'channel-unknown', message: `Channel "${kit.channel}" is not in channels.json. Add it (category, language, playlists) before uploading.`}]);
	if (!RENDER_ID.test(opts.renderId)) throw new UsageError([{code: 'render-invalid', message: `--render must be "long" or "short-<n>", not "${opts.renderId}".`}]);
	const render = kit.renders.find((r) => r.id === opts.renderId);
	if (!render || render.kind === 'thumbnail') {
		const ids = kit.renders.filter((r) => r.kind !== 'thumbnail').map((r) => r.id);
		throw new UsageError([{code: 'render-unknown', message: `kit.json has no video render "${opts.renderId}" (it has: ${ids.join(', ') || 'none'}).`}]);
	}
	const kind = render.kind === 'short' ? 'short' : 'long';

	// spec
	let spec: UploadInputs['spec'] = null;
	if (opts.spec) {
		const specPath = fromRoot(root, opts.spec);
		const raw = readJson(specPath, 'Upload spec');
		spec = {rel: toRootRel(root, specPath), sha256: sha256Hex(readFileSync(specPath)), data: parseSpec(raw, specPath)};
	}
	const s = spec?.data ?? null;

	// title and description
	let title = kit.title;
	let description = kit.posts.youtube.text;
	if (kind === 'short') {
		const n = Number(opts.renderId.slice('short-'.length));
		const file = join(kitDir, `shorts-${n}.txt`);
		if (!existsSync(file)) throw new UsageError([{code: 'short-file-missing', message: `${file} is missing: re-run the publish kit for this episode.`}]);
		({title, description} = parseShortFile(readFileSync(file, 'utf8'), file));
	}
	problems.push(...titleProblems(title, 'title'), ...descriptionProblems(description, 'description'));

	// episode.json (optional): tags and language
	const episodePath = join(root, 'content', kit.channel, kit.slug, 'episode.json');
	let episodeLang: string | null = null;
	let episodeTags: string[] = [];
	if (existsSync(episodePath)) {
		const episode = readJson(episodePath, 'episode.json');
		if (isRecord(episode)) {
			episodeLang = str(episode.lang);
			if (Array.isArray(episode.tags)) episodeTags = episode.tags.filter((t): t is string => typeof t === 'string');
		}
	}

	const tags = s?.tags ?? episodeTags;
	if (tags.some((t) => !t.trim() || /[<>,]/.test(t))) problems.push('tags: a tag is empty or contains "<", ">" or a comma');
	if (youtubeTagsLength(tags) > LIMITS.tagsChars) problems.push(`tags: ${youtubeTagsLength(tags)} characters by YouTube's count (limit ${LIMITS.tagsChars})`);

	const categoryId = s?.categoryId ?? channelConfig.categoryId;
	if (!categoryId) {
		problems.push(
			`categoryId: none is set for "${kit.channel}". Choose one in tools/uploader/channels.json (an owner decision; "node tools/uploader/cli.ts categories" lists YouTube's, e.g. 28 Science & Technology, 27 Education, 24 Entertainment, 1 Film & Animation).`,
		);
	}

	const languageInput = s?.defaultLanguage ?? episodeLang ?? channelConfig.defaultLanguage;
	const defaultLanguage = bcp47(languageInput, LANGUAGE_TAGS);
	if (!defaultLanguage) problems.push(`defaultLanguage "${languageInput}" is not a language code`);
	const audioInput = s?.audioLanguage ?? languageInput;
	const audioLanguage = bcp47(audioInput, LANGUAGE_TAGS);
	if (!audioLanguage) problems.push(`audioLanguage "${audioInput}" is not a language code`);

	// The spec's own text (tags, translations) is checked by nobody else: income claims in any of en/es/pt are refusals.
	for (const tag of s?.tags ?? []) {
		for (const hit of findClaims(tag)) problems.push(`tags: "${tag}" is an income or return claim (${hit.label}); remove it`);
	}
	const localizations: Record<string, {title: string; description: string}> = {};
	const approvedDisclosures = Object.keys(s?.localizations ?? {}).length ? loadApprovedDisclosures(root, kit.channel) : null;
	for (const [code, value] of Object.entries(s?.localizations ?? {})) {
		const tag = bcp47(code, LANGUAGE_TAGS);
		if (!tag) {
			problems.push(`localizations: "${code}" is not a language code`);
			continue;
		}
		if (tag === defaultLanguage) problems.push(`localizations.${code}: the default language's title and description come from the kit; remove this entry`);
		if (localizations[tag]) problems.push(`localizations: "${code}" duplicates ${tag}`);
		problems.push(...titleProblems(value.title, `localizations.${code}`), ...descriptionProblems(value.description, `localizations.${code}`));
		// a translation may repeat the kit's links (hub links carry tracking, region checks and disclosures) but never add one
		const allowed = new Set(urlsIn(description));
		for (const url of urlsIn(value.description)) {
			if (!allowed.has(url)) problems.push(`localizations.${code}: the link ${url} is not in the kit's description; translated descriptions may only repeat the kit's links`);
		}
		for (const [field, text] of [['title', value.title], ['description', value.description]] as const) {
			for (const hit of findClaims(text)) problems.push(`localizations.${code}.${field}: income or return claim (${hit.label}): "${hit.match}". Rephrase it, even when describing a scam`);
		}
		if (!(COVERED_LANGUAGES as readonly string[]).includes(tag.toLowerCase().split('-')[0] ?? '')) {
			warnings.push(`localizations.${code}: the income-claim rules cover English, Spanish and Portuguese only; read the ${tag} title and description yourself before approving`);
		}
		// every offer link keeps its owner-approved disclosure, in this language, next to it (FTC 16 CFR 255)
		if (approvedDisclosures) problems.push(...localizedDisclosureProblems(value.description, `localizations.${code}`, tag, kit, approvedDisclosures, urlsIn));
		localizations[tag] = value;
	}

	const playlistId = s && s.playlistId !== undefined ? s.playlistId : channelConfig.playlists[kind];

	// the video file
	const videoPath = opts.video ? fromRoot(root, opts.video) : fromRoot(root, render.output);
	if (!existsSync(videoPath) || !statSync(videoPath).isFile()) {
		throw new UsageError([{code: 'video-missing', message: `The rendered file is missing: ${videoPath}. Render it (render-plan.sh) or pass --video <file>.`}]);
	}
	const stamp = fileStamp(videoPath);
	if (stamp.bytes === 0) problems.push(`${videoPath} is empty`);
	if (stamp.bytes > LIMITS.videoMaxBytes) problems.push(`${videoPath} is larger than YouTube's 256 GB limit`);
	const videoHash = await hashFile(videoPath);
	const video: VideoInput = {path: videoPath, rel: toRootRel(root, videoPath), bytes: videoHash.bytes, sha256: videoHash.sha256, mimeType: videoMimeType(videoPath), stamp};
	if (video.mimeType === 'application/octet-stream') warnings.push(`${video.rel}: unknown video extension, sent as application/octet-stream`);

	// thumbnail
	let thumbPath: string | null = null;
	if (opts.thumbnail !== undefined) thumbPath = opts.thumbnail === null ? null : fromRoot(root, opts.thumbnail);
	else if (s && s.thumbnail !== undefined) thumbPath = s.thumbnail === null ? null : fromRoot(root, s.thumbnail);
	else if (kind === 'long') {
		const planned = kit.renders.find((r) => r.kind === 'thumbnail');
		if (planned) thumbPath = fromRoot(root, planned.output);
	}
	let thumbnail: ThumbnailInput | null = null;
	if (thumbPath) {
		if (!existsSync(thumbPath)) {
			problems.push(`thumbnail ${thumbPath} is missing: render the thumbnails (render-plan.sh thumbnails), or pass --thumbnail none`);
		} else {
			const content = readFileSync(thumbPath);
			const info = sniffImage(content);
			if (!info) problems.push(`thumbnail ${thumbPath} is not a PNG or JPEG (YouTube accepts only those)`);
			else {
				if (content.length > LIMITS.thumbnailMaxBytes) problems.push(`thumbnail ${thumbPath} is over YouTube's 50 MB limit`);
				if (info.width < LIMITS.thumbnailMinWidth) problems.push(`thumbnail ${thumbPath} is ${info.width} px wide (YouTube's minimum is ${LIMITS.thumbnailMinWidth})`);
				const ratio = info.width / info.height;
				if (kind === 'long' && Math.abs(ratio - 16 / 9) > 0.02) warnings.push(`thumbnail is ${info.width}x${info.height}; YouTube recommends 16:9 for videos`);
				if (kind === 'short' && Math.abs(ratio - 9 / 16) > 0.02) warnings.push(`thumbnail is ${info.width}x${info.height}; Shorts thumbnails should be 9:16 (YouTube replaces a 16:9 one with an automatic 4:5 crop on Home, Help 72431)`);
				thumbnail = {path: thumbPath, rel: toRootRel(root, thumbPath), bytes: content.length, sha256: sha256Hex(content), mimeType: info.mimeType, width: info.width, height: info.height, content};
			}
		}
	}

	// captions: the kit's captions.srt is the default-language track of a long-form upload; the spec adds tracks
	// (other languages), and a spec track in the default language replaces the kit's
	const captions: CaptionInput[] = [];
	const captionName = (tag: string): string => (tag === defaultLanguage ? 'Captions' : 'Subtitles');
	for (const c of s?.captions ?? []) {
		const tag = bcp47(c.language, LANGUAGE_TAGS);
		const file = fromRoot(root, c.file);
		if (!tag) {
			problems.push(`captions: "${c.language}" is not a language code`);
			continue;
		}
		if (!existsSync(file)) {
			problems.push(`captions: ${file} is missing`);
			continue;
		}
		const content = readFileSync(file);
		problems.push(...srtProblems(content, file));
		if (content.length > LIMITS.captionMaxBytes) problems.push(`captions: ${file} is over YouTube's 100 MB limit`);
		captions.push({language: tag, name: c.name ?? captionName(tag), source: 'file', rel: toRootRel(root, file), bytes: content.length, sha256: sha256Hex(content), content});
	}
	if (kind === 'long' && kit.captions.srt && defaultLanguage && !captions.some((c) => c.language === defaultLanguage)) {
		const content = Buffer.from(kit.captions.srt, 'utf8');
		problems.push(...srtProblems(content, 'kit.json captions.srt'));
		captions.unshift({language: defaultLanguage, name: captionName(defaultLanguage), source: 'kit', rel: null, bytes: content.length, sha256: sha256Hex(content), content});
	}
	const seen = new Set<string>();
	for (const c of captions) {
		if (!c.name.trim() || c.name.length > LIMITS.captionNameChars) problems.push(`captions: track name "${c.name}" must have 1-${LIMITS.captionNameChars} characters`);
		const key = `${c.language}\u0000${c.name}`;
		if (seen.has(key)) problems.push(`captions: two tracks for ${c.language} named "${c.name}" (YouTube answers 409 captionExists)`);
		seen.add(key);
	}
	if (kind === 'short' && !captions.length) warnings.push('no captions for a Short: the kit has no per-Short caption files (YouTube auto-captions, or burned-in captions)');

	// storyboard
	const storyboardPath = opts.storyboard ? fromRoot(root, opts.storyboard) : join(root, 'content', kit.channel, kit.slug, 'storyboard.json');
	if (!existsSync(storyboardPath)) {
		throw new UsageError([{code: 'storyboard-missing', message: `The storyboard is missing: ${storyboardPath}. An approval binds the storyboard version, so the uploader needs it (or --storyboard <file>).`}]);
	}
	const storyboardBytes = readFileSync(storyboardPath);
	let storyboardData: unknown;
	try {
		storyboardData = JSON.parse(storyboardBytes.toString('utf8'));
	} catch (error) {
		throw new UsageError([{code: 'storyboard-invalid', message: `${storyboardPath} is not valid JSON (${(error as Error).message}).`}]);
	}
	const sbVersion = isRecord(storyboardData) ? num(storyboardData.version) : null;
	if (sbVersion === null || !Number.isInteger(sbVersion) || sbVersion < 1) problems.push(`${storyboardPath} has no storyboard "version"`);
	if (isRecord(storyboardData) && ((storyboardData.channel !== undefined && storyboardData.channel !== kit.channel) || (storyboardData.slug !== undefined && storyboardData.slug !== kit.slug))) {
		problems.push(`${storyboardPath} belongs to ${String(storyboardData.channel)}/${String(storyboardData.slug)}, not ${kit.channel}/${kit.slug}`);
	}
	const storyboard: StoryboardInput = {path: storyboardPath, rel: toRootRel(root, storyboardPath), bytes: storyboardBytes.length, sha256: sha256Hex(storyboardBytes), version: sbVersion ?? 0};

	if (problems.length) throw new UsageError(problems.map((message) => ({code: 'input-invalid', message})));

	const kitFailures = kit.checks.filter((c) => !c.ok).map((c) => ({code: 'kit-check-failed', message: `Publish-kit check "${c.id}" fails: ${c.detail}`}));
	return {
		root,
		kitPath,
		kit,
		channel: kit.channel,
		slug: kit.slug,
		render: {id: opts.renderId, kind},
		channelConfig,
		config: opts.channels,
		video,
		thumbnail,
		captions,
		storyboard,
		spec,
		title,
		description,
		tags,
		categoryId: categoryId ?? '',
		defaultLanguage: defaultLanguage ?? 'en',
		audioLanguage: audioLanguage ?? 'en',
		localizations,
		playlistId: playlistId ?? null,
		extras: {
			...(s?.notifySubscribers !== undefined ? {notifySubscribers: s.notifySubscribers} : {}),
			...(s?.embeddable !== undefined ? {embeddable: s.embeddable} : {}),
			...(s?.license !== undefined ? {license: s.license} : {}),
			...(s?.publicStatsViewable !== undefined ? {publicStatsViewable: s.publicStatsViewable} : {}),
		},
		kitFailures,
		warnings,
	};
};
