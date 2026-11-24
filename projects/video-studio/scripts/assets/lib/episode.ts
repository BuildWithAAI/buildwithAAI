/**
 * Loads one episode in one language from the pipeline's file contracts:
 *   storyboard  content/<channel>/<slug>/storyboard.<lang>.json, or storyboard.json when its "lang" matches
 *               (dev fixtures: src/episode/dev/fixtures/<slug>/ for channel "_dev")
 *   timeline    public/generated/<channel>/<slug>/<lang>/timeline.json (scripts/voice), narration.wav next to it
 *   kit         out/publish/<channel>/<slug>/kit.json (scripts/publish-kit; PublishKit in creator-hub/src/types.ts)
 *   sidecar     content/<channel>/<slug>/assets.json + assets.<lang>.json (optional, owned by these tools)
 *   corrections content/<channel>/corrections.json (scripts/news contract), filtered to this slug
 * Missing optional inputs are reported, never invented.
 */
import {existsSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {sourceIds} from './markup.ts';
import type {AssetsSidecar, Correction, EpisodeStoryboard, EpisodeTimeline, Lang, PublishKit} from './types.ts';
import {InputError, isRecord, readJson} from './util.ts';

export const LANGS: readonly Lang[] = ['en', 'es', 'pt-br', 'hi', 'it', 'zh', 'ja'];

export type Roots = {
	project: string; // projects/video-studio
	content: string; // content/
	devFixtures: string; // src/episode/dev/fixtures
	generated: string; // public/generated
	publish: string; // out/publish
};

export const defaultRoots = (project: string): Roots => ({
	project,
	content: join(project, 'content'),
	devFixtures: join(project, 'src/episode/dev/fixtures'),
	generated: join(project, 'public/generated'),
	publish: join(project, 'out/publish'),
});

export type Episode = {
	channel: string;
	slug: string;
	lang: Lang;
	dir: string; // the storyboard folder
	storyboard: EpisodeStoryboard;
	storyboardPath: string;
	timeline: EpisodeTimeline | null;
	timelinePath: string;
	narrationPath: string | null; // null when the file does not exist
	kit: PublishKit | null;
	kitPath: string | null;
	sidecar: AssetsSidecar;
	sidecarPaths: string[];
	corrections: Correction[];
	correctionsPath: string | null;
	/** Languages with a storyboard for this episode (for hreflang), with their translation status. */
	languages: {lang: Lang; reviewed: boolean}[];
	notes: string[];
};

export const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const CHANNEL = /^_?[a-z0-9][a-z0-9_-]{0,63}$/;

export const parseEpisodeRef = (ref: string): {channel: string; slug: string} => {
	const m = /^([^/]+)\/([^/]+)$/.exec(ref.trim());
	if (!m || !CHANNEL.test(m[1]) || !SLUG.test(m[2])) throw new InputError(`expected <channel>/<slug> (lowercase a-z, 0-9, "-" or "_"), got ${JSON.stringify(ref)}`);
	return {channel: m[1], slug: m[2]};
};

export const episodeDir = (roots: Roots, channel: string, slug: string): string =>
	channel === '_dev' ? join(roots.devFixtures, slug) : join(roots.content, channel, slug);

/** A storyboard counts as reviewed when it is in its source language or marked native-reviewed. */
export const isReviewed = (sb: Pick<EpisodeStoryboard, 'lang' | 'sourceLang' | 'translation'>): boolean =>
	sb.lang === sb.sourceLang || sb.translation?.status === 'native-reviewed';

const storyboardFiles = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => /^storyboard(\.[a-z]{2}(-[a-z]{2})?)?\.json$/.test(f)).sort() : []);

const checkStoryboard = (raw: unknown, path: string): EpisodeStoryboard => {
	if (!isRecord(raw)) throw new InputError(`${path}: a storyboard must be a JSON object`);
	const problems: string[] = [];
	if (raw.version !== 1) problems.push('"version" must be 1');
	for (const key of ['channel', 'slug', 'title'] as const) if (typeof raw[key] !== 'string' || !(raw[key] as string).trim()) problems.push(`"${key}" must be a non-empty string`);
	if (!LANGS.includes(raw.lang as Lang)) problems.push(`"lang" must be one of ${LANGS.join(', ')}`);
	if (!LANGS.includes(raw.sourceLang as Lang)) problems.push(`"sourceLang" must be one of ${LANGS.join(', ')}`);
	if (typeof raw.fiction !== 'boolean') problems.push('"fiction" must be true or false');
	const ids = new Set<string>();
	if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) problems.push('"scenes" must be a non-empty array');
	else
		raw.scenes.forEach((s, i) => {
			if (!isRecord(s) || typeof s.id !== 'string' || typeof s.type !== 'string' || typeof s.narration !== 'string') {
				problems.push(`scenes[${i}] needs string id, type and narration`);
				return;
			}
			if (ids.has(s.id)) problems.push(`scenes[${i}]: duplicate id "${s.id}"`);
			ids.add(s.id);
			try {
				sourceIds(s.narration);
			} catch (err) {
				problems.push(`scenes[${i}] (${s.id}): narration markup: ${(err as Error).message}`);
			}
		});
	const srcIds = new Set<string>();
	if (!Array.isArray(raw.sources)) problems.push('"sources" must be an array');
	else
		raw.sources.forEach((s, i) => {
			if (!isRecord(s) || typeof s.id !== 'string' || typeof s.title !== 'string' || typeof s.url !== 'string' || typeof s.accessed !== 'string') {
				problems.push(`sources[${i}] needs string id, title, url and accessed`);
				return;
			}
			srcIds.add(s.id);
		});
	if (Array.isArray(raw.scenes)) {
		for (const s of raw.scenes) {
			if (!isRecord(s) || typeof s.narration !== 'string') continue;
			let cited: string[] = [];
			try {
				cited = sourceIds(s.narration);
			} catch {
				continue; // already reported
			}
			for (const id of cited) if (!srcIds.has(id)) problems.push(`scene ${String(s.id)} cites [src:${id}], which is not in "sources"`);
		}
	}
	if (problems.length) throw new InputError(`${path}:\n  ${problems.join('\n  ')}`);
	return raw as unknown as EpisodeStoryboard;
};

const checkTimeline = (raw: unknown, path: string, sb: EpisodeStoryboard): EpisodeTimeline => {
	if (!isRecord(raw)) throw new InputError(`${path}: a timeline must be a JSON object`);
	const problems: string[] = [];
	if (raw.version !== 1) problems.push('"version" must be 1');
	if (raw.lang !== sb.lang) problems.push(`"lang" is ${JSON.stringify(raw.lang)} but the storyboard is "${sb.lang}"`);
	if (typeof raw.totalMs !== 'number' || raw.totalMs <= 0) problems.push('"totalMs" must be a positive number');
	if (!Array.isArray(raw.scenes)) problems.push('"scenes" must be an array');
	else {
		const want = sb.scenes.map((s) => s.id).join(',');
		const have = raw.scenes.map((s) => (isRecord(s) ? String(s.id) : '?')).join(',');
		if (want !== have) problems.push(`scene ids [${have}] do not match the storyboard [${want}]: the timeline is stale, re-run the voice step`);
		raw.scenes.forEach((s, i) => {
			if (!isRecord(s) || typeof s.startMs !== 'number' || typeof s.durationMs !== 'number' || !Array.isArray(s.words)) {
				problems.push(`scenes[${i}] needs numeric startMs/durationMs and a words array`);
				return;
			}
			for (const w of s.words) {
				if (!isRecord(w) || typeof w.text !== 'string' || typeof w.startMs !== 'number' || typeof w.endMs !== 'number' || w.endMs < w.startMs) {
					problems.push(`scenes[${i}] has a malformed word`);
					break;
				}
			}
		});
	}
	if (problems.length) throw new InputError(`${path}:\n  ${problems.join('\n  ')}`);
	return raw as unknown as EpisodeTimeline;
};

const loadSidecar = (dir: string, lang: Lang): {sidecar: AssetsSidecar; paths: string[]} => {
	const paths: string[] = [];
	let merged: AssetsSidecar = {};
	for (const name of ['assets.json', `assets.${lang}.json`]) {
		const file = join(dir, name);
		if (!existsSync(file)) continue;
		const raw = readJson(file, 'asset sidecar');
		if (!isRecord(raw)) throw new InputError(`${file}: must be a JSON object`);
		if (raw.takeaways !== undefined && !(Array.isArray(raw.takeaways) && raw.takeaways.every((t) => typeof t === 'string'))) throw new InputError(`${file}: "takeaways" must be a list of strings`);
		for (const key of ['summary', 'youtubeVideoId', 'publishedAt'] as const) if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new InputError(`${file}: "${key}" must be a string`);
		merged = {...merged, ...(raw as AssetsSidecar), podcast: {...merged.podcast, ...(raw.podcast as AssetsSidecar['podcast'])}, social: {...merged.social, ...(raw.social as AssetsSidecar['social'])}};
		paths.push(file);
	}
	return {sidecar: merged, paths};
};

const loadCorrections = (roots: Roots, channel: string, slug: string): {corrections: Correction[]; path: string | null} => {
	const file = join(roots.content, channel, 'corrections.json');
	if (!existsSync(file)) return {corrections: [], path: null};
	const raw = readJson(file, 'corrections file');
	if (!isRecord(raw) || !Array.isArray(raw.corrections)) throw new InputError(`${file}: expected {"version": 1, "corrections": [...]}`);
	const corrections = raw.corrections.filter(
		(c): c is Correction => isRecord(c) && c.slug === slug && typeof c.correct === 'string' && typeof c.date === 'string' && (c.status === 'pending' || c.status === 'pinned'),
	);
	return {corrections, path: file};
};

export type LoadOptions = {kitPath?: string | null};

export const loadEpisode = (roots: Roots, channel: string, slug: string, lang: Lang, opts: LoadOptions = {}): Episode => {
	const dir = episodeDir(roots, channel, slug);
	const files = storyboardFiles(dir);
	if (!files.length) throw new InputError(`no storyboard in ${dir}`);
	const notes: string[] = [];

	// every language's storyboard (for hreflang and the translation status)
	const all = files.map((f) => ({file: join(dir, f), sb: checkStoryboard(readJson(join(dir, f), 'storyboard'), join(dir, f))}));
	const byLang = new Map<Lang, {file: string; sb: EpisodeStoryboard}>();
	for (const entry of all) {
		const expectLang = /^storyboard\.(.+)\.json$/.exec(entry.file.slice(dir.length + 1))?.[1];
		if (expectLang && expectLang !== entry.sb.lang) throw new InputError(`${entry.file}: file name says "${expectLang}" but "lang" is "${entry.sb.lang}"`);
		if (entry.sb.channel !== channel && channel !== '_dev') throw new InputError(`${entry.file}: "channel" is "${entry.sb.channel}", expected "${channel}"`);
		if (entry.sb.slug !== slug) throw new InputError(`${entry.file}: "slug" is "${entry.sb.slug}", expected "${slug}"`);
		const prev = byLang.get(entry.sb.lang);
		if (!prev || /storyboard\.[^/]+\.json$/.test(entry.file)) byLang.set(entry.sb.lang, entry); // storyboard.<lang>.json wins
	}
	const own = byLang.get(lang);
	if (!own) throw new InputError(`no ${lang} storyboard for ${channel}/${slug}; this episode has: ${[...byLang.keys()].join(', ')}`);
	const sb = own.sb;

	const genDir = join(roots.generated, channel, slug, lang);
	const timelinePath = join(genDir, 'timeline.json');
	const timeline = existsSync(timelinePath) ? checkTimeline(readJson(timelinePath, 'timeline'), timelinePath, sb) : null;
	if (!timeline) notes.push(`no timeline at ${timelinePath}: transcript taken from the storyboard, no podcast audio (run scripts/voice/build.py first)`);
	else if (timeline.mock) notes.push('the timeline is a mock (silent preview): no podcast audio');
	let narrationPath: string | null = null;
	if (timeline && !timeline.mock) {
		const publicRoot = dirname(roots.generated);
		const candidates = [...(timeline.narration ? [resolve(publicRoot, timeline.narration)] : []), join(genDir, 'narration.wav')];
		narrationPath = candidates.find((p) => existsSync(p)) ?? null;
		if (!narrationPath) notes.push(`timeline found but no narration.wav (looked at ${candidates.join(', ')})`);
	}

	let kitPath: string | null = opts.kitPath ?? null;
	if (!kitPath) {
		const base = join(roots.publish, channel, slug);
		const candidates = lang === sb.sourceLang ? [join(base, lang, 'kit.json'), join(base, `kit.${lang}.json`), join(base, 'kit.json')] : [join(base, lang, 'kit.json'), join(base, `kit.${lang}.json`)];
		kitPath = candidates.find((p) => existsSync(p)) ?? null;
		if (!kitPath) notes.push(`no publish kit (looked at ${candidates.join(', ')})`);
	}
	let kit: PublishKit | null = null;
	if (kitPath) {
		const raw = readJson(kitPath, 'publish kit');
		if (!isRecord(raw) || raw.version !== 1) throw new InputError(`${kitPath}: a publish kit must be an object with "version": 1`);
		if (raw.slug !== slug || (channel !== '_dev' && raw.channel !== channel)) throw new InputError(`${kitPath}: kit is for ${String(raw.channel)}/${String(raw.slug)}, not ${channel}/${slug}`);
		kit = raw as unknown as PublishKit;
	}

	const {sidecar, paths: sidecarPaths} = loadSidecar(dir, lang);
	const {corrections, path: correctionsPath} = loadCorrections(roots, channel, slug);
	const languages = [...byLang.values()].map((e) => ({lang: e.sb.lang, reviewed: isReviewed(e.sb)})).sort((a, b) => LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang));

	return {channel, slug, lang, dir, storyboard: sb, storyboardPath: own.file, timeline, timelinePath, narrationPath, kit, kitPath, sidecar, sidecarPaths, corrections, correctionsPath, languages, notes};
};

/** Languages that have a storyboard for this episode. */
export const episodeLanguages = (roots: Roots, channel: string, slug: string): Lang[] => {
	const dir = episodeDir(roots, channel, slug);
	const langs = new Set<Lang>();
	for (const f of storyboardFiles(dir)) {
		const raw = readJson(join(dir, f), 'storyboard');
		if (isRecord(raw) && LANGS.includes(raw.lang as Lang)) langs.add(raw.lang as Lang);
	}
	return LANGS.filter((l) => langs.has(l));
};

/** The developing-story label of a storyboard (scripts/news contract), or null. */
export const developingLabel = (sb: EpisodeStoryboard): {label: string | null; asOf: string | null} | null => {
	const raw = sb.news?.developing ?? sb.developing;
	if (raw === undefined || raw === false) return null;
	if (raw === true) return {label: null, asOf: null};
	if (typeof raw === 'string') return {label: raw.trim() || null, asOf: null};
	return {label: raw.label?.trim() || null, asOf: raw.asOf?.trim() || null};
};
