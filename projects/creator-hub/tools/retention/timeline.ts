/**
 * Joins an upload with OUR scene timeline, at pull time, and keeps a snapshot of the result in the pull record, so
 * reports still work after public/generated/ is rebuilt or deleted (it is gitignored and rebuilt by the pipeline).
 *
 * Files read (all in projects/video-studio, read-only):
 *   public/generated/<channel>/<slug>/<lang>/timeline.json   the voice step's Timeline (scene startMs, durationMs, totalMs)
 *   content/<channel>/<slug>/storyboard.json                  the source storyboard (en); storyboard.<lang>.json per language
 *   src/episode/dev/fixtures/<slug>/...                       storyboards of the "_dev" channel (as src/episode/load.ts does)
 *
 * Long-form: every timeline scene at its own position; the video is `timeline.totalMs` long (both renderers).
 * Short: only `storyboard.shorts[shortId].sceneIds`, in that order, retimed from 0 on the frame grid exactly as
 * src/episode/timing.ts and src/show/timing.ts `shortSpans` do; the show also trims its outro (end screen) to its
 * speech plus 45 frames, at least 60 frames. The video is the sum of those scenes.
 *
 * Renderer: the show (src/show) renders channel "zoora-security"; the episode engine (src/episode) everything else.
 * Override with `renderer` when an upload was made the other way; the duration check catches a wrong choice.
 */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {resolveSegment, type Renderer} from './segments.ts';
import type {Format, JoinIssue, JoinSnapshot, SceneSnapshot, StoryboardInput, StoryboardSceneInput, TimelineInput} from './types.ts';

export class JoinError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'JoinError';
	}
}

export const DEV_CHANNEL = '_dev';

export const timelinePathFor = (videoStudioDir: string, channel: string, slug: string, lang: string): string =>
	join(videoStudioDir, 'public', 'generated', channel, slug, lang, 'timeline.json');

export const SHOW_CHANNEL = 'zoora-security';

export const defaultRenderer = (channel: string): Renderer => (channel === SHOW_CHANNEL ? 'show' : 'episode');

export const storyboardDirFor = (videoStudioDir: string, channel: string, slug: string, renderer: Renderer = defaultRenderer(channel)): string =>
	channel === DEV_CHANNEL ? join(videoStudioDir, 'src', renderer === 'show' ? 'show' : 'episode', 'dev', 'fixtures', slug) : join(videoStudioDir, 'content', channel, slug);

/** ShowShort keeps this much of an outro after its last word (frames), and at least OUTRO_MIN_FRAMES (src/show/timing.ts). */
export const OUTRO_SHORT_TAIL = 45;
export const OUTRO_MIN_FRAMES = 60;

export const storyboardFileFor = (lang: string): string => (lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const readJson = (path: string, what: string): {data: unknown; sha256: string} => {
	let bytes: Buffer;
	try {
		bytes = readFileSync(path);
	} catch {
		throw new JoinError(`No ${what} at ${path}.`);
	}
	try {
		return {data: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex')};
	} catch (err) {
		throw new JoinError(`${path} is not valid JSON: ${(err as Error).message}`);
	}
};

export const parseTimeline = (data: unknown, path: string): TimelineInput => {
	const bad = (why: string) => new JoinError(`${path} is not a usable timeline: ${why}.`);
	if (!isRecord(data)) throw bad('not an object');
	if (data.version !== 1) throw bad(`version is ${String(data.version)}, expected 1`);
	if (!isNum(data.totalMs) || data.totalMs <= 0) throw bad('totalMs must be a positive number');
	if (!isNum(data.fps) || data.fps <= 0) throw bad('fps must be a positive number');
	if (!Array.isArray(data.scenes)) throw bad('scenes must be an array');
	const scenes = data.scenes.map((s, i) => {
		if (!isRecord(s) || typeof s.id !== 'string' || !isNum(s.startMs) || !isNum(s.durationMs)) throw bad(`scene ${i + 1} needs id, startMs and durationMs`);
		return {id: s.id, startMs: s.startMs, durationMs: s.durationMs, ...(isNum(s.speechMs) ? {speechMs: s.speechMs} : {})};
	});
	return {
		version: 1,
		slug: typeof data.slug === 'string' ? data.slug : '',
		lang: typeof data.lang === 'string' ? data.lang : '',
		mode: typeof data.mode === 'string' ? data.mode : undefined,
		fps: data.fps,
		totalMs: data.totalMs,
		mock: data.mock === true,
		scenes,
	};
};

export const parseStoryboard = (data: unknown, path: string): StoryboardInput => {
	const bad = (why: string) => new JoinError(`${path} is not a usable storyboard: ${why}.`);
	if (!isRecord(data) || !Array.isArray(data.scenes)) throw bad('it needs a scenes array');
	const scenes: StoryboardSceneInput[] = data.scenes.map((s, i) => {
		if (!isRecord(s) || typeof s.id !== 'string') throw bad(`scene ${i + 1} has no id`);
		return {
			id: s.id,
			type: typeof s.type === 'string' ? s.type : 'unknown',
			onScreen: isRecord(s.onScreen) ? s.onScreen : undefined,
			badger: isRecord(s.badger) ? {present: s.badger.present === true, reaction: typeof s.badger.reaction === 'string' ? s.badger.reaction : undefined} : undefined,
			segment: s.segment,
			show: s.show,
		};
	});
	const shorts = Array.isArray(data.shorts)
		? data.shorts.filter(isRecord).map((x) => ({id: String(x.id), sceneIds: Array.isArray(x.sceneIds) ? x.sceneIds.map(String) : [], title: typeof x.title === 'string' ? x.title : undefined}))
		: undefined;
	return {
		version: isNum(data.version) ? data.version : 1,
		channel: typeof data.channel === 'string' ? data.channel : undefined,
		slug: typeof data.slug === 'string' ? data.slug : undefined,
		lang: typeof data.lang === 'string' ? data.lang : undefined,
		sourceLang: typeof data.sourceLang === 'string' ? data.sourceLang : undefined,
		title: typeof data.title === 'string' ? data.title : undefined,
		scenes,
		shorts,
	};
};

export type JoinOptions = {
	videoStudioDir: string;
	channel: string;
	slug: string;
	lang: string;
	shortId?: string | null;
	/** Overrides, e.g. a timeline unpacked from a render-farm artifact. */
	timelinePath?: string;
	storyboardPath?: string;
	renderer?: Renderer;
};

/** A path inside video-studio as "video-studio/<relative>", so snapshots do not record local directory layouts. */
const shownPath = (videoStudioDir: string, path: string): string => {
	const rel = relative(videoStudioDir, path);
	return rel && !rel.startsWith('..') && !isAbsolute(rel) ? `video-studio/${rel.split('\\').join('/')}` : path;
};

const fmt = (ms: number): string => {
	const s = Math.max(0, ms) / 1000;
	return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

/** Builds the scene snapshot for one upload. Throws JoinError when nothing usable can be built. */
export const buildJoin = (options: JoinOptions): JoinSnapshot => {
	const timelinePath = options.timelinePath ?? timelinePathFor(options.videoStudioDir, options.channel, options.slug, options.lang);
	const tlFile = readJson(timelinePath, `timeline (run the voice step for ${options.channel}/${options.slug} --lang ${options.lang}, or pass --timeline)`);
	const timeline = parseTimeline(tlFile.data, timelinePath);
	const issues: JoinIssue[] = [];
	if (timeline.mock) issues.push({code: 'mock-timeline', detail: 'the timeline is a mock (silent preview); no real upload was rendered from it'});

	// storyboards: the upload's language, and the source (en) for titles and segment inference
	const renderer = options.renderer ?? defaultRenderer(options.channel);
	const sbDir = options.storyboardPath ? dirname(options.storyboardPath) : storyboardDirFor(options.videoStudioDir, options.channel, options.slug, renderer);
	const langPath = options.storyboardPath ?? join(sbDir, storyboardFileFor(options.lang));
	const sourcePath = join(sbDir, 'storyboard.json');
	let storyboard: StoryboardInput | null = null;
	let storyboardRef: {path: string | null; sha256: string | null} = {path: null, sha256: null};
	if (existsSync(langPath)) {
		const file = readJson(langPath, 'storyboard');
		storyboard = parseStoryboard(file.data, langPath);
		storyboardRef = {path: langPath, sha256: file.sha256};
	} else if (existsSync(sourcePath)) {
		const file = readJson(sourcePath, 'storyboard');
		storyboard = parseStoryboard(file.data, sourcePath);
		storyboardRef = {path: sourcePath, sha256: file.sha256};
		issues.push({code: 'storyboard-fallback', detail: `no ${storyboardFileFor(options.lang)}; scene types come from storyboard.json (scene ids are stable across languages)`});
	} else {
		issues.push({code: 'no-storyboard', detail: `no storyboard in ${sbDir}; scene types are unknown`});
	}
	const source = sourcePath !== storyboardRef.path && existsSync(sourcePath) ? parseStoryboard(readJson(sourcePath, 'storyboard').data, sourcePath) : storyboard;

	const sceneById = new Map((storyboard?.scenes ?? []).map((s) => [s.id, s]));
	const sourceById = new Map((source?.scenes ?? []).map((s) => [s.id, s]));
	const frameMs = 1000 / timeline.fps;

	const snapshot = (id: string, index: number, startMs: number, durationMs: number, speechMs: number | undefined): SceneSnapshot => {
		const sc = sceneById.get(id) ?? sourceById.get(id);
		const src = sourceById.get(id);
		const seg = resolveSegment(sc, src, renderer);
		const title = src?.onScreen?.title ?? sc?.onScreen?.title;
		return {
			id,
			index,
			type: sc?.type ?? 'unknown',
			segment: seg.segment,
			segmentSource: seg.source,
			badger: sc ? sc.badger?.present === true : null,
			title: typeof title === 'string' ? title.slice(0, 80) : null,
			startMs,
			durationMs,
			speechMs: speechMs ?? null,
		};
	};

	let format: Format = 'long';
	let totalMs = timeline.totalMs;
	const scenes: SceneSnapshot[] = [];
	const inTimeline = new Map(timeline.scenes.map((s) => [s.id, s]));

	if (options.shortId) {
		format = 'short';
		if (!storyboard) throw new JoinError(`A Short needs its storyboard (storyboard.shorts), and none was found in ${sbDir}.`);
		const short = (storyboard.shorts ?? []).find((s) => s.id === options.shortId) ?? (source?.shorts ?? []).find((s) => s.id === options.shortId);
		if (!short) {
			const have = (storyboard.shorts ?? []).map((s) => s.id);
			throw new JoinError(`The storyboard has no short "${options.shortId}"${have.length ? ` (it has: ${have.join(', ')})` : ''}.`);
		}
		// the frame grid of src/episode/timing.ts shortSpans: each scene keeps its own whole-frame length
		const toFrame = (ms: number) => Math.round((ms * timeline.fps) / 1000);
		let atFrames = 0;
		for (const id of short.sceneIds) {
			const s = inTimeline.get(id);
			if (!s) {
				issues.push({code: 'short-scene-missing', detail: `short "${short.id}" lists scene ${id}, which is not in the timeline; it was skipped, so the Short's expected length is shorter`});
				continue;
			}
			let frames = Math.max(1, toFrame(s.startMs + s.durationMs) - toFrame(s.startMs));
			const snap = snapshot(id, scenes.length, atFrames * frameMs, frames * frameMs, s.speechMs);
			if (renderer === 'show' && snap.segment === 'OutroEndScreen') {
				frames = Math.min(frames, Math.max(OUTRO_MIN_FRAMES, toFrame(s.speechMs ?? 0) + OUTRO_SHORT_TAIL));
				snap.durationMs = frames * frameMs;
			}
			scenes.push(snap);
			atFrames += frames;
		}
		totalMs = atFrames * frameMs;
	} else {
		let prevEnd = 0;
		let prevId = '(start)';
		for (const s of timeline.scenes) {
			if (s.durationMs <= 0) {
				issues.push({code: 'empty-scene', detail: `scene ${s.id} has no duration; skipped`});
				continue;
			}
			if (s.startMs >= totalMs) {
				issues.push({code: 'scene-past-end', detail: `scene ${s.id} starts at ${fmt(s.startMs)}, after the video ends (${fmt(totalMs)}); skipped`});
				continue;
			}
			if (s.startMs - prevEnd > frameMs) {
				issues.push({code: 'gap', detail: `${fmt(prevEnd)}-${fmt(s.startMs)} (${Math.round(s.startMs - prevEnd)} ms) between ${prevId} and ${s.id} has no scene`});
			} else if (prevEnd - s.startMs > frameMs) {
				issues.push({code: 'overlap', detail: `scene ${s.id} starts ${Math.round(prevEnd - s.startMs)} ms before ${prevId} ends`});
			}
			let end = s.startMs + s.durationMs;
			if (end - totalMs > frameMs) {
				issues.push({code: 'scene-past-end', detail: `scene ${s.id} ends at ${fmt(end)}, after the video ends (${fmt(totalMs)}); cut at the end`});
				end = totalMs;
			}
			scenes.push(snapshot(s.id, scenes.length, s.startMs, Math.min(end, totalMs) - s.startMs, s.speechMs));
			if (!sceneById.has(s.id) && !sourceById.has(s.id) && storyboard) issues.push({code: 'scene-not-in-storyboard', detail: `scene ${s.id} is not in the storyboard; its type is unknown`});
			prevEnd = Math.max(prevEnd, end);
			prevId = s.id;
		}
		if (totalMs - prevEnd > frameMs && scenes.length) {
			issues.push({code: 'uncovered-tail', detail: `${fmt(prevEnd)}-${fmt(totalMs)} (${Math.round(totalMs - prevEnd)} ms) at the end has no scene`});
		}
		for (const sc of storyboard?.scenes ?? []) {
			if (!inTimeline.has(sc.id)) issues.push({code: 'storyboard-scene-missing', detail: `storyboard scene ${sc.id} (${sc.type}) is not in the timeline`});
		}
	}
	if (!scenes.length) throw new JoinError(`No scene of ${options.channel}/${options.slug} (${options.lang}${options.shortId ? `, short ${options.shortId}` : ''}) could be placed on the timeline.`);
	return {
		format,
		shortId: options.shortId ?? null,
		renderer,
		totalMs,
		fps: timeline.fps,
		scenes,
		timeline: {path: shownPath(options.videoStudioDir, timelinePath), sha256: tlFile.sha256, mode: timeline.mode ?? null, mock: timeline.mock === true, lang: timeline.lang},
		storyboard: {path: storyboardRef.path === null ? null : shownPath(options.videoStudioDir, storyboardRef.path), sha256: storyboardRef.sha256},
		issues,
	};
};
